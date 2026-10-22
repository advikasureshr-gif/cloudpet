// Time passing, health, weather reactions, the scheduled update and the reminder-email boost.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import dynalite from "dynalite";

let server, base, dynamo, db, TABLE, UpdateCommand, decay, weather;

before(async () => {
  dynamo = dynalite({ createTableMs: 0 });
  await new Promise(r => dynamo.listen(4596, r));
  process.env.DYNAMO_ENDPOINT = "http://localhost:4596";
  process.env.TABLE_NAME = "CloudPetTest4";
  process.env.AUTH_MODE = "dev";
  process.env.DEV_ROUTES = "true";
  process.env.WEATHER_FIXED = "clear";                   // tests never ask the internet
  await (await import("../src/table.js")).ensureTable();
  ({ db, TABLE } = await import("../src/db.js"));
  ({ UpdateCommand } = await import("@aws-sdk/lib-dynamodb"));
  decay = await import("../src/services/decay.js");
  weather = await import("../src/services/weather.js");
  server = (await import("../src/app.js")).createApp().listen(0);
  base = `http://localhost:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await new Promise(r => dynamo.close(r));
});

const call = async (user, method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer dev:${user}` },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
};
const luna = async user => (await call(user, "GET", "/pets")).body.pets[0];
const hoursAgo = h => new Date(Date.now() - h * 3600000).toISOString();
const rewind = (user, uid, h) => db.send(new UpdateCommand({
  TableName: TABLE, Key: { pk: `USER#${user}`, sk: `PET#${uid}` },
  UpdateExpression: "SET lastTick = :t, lastInteraction = :t", ExpressionAttributeValues: { ":t": hoursAgo(h) }
}));

const start = { health: 85, hunger: 72, happiness: 80, energy: 65, hygiene: 75 };

test("a few hours away lowers hunger, energy, hygiene and happiness", () => {
  const s = decay.decayStats(start, 5);
  assert.equal(s.hunger, 52);
  assert.equal(s.energy, 55);
  assert.equal(s.hygiene, 65);
  assert.equal(s.happiness, 72.5);
  assert.ok(s.health >= start.health);                 // everything still fine: no damage
});

test("long neglect hurts health, but nothing hits zero", () => {
  const s = decay.decayStats(start, 40);
  assert.ok(s.health < start.health - 10, "health fell: " + s.health);
  assert.ok(s.health >= 10);
  assert.equal(s.hunger, 5);
  assert.equal(decay.decayStats(start, 500).hunger, 5);
  assert.deepEqual(decay.decayStats(start, 500), decay.decayStats(start, 48));      // only 48 hours count
});

test("healthy pets slowly heal", () => {
  const s = decay.decayStats({ ...start, health: 60 }, 3);
  assert.equal(s.health, 63);
});

test("each kind of pet reacts to weather differently", () => {
  const cat = decay.decayStats(start, 6, weather.ruleFor(1, "rain"));
  const dog = decay.decayStats(start, 6, weather.ruleFor(2, "rain"));
  assert.ok(cat.happiness < dog.happiness - 10);

  const rabbitHot = decay.decayStats(start, 6, weather.ruleFor(3, "hot"));
  const dogSnow = decay.decayStats(start, 6, weather.ruleFor(2, "snow"));
  assert.ok(rabbitHot.health < start.health);            // heat outweighs the normal healing
  assert.ok(dogSnow.health > start.health + 5);
  assert.ok(dogSnow.health > rabbitHot.health + 10);
});

test("weather only counts for the first 6 hours of an absence", () => {
  const rule = weather.ruleFor(3, "storm");
  const six = decay.decayStats(start, 6, rule);
  const twelveNoWeather = decay.decayStats(start, 12);
  const twelve = decay.decayStats(start, 12, rule);
  assert.ok(six.happiness < decay.decayStats(start, 6).happiness - 10);
  assert.equal(Math.round(decay.decayStats(start, 12, rule).happiness - twelveNoWeather.happiness), Math.round(six.happiness - decay.decayStats(start, 6).happiness));
  assert.ok(twelve.health < twelveNoWeather.health);
});

test("less than 15 minutes changes nothing", () => {
  const pet = { stats: start, lastTick: new Date(Date.now() - 10 * 60000).toISOString() };
  assert.equal(decay.projectStats(pet, new Date(), {}).changed, false);
});

test("opening the app after time away shows the decayed stats, and keeps lastInteraction", async () => {
  const pet = await luna("t1");
  const before = (await call("t1", "GET", "/pets")).body.pets[0];
  await rewind("t1", pet.uid, 10);
  const { body } = await call("t1", "GET", "/pets");
  assert.equal(body.pets[0].stats.hunger, before.stats.hunger - 40);
  assert.ok(body.pets[0].lastInteraction < hoursAgo(9));          // time passing is not a visit
  const again = (await call("t1", "GET", "/pets")).body.pets[0];  // and it isn't applied twice
  assert.equal(again.stats.hunger, body.pets[0].stats.hunger);
});

test("an action also settles the time that passed first", async () => {
  const pet = await luna("t2");
  await rewind("t2", pet.uid, 10);
  const { body } = await call("t2", "POST", `/pets/${pet.uid}/actions`, { type: "play" });
  assert.equal(body.pet.stats.hunger, 72 - 40 - 5);
});

test("the scheduled update ages pets nobody opened", async () => {
  const pet = await luna("t3");
  await rewind("t3", pet.uid, 8);
  const tick = await call("t3", "POST", "/dev/tick");
  assert.ok(tick.body.updated >= 1);
  const row = (await call("t3", "GET", "/pets")).body.pets[0];
  assert.equal(row.stats.hunger, 72 - 32);
});

test("weather endpoint explains each pet's reaction, and the demo override works", async () => {
  await call("t4", "POST", "/dev/coins", { coins: 2000 });
  await call("t4", "POST", "/shop/pets", { type: 2 });
  await call("t4", "POST", "/shop/pets", { type: 3 });

  delete process.env.WEATHER_FIXED;
  try {
    let w = (await call("t4", "POST", "/dev/weather", { condition: "rain" })).body;
    assert.equal(w.condition, "rain");
    w = (await call("t4", "GET", "/weather")).body;
    assert.equal(w.reactions.length, 3);
    const msg = n => w.reactions.find(r => r.name === n).message;
    assert.match(msg("Luna"), /hates the rainy weather/);
    assert.match(msg("Shadow"), /enjoys the rainy weather/);
    assert.deepEqual(w.reactions.find(r => r.name === "Luna").effect, { happiness: -2, health: 0 });

    await call("t4", "POST", "/dev/weather", {});                         // back to the real weather
    assert.equal((await call("t4", "POST", "/dev/weather", { condition: "nope" })).status, 400);
  } finally {
    process.env.WEATHER_FIXED = "clear";
  }
});

test("rain during a long absence lowers a cat's happiness more than sun does", async () => {
  const a = await luna("t5"), b = await luna("t6");
  await rewind("t5", a.uid, 6); await rewind("t6", b.uid, 6);

  process.env.WEATHER_FIXED = "rain";
  const rainy = (await call("t5", "GET", "/pets")).body.pets[0];
  process.env.WEATHER_FIXED = "clear";
  const sunny = (await call("t6", "GET", "/pets")).body.pets[0];
  assert.ok(sunny.stats.happiness - rainy.stats.happiness >= 14, `${sunny.stats.happiness} vs ${rainy.stats.happiness}`);
});

test("the reminder email boosts every pet's happiness once", async () => {
  assert.equal((await call("m1", "POST", "/reminder/return")).body.error.code, "no-reminder");

  await call("m1", "POST", "/dev/coins", { coins: 500 });
  await call("m1", "POST", "/shop/pets", { type: 2 });
  const before = (await call("m1", "GET", "/pets")).body.pets;

  await call("m1", "POST", "/dev/reminder");
  const r = await call("m1", "POST", "/reminder/return");
  assert.equal(r.status, 200);
  assert.equal(r.body.boost, 15);
  r.body.pets.forEach((p, i) => assert.equal(p.stats.happiness, Math.min(100, before[i].stats.happiness + 15)));

  const again = await call("m1", "POST", "/reminder/return");
  assert.equal(again.status, 409);

  await call("m1", "POST", "/dev/reminder");                              // a new email: works again
  assert.equal((await call("m1", "POST", "/reminder/return")).status, 200);
});

test("two simultaneous clicks on the email link boost once", async () => {
  await call("m2", "GET", "/me");
  await call("m2", "POST", "/dev/reminder");
  const results = await Promise.all([1, 2, 3].map(() => call("m2", "POST", "/reminder/return")));
  assert.equal(results.filter(r => r.status === 200).length, 1);
});

test("a reminder older than a day can't be used", async () => {
  await call("m3", "GET", "/me");
  await db.send(new UpdateCommand({
    TableName: TABLE, Key: { pk: "USER#m3", sk: "PROFILE" },
    UpdateExpression: "SET reminderSentAt = :t", ExpressionAttributeValues: { ":t": hoursAgo(25) }
  }));
  const r = await call("m3", "POST", "/reminder/return");
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, "reminder-expired");
});

test("weather conditions are classified from Open-Meteo codes", () => {
  assert.equal(weather.classify(0, 28), "clear");
  assert.equal(weather.classify(3, 24), "cloudy");
  assert.equal(weather.classify(63, 22), "rain");
  assert.equal(weather.classify(95, 22), "storm");
  assert.equal(weather.classify(73, -1), "snow");
  assert.equal(weather.classify(0, 38), "hot");
  assert.equal(weather.classify(1, 5), "cold");
});
