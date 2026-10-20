import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE } from "../db.js";
import { SHOP_ITEMS } from "../catalog.js";
import { AppError } from "../errors.js";
import { getOrCreateProfile } from "./users.js";
import { invKey, userKey } from "../items.js";

export async function listInventory(userId) {
  const res = await db.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
    ExpressionAttributeValues: { ":pk": userKey(userId), ":p": "INV#" }
  }));
  return (res.Items || []).filter(i => i.qty > 0).map(i => ({ name: i.name, category: i.category, icon: i.icon, qty: i.qty }));
}

export async function countOwned(userId, name) {
  const res = await db.send(new GetCommand({ TableName: TABLE, Key: { pk: userKey(userId), sk: invKey(name) } }));
  return res.Item ? res.Item.qty : 0;
}

async function addToInventory(userId, name, amount) {
  const item = SHOP_ITEMS[name];
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: userKey(userId), sk: invKey(name) },
    UpdateExpression: "SET #n = :name, category = :cat, icon = :icon ADD qty :amt",
    ExpressionAttributeNames: { "#n": "name" },
    ExpressionAttributeValues: { ":name": name, ":cat": item.category, ":icon": item.icon, ":amt": amount }
  }));
}

// Takes one away. Refuses (returns false) if there is none left, even if two requests race.
export async function consumeOne(userId, name) {
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: userKey(userId), sk: invKey(name) },
      ConditionExpression: "qty >= :one",
      UpdateExpression: "SET qty = qty - :one",
      ExpressionAttributeValues: { ":one": 1 }
    }));
    return true;
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return false;
    throw err;
  }
}

export async function giveBack(userId, name) {
  await addToInventory(userId, name, 1);
}

// Food, accessories and themes. (Pets are bought through /shop/pets.)
export async function buyItem(userId, name) {
  const item = SHOP_ITEMS[name];
  if (!item) throw new AppError(400, "unknown-item", "That item doesn't exist.");

  await getOrCreateProfile(userId);

  if (item.category === "themes" && (await countOwned(userId, name)) > 0) {
    throw new AppError(409, "already-owned", "You already own that theme.");
  }

  let coins;
  try {
    const res = await db.send(new UpdateCommand({
      TableName: TABLE,
      Key: { pk: userKey(userId), sk: "PROFILE" },
      ConditionExpression: "coins >= :price",
      UpdateExpression: "SET coins = coins - :price",
      ExpressionAttributeValues: { ":price": item.price },
      ReturnValues: "ALL_NEW"
    }));
    coins = res.Attributes.coins;
  } catch (err) {
    if (err.name !== "ConditionalCheckFailedException") throw err;
    const current = await getOrCreateProfile(userId);
    throw new AppError(402, "not-enough-coins", `You need ${item.price - current.coins} more coins.`, { needed: item.price - current.coins });
  }

  try {
    await addToInventory(userId, name, 1);
  } catch (err) {
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: { pk: userKey(userId), sk: "PROFILE" },
      UpdateExpression: "SET coins = coins + :p", ExpressionAttributeValues: { ":p": item.price }
    }));
    throw err;
  }

  return { coins, item: { name, category: item.category, icon: item.icon } };
}
