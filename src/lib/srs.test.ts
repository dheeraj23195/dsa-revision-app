// Hand-traced fixtures for the §4 SRS ladder. LADDER_INTERVALS =
// [1, 3, 7, 14, 30] days, indexed by ladderIndex 0..4.

import { describe, expect, it } from 'vitest';
import type { SrsState } from '../types';
import { applyRating } from './srs';

const today = '2026-01-10';

describe('Again: resets to ladderIndex 0 and increments lapses, from anywhere on the ladder', () => {
  it('ladderIndex 3 -> 0, lapses 1 -> 2, due tomorrow, status learning', () => {
    const current: SrsState = { ladderIndex: 3, dueDate: '2026-01-05', lapses: 1, reps: 5 };
    const result = applyRating(current, 'again', today);
    expect(result).toEqual({
      srs: { ladderIndex: 0, dueDate: '2026-01-11', lapses: 2, reps: 6 },
      status: 'learning',
    });
  });
});

describe('Easy: ladderIndex + 2, capped at 4 (never off the end of the ladder)', () => {
  // Note on the requested "2 -> 4 (capped, not 2 -> 5)" case: 2 + 2 = 4
  // exactly, which is already the ladder's last valid index (0..4) without
  // needing to cap anything — so a 2 -> 4 jump alone doesn't actually
  // exercise the cap. Included below as the literal case, plus a genuinely
  // over-the-end case (3 -> 5 uncapped, capped to 4) so the cap itself is
  // actually under test.

  it('literal case: ladderIndex 2 -> 4 via Easy (lands exactly on the cap, not over it)', () => {
    const current: SrsState = { ladderIndex: 2, dueDate: '2026-01-08', lapses: 0, reps: 3 };
    const result = applyRating(current, 'easy', today);
    expect(result).toEqual({
      srs: { ladderIndex: 4, dueDate: '2026-02-09', lapses: 0, reps: 4 }, // today + 30
      status: 'reviewing', // reached the top rung just now — hasn't "passed" it yet, so not mastered
    });
  });

  it('cap actually engaged: ladderIndex 3 -> would be 5 uncapped, clamped to 4', () => {
    const current: SrsState = { ladderIndex: 3, dueDate: '2026-01-08', lapses: 0, reps: 3 };
    const result = applyRating(current, 'easy', today);
    expect(result.srs.ladderIndex).toBe(4); // not 5 — there is no index 5
    expect(result.srs.dueDate).toBe('2026-02-09'); // today + LADDER_INTERVALS[4] (30), not an out-of-range interval
    expect(result.status).toBe('reviewing'); // same reasoning: first arrival at the top rung, not a pass of it
  });

  it('passing the top rung: already at ladderIndex 4, Easy again -> stays 4 and becomes mastered', () => {
    const current: SrsState = { ladderIndex: 4, dueDate: '2026-01-08', lapses: 0, reps: 6 };
    const result = applyRating(current, 'easy', today);
    expect(result).toEqual({
      srs: { ladderIndex: 4, dueDate: '2026-02-09', lapses: 0, reps: 7 },
      status: 'mastered',
    });
  });
});

describe('Good: ladderIndex + 1, and also masters on a repeat pass of the top rung', () => {
  it('ladderIndex 1 -> 2, status reviewing', () => {
    const current: SrsState = { ladderIndex: 1, dueDate: '2026-01-08', lapses: 0, reps: 2 };
    const result = applyRating(current, 'good', today);
    expect(result).toEqual({
      srs: { ladderIndex: 2, dueDate: '2026-01-17', lapses: 0, reps: 3 }, // today + 7
      status: 'reviewing',
    });
  });

  it('already at ladderIndex 4, Good again -> stays 4 and becomes mastered', () => {
    const current: SrsState = { ladderIndex: 4, dueDate: '2026-01-08', lapses: 0, reps: 8 };
    const result = applyRating(current, 'good', today);
    expect(result.status).toBe('mastered');
    expect(result.srs.ladderIndex).toBe(4);
  });
});

describe('Hard: same ladderIndex, interval recomputed from today (not the old, possibly overdue, dueDate)', () => {
  it('ladderIndex unchanged at 2, due date is today + 7, not old dueDate + 7', () => {
    const current: SrsState = { ladderIndex: 2, dueDate: '2026-01-02', lapses: 0, reps: 4 }; // 8 days overdue
    const result = applyRating(current, 'hard', today);
    expect(result).toEqual({
      srs: { ladderIndex: 2, dueDate: '2026-01-17', lapses: 0, reps: 5 }, // today (Jan 10) + 7, not Jan 2 + 7
      status: 'reviewing',
    });
  });

  it('a Hard rating at the top rung demotes status from mastered back to reviewing, same interval', () => {
    const current: SrsState = { ladderIndex: 4, dueDate: '2026-01-08', lapses: 0, reps: 9 };
    const result = applyRating(current, 'hard', today);
    expect(result).toEqual({
      srs: { ladderIndex: 4, dueDate: '2026-02-09', lapses: 0, reps: 10 },
      status: 'reviewing', // struggled at the top rung -> not a clean pass, even though it was mastered before
    });
  });
});
