import { GetCommand, PutCommand, UpdateCommand, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE } from "../db.js";
import { PET_CATALOG, STARTER_TYPE, STARTING_COINS } from "../catalog.js";
import { newPetItem, userKey } from "../items.js";

function isConditionFailure(err) {
  return err && err.name === "ConditionalCheckFailedException";
}

// The player's profile row. A brand-new player gets 250 coins and Luna.
export async function getOrCreateProfile(userId) {
  const key = { pk: userKey(userId), sk: "PROFILE" };
  const existing = await db.send(new GetCommand({ TableName: TABLE, Key: key }));
  if (existing.Item) return existing.Item;

  const now = new Date().toISOString();
  const profile = {
    ...key,
    userId,
    coins: STARTING_COINS,
    petCount: 1,                              // kept next to coins so one conditional write can check both
    name: "Pet Parent",
    avatar: "👩🏻",
    theme: "Default",
    createdAt: now,
    lastVisit: now
  };

  try {
    // Only the first request creates the profile; a second one at the same moment is refused.
    await db.send(new PutCommand({ TableName: TABLE, Item: profile, ConditionExpression: "attribute_not_exists(pk)" }));
    await db.send(new PutCommand({ TableName: TABLE, Item: newPetItem(userId, STARTER_TYPE, PET_CATALOG[STARTER_TYPE].name) }));
    return profile;
  } catch (err) {
    if (!isConditionFailure(err)) throw err;
    const again = await db.send(new GetCommand({ TableName: TABLE, Key: key }));
    return again.Item;
  }
}

// Remember when the player was last here (the pet-over-time logic uses this later).
export async function touchVisit(userId) {
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: userKey(userId), sk: "PROFILE" },
    UpdateExpression: "SET lastVisit = :now",
    ExpressionAttributeValues: { ":now": new Date().toISOString() }
  }));
}

// Test helper: set the coin balance directly.
export async function setCoins(userId, coins) {
  await getOrCreateProfile(userId);
  const res = await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: userKey(userId), sk: "PROFILE" },
    UpdateExpression: "SET coins = :c",
    ExpressionAttributeValues: { ":c": coins },
    ReturnValues: "ALL_NEW"
  }));
  return res.Attributes;
}

// Test helper: delete everything the player owns, so the next request starts them fresh.
export async function deleteUser(userId) {
  const res = await db.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: { ":pk": userKey(userId) }
  }));
  const items = res.Items || [];

  for (let i = 0; i < items.length; i += 25) {
    await db.send(new BatchWriteCommand({
      RequestItems: {
        [TABLE]: items.slice(i, i + 25).map(it => ({ DeleteRequest: { Key: { pk: it.pk, sk: it.sk } } }))
      }
    }));
  }
  return items.length;
}
