// Daily scheduler — spec §5. Pure function: (questions, reviewLogs, settings,
// date) => DayPlan. No Dexie, no React, no Date.now() — every input the
// function needs (including "today") is passed in, so it's fully
// unit-testable and replayable for any date.
//
// Only `done: true` questions are ever candidates (§5: "Only questions with
// done: true are ever scheduled for review").

import type { DayPlan, Difficulty, Question, ReviewLog, Settings } from '../types';
import { daysBetween } from './date';

export type Mix = 'hardDay' | 'mediumDay';

export type PickReason = 'overdue' | 'due-today' | 'coverage' | 'hard-interleave';

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
function patternReviewCounts(questions: Question[], reviewLogs: ReviewLog[]): Map<string, number> {
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

function pickForSlot(
  slot: Slot,
  questions: Question[],
  counts: Map<string, number>,
  date: string,
  usedIds: Set<string>,
): PlannedPick | null {
  for (const difficulty of DIFFICULTY_RELAX_CHAIN[slot.difficulty]) {
    const pool = questions.filter(
      (q) => q.done && q.srs !== null && q.difficulty === difficulty && !usedIds.has(q.id),
    );
    if (pool.length === 0) continue;

    // 1. Overdue reviews, oldest due date first.
    const overdue = pool
      .filter((q) => q.srs!.dueDate < date)
      .sort((a, b) => a.srs!.dueDate.localeCompare(b.srs!.dueDate) || byDoneAtAsc(a, b));
    if (overdue.length > 0) return { questionId: overdue[0].id, reason: 'overdue' };

    // 2. Due today.
    const dueToday = pool.filter((q) => q.srs!.dueDate === date).sort(byDoneAtAsc);
    if (dueToday.length > 0) return { questionId: dueToday[0].id, reason: 'due-today' };

    // 3. Coverage pick — on an interleave day, the Hard slot's version of
    // this step is inverted per §5 Step 3: pick the *most*-covered pattern
    // (a deliberate duplicate) instead of the least-covered one.
    if (slot.interleaveEligible && difficulty === 'Hard') {
      const alreadyCovered = pool.filter((q) => mostCoveredScore(q, counts) > 0);
      if (alreadyCovered.length > 0) {
        const ranked = alreadyCovered
          .slice()
          .sort((a, b) => mostCoveredScore(b, counts) - mostCoveredScore(a, counts) || byDoneAtAsc(a, b));
        return { questionId: ranked[0].id, reason: 'hard-interleave' };
      }
      // Nothing has ever been reviewed yet (e.g. very first days) — there is
      // no "already-covered" pattern to duplicate, so fall through to a
      // normal coverage pick rather than picking arbitrarily.
    }

    const ranked = pool
      .slice()
      .sort((a, b) => leastCoveredScore(a, counts) - leastCoveredScore(b, counts) || byDoneAtAsc(a, b));
    return { questionId: ranked[0].id, reason: 'coverage' };
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
  const usedIds = new Set<string>();
  const picks: PlannedPick[] = [];

  for (const slot of buildSlots(mix, interleaveDay)) {
    const pick = pickForSlot(slot, questions, counts, date, usedIds);
    if (pick) {
      picks.push(pick);
      usedIds.add(pick.questionId);
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
  return {
    date,
    questionIds: detail.picks.map((p) => p.questionId),
    extraIds: [],
  };
}
