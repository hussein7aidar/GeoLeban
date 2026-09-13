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
    return mode === "gov" ? t("govOption") : t("cazaOption");
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
  ];

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
    points: 0,
    startTime: 0,
    elapsedMs: 0,
    timerId: null,
    locked: false,
    current: null,
    user: null,
    lastResult: null,
  };

  let authMode = "login";
  let setupMode = "gov";
  let setupInput = "click";
  let setupMinutes = 0;
  let setupUseCustom = false;

  let lbTab = "global";
  let lbMode = "all";
  let lbInput = "all";

  /* ------------------------------ Overlay UI ------------------------------ */

  function showOverlay(id) {
    OVERLAYS.forEach((o) => {
      const el = $(o);
      if (el) el.classList.toggle("active", o === id);
    });
    setFab(false);
    document.body.classList.add("overlay-open");
  }

  function hideOverlays() {
    OVERLAYS.forEach((o) => {
      const el = $(o);
      if (el) el.classList.remove("active");
    });
    document.body.classList.remove("overlay-open");
    setFab(!!state.user);
  }

  function setFab(on) {
    const f = $("game-fab");
    if (f) f.classList.toggle("visible", !!on);
  }

  /* -------------------------------- i18n ---------------------------------- */

  function applyGameTranslations() {
    qsa("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    qsa("[data-i18n-ph]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    syncAuthModeUI();
    syncSetupUi();
    updateModeNotes();

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
    return t("genericError");
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const email = $("auth-email").value.trim();
    const password = $("auth-password").value;
    const name = $("auth-name").value.trim();

    showAuthError("");
    if (authMode === "signup" && !name) return showAuthError(t("nameRequired"));
    if (!isValidEmail(email)) return showAuthError(t("emailInvalid"));
    if (password.length < 6) return showAuthError(t("passShort"));

    setAuthBusy(true);
    try {
      if (authMode === "signup") await Backend.signUp(name, email, password);
      else await Backend.signIn(email, password);
      $("auth-password").value = "";
    } catch (err) {
      console.warn("[GeoLeban] Auth error", err);
      showAuthError(mapAuthError(err));
    } finally {
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
      if (wasActive) return; // keep playing
      // Go to the menu after a fresh login / signup, but don't yank the user
      // away from another panel (stats, leaderboard, setup) if they are
      // already browsing it.
      const onAuthScreen = $("auth-overlay").classList.contains("active");
      if (onAuthScreen || !isAnyPanelOpen()) showOverlay("menu-overlay");
    } else {
      if (wasActive) quitGame(true);
      showOverlay("auth-overlay");
    }
  }

  function isAnyPanelOpen() {
    return OVERLAYS.some((id) => $(id) && $(id).classList.contains("active"));
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
    try {
      await Backend.signOut();
    } catch (e) {
      console.warn(e);
    }
  }

  /* ------------------------------- Setup ---------------------------------- */

  function syncSetupUi() {
    qsa("[data-setup-mode]").forEach((b) =>
      b.classList.toggle("active", b.getAttribute("data-setup-mode") === setupMode),
    );
    qsa("[data-setup-input]").forEach((b) =>
      b.classList.toggle("active", b.getAttribute("data-setup-input") === setupInput),
    );
    qsa("[data-setup-timer]").forEach((b) =>
      b.classList.toggle(
        "active",
        !setupUseCustom && Number(b.getAttribute("data-setup-timer")) === setupMinutes,
      ),
    );
    const custom = $("setup-custom-min");
    if (custom) custom.classList.toggle("active", setupUseCustom);
  }

  function bindSetup() {
    qsa("[data-setup-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        setupMode = b.getAttribute("data-setup-mode");
        syncSetupUi();
      }),
    );
    qsa("[data-setup-input]").forEach((b) =>
      b.addEventListener("click", () => {
        setupInput = b.getAttribute("data-setup-input");
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
  }

  function getSetupMinutes() {
    if (setupUseCustom) {
      const v = Number($("setup-custom-min").value);
      return v > 0 ? Math.min(60, Math.floor(v)) : 0;
    }
    return setupMinutes;
  }

  /* ------------------------------ Gameplay -------------------------------- */

  function startGame() {
    state.mode = setupMode;
    state.input = setupInput;
    const minutes = getSetupMinutes();
    state.limitMs = minutes > 0 ? minutes * 60 * 1000 : 0;
    state.questions = shuffle(getFeatureNamesForMode(state.mode));
    state.index = 0;
    state.solved = 0;
    state.points = 0;
    state.locked = false;
    state.active = true;
    state.current = null;

    if (typeof setMode === "function") setMode(state.mode);
    setGameActive(true);
    hideOverlays();
    setFab(false);
    $("game-hud").classList.add("active");
    $("game-feedback").textContent = "";
    $("game-answer-input").value = "";

    state.startTime = performance.now();
    state.elapsedMs = 0;
    startTimer();
    nextQuestion();
  }

  function quitGame(silent) {
    if (!state.active) {
      if (!silent) showOverlay("menu-overlay");
      return;
    }
    if (!silent && !window.confirm(t("quitConfirm"))) return;
    state.active = false;
    stopTimer();
    setGameActive(false);
    $("game-hud").classList.remove("active");
    if (silent) showOverlay("auth-overlay");
    else showOverlay("menu-overlay");
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
    gameClearMarks();

    if (state.input === "click") {
      if (typeof selectItem === "function") selectItem("all");
      $("game-input-row").style.display = "none";
      $("game-prompt-target").style.display = "";
    } else {
      gameMark(state.current, "target");
      fitToFeature(state.current);
      $("game-input-row").style.display = "";
      $("game-prompt-target").style.display = "none";
      setTimeout(() => $("game-answer-input").focus(), 250);
    }
    refreshPromptText();
    updateGameHud();
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

  function fitToFeature(name) {
    const feat = featuresByName[state.mode][name];
    if (!feat) return;
    const bounds = getBounds(feat.geometry.coordinates);
    map.fitBounds(bounds, {
      padding: getResponsivePadding(),
      duration: 600,
      essential: true,
    });
  }

  function updateGameHud() {
    const shown = Math.min(state.index + 1, state.questions.length);
    $("game-progress").textContent =
      t("question") + " " + shown + " / " + state.questions.length;
    $("game-tries").textContent = t("triesLeft") + ": " + state.triesLeft;
    $("game-score").textContent = t("points") + ": " + state.points;
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
      state.elapsedMs = performance.now() - state.startTime;
      if (state.limitMs && state.elapsedMs >= state.limitMs) {
        state.elapsedMs = state.limitMs;
        updateGameHud();
        endGame("timeout");
        return;
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
    push(target);
    const targetVals = langs.map((l) => getTranslatedName(target, l));
    targetVals.forEach(push);
    Object.keys(TRANSLATIONS.names).forEach((key) => {
      const vals = langs.map((l) => getTranslatedName(key, l));
      if (vals.some((v) => targetVals.indexOf(v) !== -1)) push(key);
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
    setFeedback("correct", t("correct"));
    updateGameHud();
    setTimeout(() => {
      state.index += 1;
      nextQuestion();
    }, 700);
  }

  function handleWrong(clickedName) {
    if (state.locked) return;
    state.triesLeft -= 1;
    if (clickedName) gameMark(clickedName, "wrong");
    updateGameHud();

    if (state.triesLeft <= 0) {
      state.locked = true;
      gameMark(state.current, "correct");
      $("game-answer-input").disabled = true;
      setFeedback(
        "reveal",
        t("revealAnswer") + ": " + displayName(state.current),
      );
      setTimeout(() => {
        state.index += 1;
        nextQuestion();
      }, 1700);
    } else {
      setFeedback("wrong", t("wrong") + " — " + t("triesLeft") + ": " + state.triesLeft);
      if (state.input === "type") $("game-answer-input").select();
    }
  }

  function handleGameMapClick(e) {
    if (!state.active || state.input !== "click" || state.locked) return;
    const layer = state.mode === "gov" ? "lebanon-govs-fill" : "lebanon-cazas-fill";
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
    state.elapsedMs = performance.now() - state.startTime;
    stopTimer();
    state.active = false;
    setGameActive(false);
    $("game-hud").classList.remove("active");

    const total = state.questions.length;
    const accuracy = total ? (state.solved / total) * 100 : 0;
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
    };
    showResults(result, reason);
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
      const mine = await Backend.getMyResults();
      const rel = mine.filter(
        (r) => r.mode === result.mode && r.input === result.input,
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
    } catch (e) {
      console.warn("[GeoLeban] Could not save result.", e);
      $("results-save").textContent = t("genericError");
    }

    const isNewBest = !prevBest || result.points > prevBest.points;
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
      mine = await Backend.getMyResults();
    } catch (e) {
      mine = [];
    }
    const combos = [
      ["gov", "click"],
      ["gov", "type"],
      ["caza", "click"],
      ["caza", "type"],
    ];
    grid.innerHTML = combos
      .map((combo) => statsCard(combo[0], combo[1], mine))
      .join("");
  }

  function statsCard(mode, input, mine) {
    const rel = mine.filter((r) => r.mode === mode && r.input === input);
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

  function openLeaderboard(tab) {
    lbTab = tab || "global";
    showOverlay("leaderboard-overlay");
    renderLeaderboard();
  }

  async function renderLeaderboard() {
    const body = $("lb-body");
    if (!body) return;
    $("lb-tab-global").classList.toggle("active", lbTab === "global");
    $("lb-tab-my").classList.toggle("active", lbTab === "my");
    body.innerHTML = '<tr><td colspan="6" class="empty">…</td></tr>';

    let rows = [];
    try {
      rows = lbTab === "global" ? await Backend.getAllResults() : await Backend.getMyResults();
    } catch (e) {
      rows = [];
    }

    rows = rows.filter(
      (r) =>
        (lbMode === "all" || r.mode === lbMode) &&
        (lbInput === "all" || r.input === lbInput),
    );

    if (lbTab === "global") {
      rows.sort(
        (a, b) =>
          (b.points || 0) - (a.points || 0) ||
          (b.accuracy || 0) - (a.accuracy || 0) ||
          (a.elapsedMs || 0) - (b.elapsedMs || 0),
      );
    }

    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="6" class="empty">' + t("noResultsYet") + "</td></tr>";
      return;
    }

    body.innerHTML = rows
      .slice(0, 50)
      .map((r, i) => leaderboardRow(r, i))
      .join("");
  }

  function leaderboardRow(r, i) {
    const isMe = state.user && r.uid && r.uid === state.user.uid;
    return (
      "<tr" + (isMe ? ' class="is-me"' : "") + ">" +
      "<td>" + (i + 1) + "</td>" +
      "<td>" +
      escapeHtml(r.name || "—") +
      (isMe ? ' <span class="you-badge">' + t("you") + "</span>" : "") +
      "</td>" +
      "<td>" + modeLabel(r.mode) + " · " + inputLabel(r.input) + "</td>" +
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
    $("menu-leaderboard").addEventListener("click", () => openLeaderboard("global"));
    $("menu-explore").addEventListener("click", hideOverlays);
    $("menu-logout").addEventListener("click", handleLogout);
    $("game-fab").addEventListener("click", openMenu);

    $("setup-back").addEventListener("click", () => showOverlay("menu-overlay"));
    $("setup-start").addEventListener("click", startGame);

    $("game-quit").addEventListener("click", () => quitGame(false));
    $("game-answer-submit").addEventListener("click", handleTypedSubmit);
    $("game-answer-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleTypedSubmit();
      }
    });

    $("results-menu").addEventListener("click", () => showOverlay("menu-overlay"));
    $("results-leaderboard").addEventListener("click", () => openLeaderboard("global"));
    $("results-again").addEventListener("click", startGame);

    $("stats-back").addEventListener("click", () => showOverlay("menu-overlay"));

    $("lb-back").addEventListener("click", () => showOverlay("menu-overlay"));
    $("lb-tab-global").addEventListener("click", () => {
      lbTab = "global";
      renderLeaderboard();
    });
    $("lb-tab-my").addEventListener("click", () => {
      lbTab = "my";
      renderLeaderboard();
    });
    $("lb-filter-mode").addEventListener("change", (e) => {
      lbMode = e.target.value;
      renderLeaderboard();
    });
    $("lb-filter-input").addEventListener("change", (e) => {
      lbInput = e.target.value;
      renderLeaderboard();
    });

    bindSetup();
  }

  /* --------------------------------- Init --------------------------------- */

  async function init() {
    bindEvents();
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
