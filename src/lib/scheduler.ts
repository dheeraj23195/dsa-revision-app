// Daily scheduler — spec §5. Pure function: (questions, reviewLogs, settings,
// date) => DayPlan. No Dexie, no React, no Date.now() — every input the
// function needs (including "today") is passed in, so it's fully
// unit-testable and replayable for any date.
//
// Only `done: true` questions are ever candidates (§5: "Only questions with
// done: true are ever scheduled for review").
//
// This file also carries one post-hoc amendment to §5 itself (weak-pattern
// reinforcement, marked inline below) — see docs/SPEC-AMENDMENTS.md for the
// full record of what changed and why, kept separate from the "design
// decision" comments that just resolve ambiguity already latent in §5.

import type { DayPlan, Difficulty, PickReason, Question, ReviewLog, Settings } from '../types';
import { addDaysISO, daysBetween } from './date';

export type Mix = 'hardDay' | 'mediumDay';

export interface PlannedPick {
  questionId: string;
  /** Which step of the §5 priority chain produced this pick — the Today
   * screen's "why" label (§6: "Overdue · Due · New pattern · Hard
   * interleave") reads directly off this. */
  reason: PickReason;
}

export interface DayPlanDetail {
  date: string;
  mix: Mix;
  /** true if today is a hard-interleave day per §5 Step 3 (only meaningful
   * when mix is 'hardDay' — a mediumDay has no Hard slot for it to affect). */
  interleaveDay: boolean;
  picks: PlannedPick[];
}

// §5 Step 2.4: "If literally nothing fits the slot's difficulty, relax
// difficulty (Hard slot ← Medium, Medium slot ← Easy) rather than serving an
// empty day." Chained rather than a single fallback so a Hard slot with zero
// Hard AND zero Medium done questions still falls through to Easy.
const DIFFICULTY_RELAX_CHAIN: Record<Difficulty, Difficulty[]> = {
  Hard: ['Hard', 'Medium', 'Easy'],
  Medium: ['Medium', 'Easy'],
  Easy: ['Easy'],
};

interface Slot {
  difficulty: Difficulty;
  /** Only ever true for the Hard slot on an interleave day. */
  interleaveEligible: boolean;
}

/** §5 Step 3: "every hardInterleaveEvery days ... default: every 3rd day."
 * Derived from date modulo (spec's own suggestion) rather than a stored
 * counter, so the function stays pure and replayable for any date. Day 0 of
 * the Unix epoch is the first interleave day, then every Nth day after. */
function isHardInterleaveDay(date: string, hardInterleaveEvery: number): boolean {
  if (hardInterleaveEvery <= 0) return false;
  const epochDay = daysBetween('1970-01-01', date);
  return ((epochDay % hardInterleaveEvery) + hardInterleaveEvery) % hardInterleaveEvery === 0;
}

function decideMix(questions: Question[], settings: Settings, date: string, interleaveDay: boolean): Mix {
  // A forced setting (§6.4: "Daily mix: auto / 1H+1M / 3M") bypasses the
  // auto heuristic entirely — including the interleave-forces-hardDay rule,
  // since a forced mediumDay has no Hard slot for interleave to occupy.
  if (settings.dailyMix === 'hardDay' || settings.dailyMix === 'mediumDay') {
    return settings.dailyMix;
  }
  const hasDueOrOverdueHard = questions.some(
    (q) => q.done && q.difficulty === 'Hard' && q.srs !== null && q.srs.dueDate <= date,
  );
  if (hasDueOrOverdueHard) return 'hardDay';
  // Design decision #3: the interleave rule only "triggers" (§5 Step 1's
  // second OR-clause) if there is actually a Done Hard question for the
  // Hard slot to serve. Forcing hardDay off the date alone, with zero Hard
  // candidates, wouldn't produce a real interleave pick — the Hard slot's
  // difficulty-relax chain would immediately fall through to Medium, and
  // the day would end up with 2 total picks instead of mediumDay's 3, for
  // no benefit. This is checked explicitly here rather than left as an
  // emergent side effect of the relax chain silently absorbing the miss.
  if (interleaveDay && hasHardCandidate(questions)) return 'hardDay';
  return 'mediumDay';
}

function hasHardCandidate(questions: Question[]): boolean {
  return questions.some((q) => q.done && q.srs !== null && q.difficulty === 'Hard');
}

/** Total logged reviews per pattern so far (§5 Step 2.3's "fewest total
 * reviews" and Step 3's mirror-image "most-reviewed / already-covered").
 * A question tagged with multiple patterns contributes each of its reviews
 * to every one of its patterns' counts. */
export function patternReviewCounts(questions: Question[], reviewLogs: ReviewLog[]): Map<string, number> {
  const patternsById = new Map<string, string[]>();
  for (const q of questions) patternsById.set(q.id, q.patterns);
  const counts = new Map<string, number>();
  for (const log of reviewLogs) {
    for (const p of patternsById.get(log.questionId) ?? []) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return counts;
}

// AMENDMENT (see docs/SPEC-AMENDMENTS.md #1, not in the original §5): a
// pattern is "weak" as of `date` if any question carrying it has an
// 'again'-rated ReviewLog dated within the `windowDays` days strictly
// before `date` (i.e. [date - windowDays, date - 1] — not including `date`
// itself). Same shape as patternReviewCounts: needs `questions` to map a
// ReviewLog's questionId back to its patterns.
export function weakPatterns(
  questions: Question[],
  reviewLogs: ReviewLog[],
  date: string,
  windowDays = 7,
): Set<string> {
  const patternsById = new Map<string, string[]>();
  for (const q of questions) patternsById.set(q.id, q.patterns);
  const windowStart = addDaysISO(date, -windowDays);

  const weak = new Set<string>();
  for (const log of reviewLogs) {
    if (log.rating !== 'again') continue;
    if (log.date < windowStart || log.date >= date) continue;
    for (const p of patternsById.get(log.questionId) ?? []) weak.add(p);
  }
  return weak;
}

function isWeak(q: Question, weakSet: Set<string>): boolean {
  return q.patterns.some((p) => weakSet.has(p));
}

// AMENDMENT (see docs/SPEC-AMENDMENTS.md #2, not in the original §5): a
// pattern that keeps winning the coverage-pick tie-break (weak-pattern OR
// ordinary fewest-reviews — both funnel through pickFromPool's step 3 below
// and produce reason: 'coverage') can dominate nearly every coverage slot in
// a day when it has few total questions — weak-pattern reinforcement alone
// has no such limit. Cap how many times a single pattern may WIN that slot
// per day; once hit, exclude it from coverage-pick candidacy for the rest of
// the day and fall through to the next-best candidate. Named constant so
// it's easy to tune later without a Settings UI control.
export const MAX_COVERAGE_PICKS_PER_PATTERN_PER_DAY = 2;

// A question is "capped out" of coverage-pick candidacy once every pattern
// it carries has hit the per-day cap — mirrors leastCoveredScore's own
// per-question, min-across-patterns shape. Patternless questions (score 0,
// "always eligible" per leastCoveredScore's own comment) are never capped:
// `.every()` on an empty array is vacuously true, so that case is called out
// explicitly rather than left as an accidental side effect.
function isCappedOut(q: Question, coveragePickCounts: Map<string, number>): boolean {
  if (q.patterns.length === 0) return false;
  return q.patterns.every((p) => (coveragePickCounts.get(p) ?? 0) >= MAX_COVERAGE_PICKS_PER_PATTERN_PER_DAY);
}

// Rebuilds today's coverage-pick win counts from a DayPlan's persisted
// `reasons` map, so pickOneMore (a separate call per "One More" press, with
// no loop state of its own to carry the count across presses) can enforce
// the same per-day cap planDayDetailed enforces within its own loop. Only
// 'coverage' entries count — overdue/due-today/hard-interleave picks never
// occupy a coverage-pick slot, so they must never contribute to the cap.
function coveragePickCountsFromReasons(
  questions: Question[],
  reasonsById: Record<string, PickReason>,
): Map<string, number> {
  const questionsById = new Map(questions.map((q) => [q.id, q]));
  const counts = new Map<string, number>();
  for (const [id, reason] of Object.entries(reasonsById)) {
    if (reason !== 'coverage') continue;
    for (const p of questionsById.get(id)?.patterns ?? []) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return counts;
}

// A question's coverage "score" is the least-reviewed of its own patterns —
// its most under-covered angle. Patternless questions score 0 (always
// eligible; never blocked from breadth picks for lack of tags).
function leastCoveredScore(q: Question, counts: Map<string, number>): number {
  if (q.patterns.length === 0) return 0;
  return Math.min(...q.patterns.map((p) => counts.get(p) ?? 0));
}

function mostCoveredScore(q: Question, counts: Map<string, number>): number {
  if (q.patterns.length === 0) return 0;
  return Math.max(...q.patterns.map((p) => counts.get(p) ?? 0));
}

// Deterministic tie-break shared by every priority step: "Ties → older
// doneAt first" (§5 Step 2.3), applied uniformly rather than just at the
// coverage step so results never depend on iteration/insertion order.
function byDoneAtAsc(a: Question, b: Question): number {
  return (a.doneAt ?? '').localeCompare(b.doneAt ?? '');
}

// §4: "Mastered questions leave the regular rotation but remain eligible for
// 'One More' and for hard-interleave picks." So overdue / due-today / the
// default coverage ranking must all exclude mastered questions — but the
// interleave-override branch (a deliberate duplicate pick) and pickOneMore
// below are explicitly exempted and may still draw from them.
//
// `basePool` is every done/srs/difficulty-matching, not-yet-used candidate;
// `allowMastered` controls whether mastered questions are visible to the
// overdue/due-today/coverage checks run here, or excluded from all of them.
function pickFromPool(
  basePool: Question[],
  counts: Map<string, number>,
  weakSet: Set<string>,
  date: string,
  allowMastered: boolean,
  coveragePickCounts: Map<string, number>,
): PlannedPick | null {
  const pool = allowMastered ? basePool : basePool.filter((q) => q.status !== 'mastered');
  if (pool.length === 0) return null;

  // 1. Overdue reviews, oldest due date first. Priorities 1-2 are
  // deliberately evaluated against the FULL pool, before the per-day
  // coverage cap below ever comes into play — a genuinely overdue question
  // is served regardless of how many times its pattern has already won a
  // coverage-pick slot today (docs/SPEC-AMENDMENTS.md #2).
  const overdue = pool
    .filter((q) => q.srs!.dueDate < date)
    .sort((a, b) => a.srs!.dueDate.localeCompare(b.srs!.dueDate) || byDoneAtAsc(a, b));
  if (overdue.length > 0) return { questionId: overdue[0].id, reason: 'overdue' };

  // 2. Due today.
  const dueToday = pool.filter((q) => q.srs!.dueDate === date).sort(byDoneAtAsc);
  if (dueToday.length > 0) return { questionId: dueToday[0].id, reason: 'due-today' };

  // 3. Coverage pick. AMENDMENT (docs/SPEC-AMENDMENTS.md #1): weak patterns
  // sort first, then fewest total reviews (as originally specced), then
  // older doneAt as the final tie-break. AMENDMENT #2: a pattern that has
  // already won MAX_COVERAGE_PICKS_PER_PATTERN_PER_DAY coverage-pick slots
  // today is excluded from candidacy here — unless that would leave nothing
  // to pick, in which case the cap is ignored for this slot only (same
  // "never serve an empty day" principle as the difficulty-relax chain).
  const notCapped = pool.filter((q) => !isCappedOut(q, coveragePickCounts));
  const candidates = notCapped.length > 0 ? notCapped : pool;
  const ranked = candidates.slice().sort((a, b) => {
    const weakDiff = Number(isWeak(b, weakSet)) - Number(isWeak(a, weakSet));
    if (weakDiff !== 0) return weakDiff;
    return leastCoveredScore(a, counts) - leastCoveredScore(b, counts) || byDoneAtAsc(a, b);
  });
  return { questionId: ranked[0].id, reason: 'coverage' };
}

function pickForSlot(
  slot: Slot,
  questions: Question[],
  counts: Map<string, number>,
  weakSet: Set<string>,
  date: string,
  usedIds: Set<string>,
  coveragePickCounts: Map<string, number>,
): PlannedPick | null {
  for (const difficulty of DIFFICULTY_RELAX_CHAIN[slot.difficulty]) {
    const basePool = questions.filter(
      (q) => q.done && q.srs !== null && q.difficulty === difficulty && !usedIds.has(q.id),
    );
    if (basePool.length === 0) continue;

    // Step 3's inversion for an interleave day's Hard slot: pick the
    // *most*-covered pattern (a deliberate duplicate) instead of the least
    // covered one — and, per §4, this branch alone may draw on mastered
    // questions, since duplicating an already-mastered Hard pattern is
    // exactly the "stress-test familiar patterns" case §1 describes. Not
    // affected by weak-pattern reinforcement — see SPEC-AMENDMENTS.md #1.
    if (slot.interleaveEligible && difficulty === 'Hard') {
      const alreadyCovered = basePool.filter((q) => mostCoveredScore(q, counts) > 0);
      if (alreadyCovered.length > 0) {
        const ranked = alreadyCovered
          .slice()
          .sort((a, b) => mostCoveredScore(b, counts) - mostCoveredScore(a, counts) || byDoneAtAsc(a, b));
        return { questionId: ranked[0].id, reason: 'hard-interleave' };
      }
      // Nothing has ever been reviewed yet (e.g. very first days) — there is
      // no "already-covered" pattern to duplicate, so fall through to a
      // normal (non-mastered) pick rather than picking arbitrarily.
    }

    const pick = pickFromPool(basePool, counts, weakSet, date, false, coveragePickCounts);
    if (pick) return pick;
    // pickFromPool returned null: basePool had candidates, but all of them
    // were mastered — relax to the next difficulty rather than serving a
    // mastered question through the regular rotation.
  }
  return null;
}

/** §5's "One More" button: same priority chain (overdue -> due -> coverage),
 * difficulty preference Medium -> Hard -> Easy, no hard-interleave concept.
 * Per §4, mastered questions ARE eligible here (unlike the regular slots
 * above) — "remain eligible for One More" is explicit. `excludeIds` must
 * include both the day's original questionIds AND any extraIds already
 * appended by earlier "One More" presses, so a still-unrated extra pick
 * can never be served a second time before it's rated.
 *
 * `reasonsById` should be the day's DayPlan.reasons (defaults to {} only
 * for callers that genuinely have no plan yet). Two things depend on it:
 *  - AMENDMENT (docs/SPEC-AMENDMENTS.md #1): mirrors planDayDetailed's own
 *    within-day local bump (Fixture F) — every pattern already served
 *    today (original plan picks AND earlier One More extras, i.e. every id
 *    in excludeIds) counts against itself for THIS pick's coverage ranking
 *    too, not just reviewLogs from past days. Without this, pickOneMore was
 *    a divergent implementation of the coverage step that ignored today's
 *    own picks entirely, unlike planDayDetailed's slot loop.
 *  - AMENDMENT #2: reconstructs today's per-pattern coverage-pick win
 *    counts (see coveragePickCountsFromReasons) so the same per-day cap
 *    planDayDetailed enforces across its slots also holds across separate
 *    "One More" presses, which each get their own pickOneMore call with no
 *    shared loop state. */
export function pickOneMore(
  questions: Question[],
  reviewLogs: ReviewLog[],
  excludeIds: Set<string>,
  date: string,
  reasonsById: Record<string, PickReason> = {},
): PlannedPick | null {
  const counts = patternReviewCounts(questions, reviewLogs);
  const weakSet = weakPatterns(questions, reviewLogs, date);
  const coveragePickCounts = coveragePickCountsFromReasons(questions, reasonsById);

  const questionsById = new Map(questions.map((q) => [q.id, q]));
  for (const id of excludeIds) {
    for (const p of questionsById.get(id)?.patterns ?? []) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }

  for (const difficulty of ['Medium', 'Hard', 'Easy'] as const) {
    const basePool = questions.filter(
      (q) => q.done && q.srs !== null && q.difficulty === difficulty && !excludeIds.has(q.id),
    );
    const pick = pickFromPool(basePool, counts, weakSet, date, true, coveragePickCounts);
    if (pick) return pick;
  }
  return null;
}

function buildSlots(mix: Mix, interleaveDay: boolean): Slot[] {
  if (mix === 'hardDay') {
    return [
      { difficulty: 'Hard', interleaveEligible: interleaveDay },
      { difficulty: 'Medium', interleaveEligible: false },
    ];
  }
  return [
    { difficulty: 'Medium', interleaveEligible: false },
    { difficulty: 'Medium', interleaveEligible: false },
    { difficulty: 'Medium', interleaveEligible: false },
  ];
}

/** Full detail version — mix, whether interleave fired, and *why* each pick
 * was made. `planDay` below wraps this and returns just the §3 `DayPlan`
 * shape; the Today screen (§6, not built yet) will want this richer form
 * directly for its "why" labels, so it's kept as its own exported function
 * rather than re-derived later. */
export function planDayDetailed(
  questions: Question[],
  reviewLogs: ReviewLog[],
  settings: Settings,
  date: string,
): DayPlanDetail {
  const interleaveDay = isHardInterleaveDay(date, settings.hardInterleaveEvery);
  const mix = decideMix(questions, settings, date, interleaveDay);
  const counts = patternReviewCounts(questions, reviewLogs);
  const weakSet = weakPatterns(questions, reviewLogs, date);
  const questionsById = new Map(questions.map((q) => [q.id, q]));
  const usedIds = new Set<string>();
  const coveragePickCounts = new Map<string, number>();
  const picks: PlannedPick[] = [];

  for (const slot of buildSlots(mix, interleaveDay)) {
    const pick = pickForSlot(slot, questions, counts, weakSet, date, usedIds, coveragePickCounts);
    if (pick) {
      picks.push(pick);
      usedIds.add(pick.questionId);
      // Bump the picked question's own patterns as if already reviewed,
      // before ranking the next slot. Otherwise, with reviewLogs alone
      // (all 0 for a pattern nobody has reviewed yet), two slots in the
      // SAME day's plan can both land on that pattern via coverage pick
      // while a different, equally-uncovered pattern sits untouched —
      // directly undercutting §5's "cover as many distinct patterns as
      // possible" breadth goal within a single day, not just across days.
      for (const p of questionsById.get(pick.questionId)?.patterns ?? []) {
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
      // AMENDMENT (docs/SPEC-AMENDMENTS.md #2): only a 'coverage'-reason
      // pick counts toward the per-day cap — overdue/due-today/hard-
      // interleave picks never occupy a coverage-pick slot.
      if (pick.reason === 'coverage') {
        for (const p of questionsById.get(pick.questionId)?.patterns ?? []) {
          coveragePickCounts.set(p, (coveragePickCounts.get(p) ?? 0) + 1);
        }
      }
    }
    // If pick is null, every difficulty in the relax chain was exhausted
    // (no Done questions at all for Hard/Medium/Easy) — leave the slot
    // empty rather than serving a duplicate or a not-done question.
  }

  return { date, mix, interleaveDay, picks };
}

export function planDay(
  questions: Question[],
  reviewLogs: ReviewLog[],
  settings: Settings,
  date: string,
): DayPlan {
  const detail = planDayDetailed(questions, reviewLogs, settings, date);
  const reasons: Record<string, PickReason> = {};
  for (const p of detail.picks) reasons[p.questionId] = p.reason;
  return {
    date,
    questionIds: detail.picks.map((p) => p.questionId),
    extraIds: [],
    reasons,
  };
}
