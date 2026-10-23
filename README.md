# 🐾 CloudPet — Intelligent Virtual Pet Assistant

CloudPet is a serverless virtual pet web app on AWS. Users adopt pets, care for them, chat with them through an AI assistant, and get a reminder email at the time they usually visit, predicted by a small machine-learning model.

## 🐾 Features

* 🍖 Feed, 🎾 play with, 🛁 clean and 😴 put pets to sleep (the server enforces every rule, so the browser can't cheat)
* 🐱 Six adoptable pets (Luna is the free starter), up to six per player
* 🧸 Shop for food and accessories; worn accessories boost happiness
* 🎨 Colour themes that restyle every page
* 🪙 Daily quests, achievements and hidden discoveries that pay out coins
* ⏳ Pets age in real time: hunger, energy, hygiene and happiness fall while you're away, and health follows them
* 🌦️ Real local weather affects pets differently (cats, dogs and rabbits react differently)
* 💬 Chat with your pet through an AI assistant (Groq by default; OpenAI, Amazon Bedrock and an offline demo mode are also supported)
* 🔮 A per-player **Random Forest** predicts when you usually visit; CloudPet emails you about 30 minutes before, and clicking the link cheers your pets up
* 🔐 Sign up and log in with Amazon Cognito

---

# ☁️ Cloud Architecture

CloudPet is fully serverless, and the whole architecture is deployed as a single repeatable unit.

```text
                                  👤 USER (browser)
                                        |
              +-------------------------+--------------------------+
              |                         |                          |
              v                         v                          v
       +-------------+         +----------------+          +--------------+
       |     S3      |         |    Cognito     |          |  API Gateway |
       |  Frontend   |         | sign-up/log-in |          |   HTTP API   |
       +-------------+         +-------+--------+          +------+-------+
                                       |   ID token (JWT)         |
                                       +------------------------->|  JWT authorizer
                                                                  v
                                                          +--------------+
                                                          |    Lambda    |
                                                          |  API (Node)  |
                                                          +------+-------+
                                                                 |
                                   +-----------------------------+---------------+
                                   |                             |               |
                                   v                             v               v
                             +-----------+                +-----------+     +-----------+
                             | DynamoDB  |                |    SES    |     | Groq API  |
                             | pet state |                |  e-mail   |     | (pet chat)|
                             +-----------+                +-----------+     +-----------+
                                   ^                             ^
                                   |                             |
                             +-----+-----------------------------+--+
                             |   Lambda: scheduler (every 15 min)   |
                             +----------------+---------------------+
                                              ^
                                              |
                                  +-----------+-----------+
                                  | EventBridge Scheduler |
                                  +-----------------------+

   📊 MONITORING:  CloudWatch (logs, metrics, dashboard, alarms)  ->  SNS  ->  e-mail alerts
```

## 🏗️ Components

### 🌐 Frontend — S3
Static HTML, CSS and JavaScript are hosted in an **Amazon S3** bucket with static website hosting. `js/config.js` (generated at deploy time) tells the pages which API and Cognito app to use.

### 🔐 Authentication — Cognito
**Amazon Cognito** handles sign-up and login with email and password. The browser sends the Cognito **ID token** on every API call. A pre-sign-up Lambda trigger auto-confirms accounts so the demo needs no email codes.

### 🚪 API — API Gateway
An **HTTP API** exposes `/api/*`. A **JWT authorizer** checks the Cognito token before any code runs. Only `/api/health` and `/api/catalog` are public. Throttling limits abuse, and CORS allows only the site's origin.

### ⚡ Backend logic — Lambda
The **API Lambda** (Node.js, Express through `serverless-http`) contains all game rules: actions, shop, quests, weather, aging, chat and prediction. Conditional DynamoDB updates make coin spending and rewards safe against double-clicks and parallel requests.

### ⏱️ Scheduled processing — EventBridge Scheduler + Lambda
**EventBridge Scheduler** invokes the **scheduler Lambda** every 15 minutes. It applies the passage of time to pets, runs the reminder cycle (predict the next visit, send the email shortly before it, apply a small happiness penalty after a missed visit) and re-predicts.

### 🗄️ Database — DynamoDB
A single on-demand **DynamoDB** table (`pk` / `sk` design with TTL) stores profiles, pets, inventory, quest progress, visit events and daily chat counters. Idle cost is effectively zero.

### 🔮 Prediction (machine learning)
For each player, a **Random Forest** (`ml-random-forest`) learns from the last 28 days of visits using 30-minute time slots, with time of day and weekday/weekend features on the player's own clock. With little data it falls back to a circular average time of day. A backtest script (`npm run ml:report`) compares both methods.

### 📩 Notifications — SES and SNS
**Amazon SES** sends the reminder emails. **Amazon SNS** delivers CloudWatch alarm notifications by email.

### 📊 Monitoring — CloudWatch
Lambda logs (7-day retention) and metrics are collected automatically. The stack can also create a **CloudWatch dashboard** (API traffic and errors, Lambda invocations and errors, DynamoDB usage) and **alarms** on Lambda errors.

---

# 🔄 Request Flow

When a user feeds a pet:

```text
Click "Feed" -> browser (ID token attached)
      -> API Gateway (JWT authorizer validates token)
      -> API Lambda (rules, aging, atomic update)
      -> DynamoDB
      -> updated pet returned -> page updates immediately
```

Reminder email:

```text
EventBridge Scheduler (every 15 min)
      -> scheduler Lambda
      -> Random Forest predicts the usual visit time
      -> 30 minutes before: SES sends the reminder
      -> user clicks the link -> pets gain happiness (once per email)
```

---

# 🔒 Security

* Every API route except health and catalog requires a valid Cognito token.
* Lambda roles follow least privilege (one table, SES sending).
* The browser never decides prices, rewards or stats; the server does.
* Chat input is length-limited and rate-limited (30 messages per day), and provider keys stay on the server.
* Demo helper routes are disabled unless a secret is configured and then need that secret plus a valid login.

---

# ☁️ AWS Services Summary

| AWS Service | Purpose |
| --- | --- |
| **Amazon S3** | Static frontend hosting |
| **Amazon API Gateway** | HTTP API with JWT authorizer, throttling and CORS |
| **AWS Lambda** | API logic, scheduled processing and the sign-up trigger |
| **Amazon DynamoDB** | Persistent pet, player and event data |
| **Amazon Cognito** | Sign-up, login and tokens |
| **Amazon EventBridge Scheduler** | Runs the scheduler every 15 minutes |
| **Amazon SES** | Reminder emails |
| **Amazon SNS** | Alarm notifications |
| **Amazon CloudWatch** | Logs, metrics, dashboard and alarms |
| **AWS IAM** | Least-privilege permissions |

---

# 🚀 Run it

**Locally** (no AWS needed):

```bash
cd backend
npm install
npm run db:up && npm run db:create   # DynamoDB Local in Docker
npm start                            # API on http://localhost:3000
```

Serve the `frontend` folder with any static server (for example `python3 -m http.server 8080`) and open `http://localhost:8080/login.html`. In local mode the login only checks that the username exists.

**On AWS:** see `backend/AWS-DEPLOY.md`.

```bash
cd backend
sam build
sam deploy --guided
./scripts/deploy-site.sh ../frontend
```

**Clean up** after a demo so nothing keeps running: `./scripts/teardown.sh`

---

# 🎯 Architecture Goals

1. **Cost** — Everything scales to zero, so an idle deployment costs almost nothing and `teardown.sh` removes it entirely.
2. **Scalability** — API Gateway, Lambda and on-demand DynamoDB scale with demand without servers to manage.
3. **Responsiveness** — Core pet interactions are synchronous, while time-based work runs separately on a schedule.
4. **Security** — Managed authentication and server-enforced game rules.
5. **Reproducibility** — The full infrastructure is defined in code, so it can be deployed and removed in a few commands.
