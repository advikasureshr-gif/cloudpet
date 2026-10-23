// Achievement / discovery payouts and the dev login helper. Own database on its own port.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import dynalite from "dynalite";

let server, base, dynamo;

before(async () => {
  dynamo = dynalite({ createTableMs: 0 });
  await new Promise(r => dynamo.listen(4597, r));
  process.env.DYNAMO_ENDPOINT = "http://localhost:4597";
  process.env.TABLE_NAME = "CloudPetTest3";
  process.env.AUTH_MODE = "dev";
  process.env.DEV_ROUTES = "true";
  await (await import("../src/table.js")).ensureTable();
  server = (await import("../src/app.js")).createApp().listen(0);
  base = `http://localhost:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await new Promise(r => dynamo.close(r));
});

const call = async (user, method, path, body, headers = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer dev:${user}`, ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
};
// A valid UTC offset (-12h..+14h) that makes the player's local clock read the given hour right now
const offsetFor = hour => {
  let m = (hour - new Date().getUTCHours()) * 60;
  while (m > 840) m -= 1440;
  while (m < -720) m += 1440;
  return { "X-Utc-Offset-Minutes": String(m) };
};
const noon = offsetFor(12);       // local time = 12:xx
const midnight = offsetFor(23);   // local time = 23:xx
const find = (b, id) => [...b.achievements, ...b.discoveries].find(r => r.id === id);

test("rewards start locked and can't be claimed", async () => {
  const r = await call("r1", "GET", "/rewards", null, noon);
  assert.equal(r.body.achievements.length, 4);
  assert.equal(r.body.discoveries.length, 6);
  assert.equal(find(r.body, "first_steps").unlocked, false);
  const claim = await call("r1", "POST", "/rewards/first_steps/claim", null, noon);
  assert.equal(claim.status, 409);
  assert.equal(claim.body.error.code, "locked");
});

test("first action unlocks First Steps and the cat discovery; claiming pays once", async () => {
  const luna = (await call("r2", "GET", "/pets")).body.pets[0];
  await call("r2", "POST", `/pets/${luna.uid}/actions`, { type: "play" }, noon);

  const r = await call("r2", "GET", "/rewards", null, noon);
  assert.equal(find(r.body, "first_steps").unlocked, true);
  assert.equal(find(r.body, "cat").unlocked, true);
  assert.equal(find(r.body, "dog").unlocked, false);

  const before = (await call("r2", "GET", "/me")).body.coins;
  const a = await call("r2", "POST", "/rewards/first_steps/claim", null, noon);
  assert.equal(a.body.earned, 50);
  assert.equal(a.body.coins, before + 50);
  assert.equal(find(a.body, "first_steps").claimed, true);

  const again = await call("r2", "POST", "/rewards/first_steps/claim", null, noon);
  assert.equal(again.status, 409);
  assert.equal((await call("r2", "GET", "/me")).body.coins, before + 50);
});

test("two simultaneous claims pay once", async () => {
  const luna = (await call("r3", "GET", "/pets")).body.pets[0];
  await call("r3", "POST", `/pets/${luna.uid}/actions`, { type: "clean" }, noon);
  const before = (await call("r3", "GET", "/me")).body.coins;
  const results = await Promise.all([1, 2, 3].map(() => call("r3", "POST", "/rewards/cat/claim", null, noon)));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal((await call("r3", "GET", "/me")).body.coins, before + 50);
});

test("a dog discovery needs an action with a dog", async () => {
  await call("r4", "POST", "/dev/coins", { coins: 1000 });
  const shadow = (await call("r4", "POST", "/shop/pets", { type: 2 })).body.pet;
  assert.equal(find((await call("r4", "GET", "/rewards", null, noon)).body, "dog").unlocked, false);
  await call("r4", "POST", `/pets/${shadow.uid}/actions`, { type: "play" }, noon);
  assert.equal(find((await call("r4", "GET", "/rewards", null, noon)).body, "dog").unlocked, true);
});

test("rainbow unlocks at 5 actions, mystery friend at 10", async () => {
  const luna = (await call("r5", "GET", "/pets")).body.pets[0];
  for (let i = 0; i < 5; i++) await call("r5", "POST", `/pets/${luna.uid}/actions`, { type: "play" }, noon);
  let r = (await call("r5", "GET", "/rewards", null, noon)).body;
  assert.equal(find(r, "rainbow").unlocked, true);
  assert.equal(find(r, "mystery_friend").unlocked, false);
  for (let i = 0; i < 5; i++) await call("r5", "POST", `/pets/${luna.uid}/actions`, { type: "sleep" }, noon);
  r = (await call("r5", "GET", "/rewards", null, noon)).body;
  assert.equal(find(r, "mystery_friend").unlocked, true);
});

test("night owl unlocks when you visit at night (player's own clock) and stays unlocked", async () => {
  assert.equal(find((await call("r6", "GET", "/rewards", null, noon)).body, "night_owl").unlocked, false);
  assert.equal(find((await call("r6", "GET", "/rewards", null, midnight)).body, "night_owl").unlocked, true);
  assert.equal(find((await call("r6", "GET", "/rewards", null, noon)).body, "night_owl").unlocked, true);
});

test("unknown reward is a 404", async () => {
  assert.equal((await call("r7", "POST", "/rewards/nope/claim", null, noon)).status, 404);
});

test("dev login helper tells whether a username exists", async () => {
  await call("known", "GET", "/me");
  assert.equal((await (await fetch(base + "/dev/users/known")).json()).exists, true);
  assert.equal((await (await fetch(base + "/dev/users/nobody-here")).json()).exists, false);
  assert.equal((await fetch(base + "/dev/users/bad%20name")).status, 400);
});
