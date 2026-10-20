import { PutCommand, QueryCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE } from "../db.js";
import { PET_CATALOG, MAX_PETS, EFFECTS, FOODS, SHOP_ITEMS } from "../catalog.js";
import { AppError } from "../errors.js";
import { getOrCreateProfile } from "./users.js";
import { newPetItem, toPetDto, userKey } from "../items.js";
import { consumeOne, giveBack, countOwned } from "./inventory.js";
import { recordAction } from "./quests.js";

export async function listPets(userId) {
  const res = await db.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
    ExpressionAttributeValues: { ":pk": userKey(userId), ":prefix": "PET#" }
  }));
  return (res.Items || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getPet(userId, uid) {
  const res = await db.send(new GetCommand({ TableName: TABLE, Key: { pk: userKey(userId), sk: "PET#" + uid } }));
  return res.Item || null;
}

// A second Ember is called "Ember 2", a third "Ember 3", and so on.
function nextName(pets, type) {
  const base = PET_CATALOG[type].name;
  const same = pets.filter(p => p.type === Number(type)).length;
  return same === 0 ? base : `${base} ${same + 1}`;
}

/* Buying a pet.
   The important part is the conditional update on the profile row: DynamoDB checks
   "enough coins AND fewer than 6 pets" and takes the coins in ONE step. Two requests
   arriving at the same time can't both pass the check, so nobody can overspend or end up with 7 pets. */
export async function buyPet(userId, type) {
  const kind = PET_CATALOG[type];
  if (!kind) throw new AppError(400, "unknown-pet", "That pet doesn't exist.");

  await getOrCreateProfile(userId);

  const profileKey = { pk: userKey(userId), sk: "PROFILE" };
  let profile;

  try {
    const res = await db.send(new UpdateCommand({
      TableName: TABLE,
      Key: profileKey,
      ConditionExpression: "coins >= :price AND petCount < :max",
      UpdateExpression: "SET coins = coins - :price, petCount = petCount + :one",
      ExpressionAttributeValues: { ":price": kind.price, ":max": MAX_PETS, ":one": 1 },
      ReturnValues: "ALL_NEW"
    }));
    profile = res.Attributes;
  } catch (err) {
    if (err.name !== "ConditionalCheckFailedException") throw err;

    // Work out which rule stopped the purchase, so the page can say so.
    const current = await getOrCreateProfile(userId);
    if (current.petCount >= MAX_PETS) {
      throw new AppError(409, "home-full", `Your home is full: you can only have ${MAX_PETS} pets.`);
    }
    throw new AppError(402, "not-enough-coins", `You need ${kind.price - current.coins} more coins.`, {
      needed: kind.price - current.coins
    });
  }

  // The coins are taken. Now add the pet; if that fails, give the coins back.
  try {
    const pets = await listPets(userId);
    const item = newPetItem(userId, type, nextName(pets, type));
    await db.send(new PutCommand({ TableName: TABLE, Item: item, ConditionExpression: "attribute_not_exists(sk)" }));
    return { coins: profile.coins, pet: toPetDto(item) };
  } catch (err) {
    await db.send(new UpdateCommand({
      TableName: TABLE,
      Key: profileKey,
      UpdateExpression: "SET coins = coins + :price, petCount = petCount - :one",
      ExpressionAttributeValues: { ":price": kind.price, ":one": 1 }
    }));
    throw err;
  }
}


/* ---------- Caring for a pet ---------- */

const clamp = n => Math.max(0, Math.min(100, n));

// Reads the pet, adds the effects, writes it back. If another request changed the pet in between
// (the "version" no longer matches), it reads again and retries, so no change is lost.
async function applyEffects(userId, uid, effects) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const pet = await getPet(userId, uid);
    if (!pet) throw new AppError(404, "no-such-pet", "You don't have that pet.");

    const stats = { ...pet.stats };
    for (const k of Object.keys(effects)) stats[k] = clamp((stats[k] ?? 0) + effects[k]);

    const hasVersion = typeof pet.version === "number";
    try {
      const res = await db.send(new UpdateCommand({
        TableName: TABLE,
        Key: { pk: userKey(userId), sk: "PET#" + uid },
        ConditionExpression: hasVersion ? "version = :v" : "attribute_not_exists(version)",
        UpdateExpression: "SET stats = :stats, lastInteraction = :now, version = :next",
        ExpressionAttributeValues: {
          ":stats": stats, ":now": new Date().toISOString(),
          ":next": (hasVersion ? pet.version : 0) + 1,
          ...(hasVersion ? { ":v": pet.version } : {})
        },
        ReturnValues: "ALL_NEW"
      }));
      return res.Attributes;
    } catch (err) {
      if (err.name !== "ConditionalCheckFailedException") throw err;
    }
  }
  throw new AppError(409, "busy", "That pet is busy right now. Try again.");
}

export async function doAction(userId, uid, type, day) {
  if (!EFFECTS[type]) throw new AppError(400, "unknown-action", "Unknown action.");
  const pet = await applyEffects(userId, uid, EFFECTS[type]);
  await recordAction(userId, type, day, uid);
  return toPetDto(pet);
}

export async function feedPet(userId, uid, food, day) {
  if (!FOODS[food]) throw new AppError(400, "unknown-food", "That isn't food.");
  if (!(await getPet(userId, uid))) throw new AppError(404, "no-such-pet", "You don't have that pet.");

  if (!(await consumeOne(userId, food))) {
    throw new AppError(409, "no-food", `You don't have any ${food}.`);
  }

  try {
    const pet = await applyEffects(userId, uid, FOODS[food]);
    await recordAction(userId, "feed", day, uid);
    return toPetDto(pet);
  } catch (err) {
    await giveBack(userId, food);              // the pet wasn't fed, so the food isn't used up
    throw err;
  }
}

// An accessory can be worn by one pet at a time, and you can only wear as many as you own.
export async function equipAccessory(userId, uid, accessory) {
  const pet = await getPet(userId, uid);
  if (!pet) throw new AppError(404, "no-such-pet", "You don't have that pet.");

  if (accessory !== null) {
    const item = SHOP_ITEMS[accessory];
    if (!item || item.category !== "accessories") throw new AppError(400, "unknown-accessory", "That isn't an accessory.");

    const owned = await countOwned(userId, accessory);
    const wornByOthers = (await listPets(userId)).filter(p => p.equipped === accessory && p.sk !== pet.sk).length;
    if (owned - wornByOthers < 1) {
      throw new AppError(409, "none-left", `All your ${accessory} items are already being worn.`);
    }
  }

  const res = await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { pk: userKey(userId), sk: "PET#" + uid },
    UpdateExpression: "SET equipped = :a",
    ExpressionAttributeValues: { ":a": accessory },
    ReturnValues: "ALL_NEW"
  }));
  return toPetDto(res.Attributes);
}
