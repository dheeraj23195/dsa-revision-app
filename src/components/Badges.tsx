import type { Difficulty, QuestionStatus } from '../types';

const DIFFICULTY_STYLES: Record<Difficulty, string> = {
  Easy: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  Medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Hard: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${DIFFICULTY_STYLES[difficulty]}`}
    >
      {difficulty}
    </span>
  );
}

const STATUS_STYLES: Record<QuestionStatus, string> = {
  todo: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  learning: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  reviewing: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  mastered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

const STATUS_LABELS: Record<QuestionStatus, string> = {
  todo: 'Todo',
  learning: 'Learning',
  reviewing: 'Reviewing',
  mastered: 'Mastered',
};

export function StatusChip({ status }: { status: QuestionStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PatternTags({ patterns }: { patterns: string[] }) {
  if (patterns.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {patterns.map((p) => (
        <span
          key={p}
          className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-300"
        >
          {p}
        </span>
      ))}
    </div>
  );
}
