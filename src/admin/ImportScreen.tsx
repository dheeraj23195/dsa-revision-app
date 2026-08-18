// Admin — CSV bulk import (§7). Deliberately its own top-level component
// tree (src/admin/, a sibling of src/screens/), not folded into the Bank's
// components, so this one thing is trivial to wrap in an isAdmin check once
// a login/role system exists — see the FUTURE ADMIN GATE marker in App.tsx.
// No permission-check logic exists here or anywhere yet; there's no user
// model to check against, so guessing at that shape now would just be
// design debt to undo later.

import { useState } from 'react';
import { db, commitImport } from '../db';
import { buildImportPreview, buildImportWrites, parseImportCsv } from '../lib/csvImport';
import type { ImportPreview } from '../lib/csvImport';
import type { Question } from '../types';

type Stage =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'preview'; preview: ImportPreview; existingQuestions: Question[] }
  | { kind: 'committed'; addedCount: number; updatedCount: number };

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  url: 'URL',
  difficulty: 'Difficulty',
  step: 'Step',
  stepTitle: 'Step title',
  lecture: 'Lecture',
  patterns: 'Patterns',
};

function formatValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '(empty)';
  if (Array.isArray(v)) return v.length > 0 ? v.join(', ') : '(none)';
  return String(v);
}

export function ImportScreen() {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      const { rows, errors } = parseImportCsv(text);
      const existingQuestions = await db.questions.toArray();
      const preview = buildImportPreview(rows, errors, existingQuestions);
      setStage({ kind: 'preview', preview, existingQuestions });
    } catch (err) {
      setStage({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleConfirm() {
    if (stage.kind !== 'preview') return;
    const { toAdd, toUpdate } = buildImportWrites(stage.preview, stage.existingQuestions);
    await commitImport(toAdd, toUpdate);
    setStage({ kind: 'committed', addedCount: toAdd.length, updatedCount: toUpdate.length });
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Import questions (CSV)</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Format: <code>title,url,difficulty,step,lecture,patterns</code> (patterns semicolon-separated). Matches
          existing questions by id; only catalog fields (title/url/difficulty/step/lecture/patterns) are ever
          overwritten — Done/SRS/review progress is never touched.
        </p>
      </header>

      <div className="mb-6 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = ''; // allow re-selecting the same file
          }}
          className="text-sm text-slate-600 dark:text-slate-300"
        />
      </div>

      {stage.kind === 'error' && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-300">
          Couldn't parse this file: {stage.message}
        </div>
      )}

      {stage.kind === 'committed' && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300">
          Import complete: {stage.addedCount} new question{stage.addedCount === 1 ? '' : 's'} added,{' '}
          {stage.updatedCount} updated. Upload another file to continue, or switch tabs.
        </div>
      )}

      {stage.kind === 'preview' && <PreviewPanel preview={stage.preview} onConfirm={handleConfirm} />}
    </div>
  );
}

function PreviewPanel({ preview, onConfirm }: { preview: ImportPreview; onConfirm: () => void }) {
  const { newRows, updatedRows, unchangedCount, errors } = preview;
  const nothingToDo = newRows.length === 0 && updatedRows.length === 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {newRows.length} new · {updatedRows.length} updated · {unchangedCount} unchanged
          {errors.length > 0 && <> · {errors.length} rejected</>}
        </p>
        {nothingToDo && errors.length === 0 && (
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            Nothing to do — every row matches existing data exactly.
          </p>
        )}
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-900/20">
          <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">
            {errors.length} row{errors.length === 1 ? '' : 's'} rejected (rest of the file was still processed):
          </p>
          <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
            {errors.map((e) => (
              <li key={e.rowNumber}>
                Row {e.rowNumber}: {e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {newRows.length > 0 && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-900/50 dark:bg-sky-900/20">
          <p className="mb-2 text-sm font-medium text-sky-800 dark:text-sky-300">
            {newRows.length} new question{newRows.length === 1 ? '' : 's'}:
          </p>
          <ul className="space-y-0.5 text-xs text-sky-700 dark:text-sky-400">
            {newRows.map((row) => (
              <li key={row.id}>
                {row.parsed.stepTitle} — {row.parsed.title} ({row.parsed.difficulty})
              </li>
            ))}
          </ul>
        </div>
      )}

      {updatedRows.length > 0 && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-900/50 dark:bg-violet-900/20">
          <p className="mb-2 text-sm font-medium text-violet-800 dark:text-violet-300">
            {updatedRows.length} question{updatedRows.length === 1 ? '' : 's'} to update:
          </p>
          <div className="space-y-3">
            {updatedRows.map((row) => (
              <div key={row.id} className="rounded-md bg-white p-3 text-xs dark:bg-slate-900">
                <p className="mb-1 font-medium text-slate-800 dark:text-slate-100">{row.parsed.title}</p>
                <ul className="space-y-0.5 text-slate-600 dark:text-slate-300">
                  {row.diffs.map((d) => (
                    <li key={d.field}>
                      <span className="font-medium">{FIELD_LABELS[d.field] ?? d.field}</span>:{' '}
                      <span className="text-rose-600 dark:text-rose-400">{formatValue(d.oldValue)}</span>
                      {' -> '}
                      <span className="text-emerald-600 dark:text-emerald-400">{formatValue(d.newValue)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {!nothingToDo && (
        <button
          onClick={onConfirm}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
        >
          Confirm import ({newRows.length + updatedRows.length} row{newRows.length + updatedRows.length === 1 ? '' : 's'})
        </button>
      )}
    </div>
  );
}
