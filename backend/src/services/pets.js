import { PutCommand, QueryCommand, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE } from "../db.js";
import { PET_CATALOG, MAX_PETS } from "../catalog.js";
import { AppError } from "../errors.js";
import { getOrCreateProfile } from "./users.js";
import { newPetItem, toPetDto, userKey } from "../items.js";

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
