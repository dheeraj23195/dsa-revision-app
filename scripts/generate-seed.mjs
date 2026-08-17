// One-off generator: docs/a2z-seed.csv -> src/data/seed.ts
//
// Per spec §7, seed data is a static seed.ts, not parsed from CSV at runtime.
// Re-run with `node scripts/generate-seed.mjs` if docs/a2z-seed.csv changes.
// CSV format (§7): title,url,difficulty,step,lecture,patterns(semicolon-separated)

import { parse } from 'csv-parse/sync';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csvPath = path.join(__dirname, '..', 'docs', 'a2z-seed.csv');
const outPath = path.join(__dirname, '..', 'src', 'data', 'seed.ts');

// Step names per spec §7, in sheet order.
const STEP_NAMES = {
  1: 'Basics',
  2: 'Sorting',
  3: 'Arrays',
  4: 'Binary Search',
  5: 'Strings (basic)',
  6: 'Linked List',
  7: 'Recursion',
  8: 'Bit Manipulation',
  9: 'Stacks & Queues',
  10: 'Sliding Window & Two Pointers',
  11: 'Heaps',
  12: 'Greedy',
  13: 'Binary Trees',
  14: 'BST',
  15: 'Graphs',
  16: 'DP',
  17: 'Tries',
  18: 'Strings (advanced)',
};

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const raw = readFileSync(csvPath, 'utf-8');
const records = parse(raw, { columns: true, skip_empty_lines: true });

const seen = new Set();
const questions = records.map((row) => {
  const step = Number(row.step);
  const title = row.title.trim();
  const id = `step${step}-${slugify(title)}`;
  if (seen.has(id)) {
    throw new Error(`Duplicate generated id: ${id}`);
  }
  seen.add(id);

  const stepName = STEP_NAMES[step];
  if (!stepName) {
    throw new Error(`Unknown step ${step} for question "${title}"`);
  }

  const patterns = row.patterns
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);

  const difficulty = row.difficulty.trim();
  if (!['Easy', 'Medium', 'Hard'].includes(difficulty)) {
    throw new Error(`Bad difficulty "${difficulty}" for "${title}"`);
  }

  return {
    id,
    title,
    url: row.url.trim(),
    difficulty,
    step,
    stepTitle: `Step ${step}: ${stepName}`,
    lecture: row.lecture.trim() || undefined,
    patterns,
    done: false,
    doneAt: undefined,
    srs: null,
    status: 'todo',
  };
});

console.log(`Parsed ${questions.length} questions from ${csvPath}`);

const banner = `// GENERATED FILE — do not edit by hand.
// Source: docs/a2z-seed.csv, produced by scripts/generate-seed.mjs
// Regenerate with: node scripts/generate-seed.mjs
`;

const body = `import type { Question } from '../types';

export const seedQuestions: Question[] = ${JSON.stringify(questions, null, 2)};
`;

writeFileSync(outPath, banner + body);
console.log(`Wrote ${outPath}`);
