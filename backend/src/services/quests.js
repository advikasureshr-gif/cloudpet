import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";
import { db, TABLE } from "../db.js";
import { DAILY_QUESTS, QUEST_BONUS, ACHIEVEMENTS, MAX_PETS, petGroup } from "../catalog.js";
import { AppError } from "../errors.js";
import { getOrCreateProfile } from "./users.js";
import { questKey, userKey } from "../items.js";

const profileKey = userId => ({ pk: userKey(userId), sk: "PROFILE" });

/* One row per player per day (QUEST#2026-10-20). Counters and claim flags are plain top-level
   attributes (c_feed, claimed_feed, ...) so DynamoDB can add to them atomically. */

// Called after every feed / play / clean / sleep.
export async function recordAction(userId, kind, day, petUid, petType) {
  const now = new Date();
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: userKey(userId), sk: questKey(day) },
    UpdateExpression: `ADD c_${kind} :one SET #ttl = :ttl`,     // "ttl" is a reserved word in DynamoDB, so it goes through a name placeholder
    ExpressionAttributeNames: { "#ttl": "ttl" },
    ExpressionAttributeValues: { ":one": 1, ":ttl": Math.floor(now.getTime() / 1000) + 30 * 86400 }
  }));

  const group = petGroup(petType);                    // "cat" / "dog" / "rabbit": feeds the pet discoveries
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: profileKey(userId),
    UpdateExpression: "ADD totalActions :one SET ach_first_steps = :t" + (group ? `, disc_${group} = :t` : ""),
    ExpressionAttributeValues: { ":one": 1, ":t": true }
  }));

  // Interaction log: the Random Forest learns from this later (Day 5). Expires after 90 days.
  await db.send(new PutCommand({
    TableName: TABLE,
    Item: {
      pk: userKey(userId),
      sk: `EVENT#${now.toISOString()}#${randomUUID().slice(0, 4)}`,
      kind, petUid,
      hour: now.getUTCHours(), weekday: now.getUTCDay(),
      ttl: Math.floor(now.getTime() / 1000) + 90 * 86400
    }
  }));
}

async function getRow(userId, day) {
  const res = await db.send(new GetCommand({ TableName: TABLE, Key: { pk: userKey(userId), sk: questKey(day) } }));
  return res.Item || {};
}

export async function syncAchievements(userId) {
  const p = await getOrCreateProfile(userId);
  const flags = {
    ach_first_steps: (p.totalActions || 0) >= 1 || p.ach_first_steps === true,
    ach_pet_lover: p.petCount >= 3,
    ach_super_owner: p.petCount >= MAX_PETS,
    ach_pet_haven_pro: p.ach_pet_haven_pro === true
  };

  // Once unlocked, always unlocked
  const fresh = Object.keys(flags).filter(k => flags[k] && p[k] !== true);
  if (fresh.length) {
    await db.send(new UpdateCommand({
      TableName: TABLE,
      Key: profileKey(userId),
      UpdateExpression: "SET " + fresh.map((k, i) => `${k} = :v${i}`).join(", "),
      ExpressionAttributeValues: Object.fromEntries(fresh.map((k, i) => [`:v${i}`, true]))
    }));
  }
  return flags;
}

export async function getQuests(userId, day) {
  const [row, flags] = await Promise.all([getRow(userId, day), (async () => { await getOrCreateProfile(userId); return syncAchievements(userId); })()]);

  return {
    day,
    quests: DAILY_QUESTS.map(q => ({
      ...q,
      progress: Math.min(q.goal, row[`c_${q.id}`] || 0),
      claimed: row[`claimed_${q.id}`] === true
    })),
    bonus: { reward: QUEST_BONUS, claimed: row.bonusClaimed === true },
    achievements: ACHIEVEMENTS.map(a => ({ ...a, unlocked: flags["ach_" + a.id] === true }))
  };
}

export async function addCoins(userId, amount) {
  const res = await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: profileKey(userId),
    UpdateExpression: "ADD coins :n",
    ExpressionAttributeValues: { ":n": amount },
    ReturnValues: "ALL_NEW"
  }));
  return res.Attributes.coins;
}

// Pays out a finished quest once. Claiming twice (or two clicks at once) pays only once.
export async function claimQuest(userId, questId, day) {
  const quest = DAILY_QUESTS.find(q => q.id === questId);
  if (!quest) throw new AppError(404, "unknown-quest", "No such quest.");

  await getOrCreateProfile(userId);

  try {
    await db.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: userKey(userId), sk: questKey(day) },
      ConditionExpression: `c_${questId} >= :goal AND attribute_not_exists(claimed_${questId})`,
      UpdateExpression: `SET claimed_${questId} = :t`,
      ExpressionAttributeValues: { ":goal": quest.goal, ":t": true }
    }));
  } catch (err) {
    if (err.name !== "ConditionalCheckFailedException") throw err;
    const row = await getRow(userId, day);
    if (row[`claimed_${questId}`]) throw new AppError(409, "already-claimed", "You already claimed that quest.");
    throw new AppError(409, "not-complete", "Finish the quest first.");
  }

  let earned = quest.reward;
  let coins = await addCoins(userId, quest.reward);

  // Last quest of the day? Pay the bonus, once.
  const row = await getRow(userId, day);
  if (DAILY_QUESTS.every(q => row[`claimed_${q.id}`] === true)) {
    try {
      await db.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: userKey(userId), sk: questKey(day) },
        ConditionExpression: "attribute_not_exists(bonusClaimed)",
        UpdateExpression: "SET bonusClaimed = :t",
        ExpressionAttributeValues: { ":t": true }
      }));
      earned += QUEST_BONUS;
      coins = await addCoins(userId, QUEST_BONUS);
      await db.send(new UpdateCommand({
        TableName: TABLE, Key: profileKey(userId),
        UpdateExpression: "SET ach_pet_haven_pro = :t", ExpressionAttributeValues: { ":t": true }
      }));
    } catch (err) {
      if (err.name !== "ConditionalCheckFailedException") throw err;
    }
  }

  return { earned, coins };
}
