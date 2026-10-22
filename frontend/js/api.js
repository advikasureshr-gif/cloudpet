/* Talks to the Cloudpet server. Every page that needs coins, pets, inventory, quests or the profile uses this.

   Local development : http://localhost:3000/api  (npm start in the backend folder)
   AWS demo          : set the address once in the browser console:
                         localStorage.setItem("cloudpet_api_base", "https://xxxx.execute-api.us-east-1.amazonaws.com/api")
                       (and remove it again to go back to local:  localStorage.removeItem("cloudpet_api_base"))
   Who you are (dev login for now): localStorage "cloudpet_user", default "lexie". Cognito replaces this on AWS. */

(function () {
  const API_BASE = (window.CLOUDPET_API_BASE || localStorage.getItem("cloudpet_api_base") || "http://localhost:3000/api").replace(/\/$/, "");
  let USER = localStorage.getItem("cloudpet_user") || "lexie";

  class ApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details || {};
    }
  }

  async function request(method, path, body) {
    let res;

    try {
      res = await fetch(API_BASE + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer dev:" + USER,
          "X-Utc-Offset-Minutes": String(-new Date().getTimezoneOffset())     // so daily quests reset at YOUR midnight
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (err) {
      throw new ApiError(0, "network", "Can't reach the server. Is it running? (npm start in the backend folder)");
    }

    let data = null;
    try { data = await res.json(); } catch (err) { /* empty or non-JSON body */ }

    if (!res.ok) {
      const e = (data && data.error) || {};
      throw new ApiError(res.status, e.code || "error", e.message || "Something went wrong.", e);
    }
    return data;
  }

  let catalogPromise = null;

  const api = {
    base: API_BASE,
    get user() { return USER; },
    ApiError,

    catalog: () => (catalogPromise = catalogPromise || request("GET", "/catalog")),

    me: async () => { const me = await request("GET", "/me"); api.applyProfile(me); return me; },
    updateMe: async profile => { const me = await request("PUT", "/me", profile); api.applyProfile(me); return me; },
    setTheme: async theme => { const me = await request("PUT", "/me/theme", { theme }); api.applyProfile(me); return me; },

    pets: () => request("GET", "/pets"),
    buyPet: type => request("POST", "/shop/pets", { type }),
    action: (uid, type) => request("POST", `/pets/${encodeURIComponent(uid)}/actions`, { type }),
    feed: (uid, food) => request("POST", `/pets/${encodeURIComponent(uid)}/feed`, { food }),
    equip: (uid, accessory) => request("PUT", `/pets/${encodeURIComponent(uid)}/equipment`, { accessory }),

    inventory: () => request("GET", "/inventory"),
    buyItem: name => request("POST", "/shop/items", { name }),

    chat: (petUid, message, history) => request("POST", "/chat", { petUid, message, history }),
    prediction: () => request("GET", "/prediction"),
    weather: () => request("GET", "/weather"),
    reminderReturn: () => request("POST", "/reminder/return"),

    rewards: () => request("GET", "/rewards"),
    claimReward: id => request("POST", `/rewards/${encodeURIComponent(id)}/claim`),

    // Dev login (Cognito replaces both of these on AWS)
    setUser(name) { USER = name; try { localStorage.setItem("cloudpet_user", name); } catch (e) { /* ignore */ } },
    async userExists(name) {
      let res;
      try { res = await fetch(API_BASE + "/dev/users/" + encodeURIComponent(name.toLowerCase())); }
      catch (err) { throw new ApiError(0, "network", "Can't reach the server. Is it running? (npm start in the backend folder)"); }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, (data.error || {}).code || "error", (data.error || {}).message || "Something went wrong.");
      return data.exists;
    },

    quests: () => request("GET", "/quests"),
    claim: id => request("POST", `/quests/${encodeURIComponent(id)}/claim`),

    // Updates what every page's navbar shows: coins, avatar and the colour theme. Call it with the profile from /me.
    applyProfile(me) {
      try { localStorage.setItem("cloudpet_coins", me.coins); } catch (e) { /* ignore */ }

      ["navCoins", "coinDisplay"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = "🪙 " + me.coins;
      });
      document.querySelectorAll(".nav-right .avatar").forEach(el => { el.textContent = me.avatar || "🐾"; });

      if (typeof applyTheme === "function") applyTheme(me.theme || "Default");
    },

    // A friendly message at the top of the page (used for "welcome back" and similar)
    toast(message) {
      let bar = document.getElementById("apiToast");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "apiToast";
        bar.setAttribute("role", "status");
        bar.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;max-width:min(560px,92vw);" +
          "background:#fff;color:#3a1a5c;padding:12px 18px;border-radius:14px;font:700 0.92rem system-ui,sans-serif;" +
          "box-shadow:0 8px 24px rgba(0,0,0,.3);text-align:center;";
        document.body.appendChild(bar);
      }
      bar.textContent = message;
      clearTimeout(api.toast.timer);
      api.toast.timer = setTimeout(() => bar.remove(), 5000);
    },

    // Shows a red banner at the top of the page (used when the server can't be reached, or says no).
    showError(err) {
      console.error(err);
      let bar = document.getElementById("apiErrorBar");

      if (!bar) {
        bar = document.createElement("div");
        bar.id = "apiErrorBar";
        bar.setAttribute("role", "alert");
        bar.style.cssText = "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;max-width:min(560px,92vw);" +
          "background:#b4234f;color:#fff;padding:12px 18px;border-radius:14px;font:700 0.9rem system-ui,sans-serif;" +
          "box-shadow:0 8px 24px rgba(0,0,0,.3);text-align:center;";
        document.body.appendChild(bar);
      }

      bar.textContent = "⚠️ " + (err && err.message ? err.message : "Something went wrong.");
      clearTimeout(api.showError.timer);
      api.showError.timer = setTimeout(() => bar.remove(), 5000);
    }
  };

  window.api = api;
})();