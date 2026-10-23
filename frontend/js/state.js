// CloudPet shared browser helpers.
//
// The server is now the source of truth for coins, pets, inventory, quests and profile (see js/api.js).
// This file only keeps what belongs in the browser: the colour themes.

/* ---------- Themes ----------
   A theme swaps the colour variables every page uses. Which theme you own and use is saved on the server;
   the last one used is also kept here, only so the page paints in the right colours before the server answers. */

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

function applyTheme(name) {
  const root = document.documentElement;

  Object.values(THEMES).forEach(vars => Object.keys(vars).forEach(k => root.style.removeProperty(k)));

  const vars = THEMES[name] || {};
  Object.keys(vars).forEach(k => root.style.setProperty(k, vars[k]));

  try { localStorage.setItem("cloudpet_theme_cache", name || "Default"); } catch (e) { /* storage blocked: fine */ }
}

// Paint with the last known theme straight away (no flash of purple before the server answers)
try { applyTheme(localStorage.getItem("cloudpet_theme_cache") || "Default"); } catch (e) { /* ignore */ }

/* ---------- Read-only mirror (for pages not moved to the server yet, like coins.html) ----------
   api.js copies the server's coin balance into localStorage every time a page loads it, so older code that
   calls getCoins() still shows the right number. Don't WRITE coins here: the server ignores it. */

function getCoins() {
  const saved = Number(localStorage.getItem("cloudpet_coins"));
  return Number.isFinite(saved) ? saved : 250;
}
