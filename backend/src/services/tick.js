import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE } from "../db.js";
import { updatePet } from "./pets.js";
import { runReminderCycle } from "./reminders.js";

/* The scheduled update: every pet of every player gets the time that passed applied, whether or not
   anyone is online. Locally a timer calls this; on AWS an EventBridge Scheduler rule invokes a Lambda that calls it. */
export async function tickAllPets(now = new Date()) {
  let key, seen = 0, updated = 0;

  do {
    const res = await db.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: "begins_with(sk, :p)",
      ExpressionAttributeValues: { ":p": "PET#" },
      ExclusiveStartKey: key
    }));
    for (const pet of res.Items || []) {
      seen++;
      const before = pet.version;
      const after = await updatePet(pet.userId, pet.sk.replace("PET#", ""), { interaction: false, now });
      if (after.version !== before) updated++;
    }
    key = res.LastEvaluatedKey;
  } while (key);

  return { pets: seen, updated };
}

// Every player: predict their next visit, send reminders, notice neglect
export async function tickAllUsers(now = new Date()) {
  let key, players = 0, reminded = 0, neglected = 0;
  do {
    const res = await db.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: "sk = :p",
      ExpressionAttributeValues: { ":p": "PROFILE" },
      ExclusiveStartKey: key
    }));
    for (const profile of res.Items || []) {
      players++;
      try {
        const r = await runReminderCycle(profile, now);
        if (r.reminded) reminded++;
        if (r.neglected) neglected++;
      } catch (err) {
        console.error("reminder cycle failed for", profile.userId, err.message);
      }
    }
    key = res.LastEvaluatedKey;
  } while (key);
  return { players, reminded, neglected };
}

// What the scheduler runs
export async function tickEverything(now = new Date()) {
  const pets = await tickAllPets(now);
  const users = await tickAllUsers(now);
  return { ...pets, ...users };
}
