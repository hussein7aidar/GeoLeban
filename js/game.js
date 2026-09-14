/**
 * GeoLeban Challenge - game, authentication UI and leaderboard.
 *
 * Depends on: constants.js, translations.js, utils.js, firebase-config.js,
 * backend.js and app.js (map + featuresByName + helpers).
 */
(function () {
  "use strict";

  /* ------------------------------- Helpers -------------------------------- */

  const $ = (id) => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  function t(key) {
    const lang = typeof currentLang !== "undefined" ? currentLang : "en";
    const g = TRANSLATIONS.game || {};
    return (g[lang] && g[lang][key]) || (g.en && g.en[key]) || key;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatTime(ms) {
    const total = Math.max(0, Math.round((ms || 0) / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + String(s).padStart(2, "0");
  }

  function displayName(raw) {
    return typeof getTranslatedName === "function"
      ? getTranslatedName(raw, currentLang)
      : raw;
  }

  function modeLabel(mode) {
    if (mode === "caza") return t("cazaOption");
    if (mode === "city") return t("cityOption");
    return t("govOption");
  }
  function inputLabel(input) {
    return input === "click" ? t("clickShort") : t("typeShort");
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  // Guarantees a place is only asked once per round. Two distinct features can
  // share the same displayed (localized) name, which otherwise looks like the
  // same question being repeated.
  function dedupeQuestions(list) {
    const seen = new Set();
    const out = [];
    (list || []).forEach((name) => {
      const key = displayName(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(name);
    });
    return out;
  }

  function normalizeAnswer(str) {
    return String(str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u064b-\u065f\u0670]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  const OVERLAYS = [
    "auth-overlay",
    "menu-overlay",
    "setup-overlay",
    "results-overlay",
    "stats-overlay",
    "leaderboard-overlay",
    "account-overlay",
    "admin-overlay",
  ];

  // Curated, recognizable places used by the "Famous Cities/Villages" sub-mode.
  // Names must match the shapeName values in cities.js exactly.
  const FAMOUS_CITIES = [
    "Beirut Central District",
    "Trablous Et-Tell",
    "Trablous et Tabbaneh",
    "Saida El-Qadimeh",
    "Zahleh El-Midane",
    "Nabatieh Et-Tahta",
    "Jounieh Sarba",
    "Zouk Mkayel",
    "Baalbek",
    "Batroun",
    "Zgharta",
    "Jezzine",
    "Hermel",
    "Sour",
    "Bcharreh",
    "Aaley",
    "Antelias",
    "Dbayeh",
    "Bourj Hammoud",
    "Baabda",
    "Chiyah",
    "Ghazir",
    "Faraya",
    "Bikfaya",
    "Broummana El-Matn",
    "Damour",
    "Jiyeh",
    "Aamchit",
    "Joun",
    "Ehden",
    "Hasroun",
    "Douma",
    "Tannourine Et-Tahta",
    "Aanjar (Haouch Moussa)",
    "Machghara",
    "Naameh",
    "Barja",
    "Bsous",
    "Laqlouq",
    "Aaqoura",
    "Amioun",
    "Qana",
    "Arnoun",
    "Chtaura",
    "Bchamoun",
    "Bteghrine",
    "Nahr Ibrahim",
    "Jaj",
    "Ehmej",
    "Rachkida",
    "Hamat",
    "Dimane",
    "Tourza",
    "Hadchit",
    "Bqaa Kafra",
    "Miziara",
    "Kfarsghab",
    "Sarafand",
    "Aadloun",
    "Saghbine",
    "Qabb Elias",
    "Saadnayel",
    "Niha El-Chouf",
    "Bqaatouta",
    "Hardine",
    "Kousba",
    "Heri",
    "Ijdabra",
    "Afqa Jbayl",
  ];

  /* ------------------------------ Sound effects --------------------------- */

  // Tiny WebAudio synth so the game has feedback without shipping audio files.
  const Sfx = (function () {
    let ctx = null;
    let muted = false;

    function ensure() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!ctx) ctx = new AC();
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    }

    function beep(freq, start, dur, type, vol) {
      const ac = ensure();
      if (!ac) return;
      const t0 = ac.currentTime + start;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.1, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    }

    return {
      setMuted(v) {
        muted = !!v;
      },
      isMuted() {
        return muted;
      },
      correct() {
        if (muted) return;
        beep(659, 0, 0.12, "sine", 0.11);
        beep(988, 0.09, 0.18, "sine", 0.11);
      },
      wrong() {
        if (muted) return;
        beep(233, 0, 0.16, "sawtooth", 0.07);
        beep(155, 0.09, 0.22, "sawtooth", 0.07);
      },
      reveal() {
        if (muted) return;
        beep(440, 0, 0.14, "triangle", 0.09);
        beep(330, 0.11, 0.2, "triangle", 0.09);
      },
      tick() {
        if (muted) return;
        beep(880, 0, 0.05, "square", 0.04);
      },
      complete() {
        if (muted) return;
        [523, 659, 784, 1047].forEach((f, i) =>
          beep(f, i * 0.11, 0.22, "sine", 0.11),
        );
      },
      gameover() {
        if (muted) return;
        [392, 311, 262].forEach((f, i) =>
          beep(f, i * 0.14, 0.26, "sawtooth", 0.07),
        );
      },
    };
  })();

  /* ---------------------------- Animated cursor --------------------------- */

  const cursorEl = $("game-cursor");
  const CURSOR_HALF = 22;
  let cursorFlashTimer = null;

  function setCursorActive(on) {
    if (!cursorEl) return;
    cursorEl.classList.toggle("active", !!on);
    const canvas = map.getCanvas();
    if (canvas) canvas.style.cursor = on ? "none" : "";
  }

  function moveCursor(e) {
    if (!cursorEl || !cursorEl.classList.contains("active")) return;
    const x = e.clientX - CURSOR_HALF;
    const y = e.clientY - CURSOR_HALF;
    cursorEl.style.transform = "translate3d(" + x + "px," + y + "px,0)";
  }

  function flashCursor(kind) {
    if (!cursorEl) return;
    cursorEl.classList.remove("flash-correct", "flash-wrong");
    if (kind) cursorEl.classList.add("flash-" + kind);
    if (cursorFlashTimer) clearTimeout(cursorFlashTimer);
    cursorFlashTimer = setTimeout(
      () => cursorEl.classList.remove("flash-correct", "flash-wrong"),
      450,
    );
  }

  // Show the reticle only when the player is clicking/picking on the map; all
  // other modes keep the normal arrow cursor.
  function updateGameCursor() {
    const active =
      (state.active && state.input === "click") || !!selecting;
    setCursorActive(active);
  }

  /* -------------------------------- State --------------------------------- */

  const state = {
    active: false,
    mode: "gov",
    input: "click",
    limitMs: 0,
    questions: [],
    index: 0,
    triesLeft: 3,
    maxTries: 3,
    solved: 0,
    wrongCount: 0,
    points: 0,
    startTime: 0,
    elapsedMs: 0,
    pausedMs: 0,
    lastTickSec: -1,
    timerId: null,
    locked: false,
    inputLockUntil: 0,
    current: null,
    user: null,
    lastResult: null,
    custom: false,
  };

  let authMode = "login";
  let lastShownPoints = -1;
  let adminLoginPending = false;
  let setupMode = "gov";
  let setupInput = "click";
  let setupArea = "district"; // city mode only: "district" | "pick"
  let setupDistrict = "";
  let setupCount = 0;
  let setupCountTouched = false;
  let setupMinutes = 0;
  let setupUseCustom = false;

  // Pick-on-map selection phase
  let selecting = false;
  let selectedCities = {};
  let paintDown = false;
  let pendingMinutes = 0;

  let lbTab = "my";
  let lbCombo = "gov|click";
  let globalCache = null;
  let globalPromise = null;
  let myCache = null;
  let myPromise = null;

  /* ------------------------------ Overlay UI ------------------------------ */

  function showOverlay(id) {
    OVERLAYS.forEach((o) => {
      const el = $(o);
      if (el) el.classList.toggle("active", o === id);
    });
    // Dismiss the boot screen once we know which overlay to show.
    const boot = $("boot-overlay");
    if (boot) boot.classList.remove("active");
    document.body.classList.add("overlay-open");
  }

  function hideOverlays() {
    OVERLAYS.forEach((o) => {
      const el = $(o);
      if (el) el.classList.remove("active");
    });
    document.body.classList.remove("overlay-open");
  }

  /* ------------------------- Confirmation modal --------------------------- */

  let confirmResolve = null;
  let confirmPauseStart = 0;

  function anchorFromEvent(e) {
    if (!e || typeof e.clientX !== "number" || typeof e.clientY !== "number") {
      return null;
    }
    return { x: e.clientX, y: e.clientY };
  }

  // Places the confirmation panel next to the control the user pressed instead
  // of dead-centre, then clamps it inside the viewport.
  function positionConfirm(anchor) {
    const overlay = $("confirm-overlay");
    const panel = overlay && overlay.querySelector(".confirm-panel");
    if (!panel) return;
    if (!anchor) {
      panel.classList.remove("anchored");
      panel.style.left = "";
      panel.style.top = "";
      return;
    }
    panel.classList.add("anchored");
    const pad = 12;
    const rect = panel.getBoundingClientRect();
    let left = anchor.x + 14;
    let top = anchor.y + 14;
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, anchor.x - rect.width - 14);
    }
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, anchor.y - rect.height - 14);
    }
    panel.style.left = left + "px";
    panel.style.top = top + "px";
  }

  function showConfirm(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      confirmResolve = resolve;
      $("confirm-title").textContent = opts.title || "";
      $("confirm-message").textContent = opts.message || "";
      $("confirm-ok").textContent = opts.confirmLabel || t("confirmBtn");
      const cancel = $("confirm-cancel");
      if (opts.cancel === false) {
        cancel.style.display = "none";
      } else {
        cancel.style.display = "";
        cancel.textContent = opts.cancelLabel || t("cancel");
      }
      $("confirm-overlay").classList.add("active");
      positionConfirm(opts.anchor);
      // Freeze the round clock while a confirmation is open.
      if (state.active) confirmPauseStart = performance.now();
    });
  }

  function closeConfirm(result) {
    $("confirm-overlay").classList.remove("active");
    if (confirmPauseStart) {
      state.pausedMs += performance.now() - confirmPauseStart;
      confirmPauseStart = 0;
    }
    const resolve = confirmResolve;
    confirmResolve = null;
    if (resolve) resolve(result);
  }

  window.showConfirm = showConfirm;
  window.showAlert = function (title, message) {
    return showConfirm({ title: title, message: message, cancel: false });
  };

  /* -------------------------------- i18n ---------------------------------- */

  function applyGameTranslations() {
    qsa("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    qsa("[data-i18n-ph]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    qsa("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    syncSoundButton();
    syncAuthModeUI();
    syncSetupUi();
    updateModeNotes();
    populateLbFilter();

    if ($("leaderboard-overlay").classList.contains("active")) renderLeaderboard();
    if ($("stats-overlay").classList.contains("active")) renderStats();
    if (state.active) {
      updateGameHud();
      refreshPromptText();
    }
  }
  window.applyGameTranslations = applyGameTranslations;

  function updateModeNotes() {
    const note = t("localNotice");
    const hidden = Backend.isRemote();
    ["auth-mode-note", "menu-mode-note"].forEach((id) => {
      const el = $(id);
      if (el) {
        el.textContent = hidden ? "" : note;
        el.style.display = hidden ? "none" : "";
      }
    });
  }

  /* --------------------------- User preferences --------------------------- */

  function applyPreferences(prefs) {
    if (!prefs) return;
    if (prefs.theme) setTheme(prefs.theme);
    if (prefs.language) setLanguage(prefs.language);
    if (typeof prefs.sound === "boolean") Sfx.setMuted(prefs.sound);
    syncSoundButton();
    // Map labels are always hidden: the base style's Arabic labels do not
    // render reliably, so the "Show map labels" toggle was removed from the
    // main menu.
  }

  function syncSoundButton() {
    const b = $("game-sound");
    if (!b) return;
    b.classList.toggle("muted", Sfx.isMuted());
    b.title = t(Sfx.isMuted() ? "soundOff" : "soundOn");
  }

  /* -------------------------------- Auth ---------------------------------- */

  function setAuthMode(mode) {
    authMode = mode;
    syncAuthModeUI();
  }

  function syncAuthModeUI() {
    const isSignup = authMode === "signup";
    $("auth-tab-login").classList.toggle("active", !isSignup);
    $("auth-tab-signup").classList.toggle("active", isSignup);
    $("auth-name-field").style.display = isSignup ? "" : "none";
    $("auth-submit").textContent = isSignup ? t("signupBtn") : t("loginBtn");
    $("auth-switch").textContent = isSignup ? t("haveAccount") : t("noAccount");
    const pwd = $("auth-password");
    if (pwd) pwd.setAttribute("autocomplete", isSignup ? "new-password" : "current-password");
  }

  function showAuthError(msg) {
    $("auth-error").textContent = msg || "";
  }

  function setAuthBusy(busy) {
    const btn = $("auth-submit");
    btn.disabled = !!busy;
    btn.classList.toggle("loading", !!busy);
  }

  function mapAuthError(err) {
    const code = err && err.code;
    if (
      code === "auth/invalid-credential" ||
      code === "auth/wrong-password" ||
      code === "auth/user-not-found" ||
      code === "auth/invalid-login-credentials"
    ) {
      return t("invalidCredentials");
    }
    if (code === "auth/email-already-in-use") return t("emailTaken");
    if (code === "auth/invalid-email") return t("emailInvalid");
    if (code === "auth/weak-password") return t("passShort");
    if (code === "app/email-blocked") return t("userBlocked");
    return t("genericError");
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const raw = $("auth-email").value.trim();
    const password = $("auth-password").value;
    const name = $("auth-name").value.trim();
    const looksLikeEmail = isValidEmail(raw);

    showAuthError("");

    if (authMode === "signup") {
      if (!name) return showAuthError(t("nameRequired"));
      if (!looksLikeEmail) return showAuthError(t("emailInvalid"));
      if (password.length < 6) return showAuthError(t("passShort"));
      setAuthBusy(true);
      try {
        await Backend.signUp(name, raw, password);
        $("auth-password").value = "";
      } catch (err) {
        console.warn("[GeoLeban] Auth error", err);
        showAuthError(mapAuthError(err));
      } finally {
        setAuthBusy(false);
      }
      return;
    }

    // A non-email "username" is treated as an admin login.
    if (!looksLikeEmail) return handleAdminLogin(raw, password);

    if (password.length < 6) return showAuthError(t("passShort"));
    setAuthBusy(true);
    try {
      await Backend.signIn(raw, password);
      $("auth-password").value = "";
    } catch (err) {
      console.warn("[GeoLeban] Auth error", err);
      showAuthError(mapAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  }

  // Admin login: "username" maps to "<username>@geoleban.app" and must exist in
  // the "admins" collection.
  async function handleAdminLogin(username, password) {
    const clean = (username || "").trim().toLowerCase();
    if (!clean) return showAuthError(t("emailInvalid"));
    adminLoginPending = true;
    setAuthBusy(true);
    try {
      await Backend.signIn(clean + "@geoleban.app", password);
      const user = Backend.getCurrentUser();
      const admin = user ? await Backend.isAdmin(user.uid) : false;
      if (!admin) {
        await Backend.signOut();
        showAuthError(t("notAdmin"));
        return;
      }
      $("auth-password").value = "";
      openAdminPortal();
    } catch (err) {
      console.warn("[GeoLeban] Admin login failed", err);
      showAuthError(mapAuthError(err));
    } finally {
      adminLoginPending = false;
      setAuthBusy(false);
    }
  }

  function onAuthChange(user) {
    const wasActive = state.active;
    state.user = user;
    updateModeNotes();

    if (user) {
      $("menu-user-name").textContent = user.name;
      $("menu-user-email").textContent = user.email || "";
      if (user.prefs && Object.keys(user.prefs).length) {
        applyPreferences(user.prefs);
      }
      if (wasActive) return; // keep playing
      // handleAdminLogin handles the destination while an admin login is running.
      if (adminLoginPending) return;
      // Go to the menu after a fresh login / signup, but don't yank the user
      // away from another panel (stats, leaderboard, setup) if they are
      // already browsing it. Admins go straight to the admin portal.
      const onAuthScreen = $("auth-overlay").classList.contains("active");
      if (onAuthScreen || !isAnyPanelOpen()) {
        Backend.isAdmin(user.uid).then((admin) => {
          if (admin) openAdminPortal();
          else showOverlay("menu-overlay");
        });
      }
    } else {
      if (wasActive) quitGame(true);
      showOverlay("auth-overlay");
    }
  }

  function isAnyPanelOpen() {
    return OVERLAYS.some((id) => $(id) && $(id).classList.contains("active"));
  }

  /* ------------------------------- Account -------------------------------- */

  function openAccount() {
    if (!state.user) return;
    $("account-name").value = state.user.name || "";
    const nameErr = $("account-name-error");
    nameErr.textContent = "";
    nameErr.className = "form-error";
    const passErr = $("account-pass-error");
    passErr.textContent = "";
    passErr.className = "form-error";
    $("account-current-pass").value = "";
    $("account-new-pass").value = "";
    showOverlay("account-overlay");
  }

  function mapAccountError(err) {
    const code = err && err.code;
    if (
      code === "auth/wrong-password" ||
      code === "auth/invalid-credential" ||
      code === "auth/invalid-login-credentials"
    ) {
      return t("wrongCurrentPassword");
    }
    if (code === "auth/weak-password") return t("passShort");
    if (code === "auth/requires-recent-login") return t("requiresRecentLogin");
    if (code === "app/name-required") return t("nameRequired");
    return t("genericError");
  }

  async function handleNameSubmit(e) {
    e.preventDefault();
    const errEl = $("account-name-error");
    const name = $("account-name").value.trim();
    errEl.className = "form-error";
    if (!name) {
      errEl.textContent = t("nameRequired");
      return;
    }
    errEl.textContent = "";
    const btn = $("account-name-save");
    btn.disabled = true;
    try {
      const user = await Backend.updateName(name);
      state.user = user;
      $("menu-user-name").textContent = user.name;
      errEl.className = "form-error ok";
      errEl.textContent = t("nameUpdated");
      invalidateCaches();
      if ($("leaderboard-overlay").classList.contains("active")) {
        renderLeaderboard();
      }
    } catch (err) {
      console.warn("[GeoLeban] Name update failed", err);
      errEl.className = "form-error";
      errEl.textContent = mapAccountError(err);
    } finally {
      btn.disabled = false;
    }
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    const errEl = $("account-pass-error");
    const cur = $("account-current-pass").value;
    const next = $("account-new-pass").value;
    errEl.className = "form-error";
    if (!cur) {
      errEl.textContent = t("currentPasswordRequired");
      return;
    }
    if (!next || next.length < 6) {
      errEl.textContent = t("passShort");
      return;
    }
    errEl.textContent = "";
    const btn = $("account-pass-save");
    btn.disabled = true;
    try {
      await Backend.updatePassword(cur, next);
      $("account-current-pass").value = "";
      $("account-new-pass").value = "";
      errEl.className = "form-error ok";
      errEl.textContent = t("passwordUpdated");
    } catch (err) {
      console.warn("[GeoLeban] Password update failed", err);
      errEl.className = "form-error";
      errEl.textContent = mapAccountError(err);
    } finally {
      btn.disabled = false;
    }
  }

  /* -------------------------------- Admin --------------------------------- */

  function setAdminMsg(id, text, ok) {
    const el = $(id);
    if (!el) return;
    el.className = "form-error" + (ok ? " ok" : "");
    el.textContent = text || "";
  }

  // The admin panel is English-only.
  function adminError(err) {
    const code = err && err.code;
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
      return "Wrong password.";
    }
    if (code === "auth/weak-password") {
      return "New password must be at least 6 characters.";
    }
    if (code === "auth/requires-recent-login") {
      return "Please log out and log in again.";
    }
    if (code === "auth/email-already-in-use") {
      return "That username is already taken.";
    }
    if (code === "auth/too-many-requests") {
      return "Too many attempts. Try again later.";
    }
    if (code === "permission-denied") {
      return "Permission denied — check the Firestore rules.";
    }
    return "Something went wrong.";
  }

  function openAdminPortal() {
    showOverlay("admin-overlay");
    $("admin-who").textContent = state.user ? state.user.email || "" : "";
    setAdminMsg("admin-users-msg", "");
    setAdminMsg("admin-block-msg", "");
    setAdminMsg("admin-cred-msg", "");
    renderAdmin();
  }

  async function renderAdmin() {
    const body = $("admin-users-body");
    if (!body) return;
    body.innerHTML = "";
    let users = [];
    let blocked = [];
    try {
      users = await Backend.adminListProfiles();
    } catch (e) {
      console.warn("[GeoLeban] Admin list failed", e);
      setAdminMsg("admin-users-msg", "Could not load users.");
      return;
    }
    try {
      blocked = await Backend.adminListBlocked();
    } catch (e) {
      blocked = [];
    }
    const blockedSet = new Set(
      (blocked || []).map((b) => (b.email || b.id || "").toLowerCase()),
    );
    users.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    users.forEach((u) => body.appendChild(adminUserRow(u, blockedSet)));
    if (!users.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.className = "empty";
      td.textContent = "No users.";
      tr.appendChild(td);
      body.appendChild(tr);
    }
    renderAdminBlocked(blocked);
  }

  function renderAdminBlocked(blocked) {
    const bbody = $("admin-blocked-body");
    if (!bbody) return;
    bbody.innerHTML = "";
    (blocked || [])
      .slice()
      .sort((a, b) => (b.blockedAt || 0) - (a.blockedAt || 0))
      .forEach((b) => {
        const email = b.email || b.id;
        const tr = document.createElement("tr");
        const emailTd = document.createElement("td");
        emailTd.textContent = email;
        tr.appendChild(emailTd);
        const atTd = document.createElement("td");
        atTd.textContent = b.blockedAt
          ? new Date(b.blockedAt).toLocaleDateString()
          : "\u2014";
        tr.appendChild(atTd);
        const actionTd = document.createElement("td");
        const btn = document.createElement("button");
        btn.className = "link-btn";
        btn.textContent = "Unblock";
        btn.addEventListener("click", () => adminUnblock(email));
        actionTd.appendChild(btn);
        tr.appendChild(actionTd);
        bbody.appendChild(tr);
      });
    if (!blocked || !blocked.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.className = "empty";
      td.textContent = "No blocked emails.";
      tr.appendChild(td);
      bbody.appendChild(tr);
    }
  }

  function adminUserRow(u, blockedSet) {
    const email = (u.email || "").toLowerCase();
    const isBlocked = blockedSet.has(email);
    const tr = document.createElement("tr");
    const cell = (text) => {
      const td = document.createElement("td");
      td.textContent = text;
      return td;
    };
    tr.appendChild(cell(u.name || "\u2014"));
    tr.appendChild(cell(email || "\u2014"));
    tr.appendChild(cell(u.uid || "\u2014"));
    tr.appendChild(
      cell(u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "\u2014"),
    );
    const status = cell(isBlocked ? "Blocked" : "Active");
    if (isBlocked) status.style.color = "#ef4444";
    tr.appendChild(status);

    const actions = document.createElement("td");
    const toggle = document.createElement("button");
    toggle.className = "link-btn";
    if (email) {
      toggle.textContent = isBlocked ? "Unblock" : "Block";
      toggle.addEventListener("click", () =>
        isBlocked ? adminUnblock(email) : adminBlock(email),
      );
    } else {
      // No email on the profile, so it can't be blocked/unblocked.
      toggle.textContent = "Block";
      toggle.disabled = true;
      toggle.title = "No email on this profile";
      toggle.style.opacity = "0.5";
      toggle.style.cursor = "default";
    }
    actions.appendChild(toggle);

    const del = document.createElement("button");
    del.className = "link-btn";
    del.style.color = "#ef4444";
    del.textContent = "Delete";
    del.addEventListener("click", () => adminDeleteUser(u.uid, email));
    actions.appendChild(del);
    tr.appendChild(actions);
    return tr;
  }

  async function adminBlock(email) {
    try {
      await Backend.adminBlockEmail(email);
      setAdminMsg("admin-block-msg", "");
      renderAdmin();
    } catch (e) {
      setAdminMsg("admin-block-msg", "Enter a valid email.");
    }
  }

  async function adminUnblock(email) {
    try {
      await Backend.adminUnblockEmail(email);
      renderAdmin();
    } catch (e) {
      setAdminMsg("admin-users-msg", "Something went wrong.");
    }
  }

  async function adminDeleteUser(uid, email) {
    const ok = await showConfirm({
      title: "Delete user",
      message:
        "Delete " +
        (email || uid) +
        " (profile + results) and block the email?",
    });
    if (!ok) return;
    try {
      await Backend.adminDeleteUser(uid, email);
      setAdminMsg("admin-users-msg", "");
      renderAdmin();
    } catch (e) {
      setAdminMsg("admin-users-msg", "Something went wrong.");
    }
  }

  async function adminSaveCreds() {
    const cur = $("admin-cred-current").value;
    const uname = $("admin-cred-username").value.trim();
    const pass = $("admin-cred-password").value;
    if (!cur) {
      return setAdminMsg("admin-cred-msg", "Enter your current password.");
    }
    if (!uname && !pass) {
      return setAdminMsg("admin-cred-msg", "Nothing to change.");
    }
    if (pass && pass.length < 6) {
      return setAdminMsg(
        "admin-cred-msg",
        "New password must be at least 6 characters.",
      );
    }
    try {
      await Backend.adminUpdateCredentials(cur, uname, pass);
      $("admin-cred-current").value = "";
      $("admin-cred-username").value = "";
      $("admin-cred-password").value = "";
      setAdminMsg("admin-cred-msg", "Credentials updated.", true);
      $("admin-who").textContent =
        (Backend.getCurrentUser() || {}).email || "";
    } catch (e) {
      setAdminMsg("admin-cred-msg", adminError(e));
    }
  }

  /* -------------------------------- Menu ---------------------------------- */

  function openMenu() {
    if (state.active) {
      quitGame(false);
      return;
    }
    showOverlay("menu-overlay");
  }

  async function handleLogout() {
    invalidateCaches();
    try {
      await Backend.signOut();
    } catch (e) {
      console.warn(e);
    }
  }

  /* ------------------------------- Setup ---------------------------------- */

  function cityDistricts() {
    const counts = {};
    if (typeof CITIES_DATA !== "undefined") {
      CITIES_DATA.features.forEach((f) => {
        const d = f.properties.district;
        if (d) counts[d] = (counts[d] || 0) + 1;
      });
    }
    return Object.keys(counts)
      .map((name) => ({ name: name, count: counts[name] }))
      .sort((a, b) =>
        displayName(a.name).localeCompare(displayName(b.name), currentLang),
      );
  }

  function districtLabel(name) {
    let key = name;
    if (typeof resolveFeatureKey === "function") {
      const resolved = resolveFeatureKey("caza", name);
      if (resolved !== "all") key = resolved;
    }
    return getTranslatedName(key, currentLang);
  }

  function districtCount(name) {
    if (typeof CITIES_DATA === "undefined" || !name) return 0;
    let n = 0;
    CITIES_DATA.features.forEach((f) => {
      if (f.properties.district === name) n++;
    });
    return n;
  }

  function populateDistrictSelect() {
    const select = $("setup-district");
    if (!select) return;
    const list = cityDistricts();
    select.innerHTML = "";
    list.forEach((d) => {
      const opt = document.createElement("option");
      opt.value = d.name;
      opt.textContent = districtLabel(d.name) + " (" + d.count + ")";
      select.appendChild(opt);
    });
    if (!setupDistrict || !list.some((d) => d.name === setupDistrict)) {
      setupDistrict = list.length ? list[0].name : "";
    }
    select.value = setupDistrict;
  }

  function setCountToDistrictDefault() {
    const input = $("setup-count");
    if (!input) return;
    const total = districtCount(setupDistrict);
    input.value = String(total);
    setupCount = total;
  }

  function updateCustomNote() {
    const note = $("setup-custom-note");
    if (!note) return;
    const total = districtCount(setupDistrict);
    const count = Number(($("setup-count") || {}).value) || total;
    // Custom rounds are private: pick-on-map, or fewer than the whole district.
    const show =
      setupMode === "city" &&
      (setupArea === "pick" ||
        (setupArea === "district" && total > 0 && count < total));
    note.style.display = show ? "block" : "none";
  }

  function syncSetupUi() {
    qsa("[data-setup-mode]").forEach((b) =>
      b.classList.toggle("active", b.getAttribute("data-setup-mode") === setupMode),
    );
    qsa("[data-setup-input]").forEach((b) =>
      b.classList.toggle("active", b.getAttribute("data-setup-input") === setupInput),
    );
    qsa("[data-setup-area]").forEach((b) =>
      b.classList.toggle("active", b.getAttribute("data-setup-area") === setupArea),
    );
    qsa("[data-setup-timer]").forEach((b) =>
      b.classList.toggle(
        "active",
        !setupUseCustom && Number(b.getAttribute("data-setup-timer")) === setupMinutes,
      ),
    );
    const custom = $("setup-custom-min");
    if (custom) custom.classList.toggle("active", setupUseCustom);

    const isCity = setupMode === "city";
    const areaGroup = $("setup-area-group");
    if (areaGroup) areaGroup.style.display = isCity ? "" : "none";
    const districtGroup = $("setup-district-group");
    if (districtGroup) {
      districtGroup.style.display =
        isCity && setupArea === "district" ? "" : "none";
    }

    if (isCity) {
      populateDistrictSelect();
      if (setupArea === "district") {
        const total = districtCount(setupDistrict);
        const input = $("setup-count");
        if (input) {
          input.max = String(total);
          const v = Number(input.value);
          if (!setupCountTouched || !v || v < 1 || v > total) {
            setCountToDistrictDefault();
          } else {
            setupCount = v;
          }
        }
        const of = $("setup-count-of");
        if (of) of.textContent = t("ofTotal") + " " + total;
      }
    }
    updateCustomNote();
  }

  function bindSetup() {
    qsa("[data-setup-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        setupMode = b.getAttribute("data-setup-mode");
        setupCountTouched = false;
        syncSetupUi();
      }),
    );
    qsa("[data-setup-input]").forEach((b) =>
      b.addEventListener("click", () => {
        setupInput = b.getAttribute("data-setup-input");
        syncSetupUi();
      }),
    );
    qsa("[data-setup-area]").forEach((b) =>
      b.addEventListener("click", () => {
        setupArea = b.getAttribute("data-setup-area");
        setupCountTouched = false;
        syncSetupUi();
      }),
    );
    qsa("[data-setup-timer]").forEach((b) =>
      b.addEventListener("click", () => {
        setupUseCustom = false;
        setupMinutes = Number(b.getAttribute("data-setup-timer"));
        if ($("setup-custom-min")) $("setup-custom-min").value = "";
        syncSetupUi();
      }),
    );
    const custom = $("setup-custom-min");
    if (custom) {
      custom.addEventListener("input", () => {
        const v = Number(custom.value);
        setupUseCustom = v > 0;
        setupMinutes = v > 0 ? Math.min(60, Math.floor(v)) : 0;
        syncSetupUi();
      });
    }
    const district = $("setup-district");
    if (district) {
      district.addEventListener("change", () => {
        setupDistrict = district.value;
        setupCountTouched = false;
        setCountToDistrictDefault();
        syncSetupUi();
      });
    }
    const count = $("setup-count");
    if (count) {
      count.addEventListener("input", () => {
        const total = districtCount(setupDistrict);
        let v = Math.floor(Number(count.value));
        if (!v || v < 1) v = 1;
        if (total && v > total) v = total;
        setupCount = v;
        setupCountTouched = true;
        updateCustomNote();
      });
    }
  }

  function getSetupMinutes() {
    if (setupUseCustom) {
      const v = Number($("setup-custom-min").value);
      return v > 0 ? Math.min(60, Math.floor(v)) : 0;
    }
    return setupMinutes;
  }

  /* ------------------------------ Gameplay -------------------------------- */

  function isCustomCity() {
    if (setupMode !== "city") return false;
    if (setupArea === "pick") return true;
    if (setupArea !== "district") return false;
    const total = districtCount(setupDistrict);
    const count = Number(($("setup-count") || {}).value) || total;
    return total > 0 && count < total;
  }

  function buildQuestions() {
    if (setupMode !== "city") {
      return shuffle(getFeatureNamesForMode(setupMode));
    }
    if (setupArea === "famous") {
      return shuffle(FAMOUS_CITIES);
    }
    if (setupArea === "pick") {
      return shuffle(Object.keys(selectedCities));
    }
    const total = districtCount(setupDistrict);
    let count = Number(($("setup-count") || {}).value) || total;
    if (count < 1) count = 1;
    if (count > total) count = total;
    const pool = [];
    CITIES_DATA.features.forEach((f) => {
      if (f.properties.district === setupDistrict) {
        pool.push(f.properties.shapeName);
      }
    });
    return shuffle(pool).slice(0, count);
  }

  function startGame() {
    const minutes = getSetupMinutes();
    if (setupMode === "city" && setupArea === "pick") {
      enterSelectionPhase(minutes);
      return;
    }
    launchGame(buildQuestions(), isCustomCity(), minutes);
  }

  function launchGame(questions, custom, minutes) {
    state.mode = setupMode;
    state.input = setupInput;
    // Both modes allow up to 3 attempts; each wrong guess costs accuracy.
    state.maxTries = 3;
    state.limitMs = minutes > 0 ? minutes * 60 * 1000 : 0;
    state.questions = dedupeQuestions(questions);
    state.custom = custom;
    state.index = 0;
    state.solved = 0;
    state.wrongCount = 0;
    state.points = 0;
    state.locked = false;
    state.active = true;
    state.current = null;

    if (typeof setMode === "function") setMode(state.mode, { skipCamera: true });
    setGameActive(true);
    // Start the round with a clean map: no leftover green/wrong marks.
    if (typeof gameClearMarks === "function") gameClearMarks();
    hideOverlays();
    $("game-hud").classList.add("active");
    $("game-feedback").textContent = "";
    $("game-answer-input").value = "";

    state.startTime = performance.now();
    state.elapsedMs = 0;
    state.pausedMs = 0;
    state.lastTickSec = -1;
    lastShownPoints = -1;
    updateGameCursor();
    startTimer();
    nextQuestion();
  }

  /* -------------------- Pick-on-map selection phase ----------------------- */

  function enterSelectionPhase(minutes) {
    selecting = true;
    selectedCities = {};
    paintDown = false;
    pendingMinutes = minutes;
    window.isSelectingOnMap = function () {
      return selecting;
    };

    if (typeof setMode === "function") setMode("city", { skipCamera: true });
    setGameActive(true);
    hideOverlays();
    setMapPainting(true);
    updateGameCursor();
    if (typeof selectItem === "function") selectItem("all", { skipCamera: true });
    $("select-error").textContent = "";
    $("select-count").textContent = "0";
    $("select-bar").classList.add("active");
    updateSelectionMarks();
  }

  function updateSelectionMarks() {
    gameClearMarks();
    Object.keys(selectedCities).forEach((name) => gameMark(name, "correct"));
    const count = $("select-count");
    if (count) count.textContent = String(Object.keys(selectedCities).length);
  }

  function paintAtPoint(point) {
    const layer = sourceIdForMode("city") + "-fill";
    if (!map.getLayer(layer)) return;
    const feats = map.queryRenderedFeatures(point, { layers: [layer] });
    if (!feats || !feats.length) return;
    let added = false;
    feats.forEach((f) => {
      const name = extractFeatureName(f.properties);
      if (name && !selectedCities[name]) {
        selectedCities[name] = true;
        added = true;
      }
    });
    if (added) updateSelectionMarks();
  }

  function finishSelection() {
    if (!selecting) return;
    const names = Object.keys(selectedCities);
    if (!names.length) {
      $("select-error").textContent = t("selectAtLeastOne");
      return;
    }
    const minutes = pendingMinutes;
    exitSelectionPhase();
    launchGame(shuffle(names), true, minutes);
  }

  function cancelSelection() {
    exitSelectionPhase();
    showOverlay("menu-overlay");
  }

  function clearSelection() {
    selectedCities = {};
    updateSelectionMarks();
    $("select-error").textContent = "";
  }

  function exitSelectionPhase() {
    selecting = false;
    paintDown = false;
    setMapPainting(false);
    $("select-bar").classList.remove("active");
    setGameActive(false);
    $("game-hud").classList.remove("active");
    window.isSelectingOnMap = null;
    updateGameCursor();
  }

  map.on("mousedown", (e) => {
    if (!selecting) return;
    if (e.originalEvent && e.originalEvent.button !== 0) return;
    paintDown = true;
    paintAtPoint(e.point);
  });
  map.on("mousemove", (e) => {
    if (selecting && paintDown) paintAtPoint(e.point);
  });
  map.on("mouseup", () => {
    paintDown = false;
  });
  map.on("touchstart", (e) => {
    if (!selecting) return;
    paintDown = true;
    paintAtPoint(e.point);
  });
  map.on("touchmove", (e) => {
    if (selecting && paintDown) paintAtPoint(e.point);
  });
  map.on("touchend", () => {
    paintDown = false;
  });

  async function quitGame(silent, anchor) {
    if (!state.active) {
      if (!silent) showOverlay("menu-overlay");
      return;
    }
    if (!silent) {
      const ok = await showConfirm({
        title: t("quit"),
        message: t("quitConfirm"),
        anchor: anchor,
      });
      if (!ok) return;
    }
    state.active = false;
    stopTimer();
    setGameActive(false);
    $("game-hud").classList.remove("active");
    updateGameCursor();
    if (silent) showOverlay("auth-overlay");
    else showOverlay("menu-overlay");
  }

  async function restartRound(anchor) {
    if (!state.active) return;
    const ok = await showConfirm({
      title: t("restart"),
      message: t("restartConfirm"),
      anchor: anchor,
    });
    if (!ok || !state.active) return;
    const minutes = state.limitMs ? state.limitMs / 60000 : 0;
    // Pick/shuffle the places again and start with a clean map.
    launchGame(buildQuestions(), isCustomCity(), minutes);
  }

  function nextQuestion() {
    if (state.index >= state.questions.length) {
      endGame("complete");
      return;
    }
    state.current = state.questions[state.index];
    state.triesLeft = state.maxTries;
    state.locked = false;

    setFeedback("", "");
    $("game-answer-input").value = "";
    $("game-answer-input").disabled = false;
    // Keep already-solved places green for the rest of the round.
    gameClearTransientMarks();

    if (state.input === "click") {
      // Swallow a stray second click (e.g. a double-click) without holding up
      // the next question. This does not consume any time on the clock.
      state.inputLockUntil = performance.now() + 300;
      $("game-input-row").style.display = "none";
      $("game-prompt-target").style.display = "";
    } else {
      gameMark(state.current, "target");
      $("game-input-row").style.display = "";
      $("game-prompt-target").style.display = "none";
      setTimeout(() => $("game-answer-input").focus(), 250);
    }
    refreshPromptText();
    updateGameHud();
    updateGameCursor();
  }

  function refreshPromptText() {
    if (!state.current) return;
    if (state.input === "click") {
      $("game-prompt-label").textContent = t("promptClick");
      $("game-prompt-target").textContent = displayName(state.current);
      $("game-prompt-target").style.display = "";
    } else {
      $("game-prompt-label").textContent = t("promptType");
      $("game-prompt-target").textContent = "";
      $("game-prompt-target").style.display = "none";
    }
  }

  function currentAccuracy() {
    const attempts = state.solved + state.wrongCount;
    if (!attempts) return 100;
    return Math.round((state.solved / attempts) * 1000) / 10;
  }

  function updateGameHud() {
    const shown = Math.min(state.index + 1, state.questions.length);
    $("game-progress").textContent =
      t("question") + " " + shown + " / " + state.questions.length;
    $("game-tries").textContent = t("triesLeft") + ": " + state.triesLeft;
    $("game-score").textContent = t("points") + ": " + state.points;
    if (state.points !== lastShownPoints) {
      if (lastShownPoints >= 0 && state.points > lastShownPoints) {
        const score = $("game-score");
        score.classList.remove("pop");
        void score.offsetWidth;
        score.classList.add("pop");
      }
      lastShownPoints = state.points;
    }
    $("game-accuracy").textContent =
      t("accuracy") + ": " + currentAccuracy() + "%";
    $("game-timer").textContent = timerText();
  }

  function timerText() {
    if (state.limitMs) {
      const remaining = Math.max(0, state.limitMs - state.elapsedMs);
      return t("timeLeft") + " " + formatTime(remaining);
    }
    return t("timeElapsed") + " " + formatTime(state.elapsedMs);
  }

  function startTimer() {
    stopTimer();
    state.timerId = setInterval(() => {
      state.elapsedMs = performance.now() - state.startTime - state.pausedMs;
      if (state.limitMs && state.elapsedMs >= state.limitMs) {
        state.elapsedMs = state.limitMs;
        updateGameHud();
        endGame("timeout");
        return;
      }
      // Audible countdown for the last five seconds.
      if (state.limitMs) {
        const remaining = Math.ceil(
          (state.limitMs - state.elapsedMs) / 1000,
        );
        if (
          remaining <= 5 &&
          remaining > 0 &&
          remaining !== state.lastTickSec
        ) {
          state.lastTickSec = remaining;
          Sfx.tick();
        }
      }
      updateGameHud();
    }, 100);
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function setFeedback(kind, msg) {
    const el = $("game-feedback");
    el.textContent = msg || "";
    el.className = "game-feedback" + (kind ? " " + kind : "");
  }

  // Short, self-dismissing pop-up so the player notices the result even though
  // the game moves straight on to the next question.
  let flashTimer = null;
  function flashGame(text, kind) {
    const el = $("game-flash");
    if (!el) return;
    el.textContent = text || "";
    el.className = "game-flash" + (kind ? " " + kind : "");
    void el.offsetWidth; // restart the CSS animation
    el.classList.add("show");
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove("show"), 950);
  }

  function pointsForTry(tryNo) {
    return [100, 60, 30][tryNo - 1] || 0;
  }

  function acceptedAnswers(target) {
    const set = new Set();
    const langs = ["ar", "en", "fr"];
    const push = (s) => {
      const n = normalizeAnswer(s);
      if (n) set.add(n);
    };
    // Accept the plain name when a duplicate was disambiguated with a
    // parenthetical qualifier, e.g. "Kafr (Jbeil)" -> "Kafr" and
    // "مغيره (جبيل)" -> "مغيره", so typing just the base name still counts.
    const pushVariants = (s) => {
      push(s);
      const base = String(s)
        .replace(/\s*#[0-9]+$/, "")
        .replace(/\s*\([^)]*\)\s*$/, "");
      if (base && base !== s) push(base);
    };
    pushVariants(target);
    const targetVals = langs.map((l) => getTranslatedName(target, l));
    targetVals.forEach(pushVariants);
    Object.keys(TRANSLATIONS.names).forEach((key) => {
      const vals = langs.map((l) => getTranslatedName(key, l));
      if (vals.some((v) => targetVals.indexOf(v) !== -1)) {
        push(key);
        vals.forEach(pushVariants);
      }
    });
    return set;
  }

  function isAnswerCorrect(input) {
    const norm = normalizeAnswer(input);
    if (!norm) return false;
    return acceptedAnswers(state.current).has(norm);
  }

  function handleCorrect() {
    if (state.locked) return;
    state.locked = true;
    const tryNo = state.maxTries - state.triesLeft + 1;
    state.points += pointsForTry(tryNo);
    state.solved += 1;
    gameMark(state.current, "correct");
    flashGame("\u2713 " + displayName(state.current), "correct");
    flashCursor("correct");
    Sfx.correct();
    updateGameHud();
    // Move on immediately: the green mark persists for the round, so there is
    // no reason to hold the next question back and eat into the clock.
    state.index += 1;
    nextQuestion();
  }

  function handleWrong(clickedName) {
    if (state.locked) return;
    state.triesLeft -= 1;
    state.wrongCount += 1;
    if (clickedName) gameMark(clickedName, "wrong");
    updateGameHud();

    if (state.triesLeft <= 0) {
      state.locked = true;
      gameMark(state.current, "correct");
      $("game-answer-input").disabled = true;
      flashGame(
        t("revealAnswer") + ": " + displayName(state.current),
        "reveal",
      );
      flashCursor("wrong");
      Sfx.reveal();
      // Mark the place and move straight on; the flash tells the player the
      // answer without pausing the clock.
      state.index += 1;
      nextQuestion();
    } else {
      flashCursor("wrong");
      Sfx.wrong();
      setFeedback("wrong", t("wrong") + " — " + t("triesLeft") + ": " + state.triesLeft);
      if (state.input === "type") $("game-answer-input").select();
    }
  }

  function handleGameMapClick(e) {
    if (!state.active || state.input !== "click" || state.locked) return;
    if (performance.now() < state.inputLockUntil) return;
    const layer = sourceIdForMode(state.mode) + "-fill";
    if (!map.getLayer(layer)) return;
    const feats = map.queryRenderedFeatures(e.point, { layers: [layer] });
    if (!feats || !feats.length) return;
    const clicked = extractFeatureName(feats[0].properties);
    if (!clicked) return;
    if (clicked === state.current) handleCorrect();
    else handleWrong(clicked);
  }
  window.handleGameMapClick = handleGameMapClick;

  function handleTypedSubmit() {
    if (!state.active || state.input !== "type" || state.locked) return;
    const value = $("game-answer-input").value;
    if (!value || !value.trim()) return;
    if (isAnswerCorrect(value)) handleCorrect();
    else handleWrong(null);
  }

  /* ------------------------------- Results -------------------------------- */

  function endGame(reason) {
    if (!state.active) return;
    state.elapsedMs = performance.now() - state.startTime - state.pausedMs;
    stopTimer();
    state.active = false;
    setGameActive(false);
    $("game-hud").classList.remove("active");
    updateGameCursor();

    const total = state.questions.length;
    const accuracy = currentAccuracy();
    const result = {
      mode: state.mode,
      input: state.input,
      total: total,
      solved: state.solved,
      accuracy: Math.round(accuracy * 10) / 10,
      elapsedMs: Math.round(state.elapsedMs),
      limitMs: state.limitMs,
      completed: reason === "complete",
      points: state.points,
      custom: !!state.custom,
    };
    if (reason === "complete") Sfx.complete();
    else Sfx.gameover();
    showResults(result, reason);
  }

  // Lightweight confetti burst for a perfect round / new personal best.
  function celebrate() {
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const colors = [
      "#10b981",
      "#f59e0b",
      "#0284c7",
      "#ef4444",
      "#8b5cf6",
      "#14b8a6",
    ];
    for (let i = 0; i < 70; i++) {
      const p = document.createElement("span");
      p.className = "confetti-piece";
      p.style.left = Math.random() * 100 + "vw";
      p.style.background = colors[i % colors.length];
      p.style.setProperty("--dx", Math.random() * 180 - 90 + "px");
      p.style.setProperty("--rot", Math.random() * 720 - 360 + "deg");
      p.style.animationDelay = Math.random() * 0.35 + "s";
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 3600);
    }
  }

  async function showResults(result, reason) {
    state.lastResult = result;
    $("results-title").textContent =
      reason === "timeout" ? t("timeUp") : t("roundComplete");
    $("results-accuracy").textContent = result.accuracy + "%";
    $("results-solved").textContent = result.solved + " / " + result.total;
    $("results-points").textContent = result.points;
    $("results-time").textContent = formatTime(result.elapsedMs);
    $("results-best").innerHTML = "";
    $("results-save").textContent = t("saving");
    showOverlay("results-overlay");

    let prevBest = null;
    try {
      const mine = await loadMyResults();
      const rel = mine.filter(
        (r) =>
          r.mode === result.mode &&
          r.input === result.input &&
          !!r.custom === !!result.custom,
      );
      if (rel.length) {
        prevBest = rel.reduce((a, b) => (b.points > a.points ? b : a));
      }
    } catch (e) {
      /* ignore */
    }

    try {
      await Backend.saveResult(result);
      $("results-save").textContent = "";
      invalidateCaches();
    } catch (e) {
      console.warn("[GeoLeban] Could not save result.", e);
      $("results-save").textContent = t("genericError");
    }

    const isNewBest = !prevBest || result.points > prevBest.points;
    if (result.accuracy >= 100 || (prevBest && result.points > prevBest.points)) {
      celebrate();
    }
    const bestPoints = isNewBest ? result.points : prevBest.points;
    const bestAccuracy = isNewBest ? result.accuracy : prevBest.accuracy;
    $("results-best").innerHTML =
      "<strong>" +
      t("bestResult") +
      "</strong><span>" +
      bestPoints +
      " " +
      t("points") +
      " · " +
      bestAccuracy +
      "%</span>";
  }

  /* -------------------------------- Stats --------------------------------- */

  async function openStats() {
    showOverlay("stats-overlay");
    renderStats();
  }

  async function renderStats() {
    const grid = $("stats-grid");
    if (!grid) return;
    grid.innerHTML = '<p class="muted">…</p>';
    let mine = [];
    try {
      mine = await loadMyResults();
    } catch (e) {
      mine = [];
    }
    const combos = [
      ["gov", "click"],
      ["gov", "type"],
      ["caza", "click"],
      ["caza", "type"],
      ["city", "click"],
      ["city", "type"],
    ];
    grid.innerHTML = combos
      .map((combo) => statsCard(combo[0], combo[1], mine))
      .join("");
  }

  function statsCard(mode, input, mine) {
    // Built-in best results exclude custom (modified-count / hand-picked) rounds.
    const rel = mine.filter(
      (r) => r.mode === mode && r.input === input && !r.custom,
    );
    const head =
      "<h3>" + modeLabel(mode) + " · " + inputLabel(input) + "</h3>";
    if (!rel.length) {
      return (
        '<div class="stat-card">' + head + '<p class="muted">' + t("noResultsYet") + "</p></div>"
      );
    }
    const bestPoints = rel.reduce((a, b) => (b.points > a.points ? b : a));
    const bestAcc = rel.reduce((a, b) => (b.accuracy > a.accuracy ? b : a));
    const done = rel.filter((r) => r.completed);
    const bestTime = done.length
      ? done.reduce((a, b) => (b.elapsedMs < a.elapsedMs ? b : a))
      : null;
    return (
      '<div class="stat-card">' +
      head +
      '<div class="stat-rows">' +
      "<div><small>" + t("bestPoints") + "</small><strong>" + bestPoints.points + "</strong></div>" +
      "<div><small>" + t("bestAccuracy") + "</small><strong>" + bestAcc.accuracy + "%</strong></div>" +
      "<div><small>" + t("bestTime") + "</small><strong>" + (bestTime ? formatTime(bestTime.elapsedMs) : "—") + "</strong></div>" +
      "<div><small>" + t("gamesPlayed") + "</small><strong>" + rel.length + "</strong></div>" +
      "</div></div>"
    );
  }

  /* ----------------------------- Leaderboard ------------------------------ */

  const LB_COMBOS = [
    ["gov", "click"],
    ["gov", "type"],
    ["caza", "click"],
    ["caza", "type"],
    ["city", "click"],
    ["city", "type"],
  ];

  function populateLbFilter() {
    const select = $("lb-filter");
    if (!select) return;
    select.innerHTML = "";
    LB_COMBOS.forEach((combo) => {
      const opt = document.createElement("option");
      opt.value = combo[0] + "|" + combo[1];
      opt.textContent = modeLabel(combo[0]) + " · " + inputLabel(combo[1]);
      select.appendChild(opt);
    });
    select.value = lbCombo;
  }

  function openLeaderboard(tab) {
    lbTab = tab || "my";
    showOverlay("leaderboard-overlay");
    renderLeaderboard({ autoSelect: true });
  }

  function loadEveryoneResults() {
    // Queried only the first time the "Everyone" tab is opened; cached after.
    if (globalCache !== null) return Promise.resolve(globalCache);
    if (!globalPromise) {
      globalPromise = Backend.getAllResults()
        .then((rows) => {
          globalCache = rows || [];
          globalPromise = null;
          return globalCache;
        })
        .catch((e) => {
          globalPromise = null;
          throw e;
        });
    }
    return globalPromise;
  }

  function invalidateEveryoneCache() {
    globalCache = null;
    globalPromise = null;
  }

  function loadMyResults() {
    // Queried only once per session; invalidated when a new result is saved.
    if (myCache !== null) return Promise.resolve(myCache);
    if (!myPromise) {
      myPromise = Backend.getMyResults()
        .then((rows) => {
          myCache = rows || [];
          myPromise = null;
          return myCache;
        })
        .catch((e) => {
          myPromise = null;
          throw e;
        });
    }
    return myPromise;
  }

  function invalidateCaches() {
    invalidateEveryoneCache();
    myCache = null;
    myPromise = null;
  }

  async function renderLeaderboard(opts) {
    const body = $("lb-body");
    if (!body) return;
    $("lb-tab-global").classList.toggle("active", lbTab === "global");
    $("lb-tab-my").classList.toggle("active", lbTab === "my");
    $("lb-tab-custom").classList.toggle("active", lbTab === "custom");
    body.innerHTML = '<tr><td colspan="5" class="empty">…</td></tr>';

    let rows = [];
    try {
      rows =
        lbTab === "global"
          ? await loadEveryoneResults()
          : await loadMyResults();
    } catch (e) {
      rows = [];
    }

    const isCustom = lbTab === "custom";
    // Custom rounds (modified count / hand-picked) are private and belong to
    // the Custom tab only.
    rows = rows.filter((r) => (isCustom ? !!r.custom : !r.custom));

    // On a tab switch, point the board filter at a board that actually has
    // results (custom and standard rounds live on different boards). This is
    // skipped when the user changes the filter themselves, so an empty board
    // still shows "no results yet" instead of jumping elsewhere.
    if (opts && opts.autoSelect && rows.length) {
      const hasCurrent = rows.some((r) => r.mode + "|" + r.input === lbCombo);
      if (!hasCurrent) {
        lbCombo = rows[0].mode + "|" + rows[0].input;
        const select = $("lb-filter");
        if (select) select.value = lbCombo;
      }
    }

    rows = rows
      .filter((r) => r.mode + "|" + r.input === lbCombo)
      .sort(
        (a, b) =>
          (b.points || 0) - (a.points || 0) ||
          (b.accuracy || 0) - (a.accuracy || 0) ||
          (a.elapsedMs || 0) - (b.elapsedMs || 0),
      )
      .slice(0, 50);

    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="5" class="empty">' + t("noResultsYet") + "</td></tr>";
      return;
    }

    body.innerHTML = rows.map((r, i) => leaderboardRow(r, i)).join("");
  }

  function rankCell(rank) {
    if (rank === 1) return '<span class="rank-medal">🥇</span>';
    if (rank === 2) return '<span class="rank-medal">🥈</span>';
    if (rank === 3) return '<span class="rank-medal">🥉</span>';
    return String(rank);
  }

  function leaderboardRow(r, i) {
    const isMe = state.user && r.uid && r.uid === state.user.uid;
    return (
      "<tr" + (isMe ? ' class="is-me"' : "") + ">" +
      '<td class="rank-cell">' + rankCell(i + 1) + "</td>" +
      "<td>" +
      escapeHtml(r.name || "—") +
      (isMe ? ' <span class="you-badge">' + t("you") + "</span>" : "") +
      "</td>" +
      "<td>" + (r.accuracy != null ? r.accuracy + "%" : "—") + "</td>" +
      "<td>" + formatTime(r.elapsedMs) + "</td>" +
      "<td><strong>" + (r.points || 0) + "</strong></td>" +
      "</tr>"
    );
  }

  /* ------------------------------ Bindings -------------------------------- */

  function bindEvents() {
    $("auth-tab-login").addEventListener("click", () => setAuthMode("login"));
    $("auth-tab-signup").addEventListener("click", () => setAuthMode("signup"));
    $("auth-switch").addEventListener("click", () =>
      setAuthMode(authMode === "login" ? "signup" : "login"),
    );
    $("auth-form").addEventListener("submit", handleAuthSubmit);

    $("menu-play").addEventListener("click", () => showOverlay("setup-overlay"));
    $("menu-stats").addEventListener("click", openStats);
    $("menu-leaderboard").addEventListener("click", () => openLeaderboard());
    $("menu-explore").addEventListener("click", hideOverlays);
    $("menu-logout").addEventListener("click", handleLogout);
    $("menu-account").addEventListener("click", openAccount);
    $("account-back").addEventListener("click", () => showOverlay("menu-overlay"));
    $("account-name-form").addEventListener("submit", handleNameSubmit);
    $("account-pass-form").addEventListener("submit", handlePasswordSubmit);
    $("admin-logout").addEventListener("click", handleLogout);
    $("admin-block-btn").addEventListener("click", () =>
      adminBlock($("admin-block-email").value),
    );
    $("admin-cred-save").addEventListener("click", adminSaveCreds);
    $("btn-main-menu").addEventListener("click", openMenu);

    $("select-start").addEventListener("click", finishSelection);
    $("select-clear").addEventListener("click", clearSelection);
    $("select-cancel").addEventListener("click", cancelSelection);

    $("confirm-ok").addEventListener("click", () => closeConfirm(true));
    $("confirm-cancel").addEventListener("click", () => closeConfirm(false));
    $("confirm-overlay").addEventListener("click", (e) => {
      if (e.target === $("confirm-overlay")) closeConfirm(false);
    });
    document.addEventListener("keydown", (e) => {
      if (!$("confirm-overlay").classList.contains("active")) return;
      if (e.key === "Escape") closeConfirm(false);
      else if (e.key === "Enter") {
        e.preventDefault();
        closeConfirm(true);
      }
    });

    $("setup-back").addEventListener("click", () => showOverlay("menu-overlay"));
    $("setup-start").addEventListener("click", startGame);

    $("game-quit").addEventListener("click", (e) =>
      quitGame(false, anchorFromEvent(e)),
    );
    $("game-restart").addEventListener("click", (e) =>
      restartRound(anchorFromEvent(e)),
    );
    $("game-sound").addEventListener("click", () => {
      Sfx.setMuted(!Sfx.isMuted());
      Backend.savePreferences({ sound: Sfx.isMuted() });
      syncSoundButton();
      if (!Sfx.isMuted()) Sfx.tick();
    });

    // Drive the animated reticle cursor while the player is on the map.
    const canvasEl = map.getCanvas();
    if (canvasEl) {
      canvasEl.addEventListener("mousemove", moveCursor);
      canvasEl.addEventListener("mouseenter", updateGameCursor);
      canvasEl.addEventListener("mouseleave", () => setCursorActive(false));
    }
    $("game-answer-submit").addEventListener("click", handleTypedSubmit);
    $("game-answer-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleTypedSubmit();
      }
    });

    $("results-menu").addEventListener("click", () => showOverlay("menu-overlay"));
    $("results-leaderboard").addEventListener("click", () => openLeaderboard());
    $("results-again").addEventListener("click", startGame);

    $("stats-back").addEventListener("click", () => showOverlay("menu-overlay"));

    $("lb-back").addEventListener("click", () => showOverlay("menu-overlay"));
    $("lb-tab-global").addEventListener("click", () => {
      lbTab = "global";
      renderLeaderboard({ autoSelect: true });
    });
    $("lb-tab-my").addEventListener("click", () => {
      lbTab = "my";
      renderLeaderboard({ autoSelect: true });
    });
    $("lb-tab-custom").addEventListener("click", () => {
      lbTab = "custom";
      renderLeaderboard({ autoSelect: true });
    });
    $("lb-filter").addEventListener("change", (e) => {
      lbCombo = e.target.value;
      renderLeaderboard();
    });

    bindSetup();
  }

  /* --------------------------------- Init --------------------------------- */

  async function init() {
    bindEvents();
    applyPreferences(Backend.getPreferences());
    try {
      await Backend.init();
    } catch (e) {
      console.warn("[GeoLeban] Backend init error", e);
    }
    Backend.onAuthChange(onAuthChange);
    applyGameTranslations();
    syncSetupUi();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
