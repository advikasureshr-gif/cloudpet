// The Random Forest check-in prediction, with fake visit history (no database needed).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DYNAMO_ENDPOINT = "http://localhost:4593";       // never contacted: these tests are pure
const { predictFromTimes, evaluate } = await import("../src/services/prediction.js");
const { makeHistory } = await import("../src/services/synthetic.js");

const IST = 330;
const FRI_21_IST = new Date(Date.UTC(2026, 9, 23, 15, 30));      // Friday 23 Oct 2026, 21:00 in India
const FRI_17_IST = new Date(Date.UTC(2026, 9, 23, 11, 30));      // Friday, 17:00 in India
const minutesApart = (iso, date) => Math.abs(Date.parse(iso) - date.getTime()) / 60000;

// Weekdays around 20:00, weekends around 10:00
const history = now => makeHistory({ now, offsetMin: IST, weekdayMin: 1200, weekendMin: 600 });

test("synthetic history never contains the future and has weekday/weekend habits", () => {
  const times = history(FRI_21_IST);
  assert.ok(times.length > 30);
  assert.ok(times.every(t => t < FRI_21_IST));
  assert.deepEqual(makeHistory({ now: FRI_21_IST, offsetMin: IST }), makeHistory({ now: FRI_21_IST, offsetMin: IST }));   // same seed, same history
});

test("Friday evening: the forest knows the next visit is Saturday morning (not some average of the two habits)", () => {
  const p = predictFromTimes(history(FRI_21_IST), FRI_21_IST, IST);
  assert.equal(p.method, "forest");
  assert.ok(minutesApart(p.nextCheckInAt, new Date(Date.UTC(2026, 9, 24, 4, 30))) <= 30, "predicted " + p.nextCheckInAt);   // Sat 10:00 IST
  assert.equal(Date.parse(p.nextCheckInAt) - Date.parse(p.reminderAt), 30 * 60000);                                   // reminder 30 min before
});

test("Friday afternoon: the next visit is this evening", () => {
  const p = predictFromTimes(history(FRI_17_IST), FRI_17_IST, IST);
  assert.equal(p.method, "forest");
  assert.ok(minutesApart(p.nextCheckInAt, new Date(Date.UTC(2026, 9, 23, 14, 30))) <= 30, "predicted " + p.nextCheckInAt);   // Fri 20:00 IST
});

test("the forest beats the simple average on someone with two different habits", () => {
  const times = makeHistory({ now: FRI_21_IST, offsetMin: IST, weekdayMin: 1200, weekendMin: 600, days: 28 });
  const score = evaluate(times, FRI_21_IST, IST, 7);
  assert.ok(score.days >= 5);
  assert.ok(score.forest >= 0.8, "forest " + score.forest);
  assert.ok(score.average < score.forest, `forest ${score.forest} vs average ${score.average}`);
});

test("a steady habit is learned too, across midnight", () => {
  const times = makeHistory({ now: FRI_21_IST, offsetMin: IST, weekdayMin: 5, weekendMin: 5, days: 21 });     // just after midnight
  const p = predictFromTimes(times, FRI_21_IST, IST);
  const local = new Date(Date.parse(p.nextCheckInAt) + IST * 60000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  assert.ok(minute <= 30 || minute >= 1410, "predicted minute " + minute);
});

test("with little history it falls back to the average, and with almost none it says it doesn't know", () => {
  const few = [0, 1, 2, 3, 4].map(d => new Date(FRI_21_IST.getTime() - (d + 1) * 86400000));       // 5 visits, all at 21:00 IST
  const avg = predictFromTimes(few, FRI_21_IST, IST);
  assert.equal(avg.method, "average");
  assert.ok(Date.parse(avg.nextCheckInAt) > FRI_21_IST.getTime() + 30 * 60000);

  const none = predictFromTimes(few.slice(0, 2), FRI_21_IST, IST);
  assert.equal(none.method, "none");
  assert.equal(none.nextCheckInAt, null);
  assert.equal(predictFromTimes([], FRI_21_IST, IST).method, "none");
});
