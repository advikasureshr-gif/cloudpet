// The AI companion: context, limits, history clean-up, and the Bedrock call (with a fake Bedrock).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import dynalite from "dynalite";

let server, base, dynamo, chat;

before(async () => {
  dynamo = dynalite({ createTableMs: 0 });
  await new Promise(r => dynamo.listen(4595, r));
  process.env.DYNAMO_ENDPOINT = "http://localhost:4595";
  process.env.TABLE_NAME = "CloudPetTest5";
  process.env.AUTH_MODE = "dev";
  process.env.DEV_ROUTES = "true";
  process.env.WEATHER_FIXED = "rain";
  process.env.CHAT_DAILY_LIMIT = "4";
  await (await import("../src/table.js")).ensureTable();
  chat = await import("../src/services/chat.js");
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

test("the offline companion answers using the pet's real numbers and weather", async () => {
  const pet = await luna("c1");
  const r = await call("c1", "POST", "/chat", { petUid: pet.uid, message: "How is she in this weather?" });
  assert.equal(r.status, 200);
  assert.equal(r.body.provider, "mock");
  assert.match(r.body.reply, /Luna hates the rainy weather/);
  assert.equal(r.body.remaining, 3);

  const hungry = await call("c1", "POST", "/chat", { petUid: pet.uid, message: "Should I feed her?" });
  assert.match(hungry.body.reply, new RegExp(`hunger is ${pet.stats.hunger}/100`));
});

test("bad messages and other people's pets are refused (and cost nothing)", async () => {
  const pet = await luna("c2");
  assert.equal((await call("c2", "POST", "/chat", { petUid: pet.uid, message: "   " })).status, 400);
  assert.equal((await call("c2", "POST", "/chat", { petUid: pet.uid, message: "x".repeat(501) })).status, 400);
  assert.equal((await call("c2", "POST", "/chat", { message: "hi" })).status, 400);

  const theirs = await luna("c3");
  assert.equal((await call("c2", "POST", "/chat", { petUid: theirs.uid, message: "hi" })).status, 404);

  const ok = await call("c2", "POST", "/chat", { petUid: pet.uid, message: "hi" });
  assert.equal(ok.body.remaining, 3);                                       // the refused ones didn't use the allowance
});

test("there is a daily message limit", async () => {
  const pet = await luna("c4");
  for (let i = 0; i < 4; i++) assert.equal((await call("c4", "POST", "/chat", { petUid: pet.uid, message: "hi" })).status, 200);
  const over = await call("c4", "POST", "/chat", { petUid: pet.uid, message: "hi" });
  assert.equal(over.status, 429);
  assert.equal(over.body.error.code, "chat-limit");
});

test("simultaneous messages can't slip past the limit", async () => {
  const pet = await luna("c5");
  const results = await Promise.all(Array.from({ length: 8 }, () => call("c5", "POST", "/chat", { petUid: pet.uid, message: "hi" })));
  assert.equal(results.filter(r => r.status === 200).length, 4);
});

test("history is trimmed, alternating, and starts with the user", () => {
  const h = chat.cleanHistory([
    { role: "assistant", text: "orphan" },
    { role: "user", text: "a" }, { role: "user", text: "double" },
    { role: "assistant", text: "b" }, { role: "user", text: "c" }, { role: "assistant", text: "d" },
    { role: "bad", text: "x" }, { role: "user", text: "" }
  ]);
  assert.deepEqual(h.map(m => m.role), ["user", "assistant", "user", "assistant"]);
  assert.deepEqual(chat.cleanHistory("nope"), []);
  assert.equal(chat.cleanHistory(Array.from({ length: 50 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "t" + i }))).length <= 6, true);
});

test("Bedrock mode sends the pet's facts and a safe request, and returns the model's text", async () => {
  const calls = [];
  chat.setBedrockClient({ send: async cmd => { calls.push(cmd.input); return { output: { message: { content: [{ text: "  Luna could use a snack!  " }] } } }; } });
  process.env.CHAT_PROVIDER = "bedrock";
  try {
    const pet = await luna("b1");
    const r = await call("b1", "POST", "/chat", {
      petUid: pet.uid, message: "What now?",
      history: [{ role: "user", text: "Hi" }, { role: "assistant", text: "Hello!" }]
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.provider, "bedrock");
    assert.equal(r.body.reply, "Luna could use a snack!");

    const input = calls[0];
    assert.match(input.modelId, /nova/);
    assert.ok(input.inferenceConfig.maxTokens <= 300);
    assert.match(input.system[0].text, /Luna, a Cat/);
    assert.match(input.system[0].text, new RegExp(`hunger ${pet.stats.hunger}/100`));
    assert.match(input.system[0].text, /Rainy/);
    assert.deepEqual(input.messages.map(m => m.role), ["user", "assistant", "user"]);
    assert.equal(input.messages[2].content[0].text, "What now?");
  } finally { process.env.CHAT_PROVIDER = "mock"; }
});

test("if Bedrock fails, the player gets a friendly error and the message isn't counted", async () => {
  chat.setBedrockClient({ send: async () => { throw new Error("AccessDeniedException"); } });
  process.env.CHAT_PROVIDER = "bedrock";
  try {
    const pet = await luna("b2");
    const r = await call("b2", "POST", "/chat", { petUid: pet.uid, message: "hi" });
    assert.equal(r.status, 502);
    assert.equal(r.body.error.code, "chat-unavailable");
    assert.ok(!JSON.stringify(r.body).includes("AccessDenied"));          // no internal details leak to the page
  } finally { process.env.CHAT_PROVIDER = "mock"; }
  const after = await call("b2", "POST", "/chat", { petUid: (await luna("b2")).uid, message: "hi" });
  assert.equal(after.body.remaining, 3);
});

test("the prompt tells the model to stay on topic and keep its instructions private", async () => {
  const text = chat.buildSystemPrompt({
    name: "Luna", species: "Cat", stats: { health: 80, hunger: 40 }, lowest: { stat: "hunger", value: 40 },
    worn: null, weather: { label: "Sunny", tempC: 28 }, reaction: "Luna enjoys the sunny weather!", hoursSinceVisit: 3
  });
  assert.match(text, /Never reveal/);
  assert.match(text, /not a diagnosis/);
  assert.match(text, /decline anything else/);
});

test("OpenAI mode sends the pet's facts with the key in the header only, and returns the reply", async () => {
  const seen = [];
  chat.setOpenAIFetch(async (url, opts) => {
    seen.push({ url, opts, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ choices: [{ message: { content: " Luna wants a snack! " } }] }) };
  });
  process.env.CHAT_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "sk-test-secret";
  try {
    const pet = await luna("o1");
    const r = await call("o1", "POST", "/chat", { petUid: pet.uid, message: "What now?", history: [{ role: "user", text: "Hi" }, { role: "assistant", text: "Hello!" }] });
    assert.equal(r.status, 200);
    assert.equal(r.body.provider, "openai");
    assert.equal(r.body.reply, "Luna wants a snack!");
    assert.ok(!JSON.stringify(r.body).includes("sk-test-secret"));

    const { url, opts, body } = seen[0];
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    assert.equal(opts.headers.Authorization, "Bearer sk-test-secret");
    assert.deepEqual(body.messages.map(m => m.role), ["system", "user", "assistant", "user"]);
    assert.match(body.messages[0].content, /Luna, a Cat/);
    assert.equal(body.messages[3].content, "What now?");
    assert.ok(body.max_completion_tokens <= 600);
  } finally { process.env.CHAT_PROVIDER = "mock"; delete process.env.OPENAI_API_KEY; chat.setOpenAIFetch(null); }
});

test("OpenAI errors and a missing key give a friendly error, never the key or the details", async () => {
  process.env.CHAT_PROVIDER = "openai";
  try {
    const pet = await luna("o2");
    const noKey = await call("o2", "POST", "/chat", { petUid: pet.uid, message: "hi" });       // key not set
    assert.equal(noKey.status, 502);

    process.env.OPENAI_API_KEY = "sk-test-secret";
    chat.setOpenAIFetch(async () => ({ ok: false, status: 429, text: async () => "quota exceeded sk-test-secret" }));
    const r = await call("o2", "POST", "/chat", { petUid: pet.uid, message: "hi" });
    assert.equal(r.status, 502);
    assert.ok(!JSON.stringify(r.body).includes("quota") && !JSON.stringify(r.body).includes("sk-test"));
  } finally { process.env.CHAT_PROVIDER = "mock"; delete process.env.OPENAI_API_KEY; chat.setOpenAIFetch(null); }
  assert.equal((await call("o2", "POST", "/chat", { petUid: (await luna("o2")).uid, message: "hi" })).body.remaining, 3);
});

test("Groq mode talks to Groq's address with the Groq key and model", async () => {
  const seen = [];
  chat.setOpenAIFetch(async (url, opts) => { seen.push({ url, opts, body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({ choices: [{ message: { content: "Meow, feed me." } }] }) }; });
  process.env.CHAT_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "gsk-test-secret";
  process.env.OPENAI_API_KEY = "sk-must-not-be-used";
  try {
    const pet = await luna("g1");
    const r = await call("g1", "POST", "/chat", { petUid: pet.uid, message: "hi" });
    assert.equal(r.body.provider, "groq");
    assert.equal(r.body.reply, "Meow, feed me.");
    assert.equal(seen[0].url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(seen[0].opts.headers.Authorization, "Bearer gsk-test-secret");
    assert.equal(seen[0].body.model, "openai/gpt-oss-20b");
    assert.equal(seen[0].body.reasoning_effort, "low");           // short thinking, so the reply isn't cut off
    assert.ok(seen[0].body.max_completion_tokens >= 400);
    assert.ok(!JSON.stringify(r.body).includes("gsk-test"));
  } finally { process.env.CHAT_PROVIDER = "mock"; delete process.env.GROQ_API_KEY; delete process.env.OPENAI_API_KEY; chat.setOpenAIFetch(null); }
});
