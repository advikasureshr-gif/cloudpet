/* Sending email.

   MAIL_PROVIDER=console  (default) prints the email and keeps it in memory, so you can see it with no setup.
   MAIL_PROVIDER=ses      Amazon SES. MAIL_FROM must be an address you verified in SES (and while your account is in
                          the SES "sandbox", the recipient must be verified too). */

const outbox = [];                                            // console mode only
let sesClient = null;                                         // swapped in tests
export const setSesClient = c => { sesClient = c; };
export const getOutbox = to => outbox.filter(m => !to || m.to === to);
export const clearOutbox = () => { outbox.length = 0; };

export async function sendMail({ to, subject, text, html }) {
  if ((process.env.MAIL_PROVIDER || "console").toLowerCase() === "ses") {
    const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
    sesClient = sesClient || new SESv2Client({ region: process.env.AWS_REGION || "us-east-1" });
    if (!process.env.MAIL_FROM) throw new Error("MAIL_FROM is not set");
    await sesClient.send(new SendEmailCommand({
      FromEmailAddress: process.env.MAIL_FROM,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text }, Html: { Data: html } } } }
    }));
    return { provider: "ses" };
  }

  outbox.push({ to, subject, text, html, at: new Date().toISOString() });
  if (outbox.length > 50) outbox.shift();
  console.log(`\n--- email (console mode) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n----------------------------\n`);
  return { provider: "console" };
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// "8:00 PM" on the player's own clock
export function clockText(date, offsetMin) {
  const local = new Date(date.getTime() + offsetMin * 60000);
  const h = local.getUTCHours(), m = local.getUTCMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function buildReminderEmail({ name, pets, usualTime, link }) {
  const first = pets[0] ? pets[0].name : "your pet";
  const status = pets.map(p => `${p.name}: ${p.stats.happiness}% happy, ${p.stats.hunger}% fed`).join("\n");
  const subject = `${first} is waiting for you 🐾`;

  const text = `Hi ${name},\n\nYou usually visit around ${usualTime}, and your pets noticed. ${first} would love to see you!\n\n${status}\n\n` +
    `Come back and they'll be happier: ${link}\n\n— Pet Haven`;

  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#f2e6fb;border-radius:20px;color:#3a1a5c">
<h2 style="margin-top:0">🐾 ${esc(first)} is waiting for you</h2>
<p>Hi ${esc(name)}, you usually visit around <b>${esc(usualTime)}</b>, and your pets noticed.</p>
<p>${pets.map(p => `${esc(p.name)}: ${p.stats.happiness}% happy, ${p.stats.hunger}% fed`).join("<br>")}</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#8c4fd6;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:bold">Visit ${esc(first)}</a></p>
<p style="font-size:12px;color:#6b4a8f">Pet Haven</p></div>`;

  return { subject, text, html };
}
