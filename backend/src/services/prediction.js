import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { RandomForestClassifier } from "ml-random-forest";
import { db, TABLE } from "../db.js";
import { REMINDER_LEAD_MIN } from "../catalog.js";
import { userKey } from "../items.js";
import { rng } from "./rng.js";

/* When will this person visit next?

   Every action a player takes is logged (EVENT# rows). We cut the day into 48 half-hour slots, and for every slot in
   the last 4 weeks we know whether the player was active in it or not. A Random Forest learns
   "given the day of the week and the time of day, how likely is a visit?" and we pick the most likely slot
   in the next 24 hours. It is trained per player, from their own history, each time it is needed (a few milliseconds),
   so there is no model file to store or serve.

   Not enough history for a forest? We fall back to the average visit time, and with almost nothing, we say "no idea yet". */

const SLOT_MIN = 30;
const SLOTS = 48;
const WINDOW_DAYS = 28;
const DAY_MS = 86400000;
export const MIN_EVENTS_FOREST = 15;
export const MIN_ACTIVE_DAYS_FOREST = 4;
export const MIN_EVENTS_AVERAGE = 3;

/* ---------- Reading the history ---------- */

export async function loadEventTimes(userId, now, days = WINDOW_DAYS) {
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();
  const times = [];
  let key;
  do {
    const res = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk AND sk BETWEEN :a AND :b",
      ExpressionAttributeValues: { ":pk": userKey(userId), ":a": "EVENT#" + since, ":b": "EVENT#9" },
      ExclusiveStartKey: key
    }));
    for (const item of res.Items || []) times.push(new Date(item.sk.split("#")[1]));
    key = res.LastEvaluatedKey;
  } while (key && times.length < 5000);
  return times.filter(t => !isNaN(t) && t <= now);
}

/* ---------- Turning times into numbers the forest can use ---------- */

// Look at a moment on the player's own clock (offsetMin = minutes ahead of UTC)
function clock(date, offsetMin) {
  const local = new Date(date.getTime() + offsetMin * 60000);
  return {
    dayIndex: Math.floor(local.getTime() / DAY_MS),
    slot: Math.floor((local.getUTCHours() * 60 + local.getUTCMinutes()) / SLOT_MIN),
    weekday: local.getUTCDay()
  };
}

function features(weekday, slot) {
  const angle = 2 * Math.PI * slot / SLOTS;                 // 23:30 and 00:00 are neighbours on a clock
  return [Math.sin(angle), Math.cos(angle), (weekday === 0 || weekday === 6) ? 1 : 0, weekday];
}

// One row per half hour since the player first appeared: was there a visit in it (1) or not (0)?
function buildDataset(times, now, offsetMin, upTo = now) {
  const used = times.filter(t => t < upTo);
  if (!used.length) return { X: [], y: [], activeSlots: 0 };

  const active = new Set(used.map(t => { const c = clock(t, offsetMin); return c.dayIndex + ":" + c.slot; }));
  const first = clock(used[0], offsetMin).dayIndex;
  const last = clock(new Date(upTo.getTime() - 1), offsetMin).dayIndex;
  const start = Math.max(first, last - WINDOW_DAYS + 1);

  const pos = [], neg = [];
  for (let day = start; day <= last; day++) {
    const weekday = new Date(day * DAY_MS).getUTCDay();
    for (let slot = 0; slot < SLOTS; slot++) {
      // skip half hours that haven't happened yet today
      const slotStart = new Date(day * DAY_MS + slot * SLOT_MIN * 60000 - offsetMin * 60000);
      if (slotStart >= upTo) continue;
      (active.has(day + ":" + slot) ? pos : neg).push(features(weekday, slot));
    }
  }

  // Visits are rare (a few slots a day) and empty slots are everywhere. Keep every visit, and a random (but repeatable)
  // sample of the empty slots, about 8 for every visit. That keeps training fast and still shows the forest where visits do NOT happen.
  const random = rng(11);
  for (let i = neg.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [neg[i], neg[j]] = [neg[j], neg[i]]; }
  const keep = neg.slice(0, Math.max(60, pos.length * 8));
  return { X: [...keep, ...pos], y: [...keep.map(() => 0), ...pos.map(() => 1)], activeSlots: pos.length };
}

function trainForest(X, y) {
  const forest = new RandomForestClassifier({
    seed: 42, nEstimators: 40, maxFeatures: 3, replacement: true, useSampleBagging: true,
    treeOptions: { maxDepth: 12, minNumSamples: 2 }
  });
  forest.train(X, y);
  return forest;
}

/* ---------- The simple fallback: average time of day (a "circular" mean, so 23:50 and 00:10 average to midnight) ---------- */

function averageMinute(times, offsetMin) {
  let s = 0, c = 0;
  for (const t of times) {
    const local = new Date(t.getTime() + offsetMin * 60000);
    const angle = 2 * Math.PI * (local.getUTCHours() * 60 + local.getUTCMinutes()) / 1440;
    s += Math.sin(angle); c += Math.cos(angle);
  }
  const mean = Math.atan2(s / times.length, c / times.length);
  return Math.round(((mean + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * 1440) % 1440;
}

// The next moment (after `after`) whose local clock reads `minute`, rounded to its half-hour slot
function nextOccurrence(minute, after, offsetMin) {
  const slotMinute = Math.floor(minute / SLOT_MIN) * SLOT_MIN;
  const local = new Date(after.getTime() + offsetMin * 60000);
  let dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  for (let i = 0; i < 3; i++) {
    const t = new Date(dayStart + slotMinute * 60000 - offsetMin * 60000);
    if (t > after) return t;
    dayStart += DAY_MS;
  }
}

/* ---------- The prediction ---------- */

export function predictFromTimes(times, now = new Date(), offsetMin = 0) {
  const earliest = new Date(now.getTime() + REMINDER_LEAD_MIN * 60000);       // the reminder needs time to go out first
  const days = new Set(times.map(t => { const c = clock(t, offsetMin); return c.dayIndex; })).size;
  const base = { basedOnEvents: times.length, activeDays: days };

  const result = (method, when) => ({
    ...base, method,
    nextCheckInAt: when.toISOString(),
    reminderAt: new Date(when.getTime() - REMINDER_LEAD_MIN * 60000).toISOString()
  });

  if (times.length >= MIN_EVENTS_FOREST && days >= MIN_ACTIVE_DAYS_FOREST) {
    const { X, y, activeSlots } = buildDataset(times, now, offsetMin);
    if (activeSlots > 0 && y.includes(0)) {
      const forest = trainForest(X, y);

      // every half-hour slot in the next 24 hours (starting after the reminder lead time)
      const candidates = [];
      const startSlot = new Date(Math.ceil(earliest.getTime() / (SLOT_MIN * 60000)) * SLOT_MIN * 60000);
      for (let i = 0; i < SLOTS; i++) candidates.push(new Date(startSlot.getTime() + i * SLOT_MIN * 60000));

      const rows = candidates.map(t => { const c = clock(t, offsetMin); return features(c.weekday, c.slot); });
      const probs = forest.predictProbability(rows, 1);

      // The NEXT likely visit: the earliest slot that is nearly as likely as the best one (so a good slot this evening
      // isn't skipped just because tomorrow morning's is slightly stronger)
      const top = Math.max(...probs);
      const pick = probs.findIndex(p => p >= top * 0.6 && p > 0);
      if (pick >= 0) return result("forest", candidates[pick]);
    }
  }

  if (times.length >= MIN_EVENTS_AVERAGE) {
    return result("average", nextOccurrence(averageMinute(times, offsetMin), earliest, offsetMin));
  }

  return { ...base, method: "none", nextCheckInAt: null, reminderAt: null };
}

export async function predictNext(userId, now = new Date(), offsetMin = 0) {
  return predictFromTimes(await loadEventTimes(userId, now), now, offsetMin);
}

/* ---------- How good is it? (for the demo and the report) ----------
   Hide the last `testDays` days, learn from everything before, then check: on each of those days, did the
   most likely slot land within one slot (30 minutes) of a real visit? The "average" baseline is compared the same way. */
export function evaluate(times, now = new Date(), offsetMin = 0, testDays = 7) {
  const cutoff = new Date(now.getTime() - testDays * DAY_MS);
  const { X, y } = buildDataset(times, now, offsetMin, cutoff);
  if (!y.includes(1) || !y.includes(0)) return { days: 0, forest: 0, average: 0 };

  const forest = trainForest(X, y);
  const avgMinute = averageMinute(times.filter(t => t < cutoff), offsetMin);
  let days = 0, forestHits = 0, averageHits = 0;

  for (let back = testDays; back >= 1; back--) {
    const local = new Date(now.getTime() - back * DAY_MS + offsetMin * 60000);
    const dayIndex = Math.floor(local.getTime() / DAY_MS);
    const weekday = new Date(dayIndex * DAY_MS).getUTCDay();
    const actual = times.map(t => clock(t, offsetMin)).filter(c => c.dayIndex === dayIndex).map(c => c.slot);
    if (!actual.length) continue;
    days++;

    const probs = forest.predictProbability(Array.from({ length: SLOTS }, (_, s) => features(weekday, s)), 1);
    const best = probs.indexOf(Math.max(...probs));
    const near = slot => actual.some(a => Math.min(Math.abs(a - slot), SLOTS - Math.abs(a - slot)) <= 1);
    if (near(best)) forestHits++;
    if (near(Math.floor(avgMinute / SLOT_MIN))) averageHits++;
  }
  return { days, forest: days ? forestHits / days : 0, average: days ? averageHits / days : 0 };
}
