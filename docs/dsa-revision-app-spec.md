# DSA Spaced Repetition Revision App — Build Spec (v2)

## 1. Context & Goal

A single-user, laptop-only web app for DSA placement-prep revision, built around Striver's A2Z DSA sheet (~455 questions across 18 steps). The user marks questions as Done as they study; Done questions enter a spaced-repetition rotation. Every day the app composes a small revision set ("Today"), and a **"One More"** button serves extra questions on demand.

**Scheduling priority (no hard calendar deadlines):**
1. Cover as many distinct *patterns* as possible first (breadth).
2. Once all patterns are covered, iterate over them again in cycles (depth).
3. Even during the breadth phase, periodically interleave **Hard questions from already-covered patterns** so familiar patterns get stress-tested, not just new ones touched.

## 2. Tech Stack (decided — do not re-litigate)

| Layer | Choice | Why |
|---|---|---|
| Framework | Vite + React 18 + TypeScript | Fast to build, no SSR needed |
| Styling | Tailwind CSS | Speed |
| Storage | Dexie.js (IndexedDB) | Laptop-only, local-first, offline, zero backend |
| Backup | JSON export/import buttons | Insurance against browser data loss |
| Deploy | Vercel/Netlify static, or just `npm run dev` locally | Free |
| State | Dexie `useLiveQuery` + plain hooks | Minimal |

No auth, no server, no sync. Design data access behind one repository module (`db.ts`) anyway — cheap insurance.

## 3. Data Model

```typescript
interface Question {
  id: string;                 // stable slug, e.g. "step3-kadanes-algorithm"
  title: string;
  url: string;                // LeetCode / GfG / TUF link
  difficulty: 'Easy' | 'Medium' | 'Hard';
  step: number;               // Striver A2Z step 1–18
  stepTitle: string;          // e.g. "Step 3: Arrays"
  lecture?: string;           // sub-section within the step if known
  patterns: string[];         // technique tags, e.g. ["Kadane"], ["Monotonic Stack"]
  done: boolean;              // the checkmark — user has solved/studied it
  doneAt?: string;            // ISO date
  srs: {
    ladderIndex: number;      // 0..4 → intervals [1, 3, 7, 14, 30]
    dueDate: string;          // ISO date
    lapses: number;
    reps: number;
  } | null;                   // null until first marked done
  status: 'todo' | 'learning' | 'reviewing' | 'mastered';
}

interface ReviewLog {
  id: string;
  questionId: string;
  date: string;
  rating: 'again' | 'hard' | 'good' | 'easy';
  kind: 'first-solve' | 'review' | 'one-more';
  note?: string;
}

interface Settings {
  dailyMix: 'auto' | 'hardDay' | 'mediumDay';  // default 'auto', see §5
  hardInterleaveEvery: number;                  // default 3 (every 3rd day, see §5)
}
```

Dexie tables: `questions`, `reviewLogs`, `settings` (single row), plus a `dayPlans` table caching today's generated plan so refreshing the page doesn't reshuffle it: `{ date, questionIds: string[], extraIds: string[] }`.

## 4. Spaced Repetition Algorithm

Fixed interval ladder: **[1, 3, 7, 14, 30] days.** No deadline cap.

- **Marking the checkbox Done** (first solve): initialize `srs` at `ladderIndex 0`, due tomorrow, status `learning`.
- On rating a review:
  - **Again** → ladderIndex 0, `lapses++`, due tomorrow, status `learning`.
  - **Hard** → same ladderIndex, due at same interval.
  - **Good** → ladderIndex + 1.
  - **Easy** → ladderIndex + 2 (capped at 4).
- Passing the 30-day interval with Good/Easy → status `mastered`. Mastered questions leave the regular rotation but remain eligible for "One More" and for hard-interleave picks.
- Un-checking Done resets `srs` to null and status to `todo` (with a confirm dialog).

## 5. Daily Scheduler ("Today" algorithm)

**Only questions with `done: true` are ever scheduled for review.** Questions with `done: false` never appear in Today — the user solves those at their own pace through the bank and checks them off.

### Step 1 — decide today's mix
- `hardDay` → 2 questions: **1 Hard + 1 Medium**.
- `mediumDay` → 3 questions: **3 Medium**.
- `auto` (default): pick `hardDay` if at least one Done Hard question is due/overdue or the hard-interleave rule (below) triggers today; otherwise `mediumDay`.
- Easy questions may fill a Medium slot when nothing Medium is available (prefer Medium; never let an Easy displace an available due Medium).

### Step 2 — fill the slots, in priority order
For each slot (matching its difficulty):
1. **Overdue reviews** (oldest due date first).
2. **Due-today reviews.**
3. **Coverage pick:** a Done question from the pattern with the fewest total reviews — this drives the breadth-first requirement. Ties → older `doneAt` first.
4. If literally nothing fits the slot's difficulty, relax difficulty (Hard slot ← Medium, Medium slot ← Easy) rather than serving an empty day.

### Step 3 — hard interleave ("break with duplicate patterns")
Every `hardInterleaveEvery` days (default: every 3rd day with a Hard slot), the Hard slot **ignores coverage priority** and instead picks a Hard question from the *most-reviewed / already-covered* pattern — deliberately a duplicate pattern, to deepen rather than broaden. Track this with a simple counter in settings or derive from date modulo.

### Step 4 — after full coverage
When every pattern that has ≥1 Done question has been reviewed at least once, the scheduler naturally shifts into cycling mode: priorities 1–2 (due reviews) dominate, and the coverage pick (priority 3) becomes a round-robin over patterns ordered by least-recently-reviewed. No special mode flag needed — the same rules produce this behavior.

### "One More" button
Visible on the Today screen once all of today's planned questions are rated. Each press appends exactly one question, chosen by the same priority chain (overdue → due → least-covered pattern → least-recently-reviewed pattern), difficulty preference Medium → Hard → Easy. Logged with `kind: 'one-more'` and its rating updates SRS normally. Unlimited presses; append picks to `dayPlans.extraIds` so they persist across refresh.

## 6. Screens

### Screen 1 — Today (home)
- **Top of screen: the Today section.** Cards for each planned question: title, difficulty badge, pattern tags, Striver step, a "why" label (Overdue · Due · New pattern · Hard interleave), link out, and — after the user clicks "Attempted" — the four rating buttons.
- Progress line: "2 of 3 done today · 14 patterns covered / 31 total · 9 reviews pending".
- **"One More" button** appears when all planned cards are rated.
- Skipped reviews carry over as overdue tomorrow; no streak-shaming mechanics.

### Screen 2 — Question Bank (the inventory)
- All ~455 A2Z questions **grouped by Striver step in sheet order** (Step 1: Basics → Step 18), collapsible sections, sub-grouped by lecture where available.
- Each row: **checkmark (Done toggle)**, title (links out), difficulty badge, pattern tags, status chip, next-due date if in rotation.
- Checking the box = "I solved/studied this" → enters SRS per §4. This is the primary way questions enter revision.
- Filters: step, difficulty, status, pattern; free-text search. Per-step progress bar ("Arrays: 28/53 done").
- Inline edit for patterns/difficulty/url (seed data will have imperfections), plus add-custom-question.

### Screen 3 — Coverage Dashboard
- Pattern grid grouped by topic; each cell shows attempts/reviews and a color for untouched → learning → reviewing → mastered (aggregate of its questions).
- Simple counters: patterns covered, questions done, reviews completed, current review debt.

### Screen 4 — Settings & Data
- Daily mix (auto / 1H+1M / 3M), hard-interleave frequency.
- JSON export/import (full DB), reset day plan, danger-zone full reset.

Laptop-only: optimize for desktop widths; no mobile work needed.

## 7. Seed Data — full Striver A2Z sheet

Seed the **entire A2Z sheet (~455 questions)** as a static `seed.ts`/`seed.json`, grouped by the sheet's 18 steps and their lectures, in sheet order:

1. Basics · 2. Sorting · 3. Arrays · 4. Binary Search · 5. Strings (basic) · 6. Linked List · 7. Recursion · 8. Bit Manipulation · 9. Stacks & Queues · 10. Sliding Window & Two Pointers · 11. Heaps · 12. Greedy · 13. Binary Trees · 14. BST · 15. Graphs · 16. DP · 17. Tries · 18. Strings (advanced)

Instructions for the build chat:
- **The exact question list and how it gets in (generated seed vs. user-provided CSV/JSON vs. a mix) will be discussed and decided with the user directly in the build chat.** Do not lock this in from the spec — ask the user before generating seed data.
- Whatever the source, the app must support it: build a seed loader plus a CSV/JSON bulk import with format `title,url,difficulty,step,lecture,patterns(semicolon-separated)`, and inline editing of every field in the Bank (seed data will have imperfections either way).
- If generating: title, best-known practice URL (LeetCode preferred, else GfG/TUF), difficulty, step, lecture, and **1–2 pattern tags per question** (the sheet doesn't tag patterns — infer sensible tags from a controlled vocabulary of ~35–45 pattern names rather than inventing one-off tags). Do **not** scrape takeuforward.org.
- All questions seed as `done: false` — the user will bulk-check what they already completed in June (support shift-click range-check in the bank to make this fast).

## 8. Build Phases

**Phase 1:** Dexie + data model, full seed, Question Bank with working checkmarks, Today screen with scheduler + rating flow + One More. This is the complete core loop.

**Phase 2:** Coverage dashboard, CSV import, JSON export/import, settings screen.

**Phase 3 (optional):** review notes surfaced on next attempt, stats charts, keyboard shortcuts (j/k navigate, 1–4 rate).

## 9. Non-Goals

No auth, no backend, no mobile layout, no code editor/judge, no notifications, no scraping.

## 10. Acceptance Checklist

- [ ] Bank shows all ~455 questions grouped by Striver step, each with a working Done checkmark
- [ ] Checking Done schedules the question's first review for tomorrow
- [ ] Today generates 1H+1M or 3M per §5 and the plan survives a page refresh
- [ ] Only Done questions ever appear in Today
- [ ] Every Nth hard day pulls a Hard from an already-covered pattern (interleave)
- [ ] "One More" appears only after the day's plan is fully rated and always yields a question
- [ ] Rating updates the [1,3,7,14,30] ladder correctly; Again resets to tomorrow
- [ ] Export → wipe → import restores everything including today's plan

---
*Hand this file to a fresh chat with: "Build Phase 1 of this spec exactly as written."*
