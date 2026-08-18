// Admin — CSV bulk import (§7), presented as a modal launched from Settings.
// Deliberately its own top-level component tree (src/admin/, a sibling of
// src/screens/) rather than folded into Settings' own component tree, so
// that once a login/role system exists, gating "can this button even appear
// in Settings" is a one-line wrapper around the trigger in
// SettingsScreen.tsx — see the FUTURE ADMIN GATE marker there — not a hunt
// through Settings' JSX for what to guard. No permission-check logic exists
// here or anywhere yet; there's no user model to check against, so guessing
// at that shape now would just be design debt.
//
// All parsing/matching/diffing logic lives in ../lib/csvImport.ts, unchanged
// by this file — this is a presentation-layer wrapper only (native file
// input + drag-and-drop, both funneling into the same handleFile).

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

export function ImportModal({ onClose }: { onClose: () => void }) {
  // All local state — closing this modal (unmounting it) discards a
  // selected file/preview/error entirely on its own, with nothing to
  // separately reset. Nothing is written to Dexie until handleConfirm runs.
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [isDraggingOver, setIsDraggingOver] = useState(false);

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-slate-900">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">Import questions (CSV)</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
          <p className="mb-1">
            Required header, exactly: <code className="font-mono">title,url,difficulty,step,lecture,patterns</code>
          </p>
          <p className="mb-1">
            <code className="font-mono">patterns</code> is semicolon-separated (e.g. <code className="font-mono">Kadane;Dynamic Programming</code>).
          </p>
          <p className="mb-1">
            <code className="font-mono">difficulty</code> must be exactly <code className="font-mono">Easy</code>,{' '}
            <code className="font-mono">Medium</code>, or <code className="font-mono">Hard</code>.
          </p>
          <p>
            Rows are matched to existing questions by <strong>title + step</strong> — editing a title (or moving a
            question to a different step) changes its identity, so it will show up as a new row instead of an
            update, and the old row is left as-is.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          className={`mb-4 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            isDraggingOver
              ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-900/20'
              : 'border-slate-300 dark:border-slate-600'
          }`}
        >
          <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">Drag and drop a CSV file here, or</p>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = ''; // allow re-selecting the same file
            }}
            className="mx-auto text-sm text-slate-600 dark:text-slate-300"
          />
        </div>

        {stage.kind === 'error' && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-300">
            Couldn't parse this file: {stage.message}
          </div>
        )}

        {stage.kind === 'committed' && (
          <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-900/20 dark:text-emerald-300">
            Import complete: {stage.addedCount} new question{stage.addedCount === 1 ? '' : 's'} added,{' '}
            {stage.updatedCount} updated. Drop another file above to continue, or close this dialog.
          </div>
        )}

        {stage.kind === 'preview' && (
          <PreviewPanel preview={stage.preview} onConfirm={handleConfirm} onCancel={onClose} />
        )}

        {stage.kind !== 'preview' && (
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewPanel({
  preview,
  onConfirm,
  onCancel,
}: {
  preview: ImportPreview;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        {!nothingToDo && (
          <button
            onClick={onConfirm}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            Confirm import ({newRows.length + updatedRows.length} row{newRows.length + updatedRows.length === 1 ? '' : 's'})
          </button>
        )}
      </div>
    </div>
  );
}
