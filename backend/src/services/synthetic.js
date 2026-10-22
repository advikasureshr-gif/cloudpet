import { rng } from "./rng.js";

/* Fake visit history, used to demo the prediction (and to test it).
   Pretends a person who visits around one time on weekdays and another time on weekends. */

// weekdayMin / weekendMin: usual visit time as minutes after local midnight (20:00 = 1200).
// offsetMin: the person's UTC offset in minutes (India = 330).
export function makeHistory({ now = new Date(), days = 21, weekdayMin = 1200, weekendMin = 600, offsetMin = 0, jitterMin = 15, missChance = 0.1, seed = 7 } = {}) {
  const rand = rng(seed);
  const times = [];
  const localNow = new Date(now.getTime() + offsetMin * 60000);
  const todayStart = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());

  for (let back = 1; back <= days; back++) {                       // yesterday and earlier: never the future
    const dayStart = todayStart - back * 86400000;
    const weekday = new Date(dayStart).getUTCDay();
    if (rand() < missChance) continue;                              // some days they don't come

    const base = (weekday === 0 || weekday === 6) ? weekendMin : weekdayMin;
    const first = base + Math.round((rand() * 2 - 1) * jitterMin);
    for (let k = 0; k < 3; k++) {                                   // a visit has a few actions in a row
      const localMs = dayStart + (first + k * 4) * 60000;
      times.push(new Date(localMs - offsetMin * 60000));
    }
  }
  return times.sort((a, b) => a - b);
}
