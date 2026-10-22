import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE } from "../db.js";
import { REMINDER_BOOST, REMINDER_VALID_HOURS } from "../catalog.js";
import { AppError } from "../errors.js";
import { getOrCreateProfile } from "./users.js";
import { listPets, updatePet } from "./pets.js";
import { toPetDto, userKey } from "../items.js";

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
