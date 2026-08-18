// CSV bulk import — spec §7: "title,url,difficulty,step,lecture,
// patterns(semicolon-separated)". Pure parsing/matching/diffing logic, no
// Dexie — db.ts's commitImport() is the only thing that actually writes.
//
// Matching is by id (lib/slug.ts's questionId(step, title)) — the exact
// same algorithm scripts/generate-seed.mjs used to produce the ids already
// in the database (see slug.test.ts for the concrete proof against all
// real seed rows). A CSV row whose title or step changed enough to compute
// a different id will NOT match its old row — it will show up as a new
// row, and the old row is left untouched, orphaned. That's an inherent
// consequence of id-by-slug matching, not a bug; renames need a different
// matching strategy this feature doesn't attempt.

import type { Difficulty, Question } from '../types';
import { questionId } from './slug';

// A minimal RFC 4180-ish row parser, not the `csv-parse` package: that
// package's /sync entry references Node's global `Buffer`, which doesn't
// exist in a browser bundle — importing it here crashed the entire app on
// load, not just this screen (confirmed by actually loading the app after
// wiring it in). This format is simple and well-defined (§7's own six
// columns), so a small hand-rolled parser is more robust for a browser
// bundle than pulling in a Buffer polyfill for one call site.
// scripts/generate-seed.mjs is a Node script and can keep using csv-parse —
// this only replaces the browser-side copy.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function parseCsvRecords(csvText: string): Record<string, string>[] {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '');
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = (fields[i] ?? '').trim();
    });
    return record;
  });
}

const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard'];

// Same step -> name mapping as scripts/generate-seed.mjs, for the same
// reason slug.ts's algorithm is duplicated rather than shared: that script
// has no TS transpile step. Only matters for computing `stepTitle` here.
const STEP_NAMES: Record<number, string> = {
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

const REQUIRED_HEADERS = ['title', 'url', 'difficulty', 'step', 'lecture', 'patterns'];

export interface ParsedImportRow {
  id: string;
  title: string;
  url: string;
  difficulty: Difficulty;
  step: number;
  stepTitle: string;
  lecture?: string;
  patterns: string[];
}

export interface ImportRowError {
  /** 1-based row number as it would appear in a spreadsheet (header = row 1). */
  rowNumber: number;
  reason: string;
}

// Only the catalog fields §7 says import may touch. Never done/doneAt/srs/status.
type CatalogField = 'title' | 'url' | 'difficulty' | 'step' | 'stepTitle' | 'lecture' | 'patterns';

export interface FieldDiff {
  field: CatalogField;
  oldValue: unknown;
  newValue: unknown;
}

export interface ImportPreviewRow {
  id: string;
  parsed: ParsedImportRow;
  diffs: FieldDiff[];
}

export interface ImportPreview {
  newRows: ImportPreviewRow[];
  updatedRows: ImportPreviewRow[];
  unchangedCount: number;
  errors: ImportRowError[];
}

/** Parses raw CSV text into valid rows + per-row errors. A malformed row is
 * excluded from `rows` and reported in `errors` with its reason — it never
 * aborts parsing of the rest of the file. Throws instead if the file's
 * header row doesn't match the expected §7 columns at all, since every row
 * would fail identically — the caller shows that as one top-level error. */
export function parseImportCsv(csvText: string): { rows: ParsedImportRow[]; errors: ImportRowError[] } {
  const records = parseCsvRecords(csvText);

  if (records.length > 0) {
    const headers = Object.keys(records[0]);
    const missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
    if (missingHeaders.length > 0) {
      throw new Error(
        `CSV is missing required column(s): ${missingHeaders.join(', ')}. Expected header: ${REQUIRED_HEADERS.join(',')}`,
      );
    }
  }

  const rows: ParsedImportRow[] = [];
  const errors: ImportRowError[] = [];
  const seenIds = new Set<string>();

  records.forEach((record, index) => {
    const rowNumber = index + 2; // +1 for 1-based, +1 for the header row
    const title = (record.title ?? '').trim();
    const difficultyRaw = (record.difficulty ?? '').trim();
    const stepRaw = (record.step ?? '').trim();

    if (!title) {
      errors.push({ rowNumber, reason: 'missing title' });
      return;
    }
    if (!DIFFICULTIES.includes(difficultyRaw as Difficulty)) {
      errors.push({ rowNumber, reason: `invalid difficulty "${difficultyRaw}" (must be Easy, Medium, or Hard)` });
      return;
    }
    if (!/^\d+$/.test(stepRaw)) {
      errors.push({ rowNumber, reason: `invalid step "${stepRaw}" (must be a whole number)` });
      return;
    }
    const step = Number(stepRaw);
    const stepName = STEP_NAMES[step];
    if (!stepName) {
      errors.push({ rowNumber, reason: `unknown step ${step} (expected 1-18)` });
      return;
    }

    const id = questionId(step, title);
    if (seenIds.has(id)) {
      errors.push({ rowNumber, reason: `duplicate id "${id}" (same step + title as an earlier row in this file)` });
      return;
    }
    seenIds.add(id);

    const patterns = (record.patterns ?? '')
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean);

    rows.push({
      id,
      title,
      url: (record.url ?? '').trim(),
      difficulty: difficultyRaw as Difficulty,
      step,
      stepTitle: `Step ${step}: ${stepName}`,
      lecture: (record.lecture ?? '').trim() || undefined,
      patterns,
    });
  });

  return { rows, errors };
}

function diffCatalogFields(existing: Question, parsed: ParsedImportRow): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const compare = (field: CatalogField, oldValue: unknown, newValue: unknown) => {
    const a = Array.isArray(oldValue) ? oldValue.join(';') : (oldValue ?? '');
    const b = Array.isArray(newValue) ? newValue.join(';') : (newValue ?? '');
    if (a !== b) diffs.push({ field, oldValue, newValue });
  };
  compare('title', existing.title, parsed.title);
  compare('url', existing.url, parsed.url);
  compare('difficulty', existing.difficulty, parsed.difficulty);
  compare('step', existing.step, parsed.step);
  compare('stepTitle', existing.stepTitle, parsed.stepTitle);
  compare('lecture', existing.lecture, parsed.lecture);
  compare('patterns', existing.patterns, parsed.patterns);
  return diffs;
}

/** Matches parsed rows against existing questions by id. Never inspects or
 * changes done/doneAt/srs/status — those aren't in diffCatalogFields at all,
 * so importing can't reset anyone's progress on a question that already
 * exists, matched or not. */
export function buildImportPreview(rows: ParsedImportRow[], errors: ImportRowError[], existingQuestions: Question[]): ImportPreview {
  const existingById = new Map(existingQuestions.map((q) => [q.id, q]));

  const newRows: ImportPreviewRow[] = [];
  const updatedRows: ImportPreviewRow[] = [];
  let unchangedCount = 0;

  for (const parsed of rows) {
    const existing = existingById.get(parsed.id);
    if (!existing) {
      newRows.push({ id: parsed.id, parsed, diffs: [] });
      continue;
    }
    const diffs = diffCatalogFields(existing, parsed);
    if (diffs.length === 0) {
      unchangedCount++;
    } else {
      updatedRows.push({ id: parsed.id, parsed, diffs });
    }
  }

  return { newRows, updatedRows, unchangedCount, errors };
}

/** Builds the actual Question objects to write, from an already-reviewed
 * preview: brand-new rows start fresh (done:false/srs:null/status:'todo');
 * updated rows are the EXISTING full record with only the catalog fields
 * overwritten — progress fields are copied through untouched, not reset. */
export function buildImportWrites(
  preview: ImportPreview,
  existingQuestions: Question[],
): { toAdd: Question[]; toUpdate: Question[] } {
  const existingById = new Map(existingQuestions.map((q) => [q.id, q]));

  const toAdd: Question[] = preview.newRows.map((row) => ({
    id: row.parsed.id,
    title: row.parsed.title,
    url: row.parsed.url,
    difficulty: row.parsed.difficulty,
    step: row.parsed.step,
    stepTitle: row.parsed.stepTitle,
    lecture: row.parsed.lecture,
    patterns: row.parsed.patterns,
    done: false,
    doneAt: undefined,
    srs: null,
    status: 'todo',
  }));

  const toUpdate: Question[] = preview.updatedRows.map((row) => {
    const existing = existingById.get(row.id)!;
    return {
      ...existing,
      title: row.parsed.title,
      url: row.parsed.url,
      difficulty: row.parsed.difficulty,
      step: row.parsed.step,
      stepTitle: row.parsed.stepTitle,
      lecture: row.parsed.lecture,
      patterns: row.parsed.patterns,
      // done/doneAt/srs/status intentionally not listed — spread from
      // `existing` above carries them through unchanged.
    };
  });

  return { toAdd, toUpdate };
}
