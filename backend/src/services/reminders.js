import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE } from "../db.js";
import { REMINDER_BOOST, REMINDER_VALID_HOURS, NEGLECT_GRACE_HOURS, NEGLECT_PENALTY, REMINDER_LEAD_MIN } from "../catalog.js";
import { AppError } from "../errors.js";
import { getOrCreateProfile } from "./users.js";
import { listPets, updatePet } from "./pets.js";
import { toPetDto, userKey } from "../items.js";
import { predictNext } from "./prediction.js";
import { sendMail, buildReminderEmail, clockText } from "./mailer.js";

const profileKey = userId => ({ pk: userKey(userId), sk: "PROFILE" });

// Called when a reminder email goes out (Day 5 does this for real; /api/dev/reminder pretends for now)
export async function markReminderSent(userId, now = new Date()) {
  await getOrCreateProfile(userId);
  await db.send(new UpdateCommand({
    TableName: TABLE, Key: profileKey(userId),
    UpdateExpression: "SET reminderSentAt = :t", ExpressionAttributeValues: { ":t": now.toISOString() }
  }));
}

/* The person clicked the link in the reminder email. Every pet gets a happiness boost, once per email.
   There has to be a reminder we actually sent (and not too long ago), so the link can't be used as a free boost. */
export async function returnFromReminder(userId, now = new Date()) {
  const profile = await getOrCreateProfile(userId);
  const sent = profile.reminderSentAt;

  if (!sent || (profile.reminderUsedAt && profile.reminderUsedAt >= sent)) {
    throw new AppError(409, "no-reminder", "There's no reminder waiting for you.");
  }
  if (now.getTime() - Date.parse(sent) > REMINDER_VALID_HOURS * 3600000) {
    throw new AppError(409, "reminder-expired", "That reminder is too old.");
  }

  try {
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: profileKey(userId),
      ConditionExpression: "reminderSentAt = :sent AND (attribute_not_exists(reminderUsedAt) OR reminderUsedAt < :sent)",
      UpdateExpression: "SET reminderUsedAt = :sent",
      ExpressionAttributeValues: { ":sent": sent }
    }));
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") throw new AppError(409, "no-reminder", "There's no reminder waiting for you.");
    throw err;
  }

  const pets = await listPets(userId);
  const updated = [];
  for (const p of pets) updated.push(await updatePet(userId, p.sk.replace("PET#", ""), { effects: { happiness: REMINDER_BOOST }, now }));
  return { boost: REMINDER_BOOST, pets: updated.map(toPetDto) };
}


/* ---------- The scheduled reminder cycle (runs for every player on every tick) ----------
   1. Work out (and remember) when this player is likely to visit next.
   2. About 30 minutes before that, send the reminder email (once per predicted visit).
   3. If the visit time passes and they never showed up, every pet gets a bit sadder (once per missed visit),
      then look for the next likely visit. */


async function storePrediction(profile, now) {
  const offset = profile.utcOffset ?? 0;
  const pred = await predictNext(profile.userId, now, offset);
  const key = profileKey(profile.userId);

  if (pred.nextCheckInAt) {
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: key,
      UpdateExpression: "SET nextCheckInAt = :n, reminderAt = :r, predictionMethod = :m",
      ExpressionAttributeValues: { ":n": pred.nextCheckInAt, ":r": pred.reminderAt, ":m": pred.method }
    }));
  } else {
    await db.send(new UpdateCommand({ TableName: TABLE, Key: key, UpdateExpression: "REMOVE nextCheckInAt, reminderAt, predictionMethod" }));
  }
  return pred;
}

// Marks one step as done (returns false if a parallel run already did it), so nothing happens twice
async function claimStep(userId, attr, value) {
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: profileKey(userId),
      ConditionExpression: `attribute_not_exists(${attr}) OR ${attr} <> :v`,
      UpdateExpression: `SET ${attr} = :v`, ExpressionAttributeValues: { ":v": value }
    }));
    return true;
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

export async function runReminderCycle(profile, now = new Date()) {
  const userId = profile.userId;
  const out = { userId, predicted: false, reminded: false, neglected: false };

  if (!profile.nextCheckInAt) {
    const pred = await storePrediction(profile, now);
    out.predicted = pred.method !== "none";
    if (!pred.nextCheckInAt) return out;
    profile = { ...profile, nextCheckInAt: pred.nextCheckInAt, reminderAt: pred.reminderAt };      // carry on with the new prediction
  }

  const next = Date.parse(profile.nextCheckInAt);
  const remindAt = Date.parse(profile.reminderAt);
  const pets = await listPets(userId);
  const lastActive = Math.max(0, ...pets.map(p => Date.parse(p.lastInteraction) || 0));

  // The visit time is long gone: did they come? If not, the pets are sad. Then predict again.
  if (now.getTime() >= next + NEGLECT_GRACE_HOURS * 3600000) {
    if (lastActive < remindAt && await claimStep(userId, "neglectFor", profile.nextCheckInAt)) {
      for (const p of pets) {
        await updatePet(userId, p.sk.replace("PET#", ""), { effects: { happiness: -NEGLECT_PENALTY }, interaction: false, now });
      }
      out.neglected = true;
    }
    out.predicted = (await storePrediction(profile, now)).method !== "none";
    return out;
  }

  // Time for the reminder? (and they aren't already here, and we have an address to write to)
  if (now.getTime() >= remindAt && now.getTime() < next && lastActive < remindAt && profile.email) {
    if (await claimStep(userId, "reminderFor", profile.nextCheckInAt)) {
      try {
        const offset = profile.utcOffset ?? 0;
        const base = (process.env.APP_URL || "http://localhost:8080/").replace(/\/?$/, "/");
        const fresh = await Promise.all(pets.map(p => updatePet(userId, p.sk.replace("PET#", ""), { interaction: false, now })));
        const mail = buildReminderEmail({
          name: profile.name || "there",
          pets: fresh.map(toPetDto),
          usualTime: clockText(new Date(next), offset),
          link: base + "home.html?from=reminder"
        });
        await sendMail({ to: profile.email, ...mail });
        await markReminderSent(userId, now);
        out.reminded = true;
      } catch (err) {
        // Couldn't send: let the next tick try again
        await db.send(new UpdateCommand({ TableName: TABLE, Key: profileKey(userId), UpdateExpression: "REMOVE reminderFor" }));
        console.error("reminder email failed:", err.name, err.message);
      }
    }
  }
  return out;
}
