// Bank fuzzy search — pure, tested, same shape as scheduler.ts/srs.ts/
// coverage.ts. Owns the Fuse.js config so it can't silently drift from
// BankScreen.tsx doing its own inline setup — a field-weight or threshold
// change now shows up as a failing/changed test, not a live-only surprise.

import Fuse, { type IFuseOptions } from 'fuse.js';
import type { Question } from '../types';

// threshold/weights tuned empirically against the real ~455-row seed data
// (not guessed): tight enough that a common single word ("array") doesn't
// return an unusably large slice of the bank, loose enough that real typo'd
// queries surface the intended question. ignoreLocation: true means a typo
// late in a long title isn't penalized just for being far from its start.
const FUSE_OPTIONS: IFuseOptions<Question> = {
  keys: [
    { name: 'title', weight: 0.7 },
    { name: 'patterns', weight: 0.2 },
    { name: 'stepTitle', weight: 0.1 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
  minMatchCharLength: 2,
  includeScore: true,
};

export interface ScoredQuestion {
  question: Question;
  /** Fuse relevance score — lower is a better match. Always 0 for an empty
   * query: there is no ranking signal when nothing was searched for, so
   * this is a placeholder, not a claim that every question is a "perfect"
   * match. */
  score: number;
}

/**
 * Empty (or whitespace-only) query: returns every input question, in the
 * SAME order they were passed in — the caller's sheet order, completely
 * untouched. This is "search isn't filtering or reordering anything,"
 * not "search matched everything."
 *
 * Non-empty query: returns only the matching questions, sorted by
 * ascending score (best match first) — this is what lets the Bank surface
 * the actual best fuzzy match first instead of whatever happens to sit
 * earliest in sheet order.
 */
export function searchQuestions(questions: Question[], query: string): ScoredQuestion[] {
  const trimmed = query.trim();
  if (trimmed === '') {
    return questions.map((question) => ({ question, score: 0 }));
  }

  const fuse = new Fuse(questions, FUSE_OPTIONS);
  return fuse
    .search(trimmed)
    .map((r) => ({ question: r.item, score: r.score ?? 1 }))
    .sort((a, b) => a.score - b.score);
}
