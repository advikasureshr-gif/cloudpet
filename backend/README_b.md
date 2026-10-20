# Cloudpet backend (local)

Express API on top of **DynamoDB Local**. Every action lives in a plain function under `src/services/`,
so on AWS the same functions become Lambdas behind API Gateway (Day 6).

## Run it

You need Node 20+ and Docker.

```bash
npm install
npm run db:up        # starts DynamoDB Local in Docker on port 8000
npm start            # creates the table on first run, then serves http://localhost:3000
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

`npm test` runs 13 tests against an in-memory DynamoDB (no Docker needed).
`npm run db:down` stops the database; your data stays in `.dynamodb/`.

## Endpoints (Day 1)

| Method | Path | What |
|---|---|---|
| GET | `/api/catalog` | the six pets and their prices (public) |
| GET | `/api/me` | coins and profile; a new player gets 250 coins and Luna |
| GET | `/api/pets` | the pets you own |
| POST | `/api/shop/pets` `{type}` | buy a pet; refuses with 402 not-enough-coins or 409 home-full |
| POST | `/api/dev/coins` `{coins}` | set your coins (dev only) |
| POST | `/api/dev/reset` | delete your data (dev only) |

Errors look like `{ "error": { "code": "not-enough-coins", "message": "..." } }`.

## The table (one table, `pk` + `sk`)

| pk | sk | holds |
|---|---|---|
| `USER#lexie` | `PROFILE` | coins, petCount, name, avatar, theme, lastVisit |
| `USER#lexie` | `PET#a1b2c3d4` | type, name, stats, equipped, lastInteraction |

Coming next: `INV#...` (inventory), `QUEST#<date>` (daily quests), `EVENT#<time>` (interaction log for the ML part),
and `RULE#<petType>` / `WEATHER#<condition>` (how each pet reacts to weather).

## Why buying a pet is safe

`buyPet` (src/services/pets.js) uses one conditional update: DynamoDB checks "coins >= price AND petCount < 6"
and subtracts the coins in a single step. Ten simultaneous purchases can't overspend or reach 7 pets. A test proves it.

## Going to AWS later

* Leave `DYNAMO_ENDPOINT` empty so the real DynamoDB is used.
* `AUTH_MODE=dev` is replaced by a Cognito authorizer on API Gateway.
* Set `DEV_ROUTES=false`.
