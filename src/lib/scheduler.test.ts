// Hand-traced fixtures for the §5 scheduler. Each fixture is small enough to
// verify by hand against the priority chain (overdue -> due-today ->
// coverage -> relax-difficulty) and the hard-interleave override (§5 Step 3)
// — see the comments above each `describe` block for the trace.

import { describe, expect, it } from 'vitest';
import type { Question, ReviewLog, Settings } from '../types';
import { MAX_COVERAGE_PICKS_PER_PATTERN_PER_DAY, pickOneMore, planDayDetailed } from './scheduler';

function q(overrides: Partial<Question> & Pick<Question, 'id' | 'difficulty' | 'patterns'>): Question {
  return {
    title: overrides.id,
    url: '',
    step: 1,
    stepTitle: 'Step 1: Basics',
    done: true,
    doneAt: '2026-01-01',
    srs: null,
    status: 'learning',
    ...overrides,
  };
}

function log(questionId: string, date: string): ReviewLog {
  return { id: `log-${questionId}-${date}`, questionId, date, rating: 'good', kind: 'review' };
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return { id: 1, dailyMix: 'auto', hardInterleaveEvery: 3, ...overrides };
}

describe('Fixture A — hardDay: overdue beats due-today, per slot', () => {
  // date = 2026-01-11. epochDay(2026-01-11) % 3 = 1, so this is NOT a
  // hard-interleave day — isolates steps 1-2 of the priority chain.
  const date = '2026-01-11';

  const questions: Question[] = [
    // Hard slot candidates
    q({ id: 'h1-kadane-overdue', difficulty: 'Hard', patterns: ['Kadane'], doneAt: '2026-01-02', srs: { ladderIndex: 0, dueDate: '2026-01-09', lapses: 0, reps: 0 } }), // overdue by 2d
    q({ id: 'h2-binsearch-due-today', difficulty: 'Hard', patterns: ['Binary Search'], doneAt: '2026-01-06', srs: { ladderIndex: 0, dueDate: '2026-01-11', lapses: 0, reps: 0 } }), // due today — decoy, should lose to h1
    q({ id: 'h3-slidingwindow-future', difficulty: 'Hard', patterns: ['Sliding Window'], doneAt: '2026-01-08', srs: { ladderIndex: 0, dueDate: '2026-01-20', lapses: 0, reps: 0 } }), // not eligible yet

    // Medium slot candidates
    q({ id: 'm1-slidingwindow-future', difficulty: 'Medium', patterns: ['Sliding Window'], doneAt: '2026-01-01', srs: { ladderIndex: 0, dueDate: '2026-01-20', lapses: 0, reps: 0 } }), // not eligible yet
    q({ id: 'm2-kadane-due-today', difficulty: 'Medium', patterns: ['Kadane'], doneAt: '2026-01-05', srs: { ladderIndex: 0, dueDate: '2026-01-11', lapses: 0, reps: 0 } }), // due today — no medium overdue exists, so this should win
    q({ id: 'm3-binsearch-future', difficulty: 'Medium', patterns: ['Binary Search'], doneAt: '2026-01-07', srs: { ladderIndex: 0, dueDate: '2026-01-25', lapses: 0, reps: 0 } }), // not eligible yet

    // Decoys that must never be picked
    q({ id: 'e1-hashing-overdue-easy', difficulty: 'Easy', patterns: ['Hashing'], doneAt: '2026-01-01', srs: { ladderIndex: 2, dueDate: '2026-01-01', lapses: 0, reps: 2 } }), // overdue but Easy — must not displace Hard/Medium since both slots have eligible candidates
    q({ id: 'nd1-kadane-not-done', difficulty: 'Medium', patterns: ['Kadane'], done: false, doneAt: undefined, srs: null }), // never done — must never appear
  ];

  it('mix is hardDay (forced by the overdue Hard question, not by interleave)', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.mix).toBe('hardDay');
    expect(result.interleaveDay).toBe(false);
  });

  it('Hard slot: h1 (overdue) wins over h2 (due-today) and h3 (not yet due)', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.picks[0]).toEqual({ questionId: 'h1-kadane-overdue', reason: 'overdue' });
  });

  it('Medium slot: m2 (due-today) wins because no Medium question is overdue', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.picks[1]).toEqual({ questionId: 'm2-kadane-due-today', reason: 'due-today' });
  });

  it('produces exactly [h1, m2] and never touches the Easy decoy or the not-done question', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.picks.map((p) => p.questionId)).toEqual(['h1-kadane-overdue', 'm2-kadane-due-today']);
  });
});

describe('Fixture B — mediumDay: coverage pick ordering, then relax to Easy', () => {
  // No Hard questions at all -> auto mix is mediumDay regardless of date.
  const date = '2026-01-12';

  const questions: Question[] = [
    q({ id: 'm1-twopointers', difficulty: 'Medium', patterns: ['Two Pointers'], doneAt: '2026-01-01', srs: { ladderIndex: 0, dueDate: '2026-01-20', lapses: 0, reps: 0 } }),
    q({ id: 'm2-binsearch', difficulty: 'Medium', patterns: ['Binary Search'], doneAt: '2026-01-02', srs: { ladderIndex: 0, dueDate: '2026-01-25', lapses: 0, reps: 0 } }),
    q({ id: 'e1-hashing', difficulty: 'Easy', patterns: ['Hashing'], doneAt: '2026-01-03', srs: { ladderIndex: 0, dueDate: '2026-01-30', lapses: 0, reps: 0 } }),
    q({ id: 'h1-kadane-not-done', difficulty: 'Hard', patterns: ['Kadane'], done: false, doneAt: undefined, srs: null }),
    q({ id: 'nd1-twopointers-not-done', difficulty: 'Medium', patterns: ['Two Pointers'], done: false, doneAt: undefined, srs: null }),
  ];

  // Two Pointers has 2 prior reviews logged (against m1); Binary Search has
  // 0. Neither m1 nor m2 is due/overdue, so both Medium slots must resolve
  // via coverage — and Binary Search (fewer reviews) should be picked first.
  const reviewLogs: ReviewLog[] = [log('m1-twopointers', '2025-12-20'), log('m1-twopointers', '2025-12-27')];

  it('mix is mediumDay (no Done Hard questions exist at all)', () => {
    const result = planDayDetailed(questions, reviewLogs, settings(), date);
    expect(result.mix).toBe('mediumDay');
  });

  it('slot 1: m2 (Binary Search, 0 reviews) beats m1 (Two Pointers, 2 reviews) on coverage', () => {
    const result = planDayDetailed(questions, reviewLogs, settings(), date);
    expect(result.picks[0]).toEqual({ questionId: 'm2-binsearch', reason: 'coverage' });
  });

  it('slot 2: m1 is the only Medium question left, so it fills the slot', () => {
    const result = planDayDetailed(questions, reviewLogs, settings(), date);
    expect(result.picks[1]).toEqual({ questionId: 'm1-twopointers', reason: 'coverage' });
  });

  it('slot 3: no Medium candidates remain -> relaxes to Easy and picks e1', () => {
    const result = planDayDetailed(questions, reviewLogs, settings(), date);
    expect(result.picks[2]).toEqual({ questionId: 'e1-hashing', reason: 'coverage' });
    const picked = questions.find((x) => x.id === result.picks[2].questionId);
    expect(picked?.difficulty).toBe('Easy'); // proves the relax actually fired
  });
});

describe('Fixture C — hard-interleave (§5 Step 3) actually firing on the right day', () => {
  // Same two Hard candidates and same review history in both runs. Only the
  // date (and, to isolate the effect, whether hardDay is forced vs. earned
  // via interleave) differs, to show the override flips the pick.
  const questions: Question[] = [
    q({ id: 'h1-kadane-covered', difficulty: 'Hard', patterns: ['Kadane'], doneAt: '2026-01-01', srs: { ladderIndex: 0, dueDate: '2026-02-01', lapses: 0, reps: 0 } }),
    q({ id: 'h2-recursion-uncovered', difficulty: 'Hard', patterns: ['Recursion'], doneAt: '2026-01-02', srs: { ladderIndex: 0, dueDate: '2026-02-01', lapses: 0, reps: 0 } }),
    q({ id: 'm1-filler', difficulty: 'Medium', patterns: ['Two Pointers'], doneAt: '2026-01-01', srs: { ladderIndex: 0, dueDate: '2026-02-01', lapses: 0, reps: 0 } }),
  ];
  // Kadane has 3 prior reviews (well-covered); Recursion has 0 (never
  // touched). Neither Hard question is due/overdue on either date below.
  const reviewLogs: ReviewLog[] = [
    log('h1-kadane-covered', '2025-12-01'),
    log('h1-kadane-covered', '2025-12-08'),
    log('h1-kadane-covered', '2025-12-15'),
  ];

  it('baseline (non-interleave hardDay): coverage picks the LEAST-covered pattern, Recursion', () => {
    // 2026-01-11: epochDay % 3 = 1, not an interleave day. Mix is forced to
    // hardDay here purely to isolate the Hard slot's behavior for
    // comparison — in real auto mode this date would be a mediumDay, since
    // neither Hard question is due and it isn't an interleave day.
    const result = planDayDetailed(questions, reviewLogs, settings({ dailyMix: 'hardDay' }), '2026-01-11');
    expect(result.interleaveDay).toBe(false);
    expect(result.picks[0]).toEqual({ questionId: 'h2-recursion-uncovered', reason: 'coverage' });
  });

  it('interleave day: auto mix becomes hardDay on its own, and the Hard slot flips to the MOST-covered pattern, Kadane', () => {
    // 2026-01-10: epochDay % 3 = 0 -> interleave day. In 'auto' mode this
    // alone is enough to force hardDay (§5 Step 1's OR condition), with no
    // due/overdue Hard question needed.
    const result = planDayDetailed(questions, reviewLogs, settings({ dailyMix: 'auto' }), '2026-01-10');
    expect(result.interleaveDay).toBe(true);
    expect(result.mix).toBe('hardDay');
    expect(result.picks[0]).toEqual({ questionId: 'h1-kadane-covered', reason: 'hard-interleave' });
  });

  it('design decision #3: interleave day with ZERO Hard candidates does not force hardDay', () => {
    // Same interleave date (2026-01-10) as above, but no Hard questions
    // exist at all. If the interleave trigger fired off the date alone, the
    // Hard slot would immediately relax to Medium and this day would only
    // get 2 total picks instead of mediumDay's 3 — for no interleave
    // benefit, since there's no Hard question to duplicate. It should stay
    // a mediumDay instead.
    const noHardQuestions = questions.filter((x) => x.difficulty !== 'Hard');
    const result = planDayDetailed(noHardQuestions, reviewLogs, settings({ dailyMix: 'auto' }), '2026-01-10');
    expect(result.interleaveDay).toBe(true); // the date itself is still an interleave day...
    expect(result.mix).toBe('mediumDay'); // ...but there's nothing for it to trigger
    // Only one Medium question exists in this fixture at all, so only one
    // slot can be filled — the point here is `mix`, not the pick count.
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0]).toEqual({ questionId: 'm1-filler', reason: 'coverage' });
  });
});

describe('Fixture D — two overdue candidates in the same slot: older due date wins', () => {
  const date = '2026-01-15';

  const questions: Question[] = [
    q({ id: 'm-old-overdue', difficulty: 'Medium', patterns: ['DP'], doneAt: '2025-12-01', srs: { ladderIndex: 1, dueDate: '2026-01-05', lapses: 0, reps: 1 } }), // overdue 10d
    q({ id: 'm-new-overdue', difficulty: 'Medium', patterns: ['Greedy'], doneAt: '2025-12-10', srs: { ladderIndex: 1, dueDate: '2026-01-08', lapses: 0, reps: 1 } }), // overdue 7d
    q({ id: 'm-due-today', difficulty: 'Medium', patterns: ['Trie'], doneAt: '2026-01-01', srs: { ladderIndex: 0, dueDate: '2026-01-15', lapses: 0, reps: 0 } }), // due today, not overdue
  ];

  it('slot 1: the OLDER due date (Jan 5) wins over the less-overdue candidate (Jan 8), not just "any overdue"', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.picks[0]).toEqual({ questionId: 'm-old-overdue', reason: 'overdue' });
  });

  it('slot 2: with the oldest overdue question used, the remaining overdue candidate (Jan 8) wins over due-today', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.picks[1]).toEqual({ questionId: 'm-new-overdue', reason: 'overdue' });
  });

  it('slot 3: no overdue candidates remain, so the due-today question fills the last slot', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.picks[2]).toEqual({ questionId: 'm-due-today', reason: 'due-today' });
  });
});

describe('Fixture E — coverage-pick tie on review count: older doneAt wins', () => {
  const date = '2026-01-20';

  const questions: Question[] = [
    q({ id: 'mc1-stacks-older', difficulty: 'Medium', patterns: ['Stacks'], doneAt: '2026-01-05', srs: { ladderIndex: 0, dueDate: '2026-02-01', lapses: 0, reps: 0 } }),
    q({ id: 'mc2-queues-newer', difficulty: 'Medium', patterns: ['Queues'], doneAt: '2026-01-10', srs: { ladderIndex: 0, dueDate: '2026-02-01', lapses: 0, reps: 0 } }),
  ];
  // No reviewLogs at all -> both patterns are tied at 0 reviews. Neither
  // question is due/overdue, so both slots resolve via coverage pick, and
  // the tie must break on doneAt (§5 Step 2.3: "Ties -> older doneAt first").

  it('slot 1: tied at 0 reviews each -> mc1 wins because it was doneAt earlier (Jan 5 vs Jan 10)', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.picks[0]).toEqual({ questionId: 'mc1-stacks-older', reason: 'coverage' });
  });

  it('slot 2: only mc2 remains, so it fills the slot; no 3rd pick since nothing else is Done', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.picks[1]).toEqual({ questionId: 'mc2-queues-newer', reason: 'coverage' });
    expect(result.picks).toHaveLength(2);
  });
});

describe('Fixture F — within-day breadth: a pattern picked earlier today counts against itself later today', () => {
  // Two Recursion questions and one Bit Manipulation question, all tied at 0
  // logged reviews, none due/overdue. qB's doneAt (Jan 5) is older than
  // qC's (Jan 10) — if slot ranking only consulted reviewLogs + the doneAt
  // tie-break, qB would beat qC for slot 2 (same tie-break as Fixture E).
  // But qB shares a pattern with the question slot 1 already picked, so a
  // real breadth-first day should prefer qC's untouched pattern instead.
  const date = '2026-02-01';

  const questions: Question[] = [
    q({ id: 'qA-recursion-oldest', difficulty: 'Medium', patterns: ['Recursion'], doneAt: '2026-01-01', srs: { ladderIndex: 0, dueDate: '2026-03-01', lapses: 0, reps: 0 } }),
    q({ id: 'qB-recursion-older', difficulty: 'Medium', patterns: ['Recursion'], doneAt: '2026-01-05', srs: { ladderIndex: 0, dueDate: '2026-03-01', lapses: 0, reps: 0 } }),
    q({ id: 'qC-bitmanip-newer', difficulty: 'Medium', patterns: ['Bit Manipulation'], doneAt: '2026-01-10', srs: { ladderIndex: 0, dueDate: '2026-03-01', lapses: 0, reps: 0 } }),
  ];

  it('slot 1: all tied at 0 reviews -> oldest doneAt (qA) wins, as usual', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.picks[0]).toEqual({ questionId: 'qA-recursion-oldest', reason: 'coverage' });
  });

  it('slot 2: qC (untouched Bit Manipulation) beats qB (Recursion, already used this plan) despite qB\'s older doneAt', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.picks[1]).toEqual({ questionId: 'qC-bitmanip-newer', reason: 'coverage' });
  });

  it('slot 3: qB is the only question left, so it fills the last slot', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.picks[2]).toEqual({ questionId: 'qB-recursion-older', reason: 'coverage' });
  });
});

describe('Fixture G — "One More" never re-serves a question already in today\'s plan', () => {
  const date = '2026-03-01';

  // qX is heavily overdue (Feb 1) and would clearly win an ordinary priority
  // chain over qY (overdue by only 3 days) — but qX is already in today's
  // plan (both as an original pick and, separately below, as an
  // already-appended "One More" extra), so pickOneMore must skip it.
  const questions: Question[] = [
    q({ id: 'qX-already-planned', difficulty: 'Medium', patterns: ['Greedy'], doneAt: '2026-01-01', srs: { ladderIndex: 1, dueDate: '2026-02-01', lapses: 0, reps: 1 } }),
    q({ id: 'qY-not-yet-planned', difficulty: 'Medium', patterns: ['Trie'], doneAt: '2026-01-05', srs: { ladderIndex: 1, dueDate: '2026-02-26', lapses: 0, reps: 1 } }),
  ];

  it('qX excluded as an original plan member -> qY is picked instead, even though qX is more overdue', () => {
    const excludeIds = new Set(['qX-already-planned']); // e.g. dayPlan.questionIds
    const pick = pickOneMore(questions, [], excludeIds, date);
    expect(pick).toEqual({ questionId: 'qY-not-yet-planned', reason: 'overdue' });
  });

  it('qX excluded as an already-appended (unrated) One More extra -> same result', () => {
    const excludeIds = new Set(['qX-already-planned']); // e.g. dayPlan.extraIds from an earlier press
    const pick = pickOneMore(questions, [], excludeIds, date);
    expect(pick).toEqual({ questionId: 'qY-not-yet-planned', reason: 'overdue' });
  });

  it('with nothing excluded, qX (more overdue) would normally win -- confirms the exclusion is what changes the outcome', () => {
    const pick = pickOneMore(questions, [], new Set(), date);
    expect(pick).toEqual({ questionId: 'qX-already-planned', reason: 'overdue' });
  });
});

describe('Fixture H — mastered questions leave the regular rotation but stay eligible for One More and hard-interleave', () => {
  const date = '2026-04-01';

  // A mastered, overdue Medium question sits alongside a non-mastered,
  // not-yet-due Medium question. The regular scheduler must skip the
  // mastered one entirely (even though it's overdue!) and fall back to a
  // coverage pick on the non-mastered one; pickOneMore must still be able
  // to reach the mastered one when nothing else is available.
  const questions: Question[] = [
    q({ id: 'm-mastered-overdue', difficulty: 'Medium', patterns: ['Trees'], doneAt: '2026-01-01', status: 'mastered', srs: { ladderIndex: 4, dueDate: '2026-03-01', lapses: 0, reps: 6 } }),
    q({ id: 'm-active-not-due', difficulty: 'Medium', patterns: ['Graphs'], doneAt: '2026-01-02', status: 'reviewing', srs: { ladderIndex: 2, dueDate: '2026-05-01', lapses: 0, reps: 2 } }),
  ];

  it('regular Today plan: skips the overdue-but-mastered question, coverage-picks the non-mastered one instead', () => {
    const result = planDayDetailed(questions, [], settings(), date);
    expect(result.picks).toHaveLength(1);
    expect(result.picks[0]).toEqual({ questionId: 'm-active-not-due', reason: 'coverage' });
  });

  it('pickOneMore CAN still reach the mastered question once the non-mastered one is excluded', () => {
    const excludeIds = new Set(['m-active-not-due']); // e.g. already used by the regular plan
    const pick = pickOneMore(questions, [], excludeIds, date);
    expect(pick).toEqual({ questionId: 'm-mastered-overdue', reason: 'overdue' });
  });

  it('hard-interleave override CAN still reach a mastered Hard question when duplicating a covered pattern', () => {
    const hardMastered = q({
      id: 'h-mastered-covered',
      difficulty: 'Hard',
      patterns: ['Kadane'],
      status: 'mastered',
      doneAt: '2026-01-01',
      srs: { ladderIndex: 4, dueDate: '2026-03-01', lapses: 0, reps: 6 },
    });
    const reviewLogs: ReviewLog[] = [log('h-mastered-covered', '2026-02-01')]; // Kadane has 1 prior review -> "already covered"
    // hardInterleaveEvery: 1 forces every hardDay to be an interleave day,
    // isolating the override's mastered-eligibility from date arithmetic.
    const result = planDayDetailed([hardMastered], reviewLogs, settings({ dailyMix: 'hardDay', hardInterleaveEvery: 1 }), date);
    expect(result.interleaveDay).toBe(true);
    expect(result.picks[0]).toEqual({ questionId: 'h-mastered-covered', reason: 'hard-interleave' });
  });
});

// AMENDMENT (docs/SPEC-AMENDMENTS.md #1, not in the original §5): weak-pattern
// reinforcement. A pattern is weak as of date D if any of its questions has
// an 'again'-rated ReviewLog dated within the 7 days strictly before D. Weak
// patterns now sort FIRST in the coverage-pick step, ahead of the original
// fewest-total-reviews rule.
describe('Fixture I — weak-pattern reinforcement wins a coverage slot, then expires after 7 days', () => {
  const questions: Question[] = [
    q({ id: 'q-weak-dp', difficulty: 'Medium', patterns: ['DP'], doneAt: '2026-04-01', srs: { ladderIndex: 1, dueDate: '2026-06-01', lapses: 0, reps: 3 } }),
    q({ id: 'q-not-weak-greedy', difficulty: 'Medium', patterns: ['Greedy'], doneAt: '2026-04-01', srs: { ladderIndex: 0, dueDate: '2026-06-01', lapses: 0, reps: 0 } }),
  ];
  // DP already has 2 historical (non-'again') reviews -- strictly MORE than
  // Greedy's 0 -- so under the original fewest-total-reviews rule alone,
  // Greedy would win this coverage slot. The 'again' review on Jan 07 is
  // what makes DP "weak" as of May 10 (within the 7 days before it), and
  // bumps DP's total review count to 3 -- even higher above Greedy's 0.
  const reviewLogs: ReviewLog[] = [
    { id: 'log-1', questionId: 'q-weak-dp', date: '2026-01-01', rating: 'good', kind: 'review' },
    { id: 'log-2', questionId: 'q-weak-dp', date: '2026-01-02', rating: 'good', kind: 'review' },
    { id: 'log-3', questionId: 'q-weak-dp', date: '2026-05-07', rating: 'again', kind: 'review' },
  ];

  it('weak pattern wins despite MORE total reviews (3) than the non-weak pattern (0)', () => {
    const date = '2026-05-10'; // May 07 is 3 days before -> within the 7-day window
    const result = planDayDetailed(questions, reviewLogs, settings(), date);
    expect(result.picks[0]).toEqual({ questionId: 'q-weak-dp', reason: 'coverage' });
  });

  it('boost expires after the 7-day window: 10 days later, fewest-total-reviews (Greedy, 0) wins again', () => {
    const date = '2026-05-20'; // May 07 is 13 days before -> outside the 7-day window [May 13, May 19]
    const result = planDayDetailed(questions, reviewLogs, settings(), date);
    expect(result.picks[0]).toEqual({ questionId: 'q-not-weak-greedy', reason: 'coverage' });
  });
});

// AMENDMENT (docs/SPEC-AMENDMENTS.md #1, part a): pickOneMore was a
// divergent implementation of the coverage-pick step — unlike
// planDayDetailed's slot loop (Fixture F), it never counted a pattern
// already served today (the original plan, or an earlier "One More" pick)
// against itself, so it could keep re-serving that pattern's other
// questions instead of spreading to an untouched one. Same shape as
// Fixture F, transplanted onto pickOneMore to prove the fix.
describe('Fixture J — "One More" shares planDayDetailed\'s within-day local bump (mirrors Fixture F)', () => {
  const date = '2026-07-01';

  const questions: Question[] = [
    q({ id: 'qA-recursion-already-planned', difficulty: 'Medium', patterns: ['Recursion'], doneAt: '2026-06-01', srs: { ladderIndex: 0, dueDate: '2026-08-01', lapses: 0, reps: 0 } }),
    q({ id: 'qB-recursion-older', difficulty: 'Medium', patterns: ['Recursion'], doneAt: '2026-06-05', srs: { ladderIndex: 0, dueDate: '2026-08-01', lapses: 0, reps: 0 } }),
    q({ id: 'qC-bitmanip-newer', difficulty: 'Medium', patterns: ['Bit Manipulation'], doneAt: '2026-06-10', srs: { ladderIndex: 0, dueDate: '2026-08-01', lapses: 0, reps: 0 } }),
  ];

  it('qC (untouched Bit Manipulation) beats qB (Recursion, already served today via qA) despite qB\'s older doneAt', () => {
    const excludeIds = new Set(['qA-recursion-already-planned']); // e.g. dayPlan.questionIds
    const pick = pickOneMore(questions, [], excludeIds, date);
    expect(pick).toEqual({ questionId: 'qC-bitmanip-newer', reason: 'coverage' });
  });

  it('without qA in the picture at all, qB (older doneAt) wins the tie normally -- confirms the today-served bump is what changes the outcome above', () => {
    const withoutQA = questions.filter((x) => x.id !== 'qA-recursion-already-planned');
    const pick = pickOneMore(withoutQA, [], new Set(), date);
    expect(pick).toEqual({ questionId: 'qB-recursion-older', reason: 'coverage' });
  });
});

// AMENDMENT (docs/SPEC-AMENDMENTS.md #2, part b): a pattern may win the
// coverage-pick slot (weak-pattern tie-break OR the ordinary fewest-reviews
// tie-break — both produce reason: 'coverage') at most
// MAX_COVERAGE_PICKS_PER_PATTERN_PER_DAY times per day. A weak pattern with
// several questions can otherwise dominate nearly every coverage slot in a
// session, which is exactly the real bug this amendment fixes.
describe('Fixture K — weak-pattern dominance cap: Sliding Window wins slots 1-2, then loses slot 3 once capped', () => {
  const date = '2026-08-01';

  const questions: Question[] = [
    q({ id: 'sw1', difficulty: 'Medium', patterns: ['Sliding Window'], doneAt: '2026-07-01', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
    q({ id: 'sw2', difficulty: 'Medium', patterns: ['Sliding Window'], doneAt: '2026-07-02', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
    q({ id: 'sw3', difficulty: 'Medium', patterns: ['Sliding Window'], doneAt: '2026-07-03', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
    q({ id: 'tp1', difficulty: 'Medium', patterns: ['Two Pointers'], doneAt: '2026-07-04', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
  ];
  // 'again' on sw1, four days before `date` -> Sliding Window is weak as of
  // `date` (within the 7-day window), so it wins the weak-pattern tie-break
  // for as long as it isn't capped out.
  const reviewLogs: ReviewLog[] = [{ id: 'log-again', questionId: 'sw1', date: '2026-07-28', rating: 'again', kind: 'review' }];

  it('caps Sliding Window at exactly MAX_COVERAGE_PICKS_PER_PATTERN_PER_DAY wins, then falls through to Two Pointers', () => {
    expect(MAX_COVERAGE_PICKS_PER_PATTERN_PER_DAY).toBe(2); // fixture is hand-traced against this value
    const result = planDayDetailed(questions, reviewLogs, settings({ dailyMix: 'mediumDay' }), date);
    expect(result.picks).toEqual([
      { questionId: 'sw1', reason: 'coverage' }, // weak-pattern win #1
      { questionId: 'sw2', reason: 'coverage' }, // weak-pattern win #2 -> cap now hit
      { questionId: 'tp1', reason: 'coverage' }, // sw3 exists but SW is capped out -> falls through to Two Pointers
    ]);
  });
});

// Companion to Fixture K: proves the cap is scoped to coverage-pick ONLY.
// An overdue question from an already-capped pattern must still be served —
// priorities 1-2 (overdue / due-today) never consult coveragePickCounts at
// all (see pickFromPool step 1's comment), so this is really just making
// that scoping decision visible as a fixture.
describe('Fixture L — the coverage-pick cap does not block an overdue pick from the same (capped) pattern', () => {
  const date = '2026-08-01';

  const questions: Question[] = [
    // Already served today, both via reason: 'coverage' -> Sliding Window
    // is at the cap per Fixture K's same MAX_COVERAGE_PICKS_PER_PATTERN_PER_DAY.
    q({ id: 'sw-served-1', difficulty: 'Medium', patterns: ['Sliding Window'], doneAt: '2026-07-01', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
    q({ id: 'sw-served-2', difficulty: 'Medium', patterns: ['Sliding Window'], doneAt: '2026-07-02', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
    // Genuinely overdue, same (capped) pattern, not yet served today.
    q({ id: 'sw-overdue', difficulty: 'Medium', patterns: ['Sliding Window'], doneAt: '2026-06-01', srs: { ladderIndex: 1, dueDate: '2026-07-20', lapses: 0, reps: 1 } }),
    // Decoy: a different, non-overdue pattern that would win an ordinary
    // coverage tie-break, to prove sw-overdue isn't winning by accident.
    q({ id: 'other-decoy', difficulty: 'Medium', patterns: ['Two Pointers'], doneAt: '2026-07-05', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
  ];

  it('sw-overdue is still picked (reason: overdue) despite Sliding Window already being at the per-day cap', () => {
    const excludeIds = new Set(['sw-served-1', 'sw-served-2']);
    const reasonsById = { 'sw-served-1': 'coverage', 'sw-served-2': 'coverage' } as const;
    const pick = pickOneMore(questions, [], excludeIds, date, reasonsById);
    expect(pick).toEqual({ questionId: 'sw-overdue', reason: 'overdue' });
  });
});

// Companion to Fixture K, covering the OTHER branch of the cap's fallback:
// K shows a capped pattern losing a slot to a different, uncapped pattern
// that's available. This fixture covers what happens when NO uncapped
// pattern is available at all — every single remaining Done candidate for
// the slot belongs to the one pattern already at the cap. Per the "never
// serve an empty day" principle (same one the difficulty-relax chain
// follows), the cap must be ignored for that slot rather than leaving it
// empty — pickFromPool's `candidates = notCapped.length > 0 ? notCapped :
// pool` fallback is exactly this.
describe('Fixture M — the cap is ignored (not left empty) when every remaining candidate belongs to the capped pattern', () => {
  const date = '2026-08-01';

  // Sliding Window is the ONLY pattern in this fixture -- there is nothing
  // else planDayDetailed could ever fall through to.
  const questions: Question[] = [
    q({ id: 'sw1', difficulty: 'Medium', patterns: ['Sliding Window'], doneAt: '2026-07-01', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
    q({ id: 'sw2', difficulty: 'Medium', patterns: ['Sliding Window'], doneAt: '2026-07-02', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
    q({ id: 'sw3', difficulty: 'Medium', patterns: ['Sliding Window'], doneAt: '2026-07-03', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
    q({ id: 'sw4', difficulty: 'Medium', patterns: ['Sliding Window'], doneAt: '2026-07-04', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
  ];

  it('slot 3 is still filled (sw3, oldest doneAt of what remains) even though Sliding Window is already at the cap and no other pattern exists', () => {
    const result = planDayDetailed(questions, [], settings({ dailyMix: 'mediumDay' }), date);
    expect(result.picks).toEqual([
      { questionId: 'sw1', reason: 'coverage' }, // win #1
      { questionId: 'sw2', reason: 'coverage' }, // win #2 -> cap hit
      { questionId: 'sw3', reason: 'coverage' }, // cap would leave 0 candidates -> ignored for this slot only
    ]);
    expect(result.picks).toHaveLength(3); // the key assertion: NOT left empty
  });
});

// AMENDMENT #2, multi-pattern attribution: a question tagged with more than
// one pattern (e.g. ["Sliding Window", "Two Pointers"]) that wins a
// coverage-pick slot bumps the per-day cap counter for EVERY one of its
// patterns, not just one -- the same "every pattern gets credited" shape
// patternReviewCounts already uses for total review counts. Built this way
// deliberately (see planDayDetailed's coveragePickCounts bump, which loops
// over the full `patterns` array of the picked question); this fixture
// makes that otherwise-implicit behavior explicit and regression-tested.
describe('Fixture N — a multi-pattern question\'s coverage win counts toward the cap for every one of its patterns', () => {
  const date = '2026-08-01';

  const questions: Question[] = [
    // Both weak (see reviewLogs below) and double-tagged -- each win bumps
    // BOTH Sliding Window and Two Pointers by 1.
    q({ id: 'mp1', difficulty: 'Medium', patterns: ['Sliding Window', 'Two Pointers'], doneAt: '2026-07-01', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
    q({ id: 'mp2', difficulty: 'Medium', patterns: ['Sliding Window', 'Two Pointers'], doneAt: '2026-07-02', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
    // Single-pattern questions for each half of mp1/mp2's tags -- both
    // must end up excluded from slot 3, proving the cap landed on BOTH
    // patterns after only 2 wins (not 2 wins per pattern, i.e. 4 total).
    q({ id: 'sw-only', difficulty: 'Medium', patterns: ['Sliding Window'], doneAt: '2026-07-03', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
    q({ id: 'tp-only', difficulty: 'Medium', patterns: ['Two Pointers'], doneAt: '2026-07-04', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
    // An uninvolved third pattern, untouched -- the only valid candidate
    // left once both Sliding Window and Two Pointers are capped.
    q({ id: 'other-greedy', difficulty: 'Medium', patterns: ['Greedy'], doneAt: '2026-07-05', srs: { ladderIndex: 0, dueDate: '2026-09-01', lapses: 0, reps: 0 } }),
  ];
  // Both Sliding Window and Two Pointers are weak as of `date` (each has an
  // 'again' review 4 days prior), so mp1/mp2/sw-only/tp-only all sort ahead
  // of other-greedy in the weak-pattern tie-break for as long as they're
  // eligible -- isolating this fixture from the ordinary fewest-reviews
  // tie-break, which would otherwise let untouched Greedy win early since
  // its count starts lower.
  const reviewLogs: ReviewLog[] = [
    { id: 'log-sw-again', questionId: 'sw-only', date: '2026-07-28', rating: 'again', kind: 'review' },
    { id: 'log-tp-again', questionId: 'tp-only', date: '2026-07-28', rating: 'again', kind: 'review' },
  ];

  it('mp1 and mp2 win slots 1-2, capping BOTH patterns; slot 3 skips sw-only AND tp-only, landing on the uninvolved pattern', () => {
    const result = planDayDetailed(questions, reviewLogs, settings({ dailyMix: 'mediumDay' }), date);
    expect(result.picks).toEqual([
      { questionId: 'mp1', reason: 'coverage' }, // bumps Sliding Window -> 1, Two Pointers -> 1
      { questionId: 'mp2', reason: 'coverage' }, // bumps Sliding Window -> 2, Two Pointers -> 2 -> BOTH capped
      { questionId: 'other-greedy', reason: 'coverage' }, // sw-only and tp-only both excluded -> falls through
    ]);
  });
});
