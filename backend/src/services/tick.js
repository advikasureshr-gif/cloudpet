import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE } from "../db.js";
import { updatePet } from "./pets.js";

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
