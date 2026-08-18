// Single data-access module (§2: "design data access behind one repository
// module anyway — cheap insurance"). All Dexie access should go through here;
// screens should not import `Dexie` directly.

import Dexie, { type EntityTable } from 'dexie';
import type { DayPlan, Question, Rating, ReviewKind, ReviewLog, Settings } from './types';
import { seedQuestions } from './data/seed';
import { addDaysISO, todayISO } from './lib/date';
import { pickOneMore, planDay } from './lib/scheduler';
import { applyRating } from './lib/srs';

export const DEFAULT_SETTINGS: Omit<Settings, 'id'> = {
  dailyMix: 'auto',
  hardInterleaveEvery: 3,
};

class RevisionDB extends Dexie {
  questions!: EntityTable<Question, 'id'>;
  reviewLogs!: EntityTable<ReviewLog, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  dayPlans!: EntityTable<DayPlan, 'date'>;

  constructor() {
    super('dsa-revision-db');

    this.version(1).stores({
      // '*patterns' = multi-entry index so we can query "questions with
      // pattern X" directly for the scheduler's coverage logic.
      questions: 'id, step, difficulty, status, done, *patterns',
      reviewLogs: 'id, questionId, date, kind',
      settings: 'id',
      dayPlans: 'date',
    });

    // Dexie fires 'populate' exactly once, the first time the database is
    // created on this browser — never on subsequent loads. That makes it the
    // right place to import the seed set and defaults, with no manual
    // "is the DB empty?" check and no risk of double-seeding.
    this.on('populate', () => {
      this.questions.bulkAdd(seedQuestions);
      this.settings.add({ id: 1, ...DEFAULT_SETTINGS });
    });
  }
}

export const db = new RevisionDB();

export async function getSettings(): Promise<Settings> {
  const settings = await db.settings.get(1);
  if (settings) return settings;
  // Defensive fallback (e.g. row deleted by hand) — recreate defaults.
  const restored: Settings = { id: 1, ...DEFAULT_SETTINGS };
  await db.settings.put(restored);
  return restored;
}

export function newReviewLogId(): string {
  return crypto.randomUUID();
}

// §4: checking the box is the first-solve entry point into SRS — ladderIndex
// 0, due tomorrow, status 'learning'. Unchecking resets srs to null / status
// 'todo'. Confirming that reset with the user is the caller's job (UI layer);
// this function just applies it once approved.
export async function markQuestionDone(id: string): Promise<void> {
  const q = await db.questions.get(id);
  if (!q || q.done) return;
  await db.questions.update(id, {
    done: true,
    doneAt: todayISO(),
    srs: { ladderIndex: 0, dueDate: addDaysISO(todayISO(), 1), lapses: 0, reps: 0 },
    status: 'learning',
  });
}

// Removes ids from TODAY's cached plan only (§6.1's dayPlans row for
// todayISO()) — never other dates. Other dates' dayPlans rows are a
// historical record of what was actually reviewed that day, not a live
// view; only today's is still being rendered/consumed. Prunes exactly the
// invalidated entries from questionIds/extraIds/reasons, leaving the rest
// of the plan's order and picks untouched, so the anti-reshuffle guarantee
// (§6.1: "refreshing the page doesn't reshuffle it") holds for everything
// that's still valid.
async function pruneFromTodayPlan(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const idSet = new Set(ids);
  const date = todayISO();
  const plan = await db.dayPlans.get(date);
  if (!plan) return;

  // Defensive: normalize in case a plan row from an earlier code version
  // predates a field (e.g. `reasons` didn't exist until partway through
  // this project's history). `db.transaction` rolls the whole thing back on
  // any throw, and this function runs inside unmarkQuestionDone's
  // transaction — an unhandled exception here would silently undo that
  // question's done:false write too, not just fail to prune.
  const existingQuestionIds = plan.questionIds ?? [];
  const existingExtraIds = plan.extraIds ?? [];
  const existingReasons = plan.reasons ?? {};

  const questionIds = existingQuestionIds.filter((qid) => !idSet.has(qid));
  const extraIds = existingExtraIds.filter((qid) => !idSet.has(qid));
  if (questionIds.length === existingQuestionIds.length && extraIds.length === existingExtraIds.length) {
    return; // none of these ids were actually in today's plan
  }

  const reasons = { ...existingReasons };
  for (const qid of ids) delete reasons[qid];
  await db.dayPlans.update(date, { questionIds, extraIds, reasons });
}

// §4: unchecking Done resets srs to null / status 'todo'. Also removes the
// question from today's cached plan (see pruneFromTodayPlan) — without
// this, a question un-Done in the Bank kept showing up in Today forever,
// since the cached plan only ever stores question IDs and the question row
// itself still exists (just done:false), so Today's render (which resolves
// IDs to full Question objects) kept finding and showing it.
export async function unmarkQuestionDone(id: string): Promise<void> {
  await db.transaction('rw', db.questions, db.dayPlans, async () => {
    const q = await db.questions.get(id);
    if (!q || !q.done) return;
    await db.questions.update(id, {
      done: false,
      doneAt: undefined,
      srs: null,
      status: 'todo',
    });
    await pruneFromTodayPlan([id]);
  });
}

// Bulk variants for the Bank's shift-click range-check (§7: "the user will
// bulk-check what they already completed in June"). Same per-question rules
// as the single-question versions above, applied to every id in the range in
// one transaction; ids already in the target state are skipped so a range
// that mixes done/not-done rows doesn't clobber SRS progress that's already
// mid-rotation.
export async function markQuestionsDone(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const today = todayISO();
  await db.questions
    .where('id')
    .anyOf(ids)
    .and((q) => !q.done)
    .modify({
      done: true,
      doneAt: today,
      srs: { ladderIndex: 0, dueDate: addDaysISO(today, 1), lapses: 0, reps: 0 },
      status: 'learning',
    });
}

export async function unmarkQuestionsDone(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.transaction('rw', db.questions, db.dayPlans, async () => {
    // Captured before modify() flips `done`, since the same `.and(q =>
    // q.done)` filter run afterward would no longer match any of them.
    const actuallyUnmarked = await db.questions.where('id').anyOf(ids).and((q) => q.done).primaryKeys();
    await db.questions
      .where('id')
      .anyOf(ids)
      .and((q) => q.done)
      .modify({
        done: false,
        doneAt: undefined,
        srs: null,
        status: 'todo',
      });
    await pruneFromTodayPlan(actuallyUnmarked as string[]);
  });
}

// §6.1: "the plan persisting via dayPlans... so refreshing the page doesn't
// reshuffle it." Reads the cached plan for `date` if one exists; otherwise
// runs the pure scheduler (§5) once and persists the result. Safe to call
// more than once for the same date (e.g. React StrictMode's double-invoked
// effects) — planDay is a pure function of its inputs, so a redundant
// second computation just overwrites the cache with an identical row.
//
// Exception: a cached plan with zero picks is not treated as locked in.
// Today defaults to the first tab a user sees, so it can run (and cache) a
// plan before anything has ever been marked Done — e.g. right after first
// install, or straight after a bulk-import, before the one-time shift-click
// pass in the Bank. There is nothing in an empty plan to protect from
// reshuffling, so it's safe — and necessary — to recompute until it
// actually has something to show.
export async function getOrCreateDayPlan(date: string): Promise<DayPlan> {
  const existing = await db.dayPlans.get(date);
  if (existing && (existing.questionIds.length > 0 || existing.extraIds.length > 0)) {
    return existing;
  }

  const [questions, reviewLogs, settings] = await Promise.all([
    db.questions.toArray(),
    db.reviewLogs.toArray(),
    getSettings(),
  ]);
  const plan = planDay(questions, reviewLogs, settings, date);
  await db.dayPlans.put(plan);
  return plan;
}

// §4 + §6.1: rating a Today card. Updates the question's SRS state via the
// pure ladder (lib/srs.ts) and logs the review. `kind` is derived, not
// passed in by the caller, since it depends on plan membership the caller
// shouldn't need to know about:
//   - 'one-more' if this id was appended to today's plan via the One More
//     button (checked first — an extra can be a question's first-ever
//     review too, and One More's provenance takes priority over that).
//   - 'first-solve' if this is the question's first review ever (reps was
//     still 0 going into this rating).
//   - 'review' otherwise.
//
// Eligibility is decided by `srs` alone, not `done` — the two are normally
// set together (mark/unmark flip both at once), but rating a question
// should never depend on its current done state, only on whether there's
// SRS state to apply the ladder to. Checking `done` here as well was
// redundant at best and misleading at worst: it reads as if being Done
// matters for whether a rating "counts," which it doesn't — this is purely
// "is there a ladder position to advance."
export async function submitRating(questionId: string, rating: Rating, date: string): Promise<void> {
  await db.transaction('rw', db.questions, db.reviewLogs, db.dayPlans, async () => {
    const q = await db.questions.get(questionId);
    if (!q || !q.srs) return; // no SRS state to update

    const plan = await db.dayPlans.get(date);
    const kind: ReviewKind = plan?.extraIds.includes(questionId)
      ? 'one-more'
      : q.srs.reps === 0
        ? 'first-solve'
        : 'review';

    const { srs, status } = applyRating(q.srs, rating, date);
    await db.questions.update(questionId, { srs, status });
    await db.reviewLogs.add({ id: newReviewLogId(), questionId, date, rating, kind });
  });
}

// §5's "One More" button. Picks one question via the same priority chain
// (overdue -> due -> coverage), difficulty preference Medium -> Hard -> Easy,
// excluding everything already in today's plan (originals AND earlier
// extras, rated or not) so nothing is ever served twice in one day. Appends
// to dayPlans.extraIds so it survives a refresh. Returns the picked id, or
// null if literally nothing eligible remains.
export async function addOneMore(date: string): Promise<string | null> {
  return db.transaction('rw', db.questions, db.reviewLogs, db.dayPlans, async () => {
    const plan = await db.dayPlans.get(date);
    if (!plan) return null;

    const [questions, reviewLogs] = await Promise.all([db.questions.toArray(), db.reviewLogs.toArray()]);
    const excludeIds = new Set([...plan.questionIds, ...plan.extraIds]);
    const pick = pickOneMore(questions, reviewLogs, excludeIds, date);
    if (!pick) return null;

    await db.dayPlans.update(date, {
      extraIds: [...plan.extraIds, pick.questionId],
      reasons: { ...plan.reasons, [pick.questionId]: pick.reason },
    });
    return pick.questionId;
  });
}

// Pulled forward from Phase 2's §6.4 "danger-zone full reset" — a one-time
// need to clear out this session's test data (clicked-through Done marks,
// ratings, cached day plans) before a real bulk-mark pass, without losing
// the seeded catalog data itself. Resets every question's progress fields
// (done/doneAt/srs/status) back to fresh and wipes reviewLogs/dayPlans
// entirely; title/url/difficulty/step/stepTitle/lecture/patterns are
// untouched, since this resets progress, not the catalog. `settings`
// (dailyMix/hardInterleaveEvery) is deliberately left alone — those are
// user preferences, not test artifacts.
export async function resetAllProgress(): Promise<void> {
  await db.transaction('rw', db.questions, db.reviewLogs, db.dayPlans, async () => {
    await db.questions.toCollection().modify({
      done: false,
      doneAt: undefined,
      srs: null,
      status: 'todo',
    });
    await db.reviewLogs.clear();
    await db.dayPlans.clear();
  });
}
