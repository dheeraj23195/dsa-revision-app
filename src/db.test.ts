// Regression test for the "uncheck Done -> stale Today card -> silent
// rating no-op" bug. Exercises the real Dexie-backed db.ts functions
// (not the pure scheduler/srs modules) via fake-indexeddb, so the actual
// pruneFromTodayPlan / submitRating code paths run end-to-end, the same
// way the UI calls them — this is what a browser-only Playwright repro
// couldn't pin down deterministically.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, getOrCreateDayPlan, markQuestionDone, submitRating, unmarkQuestionDone, updateSettings } from './db';
import { todayISO } from './lib/date';
import type { Question } from './types';

const TODAY = todayISO();
const QID = 'test-q';

function testQuestion(): Question {
  return {
    id: QID,
    title: 'Test Question',
    url: '',
    difficulty: 'Medium',
    step: 1,
    stepTitle: 'Step 1: Basics',
    patterns: ['Test Pattern'],
    done: false,
    srs: null,
    status: 'todo',
  };
}

beforeEach(async () => {
  // Fresh slate per test — real seed data isn't needed for this, just one
  // controllable question.
  await db.questions.clear();
  await db.reviewLogs.clear();
  await db.dayPlans.clear();
  await db.settings.clear();
  await db.settings.add({ id: 1, dailyMix: 'auto', hardInterleaveEvery: 3 });
  await db.questions.add(testQuestion());
});

describe('mark -> uncheck -> attempt rate while done:false -> re-mark', () => {
  it('step 1: marking Q done puts it in today\'s cached plan', async () => {
    await markQuestionDone(QID);
    const plan = await getOrCreateDayPlan(TODAY);
    expect(plan.questionIds).toContain(QID);
  });

  it('step 2: unchecking Q prunes it from today\'s cached plan (not left stale)', async () => {
    await markQuestionDone(QID);
    await getOrCreateDayPlan(TODAY); // plan now cached with Q in it

    await unmarkQuestionDone(QID);

    const plan = await db.dayPlans.get(TODAY);
    expect(plan?.questionIds).not.toContain(QID);
    expect(plan?.reasons[QID]).toBeUndefined();

    const q = await db.questions.get(QID);
    expect(q?.done).toBe(false);
    expect(q?.srs).toBeNull();
  });

  it('step 3: attempting to rate Q while done:false writes NO ReviewLog (there is no SRS state to update)', async () => {
    await markQuestionDone(QID);
    await getOrCreateDayPlan(TODAY);
    await unmarkQuestionDone(QID);

    const before = await db.reviewLogs.where('questionId').equals(QID).toArray();
    expect(before).toHaveLength(0);

    await submitRating(QID, 'good', TODAY);

    const after = await db.reviewLogs.where('questionId').equals(QID).toArray();
    expect(after).toHaveLength(0); // confirmed no-op, not a silent partial write

    const q = await db.questions.get(QID);
    expect(q?.srs).toBeNull(); // untouched
    expect(q?.status).toBe('todo'); // untouched
  });

  it('step 4: re-marking Q done starts a fresh rotation entry — no phantom "already rated" state appears', async () => {
    await markQuestionDone(QID);
    await getOrCreateDayPlan(TODAY);
    await unmarkQuestionDone(QID);
    await submitRating(QID, 'good', TODAY); // no-op per step 3

    await markQuestionDone(QID);

    const q = await db.questions.get(QID);
    expect(q?.done).toBe(true);
    expect(q?.srs?.ladderIndex).toBe(0); // fresh start, not resuming old progress
    expect(q?.srs?.reps).toBe(0);

    const logs = await db.reviewLogs.where('questionId').equals(QID).toArray();
    expect(logs).toHaveLength(0); // still no rating history — nothing was fabricated in step 3
  });
});

describe('getOrCreateDayPlan: a Settings change applies immediately if today has not been started, else waits for tomorrow', () => {
  const HID = 'test-hard-q';

  beforeEach(async () => {
    // beforeEach above already seeded QID as a Medium question and marked
    // nothing done; add a Hard candidate so a dailyMix change is actually
    // observable in which questions get picked, not just plan metadata.
    await db.questions.add({
      id: HID,
      title: 'Test Hard Question',
      url: '',
      difficulty: 'Hard',
      step: 3,
      stepTitle: 'Step 3: Arrays',
      patterns: ['Test Pattern'],
      done: false,
      srs: null,
      status: 'todo',
    });
    await markQuestionDone(QID);
    await markQuestionDone(HID);
    // Push both due dates far out so overdue/due-today never fire — only
    // the coverage step (and therefore dailyMix's slot selection) decides
    // what gets picked, keeping this test focused on the mix, not on due
    // dates fighting for priority.
    await db.questions.update(QID, { srs: { ladderIndex: 0, dueDate: '2027-01-01', lapses: 0, reps: 0 } });
    await db.questions.update(HID, { srs: { ladderIndex: 0, dueDate: '2027-01-01', lapses: 0, reps: 0 } });
  });

  it('forcing mediumDay never includes the Hard question at all', async () => {
    await updateSettings({ dailyMix: 'mediumDay' });
    const plan = await getOrCreateDayPlan(TODAY);
    expect(plan.questionIds).toEqual([QID]);
  });

  it('switching to hardDay BEFORE anything is rated today recomputes immediately and now includes the Hard question', async () => {
    await updateSettings({ dailyMix: 'mediumDay' });
    await getOrCreateDayPlan(TODAY); // caches the mediumDay-only plan, [QID]

    await updateSettings({ dailyMix: 'hardDay' });
    const plan = await getOrCreateDayPlan(TODAY); // nothing rated yet -> not locked in

    expect(plan.questionIds).toEqual([HID, QID]); // buildSlots(hardDay) = [Hard, Medium]
  });

  it('once something is rated today, a later Settings change no longer touches today\'s plan', async () => {
    await updateSettings({ dailyMix: 'mediumDay' });
    const plan = await getOrCreateDayPlan(TODAY);
    expect(plan.questionIds).toEqual([QID]);

    await submitRating(QID, 'good', TODAY); // today is now "started"

    await updateSettings({ dailyMix: 'hardDay' });
    const planAfter = await getOrCreateDayPlan(TODAY);

    expect(planAfter.questionIds).toEqual([QID]); // unchanged — locked in, applies from tomorrow
  });
});

describe('Deliberate decision: ticking "Attempted" does not protect a card from a same-day recompute', () => {
  // "Attempted" — the checkbox that reveals a Today card's rating buttons —
  // is pure client-side React state in TodayScreen; it writes nothing to
  // Dexie. So to getOrCreateDayPlan, a card the user has ticked Attempted on
  // is indistinguishable from one they haven't opened at all: only an actual
  // ReviewLog (a rating) locks today's plan in. This is a deliberate
  // decision (see conversation), not an oversight — widening the lock to
  // cover "checked but unrated" would reopen the same old-mix-vs-new-mix
  // slot reconciliation complexity already rejected for the Settings-change
  // case above. This test locks that decision in with a real scenario,
  // using the scheduler's own "ties -> older doneAt wins" coverage rule as
  // the trigger, rather than just asserting the behavior.
  const M2 = 'test-medium-q-2';
  const HARD_FILLER = 'test-hard-filler';

  it('a card still showing rating buttons (never rated) disappears once a same-day recompute picks a different question for its slot', async () => {
    await updateSettings({ dailyMix: 'hardDay' }); // exactly 2 slots: [Hard, Medium] -- one Medium slot only
    await db.questions.add({
      id: HARD_FILLER,
      title: 'Hard Filler',
      url: '',
      difficulty: 'Hard',
      step: 3,
      stepTitle: 'Step 3: Arrays',
      patterns: ['Filler'],
      done: false,
      srs: null,
      status: 'todo',
    });
    await markQuestionDone(HARD_FILLER);
    await db.questions.update(HARD_FILLER, { srs: { ladderIndex: 0, dueDate: '2027-01-01', lapses: 0, reps: 0 } });

    await markQuestionDone(QID); // the only Medium candidate so far
    await db.questions.update(QID, {
      srs: { ladderIndex: 0, dueDate: '2027-01-01', lapses: 0, reps: 0 },
      doneAt: '2026-06-01',
    });

    const plan = await getOrCreateDayPlan(TODAY);
    expect(plan.questionIds).toContain(QID); // QID fills the one Medium slot

    // <-- Here, in the real app, the user ticks "Attempted" on QID's card,
    // revealing its rating buttons. Nothing happens at the DB layer: there
    // is no call to make, which is exactly the point being tested.

    // A second Medium question, done with an OLDER doneAt. Ties -> older
    // doneAt wins (§5 Step 2.3) means THIS one now wins the single Medium
    // slot instead of QID.
    await db.questions.add({
      id: M2,
      title: 'Older Medium Competitor',
      url: '',
      difficulty: 'Medium',
      step: 1,
      stepTitle: 'Step 1: Basics',
      patterns: ['Test Pattern'],
      done: false,
      srs: null,
      status: 'todo',
    });
    await markQuestionDone(M2);
    await db.questions.update(M2, {
      srs: { ladderIndex: 0, dueDate: '2027-01-01', lapses: 0, reps: 0 },
      doneAt: '2026-01-01',
    });

    // QID was never rated -- ticking Attempted left no ReviewLog -- so the
    // plan is still "not started" and recomputes freely.
    const recomputed = await getOrCreateDayPlan(TODAY);

    expect(recomputed.questionIds).toContain(M2);
    expect(recomputed.questionIds).not.toContain(QID); // gone: attempted, never rated, never protected
  });
});
