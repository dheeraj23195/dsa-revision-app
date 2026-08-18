// Screen 2 — Question Bank (§6.2). All ~455 questions grouped by Striver
// step in sheet order, sub-grouped by lecture where available, with a
// working Done checkmark (the primary entry point into SRS, §4), fuzzy
// search, and filters by step / difficulty / status / pattern behind a
// single "Filters" panel.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  db,
  markQuestionDone,
  markQuestionsDone,
  unmarkQuestionDone,
  unmarkQuestionsDone,
} from '../db';
import type { Difficulty, Question, QuestionStatus } from '../types';
import { DifficultyBadge, PatternTags, StatusChip } from '../components/Badges';
import { dueLabel } from '../lib/date';
import { seedQuestions } from '../data/seed';
import { searchQuestions } from '../lib/search';

const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard'];
const STATUSES: QuestionStatus[] = ['todo', 'learning', 'reviewing', 'mastered'];

// Dexie's toArray() returns primary-key (i.e. alphabetical id) order, not
// sheet order — the static seed array is the one source of truth for "sheet
// order" (§6.2), so any custom questions added later (Phase 2) sort after it.
const SEED_ORDER = new Map(seedQuestions.map((q, i) => [q.id, i]));
function sheetOrder(q: Question): number {
  return SEED_ORDER.get(q.id) ?? Number.MAX_SAFE_INTEGER;
}

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

// Which step section(s) are expanded — persisted the same way as dark mode
// (src/lib/theme.ts): read synchronously on mount via useState's initializer,
// written on every change via a useEffect. On a true first-ever load (no
// saved state yet), the sensible default is Step 1 — the natural starting
// point of the sheet, and the cheapest possible default (no scan needed to
// find "the first step with incomplete questions" or similar).
const EXPANDED_STEPS_KEY = 'dsa-revision-bank-expanded-steps';

function getInitialExpandedSteps(): Set<number> {
  try {
    const raw = localStorage.getItem(EXPANDED_STEPS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) {
        return new Set(parsed);
      }
    }
  } catch {
    // malformed localStorage value — fall through to the default
  }
  return new Set([1]);
}

export function BankScreen() {
  const questions = useLiveQuery(() => db.questions.toArray());

  const [search, setSearch] = useState('');
  const [difficulties, setDifficulties] = useState<Set<Difficulty>>(new Set());
  const [statuses, setStatuses] = useState<Set<QuestionStatus>>(new Set());
  const [patterns, setPatterns] = useState<Set<string>>(new Set());
  const [steps, setSteps] = useState<Set<number>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Shift-click range-check (§7): the id most recently toggled by a click,
  // used as the other end of the range on the next shift-click.
  const [lastCheckedId, setLastCheckedId] = useState<string | null>(null);

  // The single-section-open "accordion" is a LOAD-TIME default only — it
  // decides what's expanded once, here, at mount. After that it's a plain
  // multi-select expand/collapse: no action anywhere in this component ever
  // auto-collapses a section the user didn't explicitly collapse themselves.
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(getInitialExpandedSteps);
  useEffect(() => {
    localStorage.setItem(EXPANDED_STEPS_KEY, JSON.stringify([...expandedSteps]));
  }, [expandedSteps]);

  const allPatterns = useMemo(() => {
    if (!questions) return [];
    const set = new Set<string>();
    for (const q of questions) for (const p of q.patterns) set.add(p);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [questions]);

  const stepMeta = useMemo(() => {
    if (!questions) return [];
    const byStep = new Map<number, { stepTitle: string; total: number; done: number }>();
    for (const q of questions) {
      const entry = byStep.get(q.step) ?? { stepTitle: q.stepTitle, total: 0, done: 0 };
      entry.total++;
      if (q.done) entry.done++;
      byStep.set(q.step, entry);
    }
    return [...byStep.entries()].sort((a, b) => a[0] - b[0]);
  }, [questions]);

  // Fuzzy search (typo-tolerant), not exact-substring — the actual Fuse.js
  // config lives in lib/search.ts (pure, unit-tested), not inline here, so
  // it can't silently drift without a test noticing.
  //
  // null = search box is empty, i.e. "don't filter by search at all" —
  // distinct from an empty (but non-null) Map, which would mean "search
  // active, zero matches." Scores (lower = better) are kept, not just which
  // ids matched: the Bank's normal browse order is sheet order, but a
  // relevance-blind sheet-order render of search results can bury the
  // actual best match under a same-step neighbor that only fuzzy-matched
  // weakly — e.g. "binry search" fuzzy-matches "Linear Search" via the
  // shared word "search," and Linear Search sits earlier in sheet order
  // (Step 3) than the real Binary Search questions (Step 4), so a
  // sheet-order render would show the weaker match first despite Fuse
  // itself correctly scoring the Binary Search questions better. Grouping
  // stays by step (see `grouped` below) so search doesn't abandon the
  // Bank's usual structure, but during an active search both the step
  // sections and the rows within them are ordered by relevance instead of
  // sheet position, specifically to avoid that failure mode.
  const searchScoreById = useMemo(() => {
    if (!questions || search.trim() === '') return null;
    const map = new Map<string, number>();
    for (const r of searchQuestions(questions, search)) map.set(r.question.id, r.score);
    return map;
  }, [questions, search]);

  const filtered = useMemo(() => {
    if (!questions) return [];
    return questions.filter((q) => {
      if (searchScoreById && !searchScoreById.has(q.id)) return false;
      if (difficulties.size > 0 && !difficulties.has(q.difficulty)) return false;
      if (statuses.size > 0 && !statuses.has(q.status)) return false;
      if (steps.size > 0 && !steps.has(q.step)) return false;
      if (patterns.size > 0 && !q.patterns.some((p) => patterns.has(p))) return false;
      return true;
    });
  }, [questions, searchScoreById, difficulties, statuses, steps, patterns]);

  const grouped = useMemo(() => {
    const byStep = new Map<number, Question[]>();
    for (const q of filtered) {
      const list = byStep.get(q.step);
      if (list) list.push(q);
      else byStep.set(q.step, [q]);
    }

    if (searchScoreById) {
      for (const list of byStep.values()) {
        list.sort((a, b) => (searchScoreById.get(a.id) ?? 1) - (searchScoreById.get(b.id) ?? 1));
      }
      const bestScore = (qs: Question[]) => Math.min(...qs.map((q) => searchScoreById.get(q.id) ?? 1));
      return [...byStep.entries()].sort((a, b) => bestScore(a[1]) - bestScore(b[1]));
    }

    for (const list of byStep.values()) list.sort((a, b) => sheetOrder(a) - sheetOrder(b));
    return [...byStep.entries()].sort((a, b) => a[0] - b[0]);
  }, [filtered, searchScoreById]);

  const anyFilterActive =
    search.trim() !== '' || difficulties.size > 0 || statuses.size > 0 || steps.size > 0 || patterns.size > 0;
  const activeFilterCount = difficulties.size + statuses.size + steps.size + patterns.size;

  // A search or filter fully suspends the accordion/persisted collapse
  // state: every matching section renders expanded, full stop, no
  // collapse-state lookups at all while active.
  const isStepExpanded = useCallback(
    (step: number) => (anyFilterActive ? true : expandedSteps.has(step)),
    [anyFilterActive, expandedSteps],
  );

  // Flattened, on-screen order of question ids — the range a shift-click
  // spans is defined over what's actually visible (filters applied,
  // collapsed steps excluded), matching what the user sees between their
  // last click and this one.
  const visibleIds = useMemo(() => {
    const ids: string[] = [];
    for (const [step, stepQuestions] of grouped) {
      if (!isStepExpanded(step)) continue;
      for (const q of stepQuestions) ids.push(q.id);
    }
    return ids;
  }, [grouped, isStepExpanded]);

  if (!questions) {
    return <div className="p-8 text-slate-500 dark:text-slate-400">Loading…</div>;
  }

  const totalDone = questions.filter((q) => q.done).length;

  async function handleToggle(q: Question, shiftKey: boolean) {
    const targetDone = !q.done;

    if (shiftKey && lastCheckedId) {
      const from = visibleIds.indexOf(lastCheckedId);
      const to = visibleIds.indexOf(q.id);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        const rangeIds = visibleIds.slice(lo, hi + 1);
        if (targetDone) {
          await markQuestionsDone(rangeIds);
        } else {
          const ok = window.confirm(
            `Uncheck ${rangeIds.length} questions? This resets spaced-repetition progress for all of them.`,
          );
          if (!ok) return;
          await unmarkQuestionsDone(rangeIds);
        }
        setLastCheckedId(q.id);
        return;
      }
      // Last-clicked id has scrolled out of the current filtered view —
      // fall back to single-row toggle below rather than guessing a range.
    }

    if (q.done) {
      const ok = window.confirm(
        `Uncheck "${q.title}"? This resets its spaced-repetition progress back to not-started.`,
      );
      if (!ok) return;
      await unmarkQuestionDone(q.id);
    } else {
      await markQuestionDone(q.id);
    }
    setLastCheckedId(q.id);
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Question Bank</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {totalDone} / {questions.length} done overall
          <span className="text-slate-400 dark:text-slate-500"> · shift-click a checkbox to check/uncheck a range</span>
        </p>
      </header>

      <div className="mb-4 flex items-center gap-3">
        <div className="relative w-full max-w-xs">
          <input
            type="text"
            placeholder="Search by title…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          {search !== '' && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200"
            >
              ✕
            </button>
          )}
        </div>

        <button
          onClick={() => setFiltersOpen((o) => !o)}
          className={`flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            filtersOpen
              ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-300'
              : 'border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'
          }`}
        >
          Filters
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-xs font-semibold text-white dark:bg-indigo-500">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {filtersOpen && (
        <FilterPanel
          difficulties={difficulties}
          onToggleDifficulty={(d) => setDifficulties((s) => toggleInSet(s, d))}
          statuses={statuses}
          onToggleStatus={(s) => setStatuses((prev) => toggleInSet(prev, s))}
          steps={steps}
          onToggleStep={(n) => setSteps((s) => toggleInSet(s, n))}
          stepMeta={stepMeta}
          patterns={patterns}
          onTogglePattern={(p) => setPatterns((s) => toggleInSet(s, p))}
          allPatterns={allPatterns}
          onClearAll={() => {
            setDifficulties(new Set());
            setStatuses(new Set());
            setSteps(new Set());
            setPatterns(new Set());
          }}
          activeFilterCount={activeFilterCount}
        />
      )}

      {!anyFilterActive && (
        <div className="mb-3 flex justify-end gap-2 text-xs">
          <button
            className="text-slate-500 hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-100"
            onClick={() => setExpandedSteps(new Set())}
          >
            Collapse all
          </button>
          <span className="text-slate-300 dark:text-slate-600">·</span>
          <button
            className="text-slate-500 hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-100"
            onClick={() => setExpandedSteps(new Set(stepMeta.map(([step]) => step)))}
          >
            Expand all
          </button>
        </div>
      )}

      {grouped.length === 0 && (
        <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
          No questions match the current filters.
        </p>
      )}

      <div className="space-y-3">
        {grouped.map(([step, stepQuestions]) => {
          const meta = stepMeta.find(([s]) => s === step);
          const stepTitle = meta?.[1].stepTitle ?? stepQuestions[0].stepTitle;
          const total = meta?.[1].total ?? stepQuestions.length;
          const done = meta?.[1].done ?? 0;
          const collapsed = !isStepExpanded(step);
          return (
            <StepSection
              key={step}
              stepTitle={stepTitle}
              total={total}
              done={done}
              shownCount={stepQuestions.length}
              collapsed={collapsed}
              onToggleCollapsed={
                anyFilterActive ? undefined : () => setExpandedSteps((s) => toggleInSet(s, step))
              }
            >
              <LectureGroups questions={stepQuestions} onToggle={handleToggle} />
            </StepSection>
          );
        })}
      </div>
    </div>
  );
}

function StepSection({
  stepTitle,
  total,
  done,
  shownCount,
  collapsed,
  onToggleCollapsed,
  children,
}: {
  stepTitle: string;
  total: number;
  done: number;
  shownCount: number;
  collapsed: boolean;
  onToggleCollapsed: (() => void) | undefined;
  children: React.ReactNode;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-700">
      <button
        onClick={onToggleCollapsed}
        disabled={!onToggleCollapsed}
        className="flex w-full items-center gap-4 rounded-lg px-4 py-3 text-left hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800"
      >
        {onToggleCollapsed && (
          <span className="w-4 text-slate-400 dark:text-slate-500">{collapsed ? '▸' : '▾'}</span>
        )}
        <span className="flex-1 font-semibold text-slate-800 dark:text-slate-100">{stepTitle}</span>
        {shownCount !== total && (
          <span className="text-xs text-slate-400 dark:text-slate-500">{shownCount} shown</span>
        )}
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {done}/{total} done
        </span>
        <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
          <div className="h-full bg-emerald-500 dark:bg-emerald-400" style={{ width: `${pct}%` }} />
        </div>
      </button>
      {!collapsed && <div className="border-t border-slate-100 dark:border-slate-800">{children}</div>}
    </section>
  );
}

function LectureGroups({
  questions,
  onToggle,
}: {
  questions: Question[];
  onToggle: (q: Question, shiftKey: boolean) => void;
}) {
  const groups = useMemo(() => {
    const byLecture = new Map<string, Question[]>();
    for (const q of questions) {
      const key = q.lecture ?? '';
      const list = byLecture.get(key);
      if (list) list.push(q);
      else byLecture.set(key, [q]);
    }
    // Keep sheet order within each group; lectureless ('') group first,
    // named lectures after, in first-seen order.
    return [...byLecture.entries()].sort((a, b) => {
      if (a[0] === '') return -1;
      if (b[0] === '') return 1;
      return 0;
    });
  }, [questions]);

  return (
    <div>
      {groups.map(([lecture, qs]) => (
        <div key={lecture || '__none__'}>
          {lecture && (
            <div className="bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              {lecture}
            </div>
          )}
          {qs.map((q) => (
            <QuestionRow key={q.id} question={q} onToggle={onToggle} />
          ))}
        </div>
      ))}
    </div>
  );
}

function QuestionRow({
  question: q,
  onToggle,
}: {
  question: Question;
  onToggle: (q: Question, shiftKey: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-slate-50 px-4 py-2 first:border-t-0 dark:border-slate-800">
      <input
        type="checkbox"
        checked={q.done}
        readOnly
        onClick={(e) => {
          e.preventDefault();
          onToggle(q, e.shiftKey);
        }}
        className="h-4 w-4 shrink-0 accent-emerald-600"
        aria-label={`Mark "${q.title}" done`}
        title="Shift-click to check/uncheck everything between this and your last click"
      />
      <div className="min-w-0 flex-1">
        {q.url ? (
          <a
            href={q.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-slate-800 hover:text-indigo-600 hover:underline dark:text-slate-100 dark:hover:text-indigo-400"
          >
            {q.title}
          </a>
        ) : (
          <span className="text-sm text-slate-800 dark:text-slate-100">{q.title}</span>
        )}
      </div>
      <PatternTags patterns={q.patterns} />
      <DifficultyBadge difficulty={q.difficulty} />
      <StatusChip status={q.status} />
      <span className="w-24 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500">
        {q.srs ? dueLabel(q.srs.dueDate) : ''}
      </span>
    </div>
  );
}

function FilterPanel({
  difficulties,
  onToggleDifficulty,
  statuses,
  onToggleStatus,
  steps,
  onToggleStep,
  stepMeta,
  patterns,
  onTogglePattern,
  allPatterns,
  onClearAll,
  activeFilterCount,
}: {
  difficulties: Set<Difficulty>;
  onToggleDifficulty: (d: Difficulty) => void;
  statuses: Set<QuestionStatus>;
  onToggleStatus: (s: QuestionStatus) => void;
  steps: Set<number>;
  onToggleStep: (n: number) => void;
  stepMeta: [number, { stepTitle: string; total: number; done: number }][];
  patterns: Set<string>;
  onTogglePattern: (p: string) => void;
  allPatterns: string[];
  onClearAll: () => void;
  activeFilterCount: number;
}) {
  return (
    <div className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Filters</span>
        {activeFilterCount > 0 && (
          <button
            onClick={onClearAll}
            className="text-xs text-slate-500 hover:text-slate-800 hover:underline dark:text-slate-400 dark:hover:text-slate-100"
          >
            Clear all
          </button>
        )}
      </div>

      <FilterChipRow label="Section">
        {stepMeta.map(([step, meta]) => (
          <Chip key={step} active={steps.has(step)} onClick={() => onToggleStep(step)}>
            {meta.stepTitle.replace(/^Step \d+: /, `${step}. `)}
          </Chip>
        ))}
      </FilterChipRow>

      <FilterChipRow label="Difficulty">
        {DIFFICULTIES.map((d) => (
          <Chip key={d} active={difficulties.has(d)} onClick={() => onToggleDifficulty(d)}>
            {d}
          </Chip>
        ))}
      </FilterChipRow>

      <FilterChipRow label="Status">
        {STATUSES.map((s) => (
          <Chip key={s} active={statuses.has(s)} onClick={() => onToggleStatus(s)}>
            {s}
          </Chip>
        ))}
      </FilterChipRow>

      <FilterChipRow label="Pattern">
        {allPatterns.map((p) => (
          <Chip key={p} active={patterns.has(p)} onClick={() => onTogglePattern(p)}>
            {p}
          </Chip>
        ))}
      </FilterChipRow>
    </div>
  );
}

function FilterChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 pt-1 text-xs font-medium text-slate-400 dark:text-slate-500">{label}</span>
      <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        active
          ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-300'
          : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  );
}
