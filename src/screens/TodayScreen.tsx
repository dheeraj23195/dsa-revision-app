// Screen 1 — Today (§6.1). Renders the day's plan from the pure scheduler
// (§5), cached in `dayPlans` so a refresh doesn't reshuffle it. Cards start
// with an "Attempted" checkbox; checking it reveals the four rating buttons
// (§4). "One More" (§5) appears once every planned + extra card is rated.

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOneMore, db, getOrCreateDayPlan, submitRating } from '../db';
import { patternReviewCounts } from '../lib/scheduler';
import { todayISO } from '../lib/date';
import type { PickReason, Question, Rating } from '../types';
import { DifficultyBadge, PatternTags } from '../components/Badges';

const REASON_LABELS: Record<PickReason, string> = {
  overdue: 'Overdue',
  'due-today': 'Due',
  coverage: 'New pattern',
  'hard-interleave': 'Hard interleave',
};

const REASON_STYLES: Record<PickReason, string> = {
  overdue: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'due-today': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  coverage: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  'hard-interleave': 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];

// "Again" is the internal/schema value everywhere (types.ts, lib/srs.ts, the
// 9 ladder fixtures) — this is a UI label change only, not a rating rename.
const RATING_LABELS: Record<Rating, string> = {
  again: "Couldn't solve without help",
  hard: 'Hard',
  good: 'Good',
  easy: 'Easy',
};

const RATING_BUTTON_STYLES: Record<Rating, string> = {
  again: 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50',
  hard: 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50',
  good: 'bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-900/30 dark:text-sky-300 dark:hover:bg-sky-900/50',
  easy: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50',
};

export function TodayScreen() {
  const today = todayISO();

  const questions = useLiveQuery(() => db.questions.toArray());
  const reviewLogs = useLiveQuery(() => db.reviewLogs.toArray());
  const dayPlan = useLiveQuery(() => db.dayPlans.get(today), [today]);

  // Ephemeral UI-only state: which cards have had "Attempted" clicked, to
  // reveal their rating buttons. Not persisted — the only durable state is
  // the ReviewLog a rating actually produces. A refresh before rating just
  // shows the "Attempted" button again, which is fine (§6.1: skipped
  // reviews carry over as overdue tomorrow, no special handling needed).
  const [attemptedIds, setAttemptedIds] = useState<Set<string>>(new Set());
  const [oneMoreExhausted, setOneMoreExhausted] = useState(false);

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

  // Defense-in-depth alongside db.ts's write-side pruneFromTodayPlan (which
  // removes an unmarked id from the cached plan on unmark): even if some id
  // ever ends up stale here for a reason pruneFromTodayPlan didn't catch,
  // this guarantees Today can never render — and so never let the user
  // attempt to rate — a question that isn't currently done:true. Without
  // this, a stale id resolves to a real Question row (unmarking doesn't
  // delete the row, just flips done/srs) and renders as if nothing were
  // wrong, right up until a rating attempt silently no-ops because there's
  // no srs left to update.
  const resolve = (ids: string[]) =>
    ids.map((id) => questionsById.get(id)).filter((q): q is Question => q !== undefined && q.done);
  const plannedQuestions = resolve(plannedIds);
  const extraQuestions = resolve(extraIds);

  const ratedRatingById = useMemo(() => {
    const map = new Map<string, Rating>();
    for (const l of reviewLogs ?? []) {
      if (l.date === today) map.set(l.questionId, l.rating);
    }
    return map;
  }, [reviewLogs, today]);

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
    return <div className="p-8 text-slate-500 dark:text-slate-400">Loading…</div>;
  }

  // §5: "One More" appears only once every planned + extra card is rated —
  // not just attempted.
  const allRated = allPlanIds.length > 0 && allPlanIds.every((id) => ratedRatingById.has(id));

  async function handleRate(questionId: string, rating: Rating) {
    await submitRating(questionId, rating, today);
    setAttemptedIds((prev) => {
      const next = new Set(prev);
      next.delete(questionId);
      return next;
    });
  }

  async function handleOneMore() {
    const pickedId = await addOneMore(today);
    setOneMoreExhausted(pickedId === null);
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Today</h1>
        {progress && (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {progress.doneToday} of {progress.totalToday} done today · {progress.patternsCovered} patterns covered /{' '}
            {progress.patternsTotal} total · {progress.reviewsPending} reviews pending
          </p>
        )}
        {mixSummary && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Today's mix: {mixSummary}</p>}
      </header>

      {plannedQuestions.length === 0 && (
        <p className="rounded-lg bg-slate-50 p-6 text-center text-sm text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
          Nothing to review yet — mark some questions Done in the Bank to start the rotation.
        </p>
      )}

      <div className="space-y-3">
        {plannedQuestions.map((q) => (
          <TodayCard
            key={q.id}
            question={q}
            reason={dayPlan.reasons[q.id]}
            rating={ratedRatingById.get(q.id)}
            attempted={attemptedIds.has(q.id)}
            onAttempt={() => setAttemptedIds((prev) => new Set(prev).add(q.id))}
            onRate={(rating) => handleRate(q.id, rating)}
          />
        ))}
        {extraQuestions.map((q) => (
          <TodayCard
            key={q.id}
            question={q}
            reason={dayPlan.reasons[q.id]}
            rating={ratedRatingById.get(q.id)}
            attempted={attemptedIds.has(q.id)}
            onAttempt={() => setAttemptedIds((prev) => new Set(prev).add(q.id))}
            onRate={(rating) => handleRate(q.id, rating)}
            extra
          />
        ))}
      </div>

      {allRated && (
        <div className="mt-4 flex flex-col items-start gap-2">
          <button
            onClick={handleOneMore}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
          >
            One More
          </button>
          {oneMoreExhausted && (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              No more eligible questions right now — mark more questions Done in the Bank to unlock more.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TodayCard({
  question: q,
  reason,
  rating,
  attempted,
  onAttempt,
  onRate,
  extra = false,
}: {
  question: Question;
  reason: PickReason | undefined;
  rating: Rating | undefined;
  attempted: boolean;
  onAttempt: () => void;
  onRate: (rating: Rating) => void;
  extra?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 ${
        rating ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {q.url ? (
            <a
              href={q.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-slate-800 hover:text-indigo-600 hover:underline dark:text-slate-100 dark:hover:text-indigo-400"
            >
              {q.title}
            </a>
          ) : (
            <span className="font-medium text-slate-800 dark:text-slate-100">{q.title}</span>
          )}
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{q.stepTitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {extra && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Extra
            </span>
          )}
          {reason && (
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${REASON_STYLES[reason]}`}>
              {REASON_LABELS[reason]}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <DifficultyBadge difficulty={q.difficulty} />
        <PatternTags patterns={q.patterns} />
      </div>

      {rating ? (
        <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">Rated: {RATING_LABELS[rating]}</p>
      ) : attempted ? (
        <div className="mt-3 flex gap-2">
          {RATINGS.map((r) => (
            <button
              key={r}
              onClick={() => onRate(r)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${RATING_BUTTON_STYLES[r]}`}
            >
              {RATING_LABELS[r]}
            </button>
          ))}
        </div>
      ) : (
        <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            onChange={onAttempt}
            className="h-4 w-4 accent-indigo-600"
            aria-label={`Mark "${q.title}" attempted`}
          />
          Attempted
        </label>
      )}
    </div>
  );
}
