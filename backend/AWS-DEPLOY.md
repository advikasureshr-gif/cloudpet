# Cloudpet on AWS – one stack, one account

`template.yaml` creates everything: DynamoDB, API Lambda + HTTP API, scheduler Lambda (every 15 min),
Cognito (self sign-up, no email code), S3 + CloudFront website, CloudWatch dashboard + alarms.
Region: **us-east-1** everywhere (console selector too).

## Deploy
```
cd ~/cloudpet/backend
npm install
sam build
sam deploy --guided --profile cloudpet-a --stack-name cloudpet --region us-east-1 \
  --capabilities CAPABILITY_IAM --resolve-s3 --confirm-changeset \
  --parameter-overrides MailFrom=you@gmail.com GroqApiKey=gsk_xxx DemoSecret=long-secret
```
Prompts: Enter for defaults; "Save arguments" = y; config file name = Enter (do not type y); confirm changeset = y.
First deploy takes ~8 min (CloudFront). Later redeploys: `sam build && sam deploy --profile cloudpet-a`.

## If AWS says "account must be verified" for CloudFront (new accounts)
Open a support case (Support > Create case > Account and billing) and include the error text, then deploy meanwhile with
`EnableCloudFront=false EnableMonitoring=false`: the site is served straight from S3 over HTTP (`http://<bucket>.s3-website-us-east-1.amazonaws.com`).
When AWS verifies the account, redeploy with `EnableCloudFront=true` (and `EnableMonitoring=true`) and run `./scripts/deploy-site.sh` again.
A stack that failed on first create (ROLLBACK_COMPLETE) must be deleted first:
`aws cloudformation delete-stack --stack-name cloudpet --profile cloudpet-a --region us-east-1`

## Put the website online (after every frontend change)
```
export AWS_PROFILE=cloudpet-a
./scripts/deploy-site.sh          # uploads the folder above backend/, writes js/config.js with the real ids
```
It prints the website URL (the `SiteUrl` output). Open it, sign up, play.

## Demo accounts
Self sign-up works on the login page (email + password, 8+ characters).
Or create users in the console: Cognito > User pools > cloudpet-users > Create user
(email, tick "Mark email address as verified", set a password, and fill the **name** attribute after creation).

## Checks
```
curl $ApiUrl/api/health ; curl $ApiUrl/api/catalog ; curl -i $ApiUrl/api/me   # 401 without a token
```
CloudWatch > Dashboards > cloudpet-overview for the professor.

## Demo helpers (need header x-demo-secret and a signed-in token)
`POST /api/demo/seed-history`, `/api/demo/reminders-run`, `/api/demo/weather`, `/api/demo/coins`, `/api/demo/tick`, `/api/demo/reset`.
Redeploy with `TimeScale=60` to make stats decay 60x faster during the demo, and back to 1 after.

## SES
Sender and recipient must both be verified (sandbox). Identity must be in **us-east-1**.

## After the demo
```
./scripts/teardown.sh        # empties the bucket, then deletes the whole stack
```
Then delete the IAM access key.

## Troubleshooting
- 401 everywhere: signed out or token expired -> log in again. Decode the ID token at jwt.io to inspect.
- CORS error: open the site through the CloudFront URL, not file://.
- No email: SES identities (sender + recipient) verified in us-east-1? Look at the scheduler's CloudWatch log.
- Page edits not showing: re-run deploy-site.sh (CloudFront caching is disabled, so they show immediately).