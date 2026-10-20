// CloudPet shared user state

const DEFAULT_COINS = 250;
const MAX_PETS = 6;

/* ---------- Coins ---------- */

function getCoins() {
  const savedCoins = localStorage.getItem("cloudpet_coins");

  if (savedCoins === null || isNaN(Number(savedCoins))) {
    localStorage.setItem("cloudpet_coins", DEFAULT_COINS);
    return DEFAULT_COINS;
  }

  return Number(savedCoins);
}

function setCoins(amount) {
  localStorage.setItem("cloudpet_coins", amount);
}

function addCoins(amount) {
  setCoins(getCoins() + amount);
}

function spendCoins(amount) {
  const currentCoins = getCoins();

  if (currentCoins < amount) {
    return false;
  }

  setCoins(currentCoins - amount);
  return true;
}

/* ---------- Inventory (food, accessories, themes) ---------- */

function getInventory() {
  const savedInventory = localStorage.getItem("cloudpet_inventory");

  if (savedInventory === null) {
    return [];
  }

  return JSON.parse(savedInventory);
}

function addToInventory(item) {
  const inventory = getInventory();
  inventory.push(item);
  localStorage.setItem("cloudpet_inventory", JSON.stringify(inventory));
}

/* ---------- Pets ----------
   There are six kinds of pet. Luna is the free starter; every other pet is bought in the shop.
   The same kind can be bought more than once, but you can own at most MAX_PETS pets in total.
   The names, emoji and prices below are the only place they are defined for home + shop.
   (Stats and animations live in the pet page.) */

const PET_CATALOG = {
  1: { name: "Luna",     species: "Cat",             emoji: "🐱",   price: 100 },
  2: { name: "Shadow",   species: "German Shepherd", emoji: "🐕",   price: 200 },
  3: { name: "Clover",   species: "Holland Lop",     emoji: "🐰",   price: 150 },
  4: { name: "Ember",    species: "Orange Cat",      emoji: "🐱",   price: 100 },
  5: { name: "Misty",    species: "Grey Cat",        emoji: "🐱",   price: 120 },
  6: { name: "Midnight", species: "Black Cat",       emoji: "🐈‍⬛", price: 140 }
};

const STARTER_PET = { uid: "1", type: 1, name: "Luna" };

// Every owned pet is { uid, type, name }. uid is what the pet page uses (?pet=uid) and what its saved stats hang off.
function getOwnedPets() {
  let pets = null;

  try {
    pets = JSON.parse(localStorage.getItem("cloudpet_pets"));
  } catch (e) {
    pets = null;
  }

  if (!Array.isArray(pets)) {
    pets = [{ ...STARTER_PET }];                // first visit: you start with Luna
    localStorage.setItem("cloudpet_pets", JSON.stringify(pets));
  }

  return pets.filter(p => p && PET_CATALOG[p.type]).slice(0, MAX_PETS);
}

function canAddPet() {
  return getOwnedPets().length < MAX_PETS;
}

// Buying a second Ember gives "Ember 2", and so on, so cards can be told apart.
function addPet(type) {
  if (!PET_CATALOG[type]) {
    return { ok: false, reason: "unknown" };
  }

  const pets = getOwnedPets();

  if (pets.length >= MAX_PETS) {
    return { ok: false, reason: "full" };
  }

  const sameKind = pets.filter(p => String(p.type) === String(type)).length;
  const base = PET_CATALOG[type].name;
  const pet = {
    uid: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    type: Number(type),
    name: sameKind === 0 ? base : base + " " + (sameKind + 1)
  };

  pets.push(pet);
  localStorage.setItem("cloudpet_pets", JSON.stringify(pets));
  return { ok: true, pet: pet };
}


/* ---------- Accessories ----------
   A pet can wear one accessory. While it is worn, the pet's happiness is boosted
   (the boost is only added when showing the stat, so taking it off gives back the real value).
   You can only have as many pets wearing "Pink Bow" as you own Pink Bows. */

const ACCESSORIES = {
  "Cute Hat": { icon: "🎩", happiness: 10 },
  "Pink Bow": { icon: "🎀", happiness: 8 }
};

function getEquipped() {                       // { petUid: accessoryName }
  try {
    const e = JSON.parse(localStorage.getItem("cloudpet_equipped"));
    return e && typeof e === "object" && !Array.isArray(e) ? e : {};
  } catch (err) {
    return {};
  }
}

function countOwned(name) {
  return getInventory().filter(i => i.name === name).length;
}

function countWorn(name, exceptUid) {
  const worn = getEquipped();
  return Object.keys(worn).filter(uid => worn[uid] === name && uid !== exceptUid).length;
}

function equipAccessory(uid, name) {
  if (!ACCESSORIES[name]) return { ok: false, reason: "unknown" };
  if (countOwned(name) - countWorn(name, uid) < 1) return { ok: false, reason: "none-left" };

  const worn = getEquipped();
  worn[uid] = name;                             // replaces whatever this pet was wearing
  localStorage.setItem("cloudpet_equipped", JSON.stringify(worn));
  return { ok: true };
}

function unequipAccessory(uid) {
  const worn = getEquipped();
  delete worn[uid];
  localStorage.setItem("cloudpet_equipped", JSON.stringify(worn));
}

/* ---------- Themes ----------
   A theme swaps the colour variables every page uses. Buy one in the shop, then press "Use" in your inventory. */

const THEMES = {
  "Default": {},
  "Garden Theme": {
    "--bg-deep": "#1b4332", "--bg-mid": "#2d6a4f", "--bg-light": "#95d5b2",
    "--card": "#eafaf0", "--card-soft": "#f3fcf6", "--ink": "#14392a", "--ink-soft": "#3f6b57",
    "--pink": "#ff8fab", "--purple": "#2e9e6b"
  },
  "Ocean Theme": {
    "--bg-deep": "#0b2545", "--bg-mid": "#13579b", "--bg-light": "#8ecae6",
    "--card": "#e7f3fb", "--card-soft": "#f1f8fd", "--ink": "#0d2b4a", "--ink-soft": "#46688a",
    "--pink": "#ff7aa8", "--purple": "#1d7fd1"
  },
  "Sunset Theme": {
    "--bg-deep": "#4a1033", "--bg-mid": "#c2410c", "--bg-light": "#fbbf77",
    "--card": "#fdeee0", "--card-soft": "#fff6ec", "--ink": "#4a1f10", "--ink-soft": "#8a5a44",
    "--pink": "#ff5c8a", "--purple": "#d9480f"
  }
};

function getActiveTheme() {
  const name = localStorage.getItem("cloudpet_theme");
  // Only a theme you actually own can be active
  return name && THEMES[name] && name !== "Default" && countOwned(name) > 0 ? name : "Default";
}

function setActiveTheme(name) {
  if (name !== "Default" && (!THEMES[name] || countOwned(name) < 1)) return false;
  localStorage.setItem("cloudpet_theme", name);
  applyTheme();
  return true;
}

function applyTheme() {
  const root = document.documentElement;
  const all = {};
  Object.values(THEMES).forEach(t => Object.keys(t).forEach(k => all[k] = true));
  Object.keys(all).forEach(k => root.style.removeProperty(k));    // clear the previous theme

  const vars = THEMES[getActiveTheme()];
  Object.keys(vars).forEach(k => root.style.setProperty(k, vars[k]));
}

/* ---------- Daily quests + achievements ----------
   The pet page records what you do (feed / play / clean / sleep); the Quests page shows progress and pays out coins.
   Daily progress resets when the date changes. Everything is stored under "cloudpet_quests". */

const DAILY_QUESTS = [
  { id: "feed",  icon: "🍖", title: "Feed your pets",      desc: "Feed a pet 2 times",      goal: 2, reward: 30 },
  { id: "play",  icon: "🎾", title: "Playtime",            desc: "Play with a pet 2 times", goal: 2, reward: 30 },
  { id: "clean", icon: "🧼", title: "Bath time",           desc: "Give a pet a bath",       goal: 1, reward: 20 },
  { id: "sleep", icon: "😴", title: "Tuck someone in",     desc: "Put a pet to bed",        goal: 1, reward: 20 }
];
const QUEST_BONUS = 50;                         // extra coins for claiming every daily quest

const ACHIEVEMENTS = [
  { key: "cloudpet_achievement_first_steps",   icon: "👣", title: "First Steps",   desc: "Take care of a pet for the first time" },
  { key: "cloudpet_achievement_pet_lover",     icon: "💖", title: "Pet Lover",     desc: "Own 3 pets" },
  { key: "cloudpet_achievement_super_owner",   icon: "🏡", title: "Super Owner",   desc: "Fill your home with 6 pets" },
  { key: "cloudpet_achievement_pet_haven_pro", icon: "🏆", title: "Pet Haven Pro", desc: "Claim every daily quest in one day" }
];

function todayString() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function getQuestData() {
  let data = null;

  try {
    data = JSON.parse(localStorage.getItem("cloudpet_quests"));
  } catch (e) {
    data = null;
  }

  if (!data || typeof data !== "object") data = {};
  if (data.date !== todayString()) {            // a new day: fresh daily quests, lifetime total is kept
    data = { date: todayString(), counts: {}, claimed: {}, bonus: false, total: Number(data.total) || 0 };
  }

  data.counts = data.counts || {};
  data.claimed = data.claimed || {};
  return data;
}

function saveQuestData(data) {
  localStorage.setItem("cloudpet_quests", JSON.stringify(data));
}

function questProgress(quest) {
  return Math.min(quest.goal, Number(getQuestData().counts[quest.id]) || 0);
}

function isQuestComplete(quest) {
  return questProgress(quest) >= quest.goal;
}

function isQuestClaimed(quest) {
  return !!getQuestData().claimed[quest.id];
}

// Pays out once. Returns the coins earned (0 if it can't be claimed).
function claimQuest(id) {
  const quest = DAILY_QUESTS.find(q => q.id === id);
  const data = getQuestData();

  if (!quest || data.claimed[id] || !isQuestComplete(quest)) return 0;

  data.claimed[id] = true;
  let earned = quest.reward;

  if (!data.bonus && DAILY_QUESTS.every(q => data.claimed[q.id])) {
    data.bonus = true;
    earned += QUEST_BONUS;
  }

  saveQuestData(data);
  addCoins(earned);
  checkAchievements();
  return earned;
}

// Unlocks achievements that have been earned. Safe to call as often as you like.
function checkAchievements() {
  const data = getQuestData();
  const owned = getOwnedPets().length;
  const earned = {
    cloudpet_achievement_first_steps:   (data.total || 0) >= 1,
    cloudpet_achievement_pet_lover:     owned >= 3,
    cloudpet_achievement_super_owner:   owned >= MAX_PETS,
    cloudpet_achievement_pet_haven_pro: data.bonus === true || localStorage.getItem("cloudpet_achievement_pet_haven_pro") === "true"
  };

  Object.keys(earned).forEach(key => {
    if (earned[key]) localStorage.setItem(key, "true");   // never taken back once unlocked
  });
}

function dailyQuestSummary() {                  // for the Home page card
  const claimed = DAILY_QUESTS.filter(isQuestClaimed).length;
  const done = DAILY_QUESTS.filter(isQuestComplete).length;
  return { done: done, claimed: claimed, total: DAILY_QUESTS.length };
}

applyTheme();                                                     // every page that loads state.js is themed