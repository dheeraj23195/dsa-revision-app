import { describe, expect, it } from 'vitest';
import { seedQuestions } from '../data/seed';
import type { Question } from '../types';
import { buildImportPreview, buildImportWrites, parseImportCsv } from './csvImport';
import { questionId } from './slug';
// Vite's `?raw` import (typed by the project's existing vite/client types)
// rather than node:fs — keeps this test file free of Node-only APIs, same
// as every other file under src/.
import realSeedCsv from '../../docs/a2z-seed.csv?raw';

// `id` is derived via questionId(step, title), the same function the import
// logic itself uses to match rows — never hand-typed, so a fixture can't
// silently drift from what the real slug algorithm actually produces (which
// is exactly the mistake a hand-typed id would risk masking).
function baseQuestion(
  overrides: Partial<Question> & Pick<Question, 'title' | 'step' | 'stepTitle'>,
): Question {
  return {
    id: questionId(overrides.step, overrides.title),
    url: '',
    difficulty: 'Medium',
    lecture: undefined,
    patterns: [],
    done: false,
    doneAt: undefined,
    srs: null,
    status: 'todo',
    ...overrides,
  };
}

describe('Fixture 1 — real docs/a2z-seed.csv re-imported unmodified is a true no-op', () => {
  it('0 new, 0 updated, all 455 unchanged, 0 errors', () => {
    const { rows, errors } = parseImportCsv(realSeedCsv);
    expect(errors).toEqual([]);
    expect(rows.length).toBe(seedQuestions.length);

    const preview = buildImportPreview(rows, errors, seedQuestions);
    expect(preview.newRows).toHaveLength(0);
    expect(preview.updatedRows).toHaveLength(0);
    expect(preview.unchangedCount).toBe(seedQuestions.length);
    expect(preview.errors).toHaveLength(0);
  });
});

describe('Fixture 2 — updates a few rows\' url/patterns without touching done/srs/status', () => {
  const existing: Question[] = [
    baseQuestion({
      title: "Kadane's Algorithm",
      step: 3,
      stepTitle: 'Step 3: Arrays',
      url: '',
      patterns: ['Kadane'],
      done: true,
      doneAt: '2026-08-01',
      srs: { ladderIndex: 2, dueDate: '2026-09-01', lapses: 1, reps: 3 },
      status: 'reviewing',
    }),
    baseQuestion({
      title: 'C++ STL',
      step: 1,
      stepTitle: 'Step 1: Basics',
      url: '',
      difficulty: 'Easy',
      patterns: ['Math Basics'],
      done: false,
    }),
  ];

  const csv = [
    'title,url,difficulty,step,lecture,patterns',
    "Kadane's Algorithm,https://leetcode.com/problems/maximum-subarray/,Medium,3,,Kadane;Dynamic Programming",
    'C++ STL,,Easy,1,,Math Basics', // unchanged on purpose, to prove it's excluded
  ].join('\n');

  it('detects exactly one real update (url + patterns changed) and one unchanged row', () => {
    const { rows, errors } = parseImportCsv(csv);
    expect(errors).toEqual([]);
    const preview = buildImportPreview(rows, errors, existing);

    expect(preview.newRows).toHaveLength(0);
    expect(preview.updatedRows).toHaveLength(1);
    expect(preview.unchangedCount).toBe(1);

    const diffFields = preview.updatedRows[0].diffs.map((d) => d.field).sort();
    expect(diffFields).toEqual(['patterns', 'url']);
  });

  it('the write for the updated row preserves done/doneAt/srs/status exactly', () => {
    const { rows, errors } = parseImportCsv(csv);
    const preview = buildImportPreview(rows, errors, existing);
    const { toAdd, toUpdate } = buildImportWrites(preview, existing);

    expect(toAdd).toHaveLength(0);
    expect(toUpdate).toHaveLength(1);
    const updated = toUpdate[0];
    expect(updated.id).toBe(questionId(3, "Kadane's Algorithm"));
    expect(updated.url).toBe('https://leetcode.com/problems/maximum-subarray/');
    expect(updated.patterns).toEqual(['Kadane', 'Dynamic Programming']);
    // Untouched progress fields:
    expect(updated.done).toBe(true);
    expect(updated.doneAt).toBe('2026-08-01');
    expect(updated.srs).toEqual({ ladderIndex: 2, dueDate: '2026-09-01', lapses: 1, reps: 3 });
    expect(updated.status).toBe('reviewing');
  });
});

describe('Fixture 3 — mix of new + updated + one deliberately malformed row', () => {
  const existing: Question[] = [
    baseQuestion({
      title: 'C++ STL',
      step: 1,
      stepTitle: 'Step 1: Basics',
      patterns: ['Math Basics'],
      done: true,
      doneAt: '2026-08-01',
      srs: { ladderIndex: 0, dueDate: '2026-08-19', lapses: 0, reps: 0 },
      status: 'learning',
    }),
  ];

  const csv = [
    'title,url,difficulty,step,lecture,patterns',
    'C++ STL,https://example.com/stl,Easy,1,,Math Basics;Templates', // updated
    'Brand New Question,https://example.com/new,Medium,3,,Sliding Window', // new
    'Bad Row,https://example.com/bad,Impossible,3,,Sliding Window', // malformed: invalid difficulty
  ].join('\n');

  it('parses the 2 valid rows and rejects the malformed one with a clear reason', () => {
    const { rows, errors } = parseImportCsv(csv);
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({ rowNumber: 4, reason: 'invalid difficulty "Impossible" (must be Easy, Medium, or Hard)' });
  });

  it('preview shows exactly 1 new, 1 updated, 0 unchanged, 1 error', () => {
    const { rows, errors } = parseImportCsv(csv);
    const preview = buildImportPreview(rows, errors, existing);

    expect(preview.newRows).toHaveLength(1);
    expect(preview.newRows[0].id).toBe('step3-brand-new-question');
    expect(preview.updatedRows).toHaveLength(1);
    expect(preview.updatedRows[0].id).toBe('step1-c-stl');
    expect(preview.unchangedCount).toBe(0);
    expect(preview.errors).toHaveLength(1);
  });

  it('the malformed row is excluded from both new and updated -- never silently written', () => {
    const { rows, errors } = parseImportCsv(csv);
    const preview = buildImportPreview(rows, errors, existing);
    const { toAdd, toUpdate } = buildImportWrites(preview, existing);

    const allIds = [...toAdd, ...toUpdate].map((q) => q.id);
    expect(allIds).not.toContain('step3-bad-row');
    expect(allIds).toHaveLength(2);
  });

  it('the new row starts fresh: done:false, srs:null, status:todo', () => {
    const { rows, errors } = parseImportCsv(csv);
    const preview = buildImportPreview(rows, errors, existing);
    const { toAdd } = buildImportWrites(preview, existing);

    expect(toAdd[0]).toMatchObject({ done: false, srs: null, status: 'todo' });
  });

  it('the updated row keeps its existing progress untouched', () => {
    const { rows, errors } = parseImportCsv(csv);
    const preview = buildImportPreview(rows, errors, existing);
    const { toUpdate } = buildImportWrites(preview, existing);

    expect(toUpdate[0]).toMatchObject({
      done: true,
      doneAt: '2026-08-01',
      srs: { ladderIndex: 0, dueDate: '2026-08-19', lapses: 0, reps: 0 },
      status: 'learning',
      url: 'https://example.com/stl',
      patterns: ['Math Basics', 'Templates'],
    });
  });
});
