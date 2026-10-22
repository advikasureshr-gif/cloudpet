import { GetCommand, PutCommand, UpdateCommand, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE } from "../db.js";
import { PET_CATALOG, STARTER_TYPE, STARTING_COINS, AVATARS, THEME_NAMES } from "../catalog.js";
import { AppError } from "../errors.js";
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
export async function touchVisit(userId, utcOffset) {
  const hasOffset = Number.isFinite(utcOffset);                 // the browser tells us its clock, so reminders use the player's own time
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: userKey(userId), sk: "PROFILE" },
    UpdateExpression: "SET lastVisit = :now" + (hasOffset ? ", utcOffset = :off" : ""),
    ExpressionAttributeValues: { ":now": new Date().toISOString(), ...(hasOffset ? { ":off": utcOffset } : {}) }
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

export async function updateProfile(userId, input) {
  await getOrCreateProfile(userId);
  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").trim();

  if (!name || name.length > 40) throw new AppError(400, "bad-name", "Name must be 1 to 40 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) throw new AppError(400, "bad-email", "That email doesn't look right.");
  if (!AVATARS.includes(input.avatar)) throw new AppError(400, "bad-avatar", "Pick one of the characters.");

  const res = await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: userKey(userId), sk: "PROFILE" },
    UpdateExpression: "SET #n = :name, email = :email, avatar = :avatar",
    ExpressionAttributeNames: { "#n": "name" },
    ExpressionAttributeValues: { ":name": name, ":email": email, ":avatar": input.avatar },
    ReturnValues: "ALL_NEW"
  }));
  return res.Attributes;
}

// You can only use a theme you own ("Default" is always allowed).
export async function setTheme(userId, theme) {
  if (!THEME_NAMES.includes(theme)) throw new AppError(400, "unknown-theme", "That theme doesn't exist.");
  await getOrCreateProfile(userId);

  if (theme !== "Default") {
    const owned = await db.send(new GetCommand({ TableName: TABLE, Key: { pk: userKey(userId), sk: `INV#${theme}` } }));
    if (!owned.Item || owned.Item.qty < 1) throw new AppError(403, "theme-not-owned", "Buy that theme in the shop first.");
  }

  const res = await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: userKey(userId), sk: "PROFILE" },
    UpdateExpression: "SET theme = :t",
    ExpressionAttributeValues: { ":t": theme },
    ReturnValues: "ALL_NEW"
  }));
  return res.Attributes;
}

// Does this player exist? (dev login only; on AWS, Cognito answers this)
export async function userExists(userId) {
  const res = await db.send(new GetCommand({ TableName: TABLE, Key: { pk: userKey(userId), sk: "PROFILE" } }));
  return Boolean(res.Item);
}

// First request of a Cognito player: copy the email and name from their login token into the profile,
// so reminder emails work without the player typing anything again. Remembered per Lambda container.
const seeded = new Set();
export async function seedFromClaims(userId, claims) {
  if (seeded.has(userId)) return;
  const profile = await getOrCreateProfile(userId);

  if (!profile.email && typeof claims.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) {
    const name = String(claims.name || claims["cognito:username"] || claims.email.split("@")[0]).slice(0, 40);
    try {
      await db.send(new UpdateCommand({
        TableName: TABLE, Key: { pk: userKey(userId), sk: "PROFILE" },
        ConditionExpression: "attribute_not_exists(email)",
        UpdateExpression: "SET email = :e, #n = :n",
        ExpressionAttributeNames: { "#n": "name" },
        ExpressionAttributeValues: { ":e": claims.email, ":n": name }
      }));
    } catch (err) {
      if (!isConditionFailure(err)) throw err;
    }
  }
  seeded.add(userId);
}
