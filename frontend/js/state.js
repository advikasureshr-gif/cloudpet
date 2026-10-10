// CloudPet shared user state

const DEFAULT_COINS = 250;


// Get current coin balance
function getCoins() {
  const savedCoins = localStorage.getItem("cloudpet_coins");

  if (savedCoins === null) {
    localStorage.setItem("cloudpet_coins", DEFAULT_COINS);
    return DEFAULT_COINS;
  }

  return Number(savedCoins);
}


// Update coin balance
function setCoins(amount) {
  localStorage.setItem("cloudpet_coins", amount);
}


// Add coins
function addCoins(amount) {
  const currentCoins = getCoins();
  setCoins(currentCoins + amount);
}


// Spend coins
function spendCoins(amount) {
  const currentCoins = getCoins();

  if (currentCoins < amount) {
    return false;
  }

  setCoins(currentCoins - amount);
  return true;
}
// Get user's inventory
function getInventory() {
  const savedInventory = localStorage.getItem("cloudpet_inventory");

  if (savedInventory === null) {
    return [];
  }

  return JSON.parse(savedInventory);
}


// Add an item to inventory
function addToInventory(item) {
  const inventory = getInventory();

  inventory.push(item);

  localStorage.setItem(
    "cloudpet_inventory",
    JSON.stringify(inventory)
  );
}
function updateNavbarAvatar() {
    const savedProfile =
        localStorage.getItem("cloudpet_profile");

    if (!savedProfile) {
        return;
    }

    const profile = JSON.parse(savedProfile);

    const avatar = profile.avatar || "👩🏻";

    document.querySelectorAll(".avatar").forEach(element => {
        element.textContent = avatar;
    });
}

document.addEventListener(
    "DOMContentLoaded",
    updateNavbarAvatar
);