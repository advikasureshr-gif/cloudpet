// Runs the real API against an in-memory DynamoDB (dynalite), so no Docker is needed to run the tests.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import dynalite from "dynalite";

let server, base, dynamo;

before(async () => {
  dynamo = dynalite({ createTableMs: 0 });
  await new Promise(r => dynamo.listen(4599, r));
  process.env.DYNAMO_ENDPOINT = "http://localhost:4599";
  process.env.TABLE_NAME = "CloudPetTest";
  process.env.AUTH_MODE = "dev";
  process.env.DEV_ROUTES = "true";

  const { ensureTable } = await import("../src/table.js");
  await ensureTable();
  const { createApp } = await import("../src/app.js");
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api`;
});

after(async () => {
  server.close();
  await new Promise(r => dynamo.close(r));
});

const call = async (user, method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", ...(user ? { Authorization: `Bearer dev:${user}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
};

test("catalog is public and has six pets", async () => {
  const { status, body } = await call(null, "GET", "/catalog");
  assert.equal(status, 200);
  assert.equal(body.pets.length, 6);
  assert.equal(body.maxPets, 6);
});

test("API needs a user", async () => {
  assert.equal((await call(null, "GET", "/me")).status, 401);
  const res = await fetch(base + "/me", { headers: { Authorization: "Bearer nonsense" } });
  assert.equal(res.status, 401);
});

test("a new player gets 250 coins and Luna", async () => {
  const me = await call("alice", "GET", "/me");
  assert.equal(me.body.coins, 250);
  assert.equal(me.body.petCount, 1);

  const pets = await call("alice", "GET", "/pets");
  assert.equal(pets.body.pets.length, 1);
  assert.equal(pets.body.pets[0].name, "Luna");
  assert.equal(pets.body.pets[0].type, 1);
});

test("two requests at once still create just one Luna", async () => {
  await Promise.all([call("racer", "GET", "/me"), call("racer", "GET", "/me"), call("racer", "GET", "/me")]);
  const pets = await call("racer", "GET", "/pets");
  assert.equal(pets.body.pets.length, 1);
});

test("buying a pet takes coins and adds the pet", async () => {
  const buy = await call("bob", "POST", "/shop/pets", { type: 4 });
  assert.equal(buy.status, 201);
  assert.equal(buy.body.coins, 150);
  assert.equal(buy.body.pet.name, "Ember");

  const me = await call("bob", "GET", "/me");
  assert.equal(me.body.coins, 150);
  assert.equal(me.body.petCount, 2);
  assert.equal((await call("bob", "GET", "/pets")).body.pets.length, 2);
});

test("the same kind can be bought twice and gets numbered", async () => {
  await call("carol", "POST", "/shop/pets", { type: 4 });
  const second = await call("carol", "POST", "/shop/pets", { type: 4 });
  assert.equal(second.body.pet.name, "Ember 2");
});

test("not enough coins: refused and nothing changes", async () => {
  await call("dave", "GET", "/me");
  const buy = await call("dave", "POST", "/shop/pets", { type: 2 });   // Shadow costs 200
  assert.equal(buy.status, 201);
  const poor = await call("dave", "POST", "/shop/pets", { type: 2 }); // 50 coins left
  assert.equal(poor.status, 402);
  assert.equal(poor.body.error.code, "not-enough-coins");
  assert.equal(poor.body.error.needed, 150);

  const me = await call("dave", "GET", "/me");
  assert.equal(me.body.coins, 50);
  assert.equal(me.body.petCount, 2);
});

test("home is full at 6 pets and no coins are taken", async () => {
  await call("erin", "POST", "/dev/coins", { coins: 5000 });
  for (let i = 0; i < 5; i++) assert.equal((await call("erin", "POST", "/shop/pets", { type: 4 })).status, 201);

  const full = await call("erin", "POST", "/shop/pets", { type: 4 });
  assert.equal(full.status, 409);
  assert.equal(full.body.error.code, "home-full");

  const me = await call("erin", "GET", "/me");
  assert.equal(me.body.petCount, 6);
  assert.equal(me.body.coins, 5000 - 5 * 100);
});

test("10 purchases at the same moment cannot overspend or exceed 6 pets", async () => {
  await call("frank", "POST", "/dev/coins", { coins: 5000 });
  const results = await Promise.all(Array.from({ length: 10 }, () => call("frank", "POST", "/shop/pets", { type: 4 })));

  const ok = results.filter(r => r.status === 201).length;
  const full = results.filter(r => r.status === 409).length;
  assert.equal(ok, 5);                       // started with Luna, so 5 more fit
  assert.equal(full, 5);

  const me = await call("frank", "GET", "/me");
  assert.equal(me.body.petCount, 6);
  assert.equal(me.body.coins, 5000 - 5 * 100);
  assert.equal((await call("frank", "GET", "/pets")).body.pets.length, 6);
});

test("coins can't be overspent by simultaneous requests", async () => {
  await call("gina", "POST", "/dev/coins", { coins: 250 });
  const results = await Promise.all(Array.from({ length: 4 }, () => call("gina", "POST", "/shop/pets", { type: 2 })));   // 200 each
  assert.equal(results.filter(r => r.status === 201).length, 1);
  assert.equal((await call("gina", "GET", "/me")).body.coins, 50);
});

test("bad input is refused", async () => {
  assert.equal((await call("hank", "POST", "/shop/pets", { type: 99 })).status, 400);
  assert.equal((await call("hank", "POST", "/shop/pets", {})).status, 400);
  assert.equal((await call("hank", "POST", "/dev/coins", { coins: -5 })).status, 400);
  assert.equal((await call("hank", "GET", "/nope")).status, 404);
});

test("users can't see each other's pets", async () => {
  await call("ivy", "POST", "/shop/pets", { type: 3 });
  const other = await call("jack", "GET", "/pets");
  assert.equal(other.body.pets.length, 1);     // just his own Luna
});

test("reset starts the player over", async () => {
  await call("kim", "POST", "/shop/pets", { type: 3 });
  await call("kim", "POST", "/dev/reset");
  const me = await call("kim", "GET", "/me");
  assert.equal(me.body.coins, 250);
  assert.equal(me.body.petCount, 1);
});
