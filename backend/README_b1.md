# Cloudpet backend (local)

Express API on top of **DynamoDB Local**. Every action lives in a plain function under `src/services/`,
so on AWS the same functions become Lambdas behind API Gateway (Day 6).

## Run it

You need Node 20+ and Docker.

```bash
npm install
npm run db:up        # starts DynamoDB Local in Docker on port 8000
npm start            # creates the table on first run, then serves http://localhost:3000
                     # (src/local-env.js points it at DynamoDB Local; no .env file needed)
```

Try it (a "user" is just a name in dev mode):

```bash
curl http://localhost:3000/api/catalog
curl -H "Authorization: Bearer dev:lexie" http://localhost:3000/api/me
curl -H "Authorization: Bearer dev:lexie" http://localhost:3000/api/pets
curl -X POST -H "Authorization: Bearer dev:lexie" -H "Content-Type: application/json" -d "{\"type\":4}" http://localhost:3000/api/shop/pets
```

Reset coins or start over (this replaces the localStorage console trick):

```bash
curl -X POST -H "Authorization: Bearer dev:lexie" -H "Content-Type: application/json" -d "{\"coins\":1000}" http://localhost:3000/api/dev/coins
curl -X POST -H "Authorization: Bearer dev:lexie" http://localhost:3000/api/dev/reset
```

`npm test` runs 30 tests against an in-memory DynamoDB (no Docker needed).
`npm run db:down` stops the database; your data stays in `.dynamodb/`.

## Endpoints

Everything except `/api/health` and `/api/catalog` needs the `Authorization: Bearer dev:<name>` header.
The browser also sends `X-Utc-Offset-Minutes` so daily quests reset at the player's own midnight.

| Method | Path | What |
|---|---|---|
| GET | `/api/catalog` | the six pets and all shop items with prices (public) |
| GET | `/api/me` | coins and profile; a new player gets 250 coins and Luna |
| PUT | `/api/me` `{name,email,avatar}` | edit the profile (validated) |
| PUT | `/api/me/theme` `{theme}` | use a theme you own, or "Default" |
| GET | `/api/pets` | your pets with their stats |
| POST | `/api/shop/pets` `{type}` | buy a pet (402 not-enough-coins, 409 home-full) |
| POST | `/api/pets/:uid/actions` `{type}` | `play`, `sleep` or `clean` |
| POST | `/api/pets/:uid/feed` `{food}` | uses up one food and feeds the pet (409 no-food) |
| PUT | `/api/pets/:uid/equipment` `{accessory}` | wear an accessory, or `null` to take it off |
| GET | `/api/inventory` | food, accessories and themes you own |
| POST | `/api/shop/items` `{name}` | buy an item (themes can only be bought once) |
| GET | `/api/quests` | today's daily quests, the bonus and your achievements |
| POST | `/api/quests/:id/claim` | collect a finished quest's coins (once) |
| POST | `/api/dev/coins` `{coins}` | set your coins (dev only) |
| POST | `/api/dev/reset` | delete your data (dev only) |

Errors look like `{ "error": { "code": "not-enough-coins", "message": "..." } }`.

## The table (one table, `pk` + `sk`)

| pk | sk | holds |
|---|---|---|
| `USER#lexie` | `PROFILE` | coins, petCount, name, email, avatar, theme, lastVisit, totalActions, ach_* flags |
| `USER#lexie` | `PET#a1b2c3d4` | type, name, stats, equipped, version, lastInteraction |
| `USER#lexie` | `INV#Apple` | name, category, icon, qty |
| `USER#lexie` | `QUEST#2026-10-20` | c_feed / c_play / ... counters, claimed_* flags, bonusClaimed, ttl |
| `USER#lexie` | `EVENT#<time>#<id>` | every action with its hour and weekday, for the Random Forest later (ttl 90 days) |

Coming next: `RULE#<petType>` / `WEATHER#<condition>` (how each pet reacts to weather).
For AWS, turn on DynamoDB TTL for the `ttl` attribute so old quest and event rows delete themselves.

## Why buying a pet is safe

`buyPet` (src/services/pets.js) uses one conditional update: DynamoDB checks "coins >= price AND petCount < 6"
and subtracts the coins in a single step. Ten simultaneous purchases can't overspend or reach 7 pets. A test proves it.

## Going to AWS later

* Leave `DYNAMO_ENDPOINT` empty so the real DynamoDB is used.
* `AUTH_MODE=dev` is replaced by a Cognito authorizer on API Gateway.
* Set `DEV_ROUTES=false`.
