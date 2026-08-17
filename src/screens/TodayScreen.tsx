// Screen 1 — Today (§6.1). Renders the day's plan from the pure scheduler
// (§5), cached in `dayPlans` so a refresh doesn't reshuffle it. This slice
// covers the cards + "why" labels + progress line only — the "Attempted" /
// rating flow and "One More" button are a later phase.

import { useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getOrCreateDayPlan } from '../db';
import { patternReviewCounts } from '../lib/scheduler';
import { todayISO } from '../lib/date';
import type { PickReason, Question } from '../types';
import { DifficultyBadge, PatternTags } from '../components/Badges';

const REASON_LABELS: Record<PickReason, string> = {
  overdue: 'Overdue',
  'due-today': 'Due',
  coverage: 'New pattern',
  'hard-interleave': 'Hard interleave',
};

const REASON_STYLES: Record<PickReason, string> = {
  overdue: 'bg-rose-100 text-rose-700',
  'due-today': 'bg-amber-100 text-amber-700',
  coverage: 'bg-sky-100 text-sky-700',
  'hard-interleave': 'bg-violet-100 text-violet-700',
};

export function TodayScreen() {
  const today = todayISO();

  const questions = useLiveQuery(() => db.questions.toArray());
  const reviewLogs = useLiveQuery(() => db.reviewLogs.toArray());
  const dayPlan = useLiveQuery(() => db.dayPlans.get(today), [today]);

  useEffect(() => {
    getOrCreateDayPlan(today).catch((err) => console.error('Failed to build today\'s plan', err));
  }, [today]);

  const questionsById = useMemo(() => {
    const map = new Map<string, Question>();
    for (const q of questions ?? []) map.set(q.id, q);
    return map;
  }, [questions]);

  const plannedIds = dayPlan?.questionIds ?? [];
  const extraIds = dayPlan?.extraIds ?? [];
  const allPlanIds = useMemo(() => [...plannedIds, ...extraIds], [plannedIds, extraIds]);

  const plannedQuestions = plannedIds
    .map((id) => questionsById.get(id))
    .filter((q): q is Question => q !== undefined);

  const mixSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const q of plannedQuestions) counts[q.difficulty] = (counts[q.difficulty] ?? 0) + 1;
    return (['Hard', 'Medium', 'Easy'] as const)
      .filter((d) => counts[d] > 0)
      .map((d) => `${counts[d]} ${d}`)
      .join(' + ');
  }, [plannedQuestions]);

  const progress = useMemo(() => {
    if (!questions || !reviewLogs) return null;

    const doneTodaySet = new Set(
      reviewLogs.filter((l) => l.date === today && allPlanIds.includes(l.questionId)).map((l) => l.questionId),
    );

    const doneQuestions = questions.filter((q) => q.done);
    const patternsTotal = new Set(doneQuestions.flatMap((q) => q.patterns));
    const counts = patternReviewCounts(questions, reviewLogs);
    const patternsCovered = [...patternsTotal].filter((p) => (counts.get(p) ?? 0) > 0).length;

    const reviewsPending = doneQuestions.filter((q) => q.srs !== null && q.srs.dueDate <= today).length;

    return {
      doneToday: doneTodaySet.size,
      totalToday: allPlanIds.length,
      patternsCovered,
      patternsTotal: patternsTotal.size,
      reviewsPending,
    };
  }, [questions, reviewLogs, allPlanIds, today]);

  if (!questions || !reviewLogs || !dayPlan) {
    return <div className="p-8 text-slate-500">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Today</h1>
        {progress && (
          <p className="mt-1 text-sm text-slate-500">
            {progress.doneToday} of {progress.totalToday} done today · {progress.patternsCovered} patterns covered /{' '}
            {progress.patternsTotal} total · {progress.reviewsPending} reviews pending
          </p>
        )}
        {mixSummary && <p className="mt-1 text-xs text-slate-400">Today's mix: {mixSummary}</p>}
      </header>

      {plannedQuestions.length === 0 && (
        <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500">
          Nothing to review yet — mark some questions Done in the Bank to start the rotation.
        </p>
      )}

      <div className="space-y-3">
        {plannedQuestions.map((q) => (
          <TodayCard key={q.id} question={q} reason={dayPlan.reasons[q.id]} />
        ))}
      </div>
    </div>
  );
}

function TodayCard({ question: q, reason }: { question: Question; reason: PickReason | undefined }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {q.url ? (
            <a
              href={q.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-slate-800 hover:text-indigo-600 hover:underline"
            >
              {q.title}
            </a>
          ) : (
            <span className="font-medium text-slate-800">{q.title}</span>
          )}
          <p className="mt-0.5 text-xs text-slate-400">{q.stepTitle}</p>
        </div>
        {reason && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${REASON_STYLES[reason]}`}
          >
            {REASON_LABELS[reason]}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <DifficultyBadge difficulty={q.difficulty} />
        <PatternTags patterns={q.patterns} />
      </div>
    </div>
  );
}
