# Spec Amendments

`docs/dsa-revision-app-spec.md` is the locked build spec — handed to the
build chat as-is, not re-litigated. This file records actual changes made
to it *after* that handoff, each with the date, the reasoning, and where
it's implemented.

This is a different category from the inline "design decision" comments in
`lib/scheduler.ts` (e.g. "Design decision #3" on the interleave-requires-a-
Hard-candidate rule). Those are resolutions of ambiguity that was already
latent in the original wording — the spec didn't say, so a call had to be
made. Amendments recorded here are new behavior the original spec didn't
describe at all.

## Amendment 1 — Weak-pattern reinforcement (2026-08-17)

**What changed:** §5 Step 2's coverage pick (priority 3) now sorts
candidates by three keys instead of two:

1. Is the candidate's pattern "weak"? (weak first)
2. Fewest total reviews (as originally specced)
3. Older `doneAt` (as originally specced, final tie-break)

A pattern is **weak** as of date D if any question carrying that pattern
has an `'again'`-rated ReviewLog dated within the 7 days strictly before D
— i.e. `[D - 7, D - 1]`, not including D itself. Window size is a parameter
(`windowDays`, default 7), not a hardcoded constant.

**Why:** a pattern the user just failed (rated "Couldn't solve without
help" / `again`) is the one that most needs to come back around soon —
recency-of-struggle is a stronger breadth signal than total-review-count
alone. Without this, a pattern with one bad recent miss could still lose a
coverage slot to an untouched pattern indefinitely, just because it
happens to have a slightly higher lifetime review count.

**Where implemented:**
- `lib/scheduler.ts` — `weakPatterns(questions, reviewLogs, date,
  windowDays)`, same shape as `patternReviewCounts` (needs `questions` to
  map a ReviewLog's `questionId` back to its patterns).
- Consumed inside `pickFromPool`'s default coverage-ranking branch, which
  is the single code path both the regular Today plan (`pickForSlot`) and
  `pickOneMore` funnel through for priority 3 — so both got this change
  from one implementation point, not two.
- Fixtures: `scheduler.test.ts`, "Fixture I" — one case showing a weak
  pattern's question win a coverage slot over a strictly-fewer-reviewed,
  non-weak pattern; one case showing the same fixture 10 days later, after
  the 7-day window has passed, reverting to the original fewest-reviews
  winner.

**What's explicitly untouched:**
- Overdue and due-today (§5 priorities 1–2) — a weak pattern does not
  jump the queue ahead of an actually-due review.
- The hard-interleave override (§5 Step 3's inversion for an interleave
  day's Hard slot, which picks the *most*-covered pattern) — unaffected;
  it keeps picking on coverage alone, regardless of weakness.
- `decideMix` / the interleave-trigger check (Design decision #3) — no
  interaction with weakness at all.

## Amendment 2 — "Again" rating relabeled in the UI (2026-08-17)

**What changed:** the Today screen's rating button and "Rated: …" label
for the `'again'` rating now read "Couldn't solve without help" instead of
"Again."

**Why:** clearer to a user glancing at four buttons mid-review than the
terser SRS-jargon "Again."

**Where implemented:** `screens/TodayScreen.tsx`'s `RATING_LABELS` map
only. The underlying `Rating` type, `'again'` value, `lib/srs.ts`'s ladder
rules, and its 9 test fixtures are all unchanged — this is a label swap,
not a schema or behavior change.
