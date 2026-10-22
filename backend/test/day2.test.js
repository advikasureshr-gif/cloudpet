// Inventory, caring for pets, accessories, themes, profile and quests. Own database on its own port.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import dynalite from "dynalite";

let server, base, dynamo;

before(async () => {
  dynamo = dynalite({ createTableMs: 0 });
  await new Promise(r => dynamo.listen(4598, r));
  process.env.DYNAMO_ENDPOINT = "http://localhost:4598";
  process.env.TABLE_NAME = "CloudPetTest2";
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
const rich = async user => call(user, "POST", "/dev/coins", { coins: 5000 });
const lunaOf = async user => (await call(user, "GET", "/pets")).body.pets[0];

test("catalog lists shop items with prices", async () => {
  const { body } = await call("x", "GET", "/catalog");
  assert.equal(body.items.length, 8);
  assert.equal(body.items.find(i => i.name === "Apple").price, 20);
});

test("buying food puts it in the inventory and takes coins", async () => {
  const a = await call("a1", "POST", "/shop/items", { name: "Apple" });
  assert.equal(a.status, 201);
  assert.equal(a.body.coins, 230);
  await call("a1", "POST", "/shop/items", { name: "Apple" });
  const inv = (await call("a1", "GET", "/inventory")).body.items;
  assert.deepEqual(inv.map(i => [i.name, i.qty]), [["Apple", 2]]);
});

test("not enough coins for an item changes nothing", async () => {
  await call("a2", "POST", "/dev/coins", { coins: 10 });
  const r = await call("a2", "POST", "/shop/items", { name: "Apple" });
  assert.equal(r.status, 402);
  assert.equal((await call("a2", "GET", "/me")).body.coins, 10);
  assert.equal((await call("a2", "GET", "/inventory")).body.items.length, 0);
  assert.equal((await call("a2", "POST", "/shop/items", { name: "Unicorn" })).status, 400);
});

test("a theme can only be bought once", async () => {
  await rich("a3");
  assert.equal((await call("a3", "POST", "/shop/items", { name: "Garden Theme" })).status, 201);
  const again = await call("a3", "POST", "/shop/items", { name: "Garden Theme" });
  assert.equal(again.status, 409);
  assert.equal((await call("a3", "GET", "/me")).body.coins, 4900);
});

test("play changes stats, keeps them between 0 and 100, and records the time", async () => {
  const luna = await lunaOf("b1");
  const r = await call("b1", "POST", `/pets/${luna.uid}/actions`, { type: "play" });
  assert.equal(r.status, 200);
  assert.equal(r.body.pet.stats.happiness, 90);
  assert.equal(r.body.pet.stats.energy, 55);
  for (let i = 0; i < 12; i++) await call("b1", "POST", `/pets/${luna.uid}/actions`, { type: "play" });
  const end = (await lunaOf("b1")).stats;
  assert.ok(end.happiness <= 100 && end.energy >= 0 && end.hunger >= 0);
  assert.equal(end.happiness, 100);
  assert.equal(end.energy, 0);
});

test("simultaneous actions don't lose updates", async () => {
  const luna = await lunaOf("b2");
  await Promise.all(Array.from({ length: 5 }, () => call("b2", "POST", `/pets/${luna.uid}/actions`, { type: "clean" })));
  const s = (await lunaOf("b2")).stats;
  assert.equal(s.hygiene, 100);            // 75 + 15*5 capped at 100
  assert.equal(s.happiness, 95);           // 80 + 3*5
});

test("feeding uses up the food and feeds the pet", async () => {
  await call("c1", "POST", "/shop/items", { name: "Fish" });
  const luna = await lunaOf("c1");
  const r = await call("c1", "POST", `/pets/${luna.uid}/feed`, { food: "Fish" });
  assert.equal(r.status, 200);
  assert.equal(r.body.pet.stats.hunger, 92);
  assert.equal(r.body.pet.stats.happiness, 85);
  const none = await call("c1", "POST", `/pets/${luna.uid}/feed`, { food: "Fish" });
  assert.equal(none.status, 409);
  assert.equal(none.body.error.code, "no-food");
});

test("one apple can't feed two pets at the same time", async () => {
  await rich("c2");
  await call("c2", "POST", "/shop/pets", { type: 4 });
  await call("c2", "POST", "/shop/items", { name: "Apple" });
  const [p1, p2] = (await call("c2", "GET", "/pets")).body.pets;
  const results = await Promise.all([
    call("c2", "POST", `/pets/${p1.uid}/feed`, { food: "Apple" }),
    call("c2", "POST", `/pets/${p2.uid}/feed`, { food: "Apple" })
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});

test("another player's pet can't be touched", async () => {
  const luna = await lunaOf("d1");
  const r = await call("d2", "POST", `/pets/${luna.uid}/actions`, { type: "play" });
  assert.equal(r.status, 404);
});

test("accessories: need to own it, one pet per item", async () => {
  await rich("e1");
  await call("e1", "POST", "/shop/pets", { type: 4 });
  const [luna, ember] = (await call("e1", "GET", "/pets")).body.pets;

  assert.equal((await call("e1", "PUT", `/pets/${luna.uid}/equipment`, { accessory: "Cute Hat" })).status, 409);   // don't own it yet
  await call("e1", "POST", "/shop/items", { name: "Cute Hat" });

  const worn = await call("e1", "PUT", `/pets/${luna.uid}/equipment`, { accessory: "Cute Hat" });
  assert.equal(worn.body.pet.equipped, "Cute Hat");
  const second = await call("e1", "PUT", `/pets/${ember.uid}/equipment`, { accessory: "Cute Hat" });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, "none-left");

  await call("e1", "POST", "/shop/items", { name: "Cute Hat" });                                                    // buy another
  assert.equal((await call("e1", "PUT", `/pets/${ember.uid}/equipment`, { accessory: "Cute Hat" })).status, 200);

  const off = await call("e1", "PUT", `/pets/${luna.uid}/equipment`, { accessory: null });
  assert.equal(off.body.pet.equipped, null);
  assert.equal((await call("e1", "PUT", `/pets/${luna.uid}/equipment`, { accessory: "Apple" })).status, 400);
});

test("theme: must own it, 'Default' is always allowed", async () => {
  await rich("f1");
  assert.equal((await call("f1", "PUT", "/me/theme", { theme: "Ocean Theme" })).status, 403);
  await call("f1", "POST", "/shop/items", { name: "Ocean Theme" });
  assert.equal((await call("f1", "PUT", "/me/theme", { theme: "Ocean Theme" })).body.theme, "Ocean Theme");
  assert.equal((await call("f1", "GET", "/me")).body.theme, "Ocean Theme");
  assert.equal((await call("f1", "PUT", "/me/theme", { theme: "Default" })).body.theme, "Default");
  assert.equal((await call("f1", "PUT", "/me/theme", { theme: "Neon" })).status, 400);
});

test("profile edit is validated and saved", async () => {
  const ok = await call("g1", "PUT", "/me", { name: "Lexie", email: "lexie@example.com", avatar: "🐕" });
  assert.equal(ok.status, 200);
  const me = (await call("g1", "GET", "/me")).body;
  assert.deepEqual([me.name, me.email, me.avatar], ["Lexie", "lexie@example.com", "🐕"]);
  assert.equal((await call("g1", "PUT", "/me", { name: "", email: "a@b.co", avatar: "🐕" })).status, 400);
  assert.equal((await call("g1", "PUT", "/me", { name: "L", email: "nope", avatar: "🐕" })).status, 400);
  assert.equal((await call("g1", "PUT", "/me", { name: "L", email: "a@b.co", avatar: "💀" })).status, 400);
});

test("quests count what you do and pay out once", async () => {
  await rich("h1");
  const luna = await lunaOf("h1");
  let q = (await call("h1", "GET", "/quests")).body;
  assert.equal(q.quests.length, 4);
  assert.ok(q.quests.every(x => x.progress === 0 && !x.claimed));
  assert.equal(q.achievements.find(a => a.id === "first_steps").unlocked, false);

  assert.equal((await call("h1", "POST", "/quests/play/claim")).status, 409);   // not finished yet

  await call("h1", "POST", `/pets/${luna.uid}/actions`, { type: "play" });
  await call("h1", "POST", `/pets/${luna.uid}/actions`, { type: "play" });
  q = (await call("h1", "GET", "/quests")).body;
  assert.equal(q.quests.find(x => x.id === "play").progress, 2);
  assert.equal(q.achievements.find(a => a.id === "first_steps").unlocked, true);

  const before = (await call("h1", "GET", "/me")).body.coins;
  const claim = await call("h1", "POST", "/quests/play/claim");
  assert.equal(claim.status, 200);
  assert.equal(claim.body.earned, 30);
  assert.equal(claim.body.coins, before + 30);
  assert.equal((await call("h1", "POST", "/quests/play/claim")).body.error.code, "already-claimed");
  assert.equal((await call("h1", "GET", "/me")).body.coins, before + 30);
});

test("double-clicking claim pays only once", async () => {
  await rich("h2");
  const luna = await lunaOf("h2");
  await call("h2", "POST", `/pets/${luna.uid}/actions`, { type: "clean" });
  const r = await Promise.all([call("h2", "POST", "/quests/clean/claim"), call("h2", "POST", "/quests/clean/claim"), call("h2", "POST", "/quests/clean/claim")]);
  assert.deepEqual(r.map(x => x.status).sort(), [200, 409, 409]);
  assert.equal((await call("h2", "GET", "/me")).body.coins, 5020);
});

test("all four quests give the bonus once, and unlock Pet Haven Pro", async () => {
  await rich("h3");
  await call("h3", "POST", "/shop/items", { name: "Apple" });
  await call("h3", "POST", "/shop/items", { name: "Apple" });
  const luna = await lunaOf("h3");
  const act = t => call("h3", "POST", `/pets/${luna.uid}/actions`, { type: t });
  await call("h3", "POST", `/pets/${luna.uid}/feed`, { food: "Apple" });
  await call("h3", "POST", `/pets/${luna.uid}/feed`, { food: "Apple" });
  await act("play"); await act("play"); await act("clean"); await act("sleep");

  const start = (await call("h3", "GET", "/me")).body.coins;
  let last;
  for (const id of ["feed", "play", "clean", "sleep"]) last = await call("h3", "POST", `/quests/${id}/claim`);
  assert.equal(last.body.earned, 20 + 50);                         // last quest + bonus
  assert.equal((await call("h3", "GET", "/me")).body.coins, start + 30 + 30 + 20 + 20 + 50);
  assert.equal(last.body.bonus.claimed, true);
  assert.equal(last.body.achievements.find(a => a.id === "pet_haven_pro").unlocked, true);
});

test("achievements follow how many pets you own", async () => {
  await rich("i1");
  await call("i1", "POST", "/shop/pets", { type: 4 });
  let a = (await call("i1", "GET", "/quests")).body.achievements;
  assert.equal(a.find(x => x.id === "pet_lover").unlocked, false);
  await call("i1", "POST", "/shop/pets", { type: 4 });
  a = (await call("i1", "GET", "/quests")).body.achievements;
  assert.equal(a.find(x => x.id === "pet_lover").unlocked, true);
});

test("the day follows the player's timezone", async () => {
  const utc = (await call("j1", "GET", "/quests", null, { "X-Utc-Offset-Minutes": "0" })).body.day;
  const farEast = (await call("j1", "GET", "/quests", null, { "X-Utc-Offset-Minutes": "840" })).body.day;
  const farWest = (await call("j1", "GET", "/quests", null, { "X-Utc-Offset-Minutes": "-840" })).body.day;
  assert.match(utc, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(farEast >= utc && farWest <= utc);
});
