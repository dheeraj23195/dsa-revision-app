// Screen 4 — Settings (§6.4), minus export/import of the user's own
// progress data (deferred to a future backend/login plan — different thing
// from the CSV catalog import below). "Reset all progress" is relocated
// here unchanged from its earlier nav-bar placement, not rebuilt.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, resetAllProgress, updateSettings } from '../db';
import { ImportModal } from '../admin/ImportModal';
import type { DailyMix } from '../types';

const MIX_OPTIONS: { value: DailyMix; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto (recommended)', description: 'Hard day when a Hard review is due, or on an interleave day; Medium day otherwise.' },
  { value: 'hardDay', label: 'Hard Day', description: '1 Hard + 1 Medium question every day.' },
  { value: 'mediumDay', label: 'Medium Day', description: '3 Medium questions every day.' },
];

export function SettingsScreen() {
  const settings = useLiveQuery(() => db.settings.get(1));
  const [showImportModal, setShowImportModal] = useState(false);

  async function handleResetProgress() {
    const ok = window.confirm(
      'Reset ALL progress? This clears every question\'s Done/SRS state, all review history, and the cached day plan. The question catalog itself (titles, links, difficulty, patterns) is untouched. This cannot be undone.',
    );
    if (!ok) return;
    await resetAllProgress();
  }

  function handleHardIntervalChange(raw: string) {
    const n = Number(raw);
    // Constrained to sensible values: whole numbers >= 1 only. A silently
    // clamped/ignored bad value beats either a NaN making it into Settings
    // (isHardInterleaveDay would divide by it) or a 0/negative one (every
    // day, or a meaningless modulo).
    if (!Number.isInteger(n) || n < 1) return;
    updateSettings({ hardInterleaveEvery: n });
  }

  if (!settings) {
    return <div className="p-8 text-slate-500 dark:text-slate-400">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Settings</h1>
      </header>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-semibold text-slate-800 dark:text-slate-100">Daily mix</h2>
        <div className="space-y-2">
          {MIX_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                settings.dailyMix === opt.value
                  ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-500 dark:bg-indigo-900/30'
                  : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'
              }`}
            >
              <input
                type="radio"
                name="dailyMix"
                checked={settings.dailyMix === opt.value}
                onChange={() => updateSettings({ dailyMix: opt.value })}
                className="mt-1 h-4 w-4 accent-indigo-600"
              />
              <span>
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{opt.label}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{opt.description}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">Hard-interleave frequency</h2>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Every Nth hard day, the Hard slot deliberately duplicates an already-covered pattern instead of a new one,
          to stress-test it. Default: 3 (every 3rd hard day).
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600 dark:text-slate-300">Every</span>
          <input
            type="number"
            min={1}
            step={1}
            value={settings.hardInterleaveEvery}
            onChange={(e) => handleHardIntervalChange(e.target.value)}
            className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          <span className="text-sm text-slate-600 dark:text-slate-300">hard day(s)</span>
        </div>
      </section>

      {/* Deliberately styled distinctly from the two preference sections
          above (and from the red Danger Zone below) — this is catalog/admin
          territory, not a personal setting, and reads that way. FUTURE
          ADMIN GATE: once a login/role system exists, wrap this whole
          section (or just the button) in an isAdmin check — e.g.
          `{isAdmin && <section>...}`. No such check exists yet; there's no
          user model to check against. src/admin/ImportModal.tsx is kept as
          its own component tree specifically so that wrapping is a one-line
          change here, not a refactor of Settings. */}
      <section className="mb-6 rounded-lg border border-slate-300 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-800/60">
        <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Catalog data <span className="font-normal text-slate-400 dark:text-slate-500">— admin</span>
        </h2>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Bulk-add or update questions from a CSV file. Never touches anyone's Done/SRS/review progress — only
          title/url/difficulty/step/lecture/patterns.
        </p>
        <button
          onClick={() => setShowImportModal(true)}
          className="rounded-md border border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-500 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Import Questions
        </button>
      </section>

      <section className="rounded-lg border border-rose-200 bg-rose-50/50 p-4 dark:border-rose-900/50 dark:bg-rose-900/10">
        <h2 className="mb-1 text-sm font-semibold text-rose-700 dark:text-rose-300">Danger zone</h2>
        <p className="mb-3 text-xs text-rose-600/80 dark:text-rose-400/80">
          Clears every question's Done/SRS state, all review history, and the cached day plan. The question catalog
          (titles, links, difficulty, patterns) is untouched. Cannot be undone.
        </p>
        <button
          onClick={handleResetProgress}
          className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 dark:bg-rose-500 dark:hover:bg-rose-400"
        >
          Reset all progress
        </button>
      </section>

      {showImportModal && <ImportModal onClose={() => setShowImportModal(false)} />}
    </div>
  );
}
