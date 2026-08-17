// Data model — spec §3. Do not add fields casually; the scheduler (§5) and
// SRS ladder (§4) are written against exactly this shape.

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export type QuestionStatus = 'todo' | 'learning' | 'reviewing' | 'mastered';

export type Rating = 'again' | 'hard' | 'good' | 'easy';

export type ReviewKind = 'first-solve' | 'review' | 'one-more';

export interface SrsState {
  ladderIndex: number; // 0..4 -> intervals [1, 3, 7, 14, 30]
  dueDate: string; // ISO date (yyyy-mm-dd)
  lapses: number;
  reps: number;
}

export interface Question {
  id: string; // stable slug, e.g. "step3-kadanes-algorithm"
  title: string;
  url: string; // may be '' — some seed rows intentionally have no link
  difficulty: Difficulty;
  step: number; // Striver A2Z step 1-18
  stepTitle: string; // e.g. "Step 3: Arrays"
  lecture?: string; // sub-section within the step, if known
  patterns: string[]; // technique tags, e.g. ["Kadane"]
  done: boolean; // the checkmark
  doneAt?: string; // ISO date
  srs: SrsState | null; // null until first marked done
  status: QuestionStatus;
}

export interface ReviewLog {
  id: string;
  questionId: string;
  date: string; // ISO date the review happened
  rating: Rating;
  kind: ReviewKind;
  note?: string;
}

export type DailyMix = 'auto' | 'hardDay' | 'mediumDay';

export interface Settings {
  id: number; // fixed at 1 — single row table, not part of the spec's logical shape
  dailyMix: DailyMix; // default 'auto'
  hardInterleaveEvery: number; // default 3
}

export interface DayPlan {
  date: string; // ISO date, primary key
  questionIds: string[]; // the originally planned set for the day
  extraIds: string[]; // appended one at a time by "One More"
}
