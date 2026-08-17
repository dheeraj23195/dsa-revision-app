// Single data-access module (§2: "design data access behind one repository
// module anyway — cheap insurance"). All Dexie access should go through here;
// screens should not import `Dexie` directly.

import Dexie, { type EntityTable } from 'dexie';
import type { DayPlan, Question, ReviewLog, Settings } from './types';
import { seedQuestions } from './data/seed';
import { addDaysISO, todayISO } from './lib/date';
import { planDay } from './lib/scheduler';

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

export async function unmarkQuestionDone(id: string): Promise<void> {
  const q = await db.questions.get(id);
  if (!q || !q.done) return;
  await db.questions.update(id, {
    done: false,
    doneAt: undefined,
    srs: null,
    status: 'todo',
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
