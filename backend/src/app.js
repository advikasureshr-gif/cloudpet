import express from "express";
import { timingSafeEqual } from "node:crypto";
import cors from "cors";
import { requireUser } from "./auth.js";
import { AppError } from "./errors.js";
import { PET_CATALOG, MAX_PETS, SHOP_ITEMS } from "./catalog.js";
import { seedFromClaims, getOrCreateProfile, touchVisit, setCoins, deleteUser, updateProfile, setTheme, userExists } from "./services/users.js";
import { BatchWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE } from "./db.js";
import { listPets, listPetsSettled, buyPet, doAction, feedPet, equipAccessory } from "./services/pets.js";
import { listInventory, buyItem } from "./services/inventory.js";
import { getQuests, claimQuest } from "./services/quests.js";
import { getRewards, claimReward } from "./services/rewards.js";
import { getWeather, reactionFor, setWeatherOverride } from "./services/weather.js";
import { returnFromReminder, markReminderSent } from "./services/reminders.js";
import { tickEverything } from "./services/tick.js";
import { predictNext } from "./services/prediction.js";
import { makeHistory } from "./services/synthetic.js";
import { getOutbox, clockText } from "./services/mailer.js";
import { runReminderCycle } from "./services/reminders.js";
import { chatWithPet } from "./services/chat.js";
import { toPetDto, dayString } from "./items.js";

// Wraps an async route so a thrown error reaches the error handler below.
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

const profileDto = p => ({
  userId: p.userId, coins: p.coins, petCount: p.petCount,
  name: p.name, email: p.email || "petparent@cloudpet.com", avatar: p.avatar, theme: p.theme, lastVisit: p.lastVisit
});

export function createApp() {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
  app.use(express.json({ limit: "20kb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // Public: what can be bought. Prices come from the server.
  app.get("/api/catalog", (_req, res) => {
    res.json({
      maxPets: MAX_PETS,
      pets: Object.entries(PET_CATALOG).map(([type, k]) => ({
        type: Number(type), name: k.name, species: k.species, emoji: k.emoji, price: k.price
      })),
      items: Object.entries(SHOP_ITEMS).map(([name, i]) => ({
        name, category: i.category, icon: i.icon, price: i.price, description: i.description
      }))
    });
  });

  // Dev login helper: does this username exist? (Cognito answers this on AWS, so the route goes away there.)
  if (process.env.DEV_ROUTES !== "false") {
    app.get("/api/dev/users/:name", route(async (req, res) => {
      const name = String(req.params.name || "").toLowerCase();
      if (!/^[a-z0-9_-]{1,32}$/.test(name)) throw new AppError(400, "bad-username", "Use 1 to 32 letters, numbers, - or _.");
      res.json({ exists: await userExists(name) });
    }));
  }

  // Everything below needs a signed-in user.
  app.use("/api", requireUser);
  app.use("/api", (req, _res, next) => {
    const offset = parseInt(req.get("x-utc-offset-minutes"), 10);       // e.g. 330 for India
    req.utcOffset = Number.isFinite(offset) ? Math.max(-840, Math.min(840, offset)) : 0;
    next();
  });

  // On AWS the Cognito login token carries the player's email and name: use them for the profile (once per player)
  app.use("/api", (req, _res, next) => {
    (req.claims ? seedFromClaims(req.userId, req.claims) : Promise.resolve()).then(() => next(), next);
  });

  // Coins + profile. Called when a page opens.
  app.get("/api/me", route(async (req, res) => {
    const profile = await getOrCreateProfile(req.userId);
    await touchVisit(req.userId, req.utcOffset);
    res.json(profileDto(profile));
  }));

  app.get("/api/pets", route(async (req, res) => {
    await getOrCreateProfile(req.userId);
    res.json({ pets: (await listPetsSettled(req.userId)).map(toPetDto) });
  }));

  app.post("/api/shop/pets", route(async (req, res) => {
    const type = Number(req.body && req.body.type);
    res.status(201).json(await buyPet(req.userId, type));
  }));

  // The player's own calendar day (the browser sends its UTC offset), so daily quests reset at THEIR midnight.
  const today = req => dayString(new Date(), req.utcOffset);

  app.put("/api/me", route(async (req, res) => {
    res.json(profileDto(await updateProfile(req.userId, req.body || {})));
  }));

  app.put("/api/me/theme", route(async (req, res) => {
    res.json(profileDto(await setTheme(req.userId, req.body && req.body.theme)));
  }));

  app.get("/api/inventory", route(async (req, res) => {
    await getOrCreateProfile(req.userId);
    res.json({ items: await listInventory(req.userId) });
  }));

  app.post("/api/shop/items", route(async (req, res) => {
    res.status(201).json(await buyItem(req.userId, req.body && req.body.name));
  }));

  app.post("/api/pets/:uid/actions", route(async (req, res) => {
    res.json({ pet: await doAction(req.userId, req.params.uid, req.body && req.body.type, today(req)) });
  }));

  app.post("/api/pets/:uid/feed", route(async (req, res) => {
    res.json({ pet: await feedPet(req.userId, req.params.uid, req.body && req.body.food, today(req)) });
  }));

  app.put("/api/pets/:uid/equipment", route(async (req, res) => {
    const accessory = req.body && "accessory" in req.body ? req.body.accessory : undefined;
    if (accessory === undefined) throw new AppError(400, "bad-request", "Send { accessory: name } or { accessory: null }.");
    res.json({ pet: await equipAccessory(req.userId, req.params.uid, accessory) });
  }));

  app.get("/api/quests", route(async (req, res) => {
    res.json(await getQuests(req.userId, today(req)));
  }));

  app.post("/api/quests/:id/claim", route(async (req, res) => {
    const result = await claimQuest(req.userId, req.params.id, today(req));
    res.json({ ...result, ...(await getQuests(req.userId, today(req))) });
  }));

  app.get("/api/rewards", route(async (req, res) => {
    res.json(await getRewards(req.userId, req.utcOffset));
  }));

  app.post("/api/rewards/:id/claim", route(async (req, res) => {
    const result = await claimReward(req.userId, req.params.id, req.utcOffset);
    res.json({ ...result, ...(await getRewards(req.userId, req.utcOffset)) });
  }));

  // Today's weather and how each of your pets feels about it (the rules live in catalog.js, not in the pages)
  app.get("/api/weather", route(async (req, res) => {
    await getOrCreateProfile(req.userId);         // a brand-new player gets Luna first
    const weather = await getWeather();
    const pets = await listPets(req.userId);
    res.json({
      condition: weather.condition, label: weather.label, icon: weather.icon, tempC: weather.tempC, source: weather.source,
      reactions: pets.map(p => ({ uid: p.sk.replace("PET#", ""), name: p.name, ...(({ message, effect }) => ({ message, effect }))(reactionFor(p, weather)) }))
    });
  }));

  // Ask the AI companion about one of your pets
  app.post("/api/chat", route(async (req, res) => {
    res.json(await chatWithPet(req.userId, req.body || {}, today(req)));
  }));

  // When will you visit next? (learned from your own activity)
  app.get("/api/prediction", route(async (req, res) => {
    const profile = await getOrCreateProfile(req.userId);
    const offset = Number.isFinite(profile.utcOffset) ? profile.utcOffset : req.utcOffset;
    const pred = await predictNext(req.userId, new Date(), offset);
    res.json({ ...pred, usualTime: pred.nextCheckInAt ? clockText(new Date(pred.nextCheckInAt), offset) : null, emailOn: Boolean(profile.email) });
  }));

  // The person clicked the link in the reminder email: every pet gets happier (once per email)
  app.post("/api/reminder/return", route(async (req, res) => {
    res.json(await returnFromReminder(req.userId));
  }));

  // Helper routes for testing and demos (coins, weather, fake history, run the reminders, start over).
  //   /api/dev/*   on your laptop only (DEV_ROUTES; never turned on in AWS)
  //   /api/demo/*  on AWS, for the live demo: the caller must be signed in AND send the secret in the x-demo-secret header
  const mountControls = (prefix, guard) => {
    app.post(prefix + "/coins", guard, route(async (req, res) => {
      const coins = Number(req.body && req.body.coins);
      if (!Number.isInteger(coins) || coins < 0 || coins > 1000000) {
        throw new AppError(400, "bad-coins", "coins must be a whole number from 0 to 1000000.");
      }
      res.json(profileDto(await setCoins(req.userId, coins)));
    }));

    // Pretend a reminder email was just sent / force the weather / run the scheduled update now
    app.post(prefix + "/reminder", guard, route(async (req, res) => { await markReminderSent(req.userId); res.json({ ok: true }); }));
    app.post(prefix + "/weather", guard, route(async (req, res) => {
      await setWeatherOverride(req.body && req.body.condition ? req.body.condition : null);
      res.json(await getWeather());
    }));
    app.post(prefix + "/tick", guard, route(async (_req, res) => { res.json(await tickEverything()); }));

    // Fake a few weeks of visit history so the prediction has something to learn from.
    // minutesFromNow: when the "usual" weekday visit should be (default: in 60 minutes). Weekends are 3 hours later.
    app.post(prefix + "/seed-history", guard, route(async (req, res) => {
      const profile = await getOrCreateProfile(req.userId);
      const offset = Number.isFinite(profile.utcOffset) ? profile.utcOffset : req.utcOffset;
      const ahead = Number(req.body && req.body.minutesFromNow);
      const target = new Date(Date.now() + (Number.isFinite(ahead) ? ahead : 60) * 60000 + offset * 60000);
      const weekdayMin = Math.floor((target.getUTCHours() * 60 + target.getUTCMinutes()) / 30) * 30 + 15;     // middle of that half hour
      const times = makeHistory({ offsetMin: offset, weekdayMin, weekendMin: (weekdayMin + 180) % 1440, days: 21, jitterMin: 4 });

      for (let i = 0; i < times.length; i += 25) {
        await db.send(new BatchWriteCommand({
          RequestItems: { [TABLE]: times.slice(i, i + 25).map((t, k) => ({
            PutRequest: { Item: { pk: `USER#${req.userId}`, sk: `EVENT#${t.toISOString()}#s${i + k}`, kind: "seed", ttl: Math.floor(t.getTime() / 1000) + 90 * 86400 } }
          })) }
        }));
      }
      await db.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: `USER#${req.userId}`, sk: "PROFILE" },
        UpdateExpression: "REMOVE nextCheckInAt, reminderAt, reminderFor, neglectFor"
      }));
      const prediction = await predictNext(req.userId, new Date(), offset);
      res.json({ events: times.length, prediction });
    }));

    // Run the reminder cycle for just this player (what the scheduler does for everyone).
    // { at: "<time>" } pretends it is that time, so a demo can jump straight to "30 minutes before the usual visit".
    app.post(prefix + "/reminders-run", guard, route(async (req, res) => {
      const at = req.body && req.body.at ? new Date(req.body.at) : new Date();
      if (isNaN(at)) throw new AppError(400, "bad-time", "at must be a date, like 2026-10-23T14:00:00Z");
      res.json(await runReminderCycle(await getOrCreateProfile(req.userId), at));
    }));
    app.get(prefix + "/outbox", guard, route(async (req, res) => {
      const profile = await getOrCreateProfile(req.userId);
      res.json({ emails: getOutbox(profile.email) });
    }));

    app.post(prefix + "/reset", guard, route(async (req, res) => {
      res.json({ deletedItems: await deleteUser(req.userId) });
    }));
  };

  const noGuard = (_req, _res, next) => next();
  const demoGuard = (req, _res, next) => {
    const given = Buffer.from(String(req.get("x-demo-secret") || ""));
    const secret = Buffer.from(String(process.env.DEMO_SECRET || ""));
    const ok = given.length === secret.length && timingSafeEqual(given, secret);
    next(ok ? undefined : new AppError(403, "forbidden", "Wrong or missing demo secret."));
  };

  if (process.env.DEV_ROUTES !== "false") mountControls("/api/dev", noGuard);
  if (process.env.DEMO_SECRET) mountControls("/api/demo", demoGuard);

  app.use((_req, _res, next) => next(new AppError(404, "not-found", "No such route.")));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.details } });
    }
    if (err.type === "entity.parse.failed") {
      return res.status(400).json({ error: { code: "bad-json", message: "The request body isn't valid JSON." } });
    }
    console.error(err);
    res.status(500).json({ error: { code: "server-error", message: "Something went wrong on the server." } });
  });

  return app;
}
