// Locks in the Fuse.js config in search.ts against the real ~455-row seed
// data, same approach as slug.test.ts/csvImport.test.ts — real production
// data, not a toy fixture, so a config change that regresses real search
// quality shows up here, not just live.

import { describe, expect, it } from 'vitest';
import { seedQuestions } from '../data/seed';
import { searchQuestions } from './search';

describe('searchQuestions — real typo examples verified live in the Bank', () => {
  it('"binry search" surfaces the actual Binary Search question first', () => {
    const results = searchQuestions(seedQuestions, 'binry search');
    expect(results[0].question.title).toBe('Binary Search to find X in sorted array');
  });

  it('"majoirty element" surfaces both Majority Element questions first', () => {
    const results = searchQuestions(seedQuestions, 'majoirty element');
    expect(results[0].question.title).toBe('Majority Element (>n/2 times)');
    expect(results[1].question.title).toBe('Majority Element (n/3 times)');
  });

  it('"reverse linked lst" surfaces the Reverse LinkedList question first', () => {
    const results = searchQuestions(seedQuestions, 'reverse linked lst');
    expect(results[0].question.title).toBe('Reverse a LinkedList [Iterative]');
  });
});

describe('searchQuestions — disclosed limitation: "kadans algorithm" does not rank Kadane\'s Algorithm first', () => {
  it('is findable, but loses the top spot to other "X\'s Algorithm" titles (Kahn\'s/Dijkstra\'s/Kruskal\'s/Kosaraju\'s)', () => {
    const results = searchQuestions(seedQuestions, 'kadans algorithm');
    const titles = results.map((r) => r.question.title);

    const kadaneIndex = titles.findIndex((t) => t.startsWith("Kadane's Algorithm"));
    expect(kadaneIndex).toBeGreaterThan(-1); // still findable...
    expect(kadaneIndex).toBeGreaterThan(0); // ...but NOT the top result

    // Documents exactly why, not just that it happens: "algorithm" is an
    // exact substring of every one of these titles, so the typo'd
    // "kadans" alone decides the ranking among them — and it happens to
    // fuzzy-match these other graph-algorithm names at least as well as
    // it matches "Kadane's". If a future tuning change fixes this,
    // kadaneIndex becomes 0 and this assertion starts failing loudly — a
    // visible improvement to notice and update, not a silent one. If it
    // regresses further (stops being findable at all), the
    // `toBeGreaterThan(-1)` above catches that instead.
    expect(titles.slice(0, kadaneIndex)).toEqual(
      expect.arrayContaining(["Kahn's Algorithm", "Djisktra's Algorithm", "Kruskal's Algorithm"]),
    );
  });
});

describe('searchQuestions — empty query', () => {
  it('returns every question, in the exact input order (sheet order), untouched — no relevance sort applied', () => {
    const results = searchQuestions(seedQuestions, '');
    expect(results).toHaveLength(seedQuestions.length);
    expect(results.map((r) => r.question.id)).toEqual(seedQuestions.map((q) => q.id));
    expect(results.every((r) => r.score === 0)).toBe(true);
  });

  it('a whitespace-only query is treated the same as empty', () => {
    const results = searchQuestions(seedQuestions, '   ');
    expect(results.map((r) => r.question.id)).toEqual(seedQuestions.map((q) => q.id));
  });
});
