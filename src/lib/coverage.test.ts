// Hand-traced fixture for the Coverage Dashboard — same approach as the
// scheduler/srs fixtures. 13 fake questions across 5 patterns, deliberately
// touching all 4 aggregate statuses plus a topic-assignment tie, and a full
// walkthrough of the four summary counters. Expected numbers below are
// computed by hand in the comments; the assertions check the code produces
// exactly those numbers.

import { describe, expect, it } from 'vitest';
import type { Question, ReviewLog } from '../types';
import { computeCoverageSummary, computePatternCoverage, groupPatternCoverageByTopic } from './coverage';

const TODAY = '2026-08-20';
const OVERDUE = '2026-08-15';
const DUE_TODAY = TODAY;
const FUTURE = '2026-09-01';

function q(overrides: Partial<Question> & Pick<Question, 'id' | 'patterns' | 'step' | 'stepTitle' | 'done'>): Question {
  return {
    title: overrides.id,
    url: '',
    difficulty: 'Medium',
    lecture: undefined,
    doneAt: overrides.done ? '2026-08-01' : undefined,
    srs: overrides.done ? { ladderIndex: 1, dueDate: FUTURE, lapses: 0, reps: 1 } : null,
    status: overrides.done ? 'learning' : 'todo',
    ...overrides,
  };
}

function log(id: string, questionId: string, date: string): ReviewLog {
  return { id, questionId, date, rating: 'good', kind: 'review' };
}

// --- Fixture -----------------------------------------------------------
//
// Kadane          (Step 3: Arrays)      — 2 questions, BOTH done+mastered
//                                          -> weakest link = mastered
// Sliding Window  (Step 10)             — 3 questions: 2 done (reviewing,
//                                          mastered), 1 not done
//                                          -> weakest link among done = reviewing
// Recursion Basics(Step 7)              — 2 questions, BOTH done+learning
//                                          -> weakest link = learning
// Tries Basics    (Step 17)             — 2 questions, NEITHER done
//                                          -> untouched
// Two Pointers    (Steps 3 AND 10, 2 questions each — a tie)
//                                          -> topic tie-break picks the
//                                             LOWER step number (3)
//                                          -> 2 done (both learning), 2 not done
//                                          -> weakest link = learning

const questions: Question[] = [
  q({ id: 'kadane-q1', patterns: ['Kadane'], step: 3, stepTitle: 'Step 3: Arrays', done: true, status: 'mastered', srs: { ladderIndex: 4, dueDate: DUE_TODAY, lapses: 0, reps: 6 } }),
  q({ id: 'kadane-q2', patterns: ['Kadane'], step: 3, stepTitle: 'Step 3: Arrays', done: true, status: 'mastered', srs: { ladderIndex: 4, dueDate: FUTURE, lapses: 0, reps: 6 } }),

  q({ id: 'sw-q1', patterns: ['Sliding Window'], step: 10, stepTitle: 'Step 10: Sliding Window & Two Pointers', done: true, status: 'reviewing', srs: { ladderIndex: 2, dueDate: OVERDUE, lapses: 0, reps: 3 } }),
  q({ id: 'sw-q2', patterns: ['Sliding Window'], step: 10, stepTitle: 'Step 10: Sliding Window & Two Pointers', done: true, status: 'mastered', srs: { ladderIndex: 4, dueDate: FUTURE, lapses: 0, reps: 6 } }),
  q({ id: 'sw-q3', patterns: ['Sliding Window'], step: 10, stepTitle: 'Step 10: Sliding Window & Two Pointers', done: false }),

  q({ id: 'rec-q1', patterns: ['Recursion Basics'], step: 7, stepTitle: 'Step 7: Recursion', done: true, status: 'learning', srs: { ladderIndex: 0, dueDate: OVERDUE, lapses: 0, reps: 1 } }),
  q({ id: 'rec-q2', patterns: ['Recursion Basics'], step: 7, stepTitle: 'Step 7: Recursion', done: true, status: 'learning', srs: { ladderIndex: 0, dueDate: FUTURE, lapses: 0, reps: 1 } }),

  q({ id: 'tries-q1', patterns: ['Tries Basics'], step: 17, stepTitle: 'Step 17: Tries', done: false }),
  q({ id: 'tries-q2', patterns: ['Tries Basics'], step: 17, stepTitle: 'Step 17: Tries', done: false }),

  q({ id: 'tp-q1', patterns: ['Two Pointers'], step: 3, stepTitle: 'Step 3: Arrays', done: true, status: 'learning', srs: { ladderIndex: 0, dueDate: FUTURE, lapses: 0, reps: 1 } }),
  q({ id: 'tp-q2', patterns: ['Two Pointers'], step: 3, stepTitle: 'Step 3: Arrays', done: false }),
  q({ id: 'tp-q3', patterns: ['Two Pointers'], step: 10, stepTitle: 'Step 10: Sliding Window & Two Pointers', done: true, status: 'learning', srs: { ladderIndex: 0, dueDate: DUE_TODAY, lapses: 0, reps: 1 } }),
  q({ id: 'tp-q4', patterns: ['Two Pointers'], step: 10, stepTitle: 'Step 10: Sliding Window & Two Pointers', done: false }),
];

// Kadane: 3 + 2 = 5. Sliding Window: 2 + 1 = 3. Recursion Basics: 1.
// Tries Basics: 0. Two Pointers: 1 + 1 = 2. Total = 5+3+1+0+2 = 11.
const reviewLogs: ReviewLog[] = [
  log('l1', 'kadane-q1', '2026-08-01'), log('l2', 'kadane-q1', '2026-08-05'), log('l3', 'kadane-q1', '2026-08-10'),
  log('l4', 'kadane-q2', '2026-08-02'), log('l5', 'kadane-q2', '2026-08-09'),
  log('l6', 'sw-q1', '2026-08-03'), log('l7', 'sw-q1', '2026-08-11'),
  log('l8', 'sw-q2', '2026-08-04'),
  log('l9', 'rec-q1', '2026-08-06'),
  log('l10', 'tp-q1', '2026-08-07'),
  log('l11', 'tp-q3', '2026-08-08'),
];

describe('computePatternCoverage — hand-traced walkthrough', () => {
  const coverage = computePatternCoverage(questions, reviewLogs);
  const byPattern = new Map(coverage.map((c) => [c.pattern, c]));

  it('Kadane: 2 questions, both mastered -> weakest link is mastered', () => {
    expect(byPattern.get('Kadane')).toMatchObject({
      topicStep: 3,
      topicTitle: 'Step 3: Arrays',
      totalQuestions: 2,
      doneQuestions: 2,
      reviewCount: 5,
      status: 'mastered',
    });
  });

  it('Sliding Window: 3 questions (1 not done), done ones are reviewing+mastered -> weakest link is reviewing', () => {
    expect(byPattern.get('Sliding Window')).toMatchObject({
      topicStep: 10,
      topicTitle: 'Step 10: Sliding Window & Two Pointers',
      totalQuestions: 3,
      doneQuestions: 2,
      reviewCount: 3,
      status: 'reviewing', // NOT 'mastered' -- one question still lagging keeps it here
    });
  });

  it('Recursion Basics: 2 questions, both learning -> learning', () => {
    expect(byPattern.get('Recursion Basics')).toMatchObject({
      topicStep: 7,
      topicTitle: 'Step 7: Recursion',
      totalQuestions: 2,
      doneQuestions: 2,
      reviewCount: 1,
      status: 'learning',
    });
  });

  it('Tries Basics: 0 done questions -> untouched, regardless of 2 not-done questions existing', () => {
    expect(byPattern.get('Tries Basics')).toMatchObject({
      topicStep: 17,
      topicTitle: 'Step 17: Tries',
      totalQuestions: 2,
      doneQuestions: 0,
      reviewCount: 0,
      status: 'untouched',
    });
  });

  it('Two Pointers: tied 2-2 between Step 3 and Step 10 -> topic tie-break picks the LOWER step (3)', () => {
    expect(byPattern.get('Two Pointers')).toMatchObject({
      topicStep: 3,
      topicTitle: 'Step 3: Arrays',
      totalQuestions: 4, // 2 from each step, still one pattern
      doneQuestions: 2,
      reviewCount: 2,
      status: 'learning',
    });
  });
});

describe('groupPatternCoverageByTopic', () => {
  it('groups the 5 patterns under their 4 assigned topics, sorted by step number', () => {
    const coverage = computePatternCoverage(questions, reviewLogs);
    const groups = groupPatternCoverageByTopic(coverage);

    expect(groups.map((g) => g.topicTitle)).toEqual([
      'Step 3: Arrays', // Kadane + Two Pointers
      'Step 7: Recursion',
      'Step 10: Sliding Window & Two Pointers', // Sliding Window only -- Two Pointers lives under Step 3
      'Step 17: Tries',
    ]);
    expect(groups[0].patterns.map((p) => p.pattern).sort()).toEqual(['Kadane', 'Two Pointers']);
    expect(groups[2].patterns.map((p) => p.pattern)).toEqual(['Sliding Window']);
  });
});

describe('computeCoverageSummary — hand-traced walkthrough', () => {
  it('all four counters match hand computation', () => {
    const summary = computeCoverageSummary(questions, reviewLogs, TODAY);

    // patternsTotal: 5 distinct pattern names across all 13 questions.
    // patternsCovered: all except Tries Basics (0 done questions) = 4.
    expect(summary.patternsTotal).toBe(5);
    expect(summary.patternsCovered).toBe(4);

    // questionsTotal: 13 fixture rows. questionsDone: kadane x2, sw-q1,
    // sw-q2, rec-q1, rec-q2, tp-q1, tp-q3 = 8.
    expect(summary.questionsTotal).toBe(13);
    expect(summary.questionsDone).toBe(8);

    // reviewsCompleted: length of the reviewLogs fixture array = 11.
    expect(summary.reviewsCompleted).toBe(11);

    // reviewDebt as of 2026-08-20: kadane-q1 (due today), sw-q1 (overdue
    // 2026-08-15), rec-q1 (overdue), tp-q3 (due today) = 4. kadane-q2,
    // sw-q2, rec-q2, tp-q1 are all due 2026-09-01 (future) -> excluded.
    expect(summary.reviewDebt).toBe(4);
  });
});
