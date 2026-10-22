// The Lambda wrapper and Cognito mode, using fake API Gateway events (no AWS needed).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import dynalite from "dynalite";

let dynamo, handler, scheduler;

before(async () => {
  dynamo = dynalite({ createTableMs: 0 });
  await new Promise(r => dynamo.listen(4592, r));
  process.env.DYNAMO_ENDPOINT = "http://localhost:4592";
  process.env.TABLE_NAME = "CloudPetTest7";
  process.env.AUTH_MODE = "cognito";
  process.env.DEV_ROUTES = "false";
  process.env.DEMO_SECRET = "open-sesame";
  process.env.WEATHER_FIXED = "clear";
  await (await import("../src/table.js")).ensureTable();
  ({ handler } = await import("../src/lambda.js"));
  ({ handler: scheduler } = await import("../src/scheduler.js"));
});

after(async () => { await new Promise(r => dynamo.close(r)); });

const event = (method, path, { claims, body, headers = {} } = {}) => ({
  version: "2.0", routeKey: "ANY /{proxy+}", rawPath: path, rawQueryString: "",
  headers: { "content-type": "application/json", "x-utc-offset-minutes": "330", ...headers },
  requestContext: {
    http: { method, path, protocol: "HTTP/1.1", sourceIp: "1.2.3.4" },
    ...(claims ? { authorizer: { jwt: { claims, scopes: null } } } : {})
  },
  body: body ? JSON.stringify(body) : undefined,
  isBase64Encoded: false
});
const invoke = async (e) => {
  const r = await handler(e, {});
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
};
const alice = { sub: "AAAAAAAA-1111-2222-3333-444444444444", email: "alice@example.com", "cognito:username": "alice" };

test("health check works without signing in", async () => {
  const r = await invoke(event("GET", "/api/health"));
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test("the catalog is public", async () => {
  const r = await invoke(event("GET", "/api/catalog"));
  assert.equal(r.status, 200);
  assert.equal(r.body.pets.length, 6);
});

test("without Cognito claims you are not signed in", async () => {
  const r = await invoke(event("GET", "/api/me"));
  assert.equal(r.status, 401);
});

test("a signed-in player gets a profile built from their token (email and name), with Luna and 250 coins", async () => {
  const me = await invoke(event("GET", "/api/me", { claims: alice }));
  assert.equal(me.status, 200);
  assert.equal(me.body.coins, 250);
  assert.equal(me.body.email, "alice@example.com");
  assert.equal(me.body.name, "alice");
  assert.equal(me.body.userId, alice.sub.toLowerCase());

  const pets = await invoke(event("GET", "/api/pets", { claims: alice }));
  assert.equal(pets.body.pets.length, 1);
  assert.equal(pets.body.pets[0].name, "Luna");
});

test("two players stay separate", async () => {
  const bob = { sub: "BBBBBBBB-1111-2222-3333-444444444444", email: "bob@example.com" };
  await invoke(event("POST", "/api/shop/pets", { claims: alice, body: { type: 4 } }));
  assert.equal((await invoke(event("GET", "/api/pets", { claims: alice }))).body.pets.length, 2);
  assert.equal((await invoke(event("GET", "/api/pets", { claims: bob }))).body.pets.length, 1);
});

test("a JSON body and the player's clock reach the app (daily quests use their midnight)", async () => {
  const pets = (await invoke(event("GET", "/api/pets", { claims: alice }))).body.pets;
  const r = await invoke(event("POST", `/api/pets/${pets[0].uid}/actions`, { claims: alice, body: { type: "play" } }));
  assert.equal(r.status, 200);
  assert.equal((await invoke(event("GET", "/api/quests", { claims: alice }))).body.quests.find(q => q.id === "play").progress, 1);
});

test("the laptop-only dev routes do not exist on AWS", async () => {
  assert.equal((await invoke(event("POST", "/api/dev/coins", { claims: alice, body: { coins: 99999 } }))).status, 404);
  assert.notEqual((await invoke(event("GET", "/api/dev/users/alice"))).status, 200);          // not there (and not public)
});

test("the demo controls need the secret as well as a sign-in", async () => {
  const body = { condition: "snow" };
  assert.equal((await invoke(event("POST", "/api/demo/weather", { claims: alice, body }))).status, 403);
  assert.equal((await invoke(event("POST", "/api/demo/weather", { claims: alice, body, headers: { "x-demo-secret": "wrong" } }))).status, 403);
  assert.equal((await invoke(event("POST", "/api/demo/weather", { body, headers: { "x-demo-secret": "open-sesame" } }))).status, 401);

  delete process.env.WEATHER_FIXED;
  try {
    const ok = await invoke(event("POST", "/api/demo/weather", { claims: alice, body, headers: { "x-demo-secret": "open-sesame" } }));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.condition, "snow");
    await invoke(event("POST", "/api/demo/weather", { claims: alice, body: {}, headers: { "x-demo-secret": "open-sesame" } }));
  } finally { process.env.WEATHER_FIXED = "clear"; }
});

test("the demo seed + reminder run works for a signed-in player", async () => {
  const h = { "x-demo-secret": "open-sesame" };
  const seeded = await invoke(event("POST", "/api/demo/seed-history", { claims: alice, headers: h }));
  assert.equal(seeded.body.prediction.method, "forest");
  const run = await invoke(event("POST", "/api/demo/reminders-run", { claims: alice, headers: h, body: { at: seeded.body.prediction.reminderAt } }));
  assert.equal(run.status, 200);
  assert.equal(typeof run.body.reminded, "boolean");
});

test("the scheduler function runs the update for everyone", async () => {
  const r = await scheduler();
  assert.ok(r.players >= 2);
  assert.ok(r.pets >= 3);
});
