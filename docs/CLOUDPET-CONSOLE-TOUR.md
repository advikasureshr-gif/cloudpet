# Cloudpet – AWS console tour (demo guide)

**Before you start:** sign in to the AWS console, set the region to **US East (N. Virginia) us-east-1** (top right), and open each service in its own browser tab ahead of time. Keep the website open in one more tab.

Website: `http://cloudpet-sitebucket-lxtw7qqu0zaz.s3-website-us-east-1.amazonaws.com`
API: `https://8nxp5v07bh.execute-api.us-east-1.amazonaws.com`

Everything below was created by **one CloudFormation stack named `cloudpet`**. Start there.

---

## 0. CloudFormation – "one stack builds it all" (30 s)
**CloudFormation > Stacks > cloudpet**
- **Resources** tab: the full list (S3, DynamoDB, Cognito, API Gateway, Lambda, EventBridge, SNS, IAM roles...).
- **Outputs** tab: site URL, bucket name, user pool ID.
- **Template** tab: the infrastructure is code (`template.yaml`), so it can be deleted and recreated with one command.

*Say:* "The whole architecture is defined as code, so I can deploy it, test it and delete it, which keeps it free."

## 1. S3 – frontend hosting
**S3 > Buckets > `cloudpet-sitebucket-...` > Objects**
- Show `home.html`, `login.html`, `js/`, `animation_packs/`.
- **Properties** tab, scroll to the bottom: **Static website hosting** is enabled, and this is the website URL.

*Say:* "The frontend is plain HTML, CSS and JavaScript stored in S3 and served as a static website."

## 2. CloudFront – fast frontend delivery
*Current status: the account was still being verified for CloudFront, so the site is served directly from S3.*
- Show **CloudFormation > Stacks > cloudpet > Template** and point to the `SiteDistribution` resource and the `EnableCloudFront` parameter.
- **If CloudFront has been enabled:** **CloudFront > Distributions**: show the distribution domain, the S3 origin, Origin Access Control, and "Redirect HTTP to HTTPS".

*Say:* "CloudFront is part of the design. It is switched off by a parameter until AWS finishes verifying my account, and one redeploy turns it on."

## 3. Cognito – user authentication
**Cognito > User pools > `cloudpet-users`**
- **Users** tab: the account you just signed up with on the website appears here (sign up live, then refresh).
- **App clients**: `cloudpet-web`, with no client secret.
- **Extensions / Lambda triggers**: the pre-sign-up trigger that auto-confirms the demo accounts.

*Say:* "Passwords never reach my backend. Cognito checks them and gives the browser a signed token."

## 4. API Gateway – backend API
**API Gateway > APIs > `cloudpet` (HTTP API)**
- **Routes**: `GET /api/health`, `GET /api/catalog` (public), `ANY /{proxy+}` with a JWT authorizer, `OPTIONS /{proxy+}` (CORS preflight).
- **Authorization**: the JWT authorizer, with the issuer pointing to the Cognito pool.
- **CORS** and **Throttling** (burst 40, rate 20).
- Live proof (terminal): `curl -i https://8nxp5v07bh.execute-api.us-east-1.amazonaws.com/api/me` returns **401** without a token. `curl .../api/catalog` returns data.

*Say:* "Every route except health and catalog is rejected unless the Cognito token is valid."

## 5. Lambda – serverless backend logic
**Lambda > Functions**
- `cloudpet-ApiFunction-...`: all the game logic (feeding, shop, rewards, chat, prediction). Open **Configuration > Environment variables** and show `AUTH_MODE=cognito`, `MAIL_PROVIDER=ses`, and `CHAT_PROVIDER=groq` (do **not** open the values of the key variables).
- `cloudpet-SchedulerFunction-...`: runs on a schedule (next section).
- `cloudpet-PreSignUpFunction-...`: the tiny Cognito trigger.
- **Monitor tab > Metrics**: invocations and duration after your demo traffic.

*Say:* "No servers to manage. The code runs only when a request or schedule triggers it."

## 6. DynamoDB – pet and user data
**DynamoDB > Tables > `cloudpet-Table-...` > Explore table items**
- Rows for your profile, pets (stats, equipped accessories), inventory and chat counters.
- Click one pet row: show `hunger`, `happiness`, `lastTick`, `version`.
- Do an action on the website (feed a pet), then **Run** the scan again: the values change.

*Say:* "A single-table design with on-demand capacity, so it costs nothing when idle. The server enforces the game rules, so the browser can't cheat."

## 7. EventBridge – scheduled pet updates
**Amazon EventBridge > Scheduler > Schedules**
- Open the schedule for `SchedulerFunction`: **rate(15 minutes)**, target the Lambda.
- Then **Lambda > SchedulerFunction > Monitor > View CloudWatch logs**: each run prints a line like `{"pets":3,"updated":2,"players":1,"reminded":0,"neglected":0}`.

*Say:* "Every 15 minutes this applies the passage of time to pets, predicts when each player usually visits, and sends the reminder email."

## 8. SES (and SNS) – notifications
**Amazon SES > Identities**: the verified sender address (region us-east-1).
- Live demo: trigger the reminder (see "Live demo moves" below), then show the email in the inbox, click it, and watch the pet's happiness rise.

**Amazon SNS > Topics** (`cloudpet-AlarmTopic-...`): the topic that CloudWatch alarms publish to; **Subscriptions** shows the confirmed email.

*Say:* "SES sends the reminder emails. SNS is the alert channel for operational alarms."

## 9. CloudWatch – monitoring and logs
**CloudWatch > Log groups**
- `/aws/lambda/cloudpet-ApiFunction-...`: open the latest stream, and show a request with your sign-in.
- `/aws/lambda/cloudpet-SchedulerFunction-...`: the schedule runs.
- Note the **retention: 1 week**, set in the template to keep costs down.

**CloudWatch > Metrics > All metrics:** Lambda (Invocations, Errors, Duration) and ApiGateway (Count, 4xx, 5xx, Latency).

**If monitoring was enabled:** **Dashboards > `cloudpet-overview`** (requests, errors, latency, DynamoDB capacity) and **Alarms** (Lambda errors, with SNS email).
*If not:* "The dashboard and alarms are defined in the template behind a switch; they get created once the account's CloudWatch verification completes."

## 10. IAM – least privilege (optional, 20 s)
**IAM > Roles > `cloudpet-ApiFunctionRole-...`**: it can only read/write this one table and send SES email. No broad access.

## 11. Billing – cost control
**Billing and Cost Management > Budgets:** the $5 budget alert. **Cost Explorer:** about $0 (credits cover it).
At the end: `./scripts/teardown.sh` deletes everything, and Cost Explorer shows nothing running.

---

## Live demo moves (in order, about 5 minutes)
1. **Sign up** on the website with a new email. Console: **Cognito > Users** shows the new account.
2. **Feed or play** with a pet. Console: **DynamoDB** shows the pet row changing.
3. **Chat** with the pet (Groq reply). Console: **Lambda > Logs** shows the request.
4. **Reminder email:** `POST /api/demo/seed-history`, then `POST /api/demo/reminders-run` (header `x-demo-secret`, plus your login token). Email arrives through **SES**, you click it, and happiness rises.
5. **Scheduler:** show the EventBridge schedule and its latest log line.

## If something goes wrong
- **Site shows "Can't reach the server":** hard refresh (Cmd+Shift+R). Check API Gateway > cloudpet is there and the URL matches `js/config.js`.
- **Login says wrong password:** make sure you use the email you signed up with, not a username.
- **Email missing:** check spam; the sender and the recipient must both be verified in SES (us-east-1).
- **Chat gives the "offline demo" reply:** the Groq key or daily limit; it keeps working, just with canned replies.
- **Backup:** play the screen recording, and mention the local version.

## After the demo (cost reset)
```
cd ~/cloudpet/backend
export AWS_PROFILE=cloudpet-a
./scripts/teardown.sh
```
Then delete the IAM access key (IAM > Users > cloudpet-admin > Security credentials) and the SES identity if you don't need it.