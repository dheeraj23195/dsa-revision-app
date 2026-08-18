// Concrete proof, not an assertion: recomputes the id for every one of the
// real ~455 seed questions from its own title+step using this module's
// questionId(), and checks it against the id that scripts/generate-seed.mjs
// actually produced when seed.ts was generated. If the two slug
// implementations ever diverge, this fails immediately and names the
// question — re-importing docs/a2z-seed.csv unmodified would otherwise
// silently mass-duplicate every row instead of being a no-op.

import { describe, expect, it } from 'vitest';
import { seedQuestions } from '../data/seed';
import { questionId } from './slug';

describe('questionId matches generate-seed.mjs\'s id for every real seed question', () => {
  it(`recomputes all ${seedQuestions.length} ids identically`, () => {
    const mismatches = seedQuestions
      .map((q) => ({ id: q.id, recomputed: questionId(q.step, q.title) }))
      .filter(({ id, recomputed }) => id !== recomputed);

    expect(mismatches).toEqual([]);
  });

  it('sanity check: actually exercises the full seed set (not a vacuous pass)', () => {
    expect(seedQuestions.length).toBeGreaterThan(400);
  });
});
