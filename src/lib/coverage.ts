// Coverage Dashboard (§6.3). Pure functions only — no Dexie, no React — same
// shape as scheduler.ts/srs.ts: computed from (questions, reviewLogs, date),
// fully unit-testable, wired to Dexie only by the screen component.

import type { Question, QuestionStatus, ReviewLog } from '../types';
import { patternReviewCounts } from './scheduler';

export type PatternAggregateStatus = 'untouched' | 'learning' | 'reviewing' | 'mastered';

// DESIGN DECISION (not obvious from §6.3, made explicit like scheduler.ts's
// numbered decisions): a pattern's aggregate status is the WEAKEST LINK
// among its Done questions — the least-advanced status, not the most
// advanced ("furthest-along wins") and not a strict "mastered iff every
// question is mastered" rule stated separately for each level. Concretely:
// rank statuses learning < reviewing < mastered, take the MINIMUM rank
// across all Done questions carrying the pattern, map that back to a label.
// This one rule happens to reduce to "mastered only if ALL are mastered"
// exactly (since mastered is the top rank, the minimum can only be mastered
// if every question is), while also giving a principled answer for the
// in-between levels: a pattern only reads "reviewing" once NONE of its
// questions are still stuck at "learning", etc.
//
// Why weakest-link and not furthest-along: this screen's whole purpose is
// surfacing what still needs work. A pattern with 9 questions in "learning"
// and 1 in "mastered" is NOT well covered — showing it green because one
// question got lucky would actively hide the gap this dashboard exists to
// show. A single straggling question keeps the whole pattern flagged until
// every one of its questions has caught up.
//
// A question with `done: false` never contributes to this at all (there is
// no meaningful "status" for a question not in rotation) — a pattern with
// zero Done questions is 'untouched', full stop, regardless of how many
// not-done questions carry it.
const QUESTION_STATUS_RANK: Record<QuestionStatus, number> = {
  todo: 0, // should never occur among done:true questions (app invariant), ranked defensively low if it ever does
  learning: 1,
  reviewing: 2,
  mastered: 3,
};

function aggregateStatus(doneQuestions: Question[]): PatternAggregateStatus {
  if (doneQuestions.length === 0) return 'untouched';
  const minRank = Math.min(...doneQuestions.map((q) => QUESTION_STATUS_RANK[q.status]));
  if (minRank >= 3) return 'mastered';
  if (minRank >= 2) return 'reviewing';
  return 'learning';
}

export interface PatternCoverage {
  pattern: string;
  /** The step this pattern is grouped/displayed under — the step with the
   * most questions carrying this pattern; ties broken by the lower step
   * number. A pattern spanning multiple steps still gets exactly one
   * "home" for grid grouping purposes. */
  topicStep: number;
  topicTitle: string;
  totalQuestions: number;
  doneQuestions: number;
  /** Total ReviewLog entries across every question carrying this pattern —
   * reuses scheduler.ts's own coverage-counting logic (patternReviewCounts)
   * rather than recomputing it a second, possibly-drifting way. */
  reviewCount: number;
  status: PatternAggregateStatus;
}

export function computePatternCoverage(questions: Question[], reviewLogs: ReviewLog[]): PatternCoverage[] {
  const reviewCounts = patternReviewCounts(questions, reviewLogs);

  const questionsByPattern = new Map<string, Question[]>();
  for (const q of questions) {
    for (const p of q.patterns) {
      const list = questionsByPattern.get(p);
      if (list) list.push(q);
      else questionsByPattern.set(p, [q]);
    }
  }

  const coverage: PatternCoverage[] = [];
  for (const [pattern, qs] of questionsByPattern) {
    const countByStep = new Map<number, number>();
    for (const q of qs) countByStep.set(q.step, (countByStep.get(q.step) ?? 0) + 1);

    let topicStep = qs[0].step;
    let topicCount = -1;
    for (const [step, count] of [...countByStep.entries()].sort((a, b) => a[0] - b[0])) {
      // Ascending step order + strict `>` means the first (lowest-numbered)
      // step in a tie is the one that sticks.
      if (count > topicCount) {
        topicCount = count;
        topicStep = step;
      }
    }
    const topicTitle = qs.find((q) => q.step === topicStep)?.stepTitle ?? `Step ${topicStep}`;

    const doneQs = qs.filter((q) => q.done);

    coverage.push({
      pattern,
      topicStep,
      topicTitle,
      totalQuestions: qs.length,
      doneQuestions: doneQs.length,
      reviewCount: reviewCounts.get(pattern) ?? 0,
      status: aggregateStatus(doneQs),
    });
  }

  return coverage.sort((a, b) => a.topicStep - b.topicStep || a.pattern.localeCompare(b.pattern));
}

export interface PatternCoverageTopicGroup {
  topicStep: number;
  topicTitle: string;
  patterns: PatternCoverage[];
}

export function groupPatternCoverageByTopic(coverage: PatternCoverage[]): PatternCoverageTopicGroup[] {
  const byTopic = new Map<number, PatternCoverageTopicGroup>();
  for (const c of coverage) {
    const entry = byTopic.get(c.topicStep) ?? { topicStep: c.topicStep, topicTitle: c.topicTitle, patterns: [] };
    entry.patterns.push(c);
    byTopic.set(c.topicStep, entry);
  }
  return [...byTopic.values()].sort((a, b) => a.topicStep - b.topicStep);
}

export interface CoverageSummary {
  patternsCovered: number;
  patternsTotal: number;
  questionsDone: number;
  questionsTotal: number;
  reviewsCompleted: number;
  /** Done questions overdue or due today, as of `date`. */
  reviewDebt: number;
}

export function computeCoverageSummary(questions: Question[], reviewLogs: ReviewLog[], date: string): CoverageSummary {
  const allPatterns = new Set(questions.flatMap((q) => q.patterns));
  const doneQuestions = questions.filter((q) => q.done);
  const coveredPatterns = new Set(doneQuestions.flatMap((q) => q.patterns));
  const reviewDebt = doneQuestions.filter((q) => q.srs !== null && q.srs.dueDate <= date).length;

  return {
    patternsCovered: coveredPatterns.size,
    patternsTotal: allPatterns.size,
    questionsDone: doneQuestions.length,
    questionsTotal: questions.length,
    reviewsCompleted: reviewLogs.length,
    reviewDebt,
  };
}
