import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { db, TABLE } from "../db.js";
import { ACHIEVEMENTS, DISCOVERIES, RAINBOW_ACTIONS, MYSTERY_ACTIONS } from "../catalog.js";
import { AppError } from "../errors.js";
import { getOrCreateProfile } from "./users.js";
import { syncAchievements, addCoins } from "./quests.js";
import { userKey } from "../items.js";

/* Achievements and discoveries pay coins once each.
   "Unlocked" is worked out here from the player's history; "claimed" is a flag (rwd_<id>) on the profile row,
   set with a conditional write so a double click can't pay twice. */

const profileKey = userId => ({ pk: userKey(userId), sk: "PROFILE" });

// Night is 8pm to 5am on the player's own clock
function isNight(now, utcOffset) {
  const hour = new Date(now.getTime() + utcOffset * 60000).getUTCHours();
  return hour >= 20 || hour < 5;
}

async function readProfile(userId) {
  const res = await db.send(new GetCommand({ TableName: TABLE, Key: profileKey(userId), ConsistentRead: true }));
  return res.Item;
}

export async function getRewards(userId, utcOffset = 0, now = new Date()) {
  await getOrCreateProfile(userId);
  await syncAchievements(userId);
  let p = await readProfile(userId);

  // Seeing your pet at night counts, even if you never claim: remember it
  if (isNight(now, utcOffset) && p.disc_night_owl !== true) {
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: profileKey(userId),
      UpdateExpression: "SET disc_night_owl = :t", ExpressionAttributeValues: { ":t": true }
    }));
    p = { ...p, disc_night_owl: true };
  }

  const actions = p.totalActions || 0;
  const unlockedDiscovery = {
    rainbow: actions >= RAINBOW_ACTIONS,
    mystery_friend: actions >= MYSTERY_ACTIONS,
    night_owl: p.disc_night_owl === true,
    cat: p.disc_cat === true,
    dog: p.disc_dog === true,
    rabbit: p.disc_rabbit === true
  };

  const shape = (r, unlocked) => ({ ...r, unlocked, claimed: p["rwd_" + r.id] === true });
  return {
    actions,
    achievements: ACHIEVEMENTS.map(a => shape({ ...a, group: "achievement" }, p["ach_" + a.id] === true)),
    discoveries: DISCOVERIES.map(d => shape(d, unlockedDiscovery[d.id]))
  };
}

export async function claimReward(userId, id, utcOffset = 0) {
  const state = await getRewards(userId, utcOffset);
  const reward = [...state.achievements, ...state.discoveries].find(r => r.id === id);
  if (!reward) throw new AppError(404, "unknown-reward", "No such reward.");
  if (reward.claimed) throw new AppError(409, "already-claimed", "You already claimed that one.");
  if (!reward.unlocked) throw new AppError(409, "locked", "That one isn't unlocked yet.");

  try {
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: profileKey(userId),
      ConditionExpression: `attribute_not_exists(rwd_${id})`,
      UpdateExpression: `SET rwd_${id} = :t`,
      ExpressionAttributeValues: { ":t": true }
    }));
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") throw new AppError(409, "already-claimed", "You already claimed that one.");
    throw err;
  }

  const coins = await addCoins(userId, reward.reward);
  return { earned: reward.reward, coins };
}
