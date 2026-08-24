// Screen 3 — Coverage Dashboard (§6.3). Pattern grid grouped by topic (the
// step each pattern has the most questions in), plus four summary counters.
// All computation lives in lib/coverage.ts (pure, unit-tested); this screen
// just wires it to live Dexie data.

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { computeCoverageSummary, computePatternCoverage, groupPatternCoverageByTopic } from '../lib/coverage';
import type { PatternAggregateStatus } from '../lib/coverage';
import { todayISO } from '../lib/date';
import type { Question } from '../types';
import { DifficultyBadge } from '../components/Badges';

// Same 4-color language as StatusChip in components/Badges.tsx (todo/
// learning/reviewing/mastered) — 'untouched' reuses the 'todo' treatment,
// since an untouched pattern is exactly "no Done question has touched it
// yet," the pattern-level equivalent of a question's 'todo' status.
const STATUS_STYLES: Record<PatternAggregateStatus, string> = {
  untouched: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  learning: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  reviewing: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  mastered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

const STATUS_LABELS: Record<PatternAggregateStatus, string> = {
  untouched: 'Untouched',
  learning: 'Learning',
  reviewing: 'Reviewing',
  mastered: 'Mastered',
};

export function CoverageScreen() {
  const questions = useLiveQuery(() => db.questions.toArray());
  const reviewLogs = useLiveQuery(() => db.reviewLogs.toArray());
  const [selectedPattern, setSelectedPattern] = useState<string | null>(null);

  if (!questions || !reviewLogs) {
    return <div className="p-8 text-slate-500 dark:text-slate-400">Loading…</div>;
  }

  const today = todayISO();
  const summary = computeCoverageSummary(questions, reviewLogs, today);
  const coverage = computePatternCoverage(questions, reviewLogs);
  const groups = groupPatternCoverageByTopic(coverage);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Coverage Dashboard</h1>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Patterns covered" value={`${summary.patternsCovered} / ${summary.patternsTotal}`} />
        <SummaryCard label="Questions done" value={`${summary.questionsDone} / ${summary.questionsTotal}`} />
        <SummaryCard label="Reviews completed" value={summary.reviewsCompleted} />
        <SummaryCard label="Review debt" value={summary.reviewDebt} accent={summary.reviewDebt > 0} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-medium">Legend:</span>
        {(['untouched', 'learning', 'reviewing', 'mastered'] as const).map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLES[s].split(' ')[0]} ${STATUS_STYLES[s].split(' ')[2]}`} />
            {STATUS_LABELS[s]}
          </span>
        ))}
      </div>

      {groups.length === 0 && (
        <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
          No patterns found — the question catalog looks empty.
        </p>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <section
            key={group.topicStep}
            className="rounded-lg border border-slate-200 p-4 dark:border-slate-700"
          >
            <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{group.topicTitle}</h2>
            <div className="flex flex-wrap gap-2">
              {group.patterns.map((p) => (
                <button
                  key={p.pattern}
                  onClick={() => setSelectedPattern(p.pattern)}
                  title={`${p.doneQuestions}/${p.totalQuestions} questions done · ${p.reviewCount} reviews — click for question list`}
                  className={`rounded-md px-3 py-2 text-left text-xs transition-opacity hover:opacity-80 ${STATUS_STYLES[p.status]}`}
                >
                  <div className="font-medium">{p.pattern}</div>
                  <div className="opacity-80">
                    {p.reviewCount} review{p.reviewCount === 1 ? '' : 's'} · {p.doneQuestions}/{p.totalQuestions} done
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {selectedPattern && (
        <PatternQuestionsModal
          pattern={selectedPattern}
          questions={questions}
          onClose={() => setSelectedPattern(null)}
        />
      )}
    </div>
  );
}

// Read-only, additive UI layer on top of lib/coverage.ts's already-computed,
// already-tested aggregation — filters the same live `questions` array the
// screen already has, rather than adding a new computation to coverage.ts
// or touching its tests.
function PatternQuestionsModal({
  pattern,
  questions,
  onClose,
}: {
  pattern: string;
  questions: Question[];
  onClose: () => void;
}) {
  const { done, notDone } = useMemo(() => {
    const matching = questions.filter((q) => q.patterns.includes(pattern));
    const byTitle = (a: Question, b: Question) => a.title.localeCompare(b.title);
    return {
      done: matching.filter((q) => q.done).sort(byTitle),
      notDone: matching.filter((q) => !q.done).sort(byTitle),
    };
  }, [questions, pattern]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-slate-900">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{pattern}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            ✕
          </button>
        </div>

        <PatternQuestionGroup title="Done" questions={done} emptyLabel="No questions done yet for this pattern." />
        <PatternQuestionGroup title="Not done" questions={notDone} emptyLabel="Nothing left — every question is done." />
      </div>
    </div>
  );
}

function PatternQuestionGroup({
  title,
  questions,
  emptyLabel,
}: {
  title: string;
  questions: Question[];
  emptyLabel: string;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {title} ({questions.length})
      </h3>
      {questions.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1.5">
          {questions.map((q) => (
            <li key={q.id} className="flex items-center justify-between gap-3 text-sm">
              {q.url ? (
                <a
                  href={q.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate text-slate-700 hover:text-indigo-600 hover:underline dark:text-slate-200 dark:hover:text-indigo-400"
                >
                  {q.title}
                </a>
              ) : (
                <span className="min-w-0 truncate text-slate-700 dark:text-slate-200">{q.title}</span>
              )}
              <DifficultyBadge difficulty={q.difficulty} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div
        className={`text-xl font-bold ${
          accent ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'
        }`}
      >
        {value}
      </div>
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}
