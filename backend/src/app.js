import express from "express";
import cors from "cors";
import { requireUser } from "./auth.js";
import { AppError } from "./errors.js";
import { PET_CATALOG, MAX_PETS } from "./catalog.js";
import { getOrCreateProfile, touchVisit, setCoins, deleteUser } from "./services/users.js";
import { listPets, buyPet } from "./services/pets.js";
import { toPetDto } from "./items.js";

// Wraps an async route so a thrown error reaches the error handler below.
const route = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

const profileDto = p => ({
  userId: p.userId, coins: p.coins, petCount: p.petCount,
  name: p.name, avatar: p.avatar, theme: p.theme, lastVisit: p.lastVisit
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
      }))
    });
  });

  // Everything below needs a signed-in user.
  app.use("/api", requireUser);

  // Coins + profile. Called when a page opens.
  app.get("/api/me", route(async (req, res) => {
    const profile = await getOrCreateProfile(req.userId);
    await touchVisit(req.userId);
    res.json(profileDto(profile));
  }));

  app.get("/api/pets", route(async (req, res) => {
    await getOrCreateProfile(req.userId);
    res.json({ pets: (await listPets(req.userId)).map(toPetDto) });
  }));

  app.post("/api/shop/pets", route(async (req, res) => {
    const type = Number(req.body && req.body.type);
    res.status(201).json(await buyPet(req.userId, type));
  }));

  // Development helpers: top up coins or start over. Switched off with DEV_ROUTES=false.
  if (process.env.DEV_ROUTES !== "false") {
    app.post("/api/dev/coins", route(async (req, res) => {
      const coins = Number(req.body && req.body.coins);
      if (!Number.isInteger(coins) || coins < 0 || coins > 1000000) {
        throw new AppError(400, "bad-coins", "coins must be a whole number from 0 to 1000000.");
      }
      res.json(profileDto(await setCoins(req.userId, coins)));
    }));

    app.post("/api/dev/reset", route(async (req, res) => {
      res.json({ deletedItems: await deleteUser(req.userId) });
    }));
  }

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
