// Regression test for the "uncheck Done -> stale Today card -> silent
// rating no-op" bug. Exercises the real Dexie-backed db.ts functions
// (not the pure scheduler/srs modules) via fake-indexeddb, so the actual
// pruneFromTodayPlan / submitRating code paths run end-to-end, the same
// way the UI calls them — this is what a browser-only Playwright repro
// couldn't pin down deterministically.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, getOrCreateDayPlan, markQuestionDone, submitRating, unmarkQuestionDone } from './db';
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
