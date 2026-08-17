import type { Difficulty, QuestionStatus } from '../types';

const DIFFICULTY_STYLES: Record<Difficulty, string> = {
  Easy: 'bg-emerald-100 text-emerald-700',
  Medium: 'bg-amber-100 text-amber-700',
  Hard: 'bg-rose-100 text-rose-700',
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
  todo: 'bg-slate-100 text-slate-500',
  learning: 'bg-sky-100 text-sky-700',
  reviewing: 'bg-violet-100 text-violet-700',
  mastered: 'bg-emerald-100 text-emerald-700',
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
        <span key={p} className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-600">
          {p}
        </span>
      ))}
    </div>
  );
}
