Here is the live SES demo, using the browser console on your site since it already holds your login token.

**Before the demo (one-time):**
- The account you demo with must have the **SES-verified email** as its sign-up address (sandbox rule). Sign in with it on the site.
- Note down your `DemoSecret`.
- Check that one pet's happiness is below 85, so the +15 boost is visible. Skip a feeding or play session if needed.

**Step 1: fake visit history and predict the next visit.** On the site (logged in), press **F12 > Console**, paste, and press Enter. Replace `YOUR_SECRET`:
```js
const t = JSON.parse(localStorage.cloudpet_tokens).idToken;
const h = { Authorization: "Bearer " + t, "Content-Type": "application/json",
  "x-demo-secret": "YOUR_SECRET", "X-Utc-Offset-Minutes": String(-new Date().getTimezoneOffset()) };
const seeded = await (await fetch(api.base + "/demo/seed-history", { method: "POST", headers: h, body: "{}" })).json();
seeded
```
It prints a prediction (method `forest`) with `reminderAt`, the time the email will be due.

**Step 2: jump to "30 minutes before the usual visit" and send the reminder:**
```js
const at = new Date(Date.parse(seeded.prediction.reminderAt) + 60000).toISOString();
await (await fetch(api.base + "/demo/reminders-run", { method: "POST", headers: h, body: JSON.stringify({ at }) })).json()
```
You should see `reminded: true`.

**Step 3: show the email.** Open your inbox in another tab (check spam). The subject names your pet, and the body says "you usually visit around ...". The email was sent by **SES**, so you can also open **SES > Account dashboard / Sending statistics** to show a send.

**Step 4: click the link in the email.** Use the same browser where you're logged in, so the token is still there. The site opens with a welcome toast and each pet's happiness is up by 15. Click it only once, since the boost works once per email and is valid for 24 hours.

**If it doesn't work:**
- `reminded: false` and no email: check that your profile has the verified email (Cognito > Users), and that you didn't use the link or interact after the reminder time. Run `seeded` again and repeat.
- 403 or 404 on the demo call: the secret is wrong or empty (`DemoSecret` must have been set at deploy).
- `reminded: true` but no email: SES sender or recipient isn't verified in **us-east-1**. Check the scheduler or API log in CloudWatch for the SES error.

To rehearse once beforehand, run steps 1 and 2 and click the link, then run step 1 again to get a fresh reminder for the real demo.