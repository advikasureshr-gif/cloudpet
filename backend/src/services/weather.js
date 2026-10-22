import { GetCommand, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE } from "../db.js";
import { WEATHER_INFO, WEATHER_RULES, petGroup } from "../catalog.js";
import { AppError } from "../errors.js";

/* Weather comes from Open-Meteo (free, no key). Where the pets "live" is set by DEFAULT_LAT / DEFAULT_LON.
   For demos, a weather override can be saved in the table so you can show every reaction on demand. */

const LAT = () => Number(process.env.DEFAULT_LAT ?? 13.08);
const LON = () => Number(process.env.DEFAULT_LON ?? 80.27);
const OVERRIDE_KEY = { pk: "SYSTEM#weather", sk: "OVERRIDE" };
const CACHE_MS = 30 * 60 * 1000;

let cache = null;                 // { at, value }
let fetcher = defaultFetch;       // swapped in tests, so they never touch the internet

export const setWeatherFetcher = fn => { fetcher = fn || defaultFetch; cache = null; };

// Open-Meteo weather codes → our seven conditions
export function classify(code, tempC) {
  if (code >= 95) return "storm";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if (tempC >= 34) return "hot";
  if (tempC <= 10) return "cold";
  if (code === 3 || code === 45 || code === 48) return "cloudy";
  return "clear";
}

async function defaultFetch() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT()}&longitude=${LON()}&current=temperature_2m,weather_code`;
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error("weather service " + res.status);
  const data = await res.json();
  const tempC = Math.round(data.current.temperature_2m);
  return { condition: classify(data.current.weather_code, tempC), tempC };
}

const shape = (condition, tempC, source) => ({ condition, tempC, source, ...pick(condition) });
const pick = c => ({ label: WEATHER_INFO[c].label, icon: WEATHER_INFO[c].icon });

export async function getWeather() {
  if (process.env.WEATHER_FIXED && WEATHER_INFO[process.env.WEATHER_FIXED]) {
    const c = process.env.WEATHER_FIXED;
    return shape(c, WEATHER_INFO[c].tempC, "fixed");
  }

  const override = (await db.send(new GetCommand({ TableName: TABLE, Key: OVERRIDE_KEY }))).Item;
  if (override) return shape(override.condition, WEATHER_INFO[override.condition].tempC, "demo");

  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  try {
    const w = await fetcher();
    cache = { at: Date.now(), value: shape(w.condition, w.tempC, "open-meteo") };
    return cache.value;
  } catch (err) {
    if (cache) return cache.value;                                  // stale is better than nothing
    return shape("clear", WEATHER_INFO.clear.tempC, "offline");     // can't reach the weather: a calm sunny day
  }
}

// Demo helper: force a condition (or null to go back to the real weather)
export async function setWeatherOverride(condition) {
  if (condition === null) {
    await db.send(new DeleteCommand({ TableName: TABLE, Key: OVERRIDE_KEY }));
    return;
  }
  if (!WEATHER_INFO[condition]) throw new AppError(400, "bad-weather", "Use one of: " + Object.keys(WEATHER_INFO).join(", "));
  await db.send(new PutCommand({ TableName: TABLE, Item: { ...OVERRIDE_KEY, condition } }));
}

// This pet's reaction to the weather: numbers for the rules, words for the page
export function reactionFor(pet, weather) {
  const rule = (WEATHER_RULES[petGroup(pet.type)] || {})[weather.condition] || {};
  const happiness = rule.happiness || 0;
  const health = rule.health || 0;
  const score = happiness + 2 * health;

  const verb = score >= 1.5 ? "absolutely loves" : score > 0 ? "enjoys" : score === 0 ? "doesn't mind" : score > -2 ? "doesn't like" : "hates";
  return { rule, effect: { happiness, health }, message: `${pet.name} ${verb} the ${weather.label.toLowerCase()} weather!` };
}

export const ruleFor = (type, condition) => (WEATHER_RULES[petGroup(type)] || {})[condition] || {};
