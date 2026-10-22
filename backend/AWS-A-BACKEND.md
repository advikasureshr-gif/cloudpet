# Cloudpet – AWS backend (Account A)

You own: DynamoDB, the API Lambda, the scheduler Lambda (every 15 min), API Gateway, SES, alarms.
Person B (Account B) owns: Cognito, S3 + CloudFront, CloudWatch dashboard, billing alarm.

## 0. One-time setup (≈30 min, do it today)
1. Install AWS CLI v2 and SAM CLI. Check: `aws --version`, `sam --version`.
2. IAM Identity Center or an IAM user with admin rights on Account A, then
   `aws configure --profile cloudpet-a` (region `us-east-1` recommended; B uses the same region).
3. Billing: Billing > Budgets > create a **$5 monthly budget** with an email alert.
4. SES (sandbox is fine): SES > Verified identities > create an **email identity** for the sender
   (e.g. your Gmail) and click the link. In the sandbox, **recipients must also be verified**, so verify
   the demo email address (professor's address is NOT needed – use your own on the demo laptop).
5. Groq key ready (from console.groq.com).

Everything below: `cd backend` and add `--profile cloudpet-a` (or `export AWS_PROFILE=cloudpet-a`).

## 1. First deploy (placeholders for Cognito)
```
npm install
sam build
sam deploy --guided --stack-name cloudpet --region us-east-1 --capabilities CAPABILITY_IAM \
  --parameter-overrides MailFrom=you@gmail.com GroqApiKey=gsk_xxx DemoSecret=pick-a-long-secret \
  --resolve-s3 --confirm-changeset --save-params
```
(Answer `y` to "may not have authorization defined" prompts – /api/health and /api/catalog are meant to be public.)

Outputs print **ApiUrl**. Send it to person B.

## 2. Smoke test (no Cognito needed)
```
curl $ApiUrl/api/health            # {"ok":true}
curl $ApiUrl/api/catalog           # pets and shop items
curl $ApiUrl/api/me                # 401 (correct: no token)
aws lambda invoke --function-name <ApiFunctionName output> \
  --cli-binary-format raw-in-base64-out --payload fileb://events/me.json out.json && cat out.json
```
`events/me.json` fakes an API Gateway event with Cognito claims, so this proves Lambda + DynamoDB work.
Run the scheduler once: `aws lambda invoke --function-name <SchedulerFunction name> out2.json && cat out2.json`
(see names in the CloudFormation console > cloudpet > Resources).

## 3. Receive from person B (the whole handoff)
| B gives you | Goes into |
|---|---|
| Issuer URL `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_XXXX` | `CognitoIssuer` |
| App client ID | `CognitoAudience` |
| CloudFront URL `https://dxxxx.cloudfront.net` (no trailing slash) | `AllowedOrigin` |
| same URL with trailing `/` | `AppUrl` (link in the reminder email) |

Redeploy:
```
sam deploy --parameter-overrides CognitoIssuer=... CognitoAudience=... \
  AllowedOrigin=https://dxxxx.cloudfront.net AppUrl=https://dxxxx.cloudfront.net/ \
  MailFrom=you@gmail.com GroqApiKey=gsk_xxx DemoSecret=pick-a-long-secret
```
(Cross-account works: the JWT authorizer only needs the public issuer URL.)

## 4. What B needs to know about the API
- Base URL = ApiUrl. Send the Cognito **ID token** (not the access token) as `Authorization: Bearer <idToken>`
  – the ID token carries email and name, which the backend uses to create the profile.
- Also send `x-utc-offset-minutes` (already done by `js/api.js`).
- Authorizer audience must equal the app client ID; the user pool app client must have no secret.
- CORS allows exactly the CloudFront origin; B must tell you the final URL.

## 5. Demo day helpers (header `x-demo-secret: <DemoSecret>` plus a valid token)
- `POST /api/demo/seed-history` – fake a week of visits so the Random Forest has data
- `POST /api/demo/reminders-run` `{ "at": "<ISO time>" }` – force a reminder cycle now (email goes via SES)
- `POST /api/demo/weather`, `/coins`, `/tick`, `/reset`
Set `TimeScale` (e.g. 60) in a redeploy to make pets' stats decay 60× faster for the demo; put it back to 1 after.

## 6. Cost and teardown
Idle cost is cents: DynamoDB on-demand, Lambda free tier, scheduler 2,880 invokes/month, logs kept 7 days.
After the demo (and after B tears down theirs):
```
sam delete --stack-name cloudpet --region us-east-1
```
Table and logs are deleted with the stack. Keep the SES verified identity (free).

## 7. Troubleshooting
- 401 on every call: issuer/audience mismatch, or sending the access token. Decode the token at jwt.io: `iss` and `aud` must match.
- CORS error in the browser: `AllowedOrigin` must be the exact origin, no trailing slash.
- No email: sender and recipient both verified in SES? Check CloudWatch logs of the scheduler.
- 502 on chat: Groq key wrong/limit hit; the app shows a friendly error and the rest keeps working.
- Logs: CloudWatch > Log groups > `/aws/lambda/cloudpet-ApiFunction-...`.
