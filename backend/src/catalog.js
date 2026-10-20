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
