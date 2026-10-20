import { randomUUID } from "node:crypto";
import { PET_CATALOG } from "./catalog.js";

// How rows are keyed and shaped in the table. Kept in one place so every service agrees.

export const userKey = userId => `USER#${userId}`;

export function newPetItem(userId, type, name) {
  const now = new Date().toISOString();
  return {
    pk: userKey(userId),
    sk: "PET#" + randomUUID().slice(0, 8),
    userId,
    type: Number(type),
    name,
    stats: { ...PET_CATALOG[type].stats },
    equipped: null,
    createdAt: now,
    lastInteraction: now                       // used to work out how much time passed while you were away
  };
}

export function toPetDto(item) {
  return {
    uid: item.sk.replace("PET#", ""),
    type: item.type,
    name: item.name,
    stats: item.stats,
    equipped: item.equipped || null,
    createdAt: item.createdAt,
    lastInteraction: item.lastInteraction
  };
}
