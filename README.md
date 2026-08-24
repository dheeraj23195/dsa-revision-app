# DSA Revision

A personal spaced-repetition tool for grinding [Striver's A2Z DSA sheet](https://takeuforward.org/strivers-a2z-dsa-course/strivers-a2z-dsa-course-sheet-2/) (~455 questions).

It's not a static checklist. The point is the daily **Today** session: instead of you deciding what to re-practice, the app picks a small set of questions each day — a mix of things that are due for review, things you haven't touched in a while, and a new pattern or two — and walks you through rating each one so it knows when to bring it back.

I built this for myself and I'm sharing it so friends can use it and tell me what's broken or annoying.

## Features

- **Question Bank** — all 455 questions, grouped by step (and sub-grouped by lecture) in sheet order. Checkboxes to mark a question Done; shift-click a checkbox to bulk-mark everything between your last click and this one. Fuzzy, typo-tolerant search (so "binry search" still finds Binary Search), plus filters by step, difficulty, status, and pattern.

- **Today** — a daily review session built by a breadth-first-then-depth scheduler. Most days it's 3 Medium questions; on a "hard day" (a Hard review is due, or it's an interleave day) it's 1 Hard + 1 Medium instead. Each card is tagged with *why* it was picked — Overdue, Due, New pattern, or Hard interleave — so the plan isn't a black box. The plan is cached for the day, so refreshing the page doesn't reshuffle it.

- **Rating flow** — after attempting a question, rate it: *couldn't solve*, *hard*, *good*, or *easy*. That rating moves it along a spaced-repetition ladder with intervals of 1, 3, 7, 14, and 30 days. Passing the 30-day interval marks a question "mastered."

- **One More** — once every card in the day's plan is rated, a button lets you pull in additional questions beyond the day's plan, using the same priority logic (overdue → due → new pattern).

- **Coverage Dashboard** — a grid of every pattern/technique (Two Pointers, Sliding Window, etc.), grouped by topic, color-coded by how covered it is (untouched / learning / reviewing / mastered), with counts of reviews and done/total questions. Click a pattern to see exactly which questions under it are done vs. not done.

- **Settings** — change the daily mix (auto / always 1 Hard + 1 Medium / always 3 Medium), adjust how often hard-interleave days happen (default: every 3rd hard day), and a "reset all progress" button that wipes Done/SRS state and review history without touching the question catalog itself.

- **CSV import** — bulk-add or update questions in the catalog from a CSV file (title/url/difficulty/step/lecture/patterns). This is really an admin/maintainer tool for editing the question catalog, not something you need to touch to use the app day to day — it never touches anyone's progress.

- **Dark mode** — toggle in the top nav, remembers your choice.

## Running it locally

Tested with **Node.js v24** (should work on any reasonably recent Node — nothing in here needs anything exotic).

```bash
git clone https://github.com/dheeraj23195/dsa-revision-app.git
cd dsa-revision-app
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

On first load, the app auto-seeds all 455 questions from the sheet into your browser's local database — you don't need to import anything or run a setup step. You'll land on an empty **Today** screen (nothing's due yet since nothing's marked Done); go to **Bank** and start checking off questions you've already solved to get the review rotation going.

## Important: this is local-only, single-player, no login

There's no backend, no server, no accounts.

- **All your progress lives in your browser's local storage** (IndexedDB), scoped to this app's origin (`localhost:5173`). Nothing is synced anywhere or shared between devices.
- **Clearing your browser data, switching browsers, or running the app on a different port will lose or hide your progress.** IndexedDB is scoped per browser + per origin, and `localhost:5173` and `localhost:5174` count as different origins as far as storage is concerned — so if you ever run this on a different port, it'll look empty.
- **There's no backup or export feature yet.** It's planned once there's an actual backend to export/import against — for now, if you care about not losing your progress, don't clear site data for this app in whichever browser you're using.
- Since everything lives in your own browser, **each person running this locally has their own separate, independent instance.** Nothing you do here is visible to me or to anyone else running the app.

## Feedback

This is an actively-developed personal project, not a finished product — expect rough edges. If something's confusing, broken, or you wish it worked differently, please [open a GitHub Issue](https://github.com/dheeraj23195/dsa-revision-app/issues) on this repo. I'd genuinely like to hear about it.

A useful report usually includes:
- What you were doing (which screen, what you clicked/typed)
- What you expected to happen
- What actually happened
- Browser and OS, if it seems relevant (especially for anything visual or storage-related)

## Not built yet

Known gaps, so you don't file these as bugs:

- Export/import of your own progress (backup/restore)
- Support for other sheets (NeetCode, etc.) — this is Striver's A2Z only right now
- Login / accounts / syncing progress across devices
- Notes on individual questions
- Stats charts / trends over time
- Keyboard shortcuts
