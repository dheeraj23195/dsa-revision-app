// Spaced-repetition ladder — §4. Pure function: given the current SRS state,
// a rating, and today's date, returns the next SRS state + question status.
// No Dexie, no Date.now() — everything the function needs is passed in.

import type { QuestionStatus, Rating, SrsState } from '../types';
import { addDaysISO } from './date';

export const LADDER_INTERVALS = [1, 3, 7, 14, 30]; // days, indexed by ladderIndex
const MAX_LADDER_INDEX = LADDER_INTERVALS.length - 1; // 4

export interface RatingResult {
  srs: SrsState;
  status: QuestionStatus;
}

// 'learning' while still on the intro rung (index 0, whether freshly Done or
// just reset by Again), 'reviewing' anywhere in between, 'mastered' only via
// the explicit "passed the 30-day interval" case below — never inferred from
// ladderIndex alone, since reaching index 4 for the first time via a big
// Easy jump hasn't "passed" it yet (see Fixture "Easy jump to the cap").
function statusFor(ladderIndex: number, justMastered: boolean): QuestionStatus {
  if (justMastered) return 'mastered';
  return ladderIndex === 0 ? 'learning' : 'reviewing';
}

export function applyRating(current: SrsState, rating: Rating, today: string): RatingResult {
  switch (rating) {
    case 'again':
      // §4: "Again → ladderIndex 0, lapses++, due tomorrow, status learning."
      return {
        srs: {
          ladderIndex: 0,
          dueDate: addDaysISO(today, LADDER_INTERVALS[0]),
          lapses: current.lapses + 1,
          reps: current.reps + 1,
        },
        status: 'learning',
      };

    case 'hard': {
      // §4: "Hard → same ladderIndex, due at same interval." The interval is
      // recomputed from *today* (not the old dueDate), since the review is
      // happening now — including when it's overdue.
      const ladderIndex = current.ladderIndex;
      return {
        srs: {
          ladderIndex,
          dueDate: addDaysISO(today, LADDER_INTERVALS[ladderIndex]),
          lapses: current.lapses,
          reps: current.reps + 1,
        },
        status: statusFor(ladderIndex, false),
      };
    }

    case 'good':
    case 'easy': {
      const step = rating === 'good' ? 1 : 2;
      const wasAtMax = current.ladderIndex === MAX_LADDER_INDEX;
      const ladderIndex = Math.min(MAX_LADDER_INDEX, current.ladderIndex + step);
      // §4: "Passing the 30-day interval with Good/Easy → status mastered."
      // "Passing" means it was already sitting at the top rung and cleared
      // another review there — not merely arriving at index 4 for the first
      // time via a big jump.
      const justMastered = wasAtMax;
      return {
        srs: {
          ladderIndex,
          dueDate: addDaysISO(today, LADDER_INTERVALS[ladderIndex]),
          lapses: current.lapses,
          reps: current.reps + 1,
        },
        status: statusFor(ladderIndex, justMastered),
      };
    }
  }
}
