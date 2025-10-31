// Regenerated script.js for Idle Forge
// Cleaner structure, fixed bugs from previous version, safer state merges, no mutation during getters,
// clearer upgrade handling, proper offline earnings, autosave, export/import, achievements, prestige.
// Works with the provided index.html and styles.css.

(() => {
  // --- Constants ---
  const SAVE_KEY = "idleforge.save.v2";
  const SAVE_DEBOUNCE_MS = 800;
  const OFFLINE_CAP_SECONDS = 3600; // maximum offline credited seconds (1 hour)
  const TICK_MS = 1000; // main game loop tick interval (1s)

  // --- Templates ---
  const BUILDING_TEMPLATES = [
    { id: "cursor", name: "Worker", baseCost: 15, baseCPS: 0.1, emoji: "🪚" },
    { id: "miner", name: "Miner", baseCost: 100, baseCPS: 1, emoji: "⛏️" },
    { id: "factory", name: "Factory", baseCost: 1100, baseCPS: 8, emoji: "🏭" },
    { id: "bank", name: "Bank", baseCost: 12000, baseCPS: 47, emoji: "🏦" },
    { id: "lab", name: "Research Lab", baseCost: 130000, baseCPS: 260, emoji: "🔬" },
    { id: "foundry", name: "Foundry", baseCost: 1400000, baseCPS: 1400, emoji: "⚙️" },
  ];

  const UPGRADE_TEMPLATES = [
    // id, name, desc, cost, currency ('coins'|'prestige'), unlock (fn(state)), effect (applied in computeMultipliers)
    { id: "click1", name: "Sharper Tools", desc: "+1 per click", cost: 50, currency: "coins", unlock: () => true, effect: (m) => { m.clickAdd += 1; } },
    { id: "click2", name: "Master Hammer", desc: "x2 click power", cost: 400, currency: "coins", unlock: () => true, effect: (m) => { m.clickMul *= 2; } },
    { id: "auto1", name: "Mining Shift", desc: "Miners +50% CPS", cost: 1500, currency: "coins", unlock: (s) => (s.buildings.miner?.count || 0) >= 1, effect: (m) => { m.buildingMul["miner"] = (m.buildingMul["miner"] || 1) * 1.5; } },
    { id: "factory_boost", name: "Assembly Line", desc: "Factories +100% CPS", cost: 10000, currency: "coins", unlock: (s) => (s.buildings.factory?.count || 0) >= 1, effect: (m) => { m.buildingMul["factory"] = (m.buildingMul["factory"] || 1) * 2; } },
    { id: "global1", name: "Public Funding", desc: "All building CPS +10%", cost: 50000, currency: "coins", unlock: (s) => true, effect: (m) => { m.globalMul *= 1.1; } },
    { id: "click3", name: "Precision Strike", desc: "+10 per click", cost: 200000, currency: "coins", unlock: (s) => true, effect: (m) => { m.clickAdd += 10; } },
    { id: "eff1", name: "Efficiency Research", desc: "All building costs -5%", cost: 1000000, currency: "coins", unlock: (s) => true, effect: (m) => { m.costMul *= 0.95; } },
    { id: "multi1", name: "Prestige Core", desc: "Prestige points give +1% CPS each", cost: 5, currency: "prestige", unlock: (s) => true, effect: (m) => { m.prestigeEffect = true; } },
  ];

  const ACHIEVEMENT_TEMPLATES = [
    { id: "first_click", name: "First Click", check: (s) => s.totalCoins >= 1, rewardCoins: 5 },
    { id: "100_coins", name: "100 Coins", check: (s) => s.totalCoins >= 100, rewardCoins: 25 },
    { id: "10_buildings", name: "Manager", check: (s) => totalBuildings(s) >= 10, rewardCoins: 100 },
    { id: "1000_total", name: "Industrialist", check: (s) => s.totalCoins >= 1000, rewardCoins: 500 },
  ];

  // --- Default state ---
  const DEFAULT_STATE = {
    coins: 0,
    totalCoins: 0,
    clickPowerBase: 1,
    prestigePoints: 0,
    buildings: {}, // id -> { count }
    upgrades: {}, // id -> { bought: bool }
    achievements: {}, // id -> { got: bool }
    lastTick: Date.now(),
    version: 2
  };

  // Initialize defaults for buildings/upgrades/achievements
  BUILDING_TEMPLATES.forEach(b => DEFAULT_STATE.buildings[b.id] = { count: 0 });
  UPGRADE_TEMPLATES.forEach(u => DEFAULT_STATE.upgrades[u.id] = { bought: false });
  ACHIEVEMENT_TEMPLATES.forEach(a => DEFAULT_STATE.achievements[a.id] = { got: false });

  // --- DOM refs ---
  const $coins = document.getElementById("coins");
  const $perClick = document.getElementById("per-click");
  const $cps = document.getElementById("cps");
  const $bigButton = document.getElementById("big-button");
  const $buildingsTab = document.getElementById("buildings-tab");
  const $upgradesTab = document.getElementById("upgrades-tab");
  const $achList = document.getElementById("ach-list");
  const $prestigeBtn = document.getElementById("prestige-btn");
  const $prestigePoints = document.getElementById("prestige-points");
  const $saveStatus = document.getElementById("save-status");
  const $tabs = Array.from(document.querySelectorAll(".tab"));
  const $statsList = document.getElementById("stats-list");
  const $exportBtn = document.getElementById("export-btn");
  const $importBtn = document.getElementById("import-btn");
  const $resetBtn = document.getElementById("reset-btn");

  // --- State (load or fresh) ---
  let state = loadSave() || deepCopy(DEFAULT_STATE);

  // Ensure any missing fields from potential older saves are present
  BUILDING_TEMPLATES.forEach(b => state.buildings[b.id] = state.buildings[b.id] || { count: 0 });
  UPGRADE_TEMPLATES.forEach(u => state.upgrades[u.id] = state.upgrades[u.id] || { bought: false });
  ACHIEVEMENT_TEMPLATES.forEach(a => state.achievements[a.id] = state.achievements[a.id] || { got: false });
  state.version = state.version || 2;
  state.lastTick = state.lastTick || Date.now();

  // --- Utilities ---
  function deepCopy(obj) { return JSON.parse(JSON.stringify(obj)); }

  function format(n) {
    if (!isFinite(n)) return "0";
    const abs = Math.abs(n);
    if (abs < 1000) {
      // show up to 2 decimals, but remove trailing zeros
      return (Math.round(n * 100) / 100).toString().replace(/\.00$/, "");
    }
    const units = ["", "K", "M", "B", "T", "Qa", "Qi"];
    let idx = Math.floor(Math.log10(abs) / 3);
    idx = Math.min(idx, units.length - 1);
    const scaled = n / Math.pow(1000, idx);
    const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return scaled.toFixed(decimals) + units[idx];
  }

  function totalBuildings(s) {
    return Object.values(s.buildings).reduce((acc, b) => acc + (b.count || 0), 0);
  }

  // --- Derived multipliers and costs (computed from bought upgrades and prestige) ---
  function computeMultipliers() {
    // returns an object: { clickAdd, clickMul, globalMul, buildingMul: {id: mul}, costMul, prestigeEffect }
    const m = {
      clickAdd: 0,
      clickMul: 1,
      globalMul: 1,
      buildingMul: {}, // per building id
      costMul: 1,
      prestigeEffect: false
    };

    // base click is handled separately using state.clickPowerBase
    UPGRADE_TEMPLATES.forEach(u => {
      if (state.upgrades[u.id]?.bought) {
        try {
          u.effect(m);
        } catch (e) {
          console.warn("Upgrade effect error", u.id, e);
        }
      }
    });

    // prestige gives CPS multiplier if the prestige upgrade is bought (multi1)
    if (m.prestigeEffect) {
      const prestigeMultiplier = 1 + (state.prestigePoints * 0.01); // each point +1% CPS/click
      m.globalMul *= prestigeMultiplier;
      m.clickMul *= prestigeMultiplier;
    }

    return m;
  }

  function getBuildingCost(template, owned) {
    // growth = 1.15^owned * baseCost * costMul
    const growth = 1.15;
    const base = template.baseCost;
    const multipliers = computeMultipliers();
    const raw = base * Math.pow(growth, owned) * multipliers.costMul;
    return Math.ceil(raw);
  }

  function getBuildingCPS(templateId) {
    const template = BUILDING_TEMPLATES.find(t => t.id === templateId);
    if (!template) return 0;
    const multipliers = computeMultipliers();
    const base = template.baseCPS;
    const buildingMultiplier = multipliers.buildingMul[templateId] || 1;
    const cps = base * buildingMultiplier * multipliers.globalMul;
    return cps;
  }

  function getCPS() {
    let sum = 0;
    BUILDING_TEMPLATES.forEach(t => {
      const count = state.buildings[t.id]?.count || 0;
      if (count > 0) {
        sum += count * getBuildingCPS(t.id);
      }
    });
    return sum;
  }

  function getPerClick() {
    const multipliers = computeMultipliers();
    const base = state.clickPowerBase || 1;
    const value = (base + multipliers.clickAdd) * multipliers.clickMul;
    return value;
  }

  // --- Rendering ---
  function renderMain() {
    $coins.textContent = format(state.coins);
    $perClick.textContent = format(getPerClick());
    $cps.textContent = format(getCPS());
    $prestigePoints.textContent = format(state.prestigePoints);
  }

  function renderBuildings() {
    $buildingsTab.innerHTML = "";
    BUILDING_TEMPLATES.forEach(t => {
      const bstate = state.buildings[t.id] || { count: 0 };
      const cost = getBuildingCost(t, bstate.count || 0);
      const perUnit = getBuildingCPS(t.id);
      const el = document.createElement("div");
      el.className = "building";
      el.innerHTML = `
        <div class="emoji" style="font-size:28px">${t.emoji}</div>
        <div class="info">
          <h4>${t.name} <span class="small-badge">x${bstate.count || 0}</span></h4>
          <div class="meta">
            <div>Produces: ${format(perUnit)} CPS each</div>
            <div>Cost: ${format(cost)}</div>
          </div>
        </div>
        <div>
          <button class="buy-btn" data-id="${t.id}">Buy</button>
          <div style="margin-top:6px;font-size:12px;color:var(--muted)">Owned: ${bstate.count || 0}</div>
        </div>
      `;
      $buildingsTab.appendChild(el);
    });

    // attach listeners
    Array.from($buildingsTab.querySelectorAll(".buy-btn")).forEach(btn => {
      btn.addEventListener("click", (e) => {
        const id = btn.dataset.id;
        const amount = e.shiftKey || window.shiftKey ? 10 : 1;
        buyBuilding(id, amount);
      });
    });
  }

  function renderUpgrades() {
    $upgradesTab.innerHTML = "";
    UPGRADE_TEMPLATES.forEach(u => {
      const bought = !!state.upgrades[u.id]?.bought;
      const affordable = u.currency === "coins" ? state.coins >= u.cost : state.prestigePoints >= u.cost;
      const unlocked = u.unlock ? u.unlock(state) : true;
      const el = document.createElement("div");
      el.className = "upgrade" + (unlocked ? "" : " locked");
      el.innerHTML = `
        <div>
          <strong>${u.name}</strong>
          <div style="font-size:13px;color:var(--muted)">${u.desc}</div>
        </div>
        <div style="min-width:110px;text-align:right;">
          <div style="font-size:13px;color:var(--muted)">${u.currency === "prestige" ? `Cost: ${u.cost} ✦` : `Cost: ${format(u.cost)}`}</div>
          <button data-id="${u.id}" ${bought || !unlocked ? "disabled" : ""}>${bought ? "Bought" : (affordable ? "Buy" : "Locked")}</button>
        </div>
      `;
      $upgradesTab.appendChild(el);
    });

    Array.from($upgradesTab.querySelectorAll("button")).forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        buyUpgrade(id);
      });
    });
  }

  function renderAchievements() {
    $achList.innerHTML = "";
    ACHIEVEMENT_TEMPLATES.forEach(a => {
      const got = !!state.achievements[a.id]?.got;
      const el = document.createElement("div");
      el.className = "ach" + (got ? "" : " locked");
      el.innerHTML = `<strong>${a.name}</strong><div style="font-size:13px;color:var(--muted)">${got ? "Unlocked" : "Locked"}</div>`;
      $achList.appendChild(el);
    });
  }

  function renderStats() {
    $statsList.innerHTML = `
      <div><strong>Total Coins:</strong> ${format(state.totalCoins)}</div>
      <div><strong>Coins:</strong> ${format(state.coins)}</div>
      <div><strong>Total Buildings:</strong> ${totalBuildings(state)}</div>
      <div><strong>Prestige Points:</strong> ${format(state.prestigePoints)}</div>
      <div style="margin-top:8px;color:var(--muted)">Game Version: ${state.version}</div>
    `;
  }

  function renderAll() {
    renderMain();
    renderBuildings();
    renderUpgrades();
    renderAchievements();
    renderStats();
  }

  // --- Actions ---
  function buyBuilding(id, amount = 1) {
    const template = BUILDING_TEMPLATES.find(b => b.id === id);
    if (!template) return;
    let bought = 0;
    for (let i = 0; i < amount; i++) {
      const owned = state.buildings[id].count || 0;
      const cost = getBuildingCost(template, owned);
      if (state.coins >= cost) {
        state.coins -= cost;
        state.buildings[id].count = owned + 1;
        bought++;
      } else {
        break;
      }
    }
    if (bought > 0) {
      tickRender();
      saveDebounced();
    } else {
      // optionally indicate can't afford
      flashMessage("Not enough coins");
    }
  }

  function buyUpgrade(id) {
    const ut = UPGRADE_TEMPLATES.find(u => u.id === id);
    if (!ut) return;
    if (state.upgrades[id]?.bought) return;
    if (ut.unlock && !ut.unlock(state)) {
      flashMessage("Upgrade locked");
      return;
    }
    if (ut.currency === "coins") {
      if (state.coins < ut.cost) { flashMessage("Not enough coins"); return; }
      state.coins -= ut.cost;
      state.upgrades[id].bought = true;
    } else if (ut.currency === "prestige") {
      if (state.prestigePoints < ut.cost) { flashMessage("Not enough prestige points"); return; }
      state.prestigePoints -= ut.cost;
      state.upgrades[id].bought = true;
    }
    // no immediate mutation beyond marking bought; computeMultipliers will pick it up
    flashMessage(`Purchased: ${ut.name}`);
    tickRender();
    saveDebounced();
  }

  $bigButton.addEventListener("click", () => {
    const amount = getPerClick();
    state.coins += amount;
    state.totalCoins += amount;
    animateClick();
    tickRender();
    saveDebounced();
  });

  function animateClick() {
    $bigButton.animate([
      { transform: "scale(1)" },
      { transform: "scale(0.96)" },
      { transform: "scale(1)" }
    ], { duration: 120, easing: "ease-out" });
  }

  // Prestige: compute points from totalCoins then reset (with confirmation)
  $prestigeBtn.addEventListener("click", () => {
    const earned = Math.floor(state.totalCoins / 100000);
    if (earned <= 0) {
      alert("You need more total coins to gain prestige points. Earn more and try again.");
      return;
    }
    if (!confirm(`Prestiging will reset most progress but award ${earned} prestige points. Continue?`)) return;
    state.prestigePoints += earned;

    // preserve prestigePoints and purchased prestige-upgrades (if any), but reset everything else
    const keepPrestige = state.prestigePoints;
    const keepPrestigeUpgrades = {};
    // keep upgrades that were bought and are prestige currency or explicitly flagged? For simplicity, keep nothing except prestigePoints.
    state = deepCopy(DEFAULT_STATE);
    state.prestigePoints = keepPrestige;
    state.lastTick = Date.now();

    // Recreate default structures
    BUILDING_TEMPLATES.forEach(b => state.buildings[b.id] = { count: 0 });
    UPGRADE_TEMPLATES.forEach(u => state.upgrades[u.id] = { bought: false });
    ACHIEVEMENT_TEMPLATES.forEach(a => state.achievements[a.id] = { got: false });

    save();
    tickRender();
    flashMessage(`Prestiged: +${earned} ✦`);
  });

  $resetBtn.addEventListener("click", () => {
    if (!confirm("Completely reset your game? This cannot be undone.")) return;
    localStorage.removeItem(SAVE_KEY);
    state = deepCopy(DEFAULT_STATE);
    BUILDING_TEMPLATES.forEach(b => state.buildings[b.id] = { count: 0 });
    UPGRADE_TEMPLATES.forEach(u => state.upgrades[u.id] = { bought: false });
    ACHIEVEMENT_TEMPLATES.forEach(a => state.achievements[a.id] = { got: false });
    save();
    tickRender();
    flashMessage("Game reset");
  });

  $exportBtn.addEventListener("click", async () => {
    try {
      const data = JSON.stringify(state);
      await navigator.clipboard.writeText(data);
      alert("Game data copied to clipboard. You can paste it to save externally.");
    } catch (e) {
      alert("Could not copy to clipboard. Here is your save data:\n\n" + JSON.stringify(state));
    }
  });

  $importBtn.addEventListener("click", async () => {
    const imported = prompt("Paste your save data here:");
    if (!imported) return;
    try {
      const parsed = JSON.parse(imported);
      // basic validation
      if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid save");
      // merge safely
      state = Object.assign(deepCopy(DEFAULT_STATE), parsed);
      // ensure structures exist
      BUILDING_TEMPLATES.forEach(b => state.buildings[b.id] = state.buildings[b.id] || { count: 0 });
      UPGRADE_TEMPLATES.forEach(u => state.upgrades[u.id] = state.upgrades[u.id] || { bought: false });
      ACHIEVEMENT_TEMPLATES.forEach(a => state.achievements[a.id] = state.achievements[a.id] || { got: false });
      state.lastTick = Date.now();
      save();
      tickRender();
      alert("Imported save successfully.");
    } catch (e) {
      console.error(e);
      alert("Invalid save data.");
    }
  });

  // Tabs
  $tabs.forEach(t => t.addEventListener("click", () => {
    $tabs.forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    const tab = t.dataset.tab;
    document.querySelectorAll(".tab-content").forEach(tc => tc.classList.add("hidden"));
    if (tab === "buildings") document.getElementById("buildings-tab").classList.remove("hidden");
    if (tab === "upgrades") document.getElementById("upgrades-tab").classList.remove("hidden");
    if (tab === "stats") document.getElementById("stats-tab").classList.remove("hidden");
  }));

  // --- Game loop & offline ---
  function tick(deltaSeconds) {
    if (deltaSeconds <= 0) return;
    const cps = getCPS();
    const gained = cps * deltaSeconds;
    state.coins += gained;
    state.totalCoins += gained;
    checkAchievements();
  }

  function tickRender() {
    renderAll();
  }

  // Main loop - use setInterval and compute delta based on timestamps for offline credit
  let loopInterval = null;
  function startLoop() {
    if (loopInterval) clearInterval(loopInterval);
    loopInterval = setInterval(() => {
      const now = Date.now();
      const last = state.lastTick || now;
      let deltaSec = (now - last) / 1000;
      if (deltaSec > OFFLINE_CAP_SECONDS) deltaSec = OFFLINE_CAP_SECONDS;
      if (deltaSec > 0) {
        tick(deltaSec);
        state.lastTick = now;
        tickRender();
        saveDebounced();
      } else {
        state.lastTick = now;
      }
    }, TICK_MS);
  }

  // Handle offline earnings one-time on load (friendly message)
  function handleOfflineOnLoad() {
    const now = Date.now();
    const last = state.lastTick || now;
    let seconds = Math.floor((now - last) / 1000);
    if (seconds <= 0) return;
    const capped = Math.min(seconds, OFFLINE_CAP_SECONDS);
    const earned = getCPS() * capped;
    if (earned > 0) {
      state.coins += earned;
      state.totalCoins += earned;
      flashMessage(`Welcome back! You earned ${format(earned)} coins while away.`);
    }
    state.lastTick = now;
  }

  // --- Achievements ---
  function checkAchievements() {
    ACHIEVEMENT_TEMPLATES.forEach(a => {
      if (!state.achievements[a.id].got && a.check(state)) {
        state.achievements[a.id].got = true;
        if (a.rewardCoins) {
          state.coins += a.rewardCoins;
          state.totalCoins += a.rewardCoins;
        }
        flashMessage(`Achievement unlocked: ${a.name}`);
      }
    });
  }

  // --- Save/Load ---
  function save() {
    state.lastTick = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      $saveStatus.textContent = "Saved";
    } catch (e) {
      console.error("Save failed", e);
      $saveStatus.textContent = "Save failed";
    }
  }

  let saveTimeout = null;
  function saveDebounced() {
    $saveStatus.textContent = "Saving...";
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      save();
    }, SAVE_DEBOUNCE_MS);
  }

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (e) {
      console.error("Load failed", e);
      return null;
    }
  }

  // --- UI helpers ---
  function flashMessage(text) {
    const el = document.createElement("div");
    el.textContent = text;
    Object.assign(el.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      background: "linear-gradient(90deg,#111827,#0f1724)",
      padding: "10px 14px",
      borderRadius: "8px",
      color: "#fff",
      zIndex: 9999,
      boxShadow: "0 6px 20px rgba(0,0,0,0.6)",
      transition: "opacity 0.4s ease"
    });
    document.body.appendChild(el);
    setTimeout(() => el.style.opacity = "0", 2200);
    setTimeout(() => el.remove(), 2600);
  }

  // --- Init ---
  function init() {
    // UI initial render
    renderAll();
    handleOfflineOnLoad();
    startLoop();

    // update UI immediately
    tickRender();

    // autosave interval in case something not caught by debounced saves
    setInterval(save, 30000);

    // bind window unload to save
    window.addEventListener("beforeunload", () => save());
  }

  // Start
  init();

  // Expose some helpers to console for debugging (optional)
  window.idleforge = {
    state,
    save,
    loadSave,
    resetToDefaults: () => { localStorage.removeItem(SAVE_KEY); location.reload(); },
    templates: { BUILDING_TEMPLATES, UPGRADE_TEMPLATES, ACHIEVEMENT_TEMPLATES }
  };
})();
