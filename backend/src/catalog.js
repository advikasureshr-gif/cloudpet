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
  { id: "first_steps",   icon: "👣", title: "First Steps",   desc: "Take care of a pet for the first time", reward: 50 },
  { id: "pet_lover",     icon: "💖", title: "Pet Lover",     desc: "Own 3 pets",                            reward: 75 },
  { id: "super_owner",   icon: "🏡", title: "Super Owner",   desc: "Fill your home with 6 pets",            reward: 100 },
  { id: "pet_haven_pro", icon: "🏆", title: "Pet Haven Pro", desc: "Claim every daily quest in one day",    reward: 250 }
];

/* Discoveries: surprises that pay out once. "hidden" ones keep their goal secret on the page until found. */
export const DISCOVERIES = [
  { id: "rainbow",        icon: "🌈", title: "Rainbow Surprise", desc: "Discover a special surprise while exploring Pet Haven.",     reward: 30, hidden: true,  group: "hidden" },
  { id: "night_owl",      icon: "🌙", title: "Night Owl",        desc: "Visit your pet during the night to discover something special.", reward: 40, hidden: true, group: "hidden" },
  { id: "mystery_friend", icon: "✨", title: "Mystery Friend",   desc: "Interact with your pet enough times to uncover this secret.", reward: 60, hidden: true,  group: "hidden" },
  { id: "cat",            icon: "🐱", title: "Cat Discovery",    desc: "Unlock a special discovery by taking care of a cat.",        reward: 50, hidden: false, group: "pet" },
  { id: "dog",            icon: "🐶", title: "Dog Discovery",    desc: "Unlock a special discovery by taking care of a dog.",        reward: 50, hidden: false, group: "pet" },
  { id: "rabbit",         icon: "🐰", title: "Rabbit Discovery", desc: "Unlock a special discovery by taking care of a rabbit.",     reward: 50, hidden: false, group: "pet" }
];
export const RAINBOW_ACTIONS = 5;
export const MYSTERY_ACTIONS = 10;

// Which pet discovery a pet counts towards
export const petGroup = type => {
  const emoji = PET_CATALOG[type] && PET_CATALOG[type].emoji;
  return type === 2 ? "dog" : type === 3 ? "rabbit" : emoji ? "cat" : null;
};

/* ---------- Pets over time ---------- */

// Stats lost per hour while time passes (the page doesn't need to be open: the server works it out)
export const DECAY_PER_HOUR = { hunger: 4, energy: 2, hygiene: 2, happiness: 1.5 };
export const MIN_STAT = 5;                 // pets never drop below this: nobody's pet "dies" while they're away
export const MIN_HEALTH = 10;
export const MAX_AWAY_HOURS = 48;          // time beyond two days isn't counted
export const MIN_TICK_HOURS = 0.25;        // changes smaller than 15 minutes wait for the next update
export const WEATHER_HOURS = 6;            // weather only counts for this many hours of an absence (we don't know the past weather)

/* Health follows the other stats. Each "low" stat costs health every hour and a little happiness;
   when everything is fine, health slowly heals. */
export const HEALTH_RULES = {
  lowHunger: 30, lowHygiene: 30, lowEnergy: 20,
  dropPerLow: 0.8,           // health lost per hour for every low stat
  happinessPerLow: 1,        // extra happiness lost per hour for every low stat
  healPerHour: 1,            // health regained per hour when hunger, hygiene, energy and happiness are all 50 or more
  healMin: 50
};

/* How each kind of pet reacts to the weather. Numbers are change per hour of exposure.
   Cats hate rain, dogs love snow, rabbits suffer in the heat. Change them here; no page needs updating. */
export const WEATHER_INFO = {
  clear:  { label: "Sunny",  icon: "☀️",  tempC: 28 },
  cloudy: { label: "Cloudy", icon: "☁️",  tempC: 24 },
  hot:    { label: "Hot",    icon: "🥵",  tempC: 37 },
  cold:   { label: "Cold",   icon: "🥶",  tempC: 8 },
  rain:   { label: "Rainy",  icon: "🌧️", tempC: 22 },
  storm:  { label: "Stormy", icon: "⛈️", tempC: 21 },
  snow:   { label: "Snowy",  icon: "❄️",  tempC: -2 }
};

export const WEATHER_RULES = {
  cat: {
    clear:  { happiness: 0.5, health: 0.3 },
    cloudy: { health: 0.2 },
    hot:    { happiness: -1,   health: -0.5 },
    cold:   { happiness: -1,   health: -0.5 },
    rain:   { happiness: -2 },
    storm:  { happiness: -3,   health: -0.5 },
    snow:   { happiness: -1.5, health: -0.5 }
  },
  dog: {
    clear:  { happiness: 1,    health: 0.3 },
    cloudy: {},
    hot:    { happiness: -1.5, health: -1 },
    cold:   { happiness: 0.5,  health: 0.3 },
    rain:   { happiness: 0.5 },
    storm:  { happiness: -2.5, health: -0.5 },
    snow:   { happiness: 2,    health: 0.5 }
  },
  rabbit: {
    clear:  { happiness: 0.5 },
    cloudy: { happiness: 0.5,  health: 0.3 },
    hot:    { happiness: -2,   health: -1.5 },
    cold:   { happiness: -1,   health: -0.5 },
    rain:   { happiness: -1,   health: -0.5 },
    storm:  { happiness: -3,   health: -1 },
    snow:   { happiness: -1.5, health: -1 }
  }
};

export const REMINDER_BOOST = 15;          // happiness gained by every pet when you come back from the reminder email
export const REMINDER_VALID_HOURS = 24;

/* ---------- Check-in prediction, reminder emails and neglect ---------- */

export const REMINDER_LEAD_MIN = 30;        // the email goes out about this long before the predicted visit
export const NEGLECT_GRACE_HOURS = 2;       // if you haven't shown up this long after your usual time...
export const NEGLECT_PENALTY = 10;          // ...every pet loses this much happiness (once per missed visit)
