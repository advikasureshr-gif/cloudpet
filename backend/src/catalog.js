// Pet catalog: the server is the only place that decides what a pet costs and how it starts out.
// (The frontend only shows this; it can't change it.)

export const MAX_PETS = 6;
export const STARTING_COINS = 250;
export const STARTER_TYPE = 1;                      // Luna: free, every new player gets her

export const PET_CATALOG = {
  1: { name: "Luna",     species: "Cat",             emoji: "🐱",   price: 100, stats: { health: 85, hunger: 72, happiness: 80, energy: 65, hygiene: 75 } },
  2: { name: "Shadow",   species: "German Shepherd", emoji: "🐕",   price: 200, stats: { health: 95, hunger: 60, happiness: 90, energy: 80, hygiene: 70 } },
  3: { name: "Clover",   species: "Holland Lop",     emoji: "🐰",   price: 150, stats: { health: 85, hunger: 70, happiness: 90, energy: 75, hygiene: 80 } },
  4: { name: "Ember",    species: "Orange Cat",      emoji: "🐱",   price: 100, stats: { health: 80, hunger: 65, happiness: 75, energy: 70, hygiene: 70 } },
  5: { name: "Misty",    species: "Grey Cat",        emoji: "🐱",   price: 120, stats: { health: 85, hunger: 70, happiness: 72, energy: 60, hygiene: 80 } },
  6: { name: "Midnight", species: "Black Cat",       emoji: "🐈‍⬛", price: 140, stats: { health: 90, hunger: 60, happiness: 70, energy: 75, hygiene: 75 } }
};

/* ---------- Shop items ---------- */

export const SHOP_ITEMS = {
  "Apple":        { category: "food",        icon: "🍎", price: 20,  description: "A fresh and healthy snack." },
  "Fish":         { category: "food",        icon: "🐟", price: 30,  description: "A tasty treat for hungry pets." },
  "Carrot":       { category: "food",        icon: "🥕", price: 15,  description: "Crunchy and nutritious." },
  "Cute Hat":     { category: "accessories", icon: "🎩", price: 50,  description: "Worn by one pet: 😊 +10 happiness.", happiness: 10 },
  "Pink Bow":     { category: "accessories", icon: "🎀", price: 40,  description: "Worn by one pet: 😊 +8 happiness.",  happiness: 8 },
  "Garden Theme": { category: "themes",      icon: "🌷", price: 100, description: "Fresh greens and soft pinks." },
  "Ocean Theme":  { category: "themes",      icon: "🌊", price: 100, description: "Deep blues and sea-glass cards." },
  "Sunset Theme": { category: "themes",      icon: "🌅", price: 100, description: "Warm orange and rose tones." }
};

export const FOODS = {
  Apple:  { hunger: 15, happiness: 3 },
  Fish:   { hunger: 20, happiness: 5 },
  Carrot: { hunger: 18, happiness: 4 }
};

// What each action does to a pet's stats (values are added, then kept between 0 and 100)
export const EFFECTS = {
  play:  { happiness: 10, energy: -10, hunger: -5 },
  sleep: { energy: 20, hunger: -5 },
  clean: { hygiene: 15, happiness: 3 }
};

export const THEME_NAMES = ["Default", "Garden Theme", "Ocean Theme", "Sunset Theme"];
export const AVATARS = ["👩🏻", "👨🏻", "🐱", "🐈‍⬛", "🐶", "🐕", "🐰", "🌸"];

/* ---------- Quests & achievements ---------- */

export const DAILY_QUESTS = [
  { id: "feed",  icon: "🍖", title: "Feed your pets",  desc: "Feed a pet 2 times",      goal: 2, reward: 30 },
  { id: "play",  icon: "🎾", title: "Playtime",        desc: "Play with a pet 2 times", goal: 2, reward: 30 },
  { id: "clean", icon: "🧼", title: "Bath time",       desc: "Give a pet a bath",       goal: 1, reward: 20 },
  { id: "sleep", icon: "😴", title: "Tuck someone in", desc: "Put a pet to bed",        goal: 1, reward: 20 }
];
export const QUEST_BONUS = 50;

export const ACHIEVEMENTS = [
  { id: "first_steps",   icon: "👣", title: "First Steps",   desc: "Take care of a pet for the first time" },
  { id: "pet_lover",     icon: "💖", title: "Pet Lover",     desc: "Own 3 pets" },
  { id: "super_owner",   icon: "🏡", title: "Super Owner",   desc: "Fill your home with 6 pets" },
  { id: "pet_haven_pro", icon: "🏆", title: "Pet Haven Pro", desc: "Claim every daily quest in one day" }
];
