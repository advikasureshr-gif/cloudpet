// Prediction → reminder email → neglect, end to end (own database, console email).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import dynalite from "dynalite";

let server, base, dynamo, db, TABLE, UpdateCommand, GetCommand, mailer;

before(async () => {
  dynamo = dynalite({ createTableMs: 0 });
  await new Promise(r => dynamo.listen(4594, r));
  process.env.DYNAMO_ENDPOINT = "http://localhost:4594";
  process.env.TABLE_NAME = "CloudPetTest6";
  process.env.AUTH_MODE = "dev";
  process.env.DEV_ROUTES = "true";
  process.env.WEATHER_FIXED = "clear";
  process.env.APP_URL = "http://localhost:8080/";
  await (await import("../src/table.js")).ensureTable();
  ({ db, TABLE } = await import("../src/db.js"));
  ({ UpdateCommand, GetCommand } = await import("@aws-sdk/lib-dynamodb"));
  mailer = await import("../src/services/mailer.js");
  server = (await import("../src/app.js")).createApp().listen(0);
  base = `http://localhost:${server.address().port}/api`;
  console.log = () => {};                                    // the console "emails" would clutter the test output
});

after(async () => {
  server.close();
  await new Promise(r => dynamo.close(r));
});

const call = async (user, method, path, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer dev:${user}`, "X-Utc-Offset-Minutes": "330" },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, body: await res.json() };
};
const signUp = async (user, email = user + "@example.com") => {
  await call(user, "PUT", "/me", { name: user, email, avatar: "🐱" });
  return (await call(user, "POST", "/dev/seed-history", {})).body.prediction;
};
const profileOf = async user => (await db.send(new GetCommand({ TableName: TABLE, Key: { pk: `USER#${user}`, sk: "PROFILE" } }))).Item;
const minutes = n => n * 60000;

test("seeded history gives a forest prediction about an hour from now, reminder 30 minutes before it", async () => {
  const pred = await signUp("rm1");
  assert.equal(pred.method, "forest");
  const untilVisit = Date.parse(pred.nextCheckInAt) - Date.now();
  assert.ok(untilVisit > minutes(30) && untilVisit <= minutes(60) + 5000, "until visit: " + untilVisit / 60000);

  const api = (await call("rm1", "GET", "/prediction")).body;
  assert.equal(api.method, "forest");
  assert.equal(api.emailOn, true);
  assert.match(api.usualTime, /^\d{1,2}:\d{2} (AM|PM)$/);
});

test("a new player with no history has no prediction", async () => {
  const api = (await call("rm0", "GET", "/prediction")).body;
  assert.equal(api.method, "none");
  assert.equal(api.nextCheckInAt, null);
});

test("the reminder goes out about 30 minutes before, once, and the link boosts happiness", async () => {
  const pred = await signUp("rm2");
  const remindAt = Date.parse(pred.reminderAt);
  mailer.clearOutbox();

  // too early: nothing is sent
  const early = await call("rm2", "POST", "/dev/reminders-run", { at: new Date(remindAt - minutes(20)).toISOString() });
  assert.equal(early.body.reminded, false);
  assert.equal(mailer.getOutbox("rm2@example.com").length, 0);

  // 30 minutes before the usual visit: the email goes out
  const at = new Date(remindAt + minutes(1)).toISOString();
  const sent = await call("rm2", "POST", "/dev/reminders-run", { at });
  assert.equal(sent.body.reminded, true);

  const mails = mailer.getOutbox("rm2@example.com");
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /Luna/);
  assert.match(mails[0].text, /home\.html\?from=reminder/);
  assert.match(mails[0].html, /http:\/\/localhost:8080\/home\.html\?from=reminder/);
  assert.match(mails[0].text, /usually visit around \d{1,2}:\d{2} (AM|PM)/);

  // a second run (or a second tick) does not send it again
  assert.equal((await call("rm2", "POST", "/dev/reminders-run", { at })).body.reminded, false);
  assert.equal(mailer.getOutbox("rm2@example.com").length, 1);

  // clicking the link works once
  assert.equal((await call("rm2", "POST", "/reminder/return")).status, 200);
  assert.equal((await call("rm2", "POST", "/reminder/return")).status, 409);
});

test("no email address, no email (but the prediction is still kept)", async () => {
  await call("rm3", "GET", "/me");                                           // profile without an email
  await call("rm3", "POST", "/dev/seed-history", {});
  mailer.clearOutbox();
  const pred = (await call("rm3", "GET", "/prediction")).body;
  const r = await call("rm3", "POST", "/dev/reminders-run", { at: new Date(Date.parse(pred.reminderAt) + minutes(1)).toISOString() });
  assert.equal(r.body.reminded, false);
  assert.equal(mailer.getOutbox().length, 0);
  assert.ok((await profileOf("rm3")).nextCheckInAt);
});

test("nobody gets a reminder if they are already here", async () => {
  const pred = await signUp("rm4");
  const remindAt = Date.parse(pred.reminderAt);
  const pets = (await call("rm4", "GET", "/pets")).body.pets;
  await db.send(new UpdateCommand({                                           // they interacted after the reminder time
    TableName: TABLE, Key: { pk: "USER#rm4", sk: `PET#${pets[0].uid}` },
    UpdateExpression: "SET lastInteraction = :t", ExpressionAttributeValues: { ":t": new Date(remindAt + minutes(5)).toISOString() }
  }));
  mailer.clearOutbox();
  const r = await call("rm4", "POST", "/dev/reminders-run", { at: new Date(remindAt + minutes(10)).toISOString() });
  assert.equal(r.body.reminded, false);
  assert.equal(mailer.getOutbox().length, 0);
});

test("missing the usual visit makes every pet sadder, once, and a new prediction is made", async () => {
  const pred = await signUp("rm5");
  await call("rm5", "POST", "/dev/coins", { coins: 500 });
  await call("rm5", "POST", "/shop/pets", { type: 2 });
  const before = (await call("rm5", "GET", "/pets")).body.pets;
  await call("rm5", "POST", "/dev/reminders-run", { at: new Date(Date.parse(pred.reminderAt) - minutes(20)).toISOString() });   // an earlier tick remembers the prediction

  const late = new Date(Date.parse(pred.nextCheckInAt) + minutes(3 * 60));    // 3 hours after the usual time, nobody came
  const r = await call("rm5", "POST", "/dev/reminders-run", { at: late.toISOString() });
  assert.equal(r.body.neglected, true);
  const after1 = (await call("rm5", "GET", "/pets")).body.pets;
  after1.forEach((p, i) => assert.ok(p.stats.happiness <= before[i].stats.happiness - 10, `${p.name}: ${before[i].stats.happiness} -> ${p.stats.happiness}`));

  const row = await profileOf("rm5");
  assert.equal(row.neglectFor, pred.nextCheckInAt);
  assert.ok(Date.parse(row.nextCheckInAt) > late.getTime(), "a later visit is predicted");

  const after = (await call("rm5", "POST", "/dev/tick")).body;                // (the real-time update must not undo or repeat it)
  assert.ok(after.pets >= 2);
  assert.equal((await call("rm5", "POST", "/dev/reminders-run", { at: late.toISOString() })).body.neglected, false);
});

test("someone who did visit is not punished", async () => {
  const pred = await signUp("rm6");
  const pets = (await call("rm6", "GET", "/pets")).body.pets;
  await call("rm6", "POST", "/dev/reminders-run", { at: new Date(Date.parse(pred.reminderAt) - minutes(20)).toISOString() });
  await db.send(new UpdateCommand({
    TableName: TABLE, Key: { pk: "USER#rm6", sk: `PET#${pets[0].uid}` },
    UpdateExpression: "SET lastInteraction = :t", ExpressionAttributeValues: { ":t": new Date(Date.parse(pred.reminderAt) + minutes(10)).toISOString() }
  }));
  const r = await call("rm6", "POST", "/dev/reminders-run", { at: new Date(Date.parse(pred.nextCheckInAt) + minutes(3 * 60)).toISOString() });
  assert.equal(r.body.neglected, false);
  assert.equal((await profileOf("rm6")).neglectFor, undefined);
});

test("the scheduled tick handles every player (predicts, never crashes)", async () => {
  const t = await call("rm1", "POST", "/dev/tick");
  assert.equal(t.status, 200);
  assert.ok(t.body.players >= 6);
  assert.equal(typeof t.body.reminded, "number");
});

test("SES mode sends through SES with the verified sender", async () => {
  const sent = [];
  mailer.setSesClient({ send: async cmd => { sent.push(cmd.input); return {}; } });
  process.env.MAIL_PROVIDER = "ses";
  process.env.MAIL_FROM = "demo@example.com";
  try {
    await mailer.sendMail({ to: "me@example.com", subject: "Hi", text: "t", html: "<b>h</b>" });
    assert.equal(sent[0].FromEmailAddress, "demo@example.com");
    assert.deepEqual(sent[0].Destination.ToAddresses, ["me@example.com"]);
    assert.equal(sent[0].Content.Simple.Subject.Data, "Hi");
  } finally { process.env.MAIL_PROVIDER = "console"; mailer.setSesClient(null); }
});

test("the email escapes names, so a hostile pet name can't inject HTML", () => {
  const m = mailer.buildReminderEmail({ name: "<script>x</script>", pets: [{ name: "Lu<b>na", stats: { happiness: 50, hunger: 50 } }], usualTime: "8:00 PM", link: "http://x/" });
  assert.ok(!m.html.includes("<script>"));
  assert.ok(!m.html.includes("Lu<b>na"));
});
