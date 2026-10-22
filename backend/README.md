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


## Rewards and dev login (added with the coins page)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/rewards` | Achievements and discoveries: `unlocked` and `claimed` for each |
| POST | `/api/rewards/:id/claim` | Pays the reward once (`first_steps`, `pet_lover`, `super_owner`, `pet_haven_pro`, `rainbow`, `night_owl`, `mystery_friend`, `cat`, `dog`, `rabbit`) |
| GET | `/api/dev/users/:name` | Does this username exist? (dev login only, no auth header needed) |

Claimed flags live on the profile row as `rwd_<id>`, set with a conditional write so a double click pays once.
Night Owl uses the player's own clock (8pm to 5am); pet discoveries unlock after caring for a cat, dog or rabbit.


## Time passing, health, weather, reminder boost

- Stats fall over time from `DECAY_PER_HOUR` in `src/catalog.js` (hunger 4/h, energy 2/h, hygiene 2/h, happiness 1.5/h; nothing below 5, only 48 hours count).
- **Health** follows the other stats: each low stat (hunger or hygiene under 30, energy under 20) costs 0.8 health per hour and 1 happiness; when hunger, hygiene, energy and happiness are all 50+ health heals 1 per hour.
- **Weather** (Open-Meteo, location from `DEFAULT_LAT` / `DEFAULT_LON`, Chennai by default) changes happiness and health per hour, differently for cats, dogs and rabbits (`WEATHER_RULES`). It counts for the first 6 hours of an absence. If the weather service can't be reached it assumes a sunny day.
- Time is applied whenever you open the app or act, and by the scheduled update (`tickAllPets`, every `TICK_MINUTES`, default 15; on AWS an EventBridge Scheduler rule calls the same function).
- `TIME_SCALE=60 npm start` makes one real minute count as an hour (for the demo video).
- `GET /api/weather`: today's weather and each pet's reaction.
- `POST /api/reminder/return`: the link in the reminder email (`home.html?from=reminder`). Every pet gets +15 happiness, once per email, within 24 hours. Day 5 sets `reminderSentAt` when the email goes out.
- Dev helpers: `POST /api/dev/weather {condition}` (clear, cloudy, hot, cold, rain, storm, snow; empty body = real weather), `POST /api/dev/reminder`, `POST /api/dev/tick`.

## AI companion (Day 4)

`POST /api/chat  { petUid, message, history }` → `{ reply, provider, remaining }`.
The server builds the prompt from the pet's real stats, accessory, weather reaction and time since your last visit (`buildSystemPrompt` in `src/services/chat.js`).

- `CHAT_PROVIDER=mock` (default): free offline replies, no AWS needed.
- `CHAT_PROVIDER=groq`: Groq API. Put `GROQ_API_KEY=gsk_...` and `CHAT_PROVIDER=groq` in `backend/.env`. Model from `GROQ_MODEL` (default `openai/gpt-oss-20b`).
- `CHAT_PROVIDER=openai`: OpenAI API. Put `OPENAI_API_KEY=sk-...` and `CHAT_PROVIDER=openai` in `backend/.env` (copy `.env.example`), then `npm start`. Model from `OPENAI_MODEL` (default `gpt-5-mini`); the key never leaves the server.
- `CHAT_PROVIDER=bedrock`: Amazon Bedrock Converse API with `BEDROCK_MODEL_ID` (default `us.amazon.nova-lite-v1:0`) in `AWS_REGION`.
  Needs: AWS credentials on your machine (`aws configure`), the model enabled for your account in the Bedrock console, and `bedrock:InvokeModel` permission.
- Cost guards: 500-character messages, 250-token replies, 6 turns of history, 30 messages per player per day (`CHAT_DAILY_LIMIT`). A failed Bedrock call isn't counted.

Try it for real once: `CHAT_PROVIDER=bedrock npm start`.

## Check-in prediction, reminder email, neglect (Day 5)

- Every action is logged (`EVENT#` rows). `src/services/prediction.js` cuts days into 48 half-hour slots, learns from the last 28 days with a **Random Forest** (`ml-random-forest`, trained per player in about 0.2 s, no model file), and picks the next likely visit. With little history it falls back to the average visit time; with almost none it says "no idea yet". Run `npm run ml:report` to see how well it does against the simple average.
- `GET /api/prediction` shows the prediction (the home page card uses it).
- On every scheduled update (`tickEverything`) each player gets: a prediction stored on their profile, a **reminder email about 30 minutes before** the predicted visit (once per visit, not if they're already here), and if they never showed up within 2 hours of the usual time **every pet loses 10 happiness** (once per missed visit). The email's button opens `home.html?from=reminder`, which gives the +15 happiness.
- Email: `MAIL_PROVIDER=console` prints the email in the terminal (and keeps it for `GET /api/dev/outbox`); `MAIL_PROVIDER=ses` sends through Amazon SES (`MAIL_FROM` must be a verified address; in the SES sandbox the recipient must be verified too).
- Demo helpers (dev only): `POST /api/dev/seed-history` makes up 3 weeks of habits so the prediction has something to learn (usual visit in about 60 minutes); `POST /api/dev/reminders-run {"at": "<time>"}` runs the cycle as if it were that time; `GET /api/dev/outbox` lists the emails.
