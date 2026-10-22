import { DECAY_PER_HOUR, MIN_STAT, MIN_HEALTH, MAX_AWAY_HOURS, MIN_TICK_HOURS, WEATHER_HOURS, HEALTH_RULES } from "../catalog.js";

/* The time-passing rules, as plain functions (no database): easy to test, and the same code runs
   on your laptop and in the scheduled Lambda later. */

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round2 = n => Math.round(n * 100) / 100;

// 1 real hour = 1 game hour. For the demo video, TIME_SCALE=60 makes one real minute count as an hour.
export const timeScale = () => Number(process.env.TIME_SCALE) > 0 ? Number(process.env.TIME_SCALE) : 1;

export function elapsedHours(pet, now = new Date()) {
  const from = Date.parse(pet.lastTick || pet.lastInteraction || pet.createdAt);
  return Math.max(0, (now.getTime() - from) / 3600000 * timeScale());
}

// `rule` is this pet's reaction to the current weather: { happiness, health } per hour (may be empty)
export function decayStats(stats, hours, rule = {}) {
  const s = { ...stats };
  const weatherHours = Math.min(hours, WEATHER_HOURS);
  let left = Math.min(hours, MAX_AWAY_HOURS);
  let t = 0;

  while (left > 1e-9) {
    const dt = Math.min(1, left);
    left -= dt;

    for (const k of Object.keys(DECAY_PER_HOUR)) s[k] = Math.max(MIN_STAT, (s[k] ?? 0) - DECAY_PER_HOUR[k] * dt);

    const low = (s.hunger < HEALTH_RULES.lowHunger) + (s.hygiene < HEALTH_RULES.lowHygiene) + (s.energy < HEALTH_RULES.lowEnergy);
    const weather = t < weatherHours;

    let happiness = -HEALTH_RULES.happinessPerLow * low;
    let health = -HEALTH_RULES.dropPerLow * low;

    const allFine = [s.hunger, s.hygiene, s.energy, s.happiness].every(v => v >= HEALTH_RULES.healMin);
    if (low === 0 && allFine) health += HEALTH_RULES.healPerHour;

    if (weather) {
      happiness += rule.happiness || 0;
      health += rule.health || 0;
    }

    s.happiness = clamp(s.happiness + happiness * dt, MIN_STAT, 100);
    s.health = clamp((s.health ?? 0) + health * dt, MIN_HEALTH, 100);
    t += dt;
  }

  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, round2(v)]));
}

// What this pet looks like right now, and whether enough time passed to bother changing anything.
export function projectStats(pet, now, rule) {
  const hours = elapsedHours(pet, now);
  if (hours < MIN_TICK_HOURS) return { stats: pet.stats, changed: false };
  return { stats: decayStats(pet.stats, hours, rule), changed: true };
}
