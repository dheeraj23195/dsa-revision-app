// Screen 2 — Question Bank (§6.2). All ~455 questions grouped by Striver
// step in sheet order, sub-grouped by lecture where available, with a
// working Done checkmark (the primary entry point into SRS, §4) and
// filters by step / difficulty / status / pattern / free-text search.

import { useMemo, useState } from 'react';
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

export function BankScreen() {
  const questions = useLiveQuery(() => db.questions.toArray());

  const [search, setSearch] = useState('');
  const [difficulties, setDifficulties] = useState<Set<Difficulty>>(new Set());
  const [statuses, setStatuses] = useState<Set<QuestionStatus>>(new Set());
  const [patterns, setPatterns] = useState<Set<string>>(new Set());
  const [steps, setSteps] = useState<Set<number>>(new Set());
  const [collapsedSteps, setCollapsedSteps] = useState<Set<number>>(new Set());
  // Shift-click range-check (§7): the id most recently toggled by a click,
  // used as the other end of the range on the next shift-click.
  const [lastCheckedId, setLastCheckedId] = useState<string | null>(null);

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

  const filtered = useMemo(() => {
    if (!questions) return [];
    const search_ = search.trim().toLowerCase();
    return questions.filter((q) => {
      if (search_ && !q.title.toLowerCase().includes(search_)) return false;
      if (difficulties.size > 0 && !difficulties.has(q.difficulty)) return false;
      if (statuses.size > 0 && !statuses.has(q.status)) return false;
      if (steps.size > 0 && !steps.has(q.step)) return false;
      if (patterns.size > 0 && !q.patterns.some((p) => patterns.has(p))) return false;
      return true;
    });
  }, [questions, search, difficulties, statuses, steps, patterns]);

  const grouped = useMemo(() => {
    const byStep = new Map<number, Question[]>();
    for (const q of filtered) {
      const list = byStep.get(q.step);
      if (list) list.push(q);
      else byStep.set(q.step, [q]);
    }
    for (const list of byStep.values()) list.sort((a, b) => sheetOrder(a) - sheetOrder(b));
    return [...byStep.entries()].sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  // Flattened, on-screen order of question ids — the range a shift-click
  // spans is defined over what's actually visible (filters applied,
  // collapsed steps excluded), matching what the user sees between their
  // last click and this one.
  const visibleIds = useMemo(() => {
    const ids: string[] = [];
    for (const [step, stepQuestions] of grouped) {
      if (collapsedSteps.has(step)) continue;
      for (const q of stepQuestions) ids.push(q.id);
    }
    return ids;
  }, [grouped, collapsedSteps]);

  if (!questions) {
    return <div className="p-8 text-slate-500">Loading…</div>;
  }

  const totalDone = questions.filter((q) => q.done).length;
  const anyFilterActive =
    search.trim() !== '' || difficulties.size > 0 || statuses.size > 0 || steps.size > 0 || patterns.size > 0;

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
        <h1 className="text-2xl font-bold text-slate-800">Question Bank</h1>
        <p className="mt-1 text-sm text-slate-500">
          {totalDone} / {questions.length} done overall
          <span className="text-slate-400"> · shift-click a checkbox to check/uncheck a range</span>
        </p>
      </header>

      <FilterBar
        search={search}
        onSearch={setSearch}
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
          setSearch('');
          setDifficulties(new Set());
          setStatuses(new Set());
          setSteps(new Set());
          setPatterns(new Set());
        }}
        anyFilterActive={anyFilterActive}
      />

      <div className="mb-3 flex justify-end gap-2 text-xs">
        <button
          className="text-slate-500 hover:text-slate-800 hover:underline"
          onClick={() => setCollapsedSteps(new Set(stepMeta.map(([step]) => step)))}
        >
          Collapse all
        </button>
        <span className="text-slate-300">·</span>
        <button
          className="text-slate-500 hover:text-slate-800 hover:underline"
          onClick={() => setCollapsedSteps(new Set())}
        >
          Expand all
        </button>
      </div>

      {grouped.length === 0 && (
        <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">
          No questions match the current filters.
        </p>
      )}

      <div className="space-y-3">
        {grouped.map(([step, stepQuestions]) => {
          const meta = stepMeta.find(([s]) => s === step);
          const stepTitle = meta?.[1].stepTitle ?? stepQuestions[0].stepTitle;
          const total = meta?.[1].total ?? stepQuestions.length;
          const done = meta?.[1].done ?? 0;
          const collapsed = collapsedSteps.has(step);
          return (
            <StepSection
              key={step}
              stepTitle={stepTitle}
              total={total}
              done={done}
              shownCount={stepQuestions.length}
              collapsed={collapsed}
              onToggleCollapsed={() =>
                setCollapsedSteps((s) => toggleInSet(s, step))
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
  onToggleCollapsed: () => void;
  children: React.ReactNode;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <section className="rounded-lg border border-slate-200">
      <button
        onClick={onToggleCollapsed}
        className="flex w-full items-center gap-4 rounded-lg px-4 py-3 text-left hover:bg-slate-50"
      >
        <span className="w-4 text-slate-400">{collapsed ? '▸' : '▾'}</span>
        <span className="flex-1 font-semibold text-slate-800">{stepTitle}</span>
        {shownCount !== total && (
          <span className="text-xs text-slate-400">{shownCount} shown</span>
        )}
        <span className="text-xs text-slate-500">
          {done}/{total} done
        </span>
        <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
      </button>
      {!collapsed && <div className="border-t border-slate-100">{children}</div>}
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
            <div className="bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-500">
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
    <div className="flex items-center gap-3 border-t border-slate-50 px-4 py-2 first:border-t-0">
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
            className="text-sm text-slate-800 hover:text-indigo-600 hover:underline"
          >
            {q.title}
          </a>
        ) : (
          <span className="text-sm text-slate-800">{q.title}</span>
        )}
      </div>
      <PatternTags patterns={q.patterns} />
      <DifficultyBadge difficulty={q.difficulty} />
      <StatusChip status={q.status} />
      <span className="w-24 shrink-0 text-right text-xs text-slate-400">
        {q.srs ? dueLabel(q.srs.dueDate) : ''}
      </span>
    </div>
  );
}

function FilterBar({
  search,
  onSearch,
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
  anyFilterActive,
}: {
  search: string;
  onSearch: (v: string) => void;
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
  anyFilterActive: boolean;
}) {
  return (
    <div className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search by title…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
        />
        {anyFilterActive && (
          <button
            onClick={onClearAll}
            className="text-xs text-slate-500 hover:text-slate-800 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

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

      <FilterChipRow label="Step">
        {stepMeta.map(([step, meta]) => (
          <Chip key={step} active={steps.has(step)} onClick={() => onToggleStep(step)}>
            {meta.stepTitle.replace(/^Step \d+: /, `${step}. `)}
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
      <span className="w-16 shrink-0 pt-1 text-xs font-medium text-slate-400">{label}</span>
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
          ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
          : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}
