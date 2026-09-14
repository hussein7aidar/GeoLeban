/**
 * Backend abstraction.
 *
 * Uses Firebase (Auth + Firestore) when js/firebase-config.js is filled in.
 * Otherwise transparently falls back to localStorage so the game stays
 * playable offline / without any cloud setup.
 *
 * Public API (all async unless noted):
 *   Backend.init()                  -> Promise<void>
 *   Backend.onAuthChange(cb)        -> unsubscribe()   (cb receives user|null)
 *   Backend.getCurrentUser()        -> { uid, name, email } | null
 *   Backend.isRemote()              -> boolean
 *   Backend.signUp(name,email,pass) -> Promise<user>
 *   Backend.signIn(email, pass)     -> Promise<user>
 *   Backend.signOut()               -> Promise<void>
 *   Backend.saveResult(result)      -> Promise<result>
 *   Backend.getMyResults()          -> Promise<result[]>
 *   Backend.getAllResults()         -> Promise<result[]>
 */
const Backend = (function () {
  const LOCAL_USERS_KEY = "geoleban.users";
  const LOCAL_SESSION_KEY = "geoleban.session";
  const LOCAL_RESULTS_KEY = "geoleban.results";
  const LOCAL_PREFS_KEY = "geoleban.prefs";
  const FIRESTORE_RESULTS = "results";
  const FIRESTORE_PROFILES = "profiles";

  let mode = "local"; // "firebase" | "local"
  let started = false;
  let fbAuth = null;
  let fbDb = null;
  let currentUser = null; // { uid, name, email, prefs }
  const listeners = new Set();
  let resolveReady;
  const readyPromise = new Promise((res) => {
    resolveReady = res;
  });

  /* ----------------------------- Local helpers ---------------------------- */

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn("[GeoLeban] Could not persist to localStorage.", e);
    }
  }

  function makeId() {
    return (
      "local_" +
      Math.random().toString(36).slice(2, 10) +
      Date.now().toString(36)
    );
  }

  function localResults() {
    const all = readJSON(LOCAL_RESULTS_KEY, []);
    return Array.isArray(all) ? all : [];
  }

  // Stores a result locally, keyed by id, so the same record is never added
  // twice (used as a mirror of cloud saves and as a fallback when the cloud
  // write is rejected).
  function saveLocalResult(record) {
    const all = localResults();
    const withId = Object.assign({}, record, { id: record.id || makeId() });
    if (!all.some((r) => r.id === withId.id)) {
      all.push(withId);
      writeJSON(LOCAL_RESULTS_KEY, all);
    }
    return withId;
  }

  function mergeResults(primary, extra) {
    const byId = new Map();
    (primary || []).concat(extra || []).forEach((r) => {
      if (!r) return;
      const key = r.id ? r.id : JSON.stringify(r);
      if (!byId.has(key)) byId.set(key, r);
    });
    return Array.from(byId.values());
  }

  function readLocalPrefs() {
    const prefs = readJSON(LOCAL_PREFS_KEY, {});
    return prefs && typeof prefs === "object" ? prefs : {};
  }

  function writeLocalPrefs(prefs) {
    writeJSON(LOCAL_PREFS_KEY, prefs);
  }

  function fallbackHash(str) {
    // Only used when crypto.subtle is unavailable (e.g. file:// on some
    // browsers). Not cryptographically secure; local fallback only.
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 =
      Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
      Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 =
      Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
      Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (
      (h2 >>> 0).toString(16).padStart(8, "0") +
      (h1 >>> 0).toString(16).padStart(8, "0")
    );
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function hashPassword(password, salt) {
    const input = salt + ":" + password;
    if (typeof crypto !== "undefined" && crypto.subtle) {
      try {
        return await sha256Hex(input);
      } catch (e) {
        /* fall through */
      }
    }
    return fallbackHash(input);
  }

  function randomSalt() {
    const arr = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(arr);
    } else {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(arr)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function toPublicLocal(rec) {
    return { uid: rec.uid, name: rec.name, email: rec.email };
  }

  function emit() {
    listeners.forEach((cb) => {
      try {
        cb(currentUser);
      } catch (e) {
        console.warn(e);
      }
    });
  }

  /* ------------------------------- Firebase ------------------------------- */

  async function resolveProfile(fbUser) {
    let name = fbUser.displayName;
    let email = fbUser.email || "";
    const prefs = {};
    try {
      const doc = await fbDb.collection(FIRESTORE_PROFILES).doc(fbUser.uid).get();
      if (doc.exists) {
        const data = doc.data();
        if (data.name) name = data.name;
        if (data.email) email = data.email;
        if (data.theme) prefs.theme = data.theme;
        if (data.language) prefs.language = data.language;
        if (typeof data.labels === "boolean") prefs.labels = data.labels;
      }
    } catch (e) {
      console.warn("[GeoLeban] Could not read profile.", e);
    }
    if (!name) name = email ? email.split("@")[0] : "Player";
    return { uid: fbUser.uid, name, email, prefs };
  }

  function initFirebase() {
    firebase.initializeApp(FIREBASE_CONFIG);
    fbAuth = firebase.auth();
    fbDb = firebase.firestore();
    mode = "firebase";
    fbAuth.onAuthStateChanged(async (fbUser) => {
      if (fbUser) {
        currentUser = await resolveProfile(fbUser);
      } else {
        currentUser = null;
      }
      emit();
      if (resolveReady) {
        const r = resolveReady;
        resolveReady = null;
        r();
      }
    });
  }

  function initLocal() {
    const sessionKey = localStorage.getItem(LOCAL_SESSION_KEY);
    if (sessionKey) {
      const users = readJSON(LOCAL_USERS_KEY, {});
      if (users[sessionKey]) currentUser = toPublicLocal(users[sessionKey]);
    }
    emit();
    if (resolveReady) {
      const r = resolveReady;
      resolveReady = null;
      r();
    }
  }

  /* -------------------------------- Public -------------------------------- */

  async function init() {
    if (started) return readyPromise;
    started = true;

    const hasFirebase = typeof isFirebaseConfigured === "function" && isFirebaseConfigured();
    if (hasFirebase && typeof firebase !== "undefined") {
      try {
        initFirebase();
      } catch (e) {
        console.warn("[GeoLeban] Firebase init failed, using local mode.", e);
        mode = "local";
        initLocal();
      }
    } else {
      mode = "local";
      initLocal();
    }
    return readyPromise;
  }

  function onAuthChange(cb) {
    listeners.add(cb);
    cb(currentUser);
    return () => listeners.delete(cb);
  }

  function getCurrentUser() {
    return currentUser;
  }

  function isRemote() {
    return mode === "firebase";
  }

  async function signUp(name, email, password) {
    await init();
    const cleanName = (name || "").trim();
    const cleanEmail = (email || "").trim().toLowerCase();

    if (mode === "firebase") {
      const cred = await fbAuth.createUserWithEmailAndPassword(cleanEmail, password);
      try {
        await cred.user.updateProfile({ displayName: cleanName });
      } catch (e) {
        /* non-fatal */
      }
      await fbDb.collection(FIRESTORE_PROFILES).doc(cred.user.uid).set({
        name: cleanName,
        email: cleanEmail,
        createdAt: Date.now(),
      });
      currentUser = { uid: cred.user.uid, name: cleanName, email: cleanEmail };
      emit();
      return currentUser;
    }

    const users = readJSON(LOCAL_USERS_KEY, {});
    if (users[cleanEmail]) {
      const err = new Error("Email already registered");
      err.code = "auth/email-already-in-use";
      throw err;
    }
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    const rec = {
      uid: makeId(),
      name: cleanName,
      email: cleanEmail,
      salt,
      hash,
      createdAt: Date.now(),
    };
    users[cleanEmail] = rec;
    writeJSON(LOCAL_USERS_KEY, users);
    localStorage.setItem(LOCAL_SESSION_KEY, cleanEmail);
    currentUser = toPublicLocal(rec);
    emit();
    return currentUser;
  }

  async function signIn(email, password) {
    await init();
    const cleanEmail = (email || "").trim().toLowerCase();

    if (mode === "firebase") {
      const cred = await fbAuth.signInWithEmailAndPassword(cleanEmail, password);
      currentUser = await resolveProfile(cred.user);
      emit();
      return currentUser;
    }

    const users = readJSON(LOCAL_USERS_KEY, {});
    const rec = users[cleanEmail];
    if (!rec) {
      const err = new Error("User not found");
      err.code = "auth/user-not-found";
      throw err;
    }
    const hash = await hashPassword(password, rec.salt);
    if (hash !== rec.hash) {
      const err = new Error("Wrong password");
      err.code = "auth/wrong-password";
      throw err;
    }
    localStorage.setItem(LOCAL_SESSION_KEY, cleanEmail);
    currentUser = toPublicLocal(rec);
    emit();
    return currentUser;
  }

  async function signOut() {
    if (mode === "firebase" && fbAuth) {
      await fbAuth.signOut();
    } else {
      localStorage.removeItem(LOCAL_SESSION_KEY);
      currentUser = null;
      emit();
    }
  }

  async function saveResult(result) {
    await init();
    const user = currentUser;
    const record = Object.assign({}, result, {
      uid: user ? user.uid : "guest",
      name: user ? user.name : "Guest",
      createdAt: Date.now(),
    });

    if (mode === "firebase" && user) {
      try {
        const ref = await fbDb.collection(FIRESTORE_RESULTS).add(record);
        const saved = Object.assign({}, record, { id: ref.id });
        // Keep a local mirror so the player always sees their own history even
        // if the cloud copy is later unreachable.
        saveLocalResult(saved);
        return saved;
      } catch (e) {
        // E.g. Firestore rules reject the write. Keep the result locally so it
        // still appears in the player's Custom board instead of vanishing.
        console.warn("[GeoLeban] Cloud save failed; keeping a local copy.", e);
        return saveLocalResult(record);
      }
    }

    return saveLocalResult(record);
  }

  async function getMyResults() {
    await init();
    if (mode === "firebase" && currentUser) {
      let remote = [];
      try {
        const snap = await fbDb
          .collection(FIRESTORE_RESULTS)
          .where("uid", "==", currentUser.uid)
          .get();
        remote = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      } catch (e) {
        console.warn("[GeoLeban] Could not load your cloud results.", e);
      }
      const local = localResults().filter((r) => r.uid === currentUser.uid);
      return mergeResults(remote, local).sort(
        (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      );
    }
    const all = localResults();
    return all
      .filter((r) => !currentUser || r.uid === currentUser.uid)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function getAllResults() {
    await init();
    if (mode === "firebase") {
      let remote = [];
      try {
        const snap = await fbDb
          .collection(FIRESTORE_RESULTS)
          .orderBy("points", "desc")
          .limit(300)
          .get();
        remote = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      } catch (e) {
        // Missing index or offline: fall back to a plain fetch + client sort.
        try {
          const snap = await fbDb.collection(FIRESTORE_RESULTS).limit(300).get();
          remote = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
          remote.sort((a, b) => (b.points || 0) - (a.points || 0));
        } catch (e2) {
          console.warn("[GeoLeban] Could not load the leaderboard.", e2);
        }
      }
      return mergeResults(remote, localResults());
    }
    return localResults();
  }

  function getPreferences() {
    return readLocalPrefs();
  }

  async function savePreferences(prefs) {
    const patch = prefs && typeof prefs === "object" ? prefs : {};
    const merged = Object.assign(readLocalPrefs(), patch);
    writeLocalPrefs(merged);

    // Also persist to the user's profile so preferences follow the account.
    try {
      await init();
      if (mode === "firebase" && currentUser) {
        await fbDb
          .collection(FIRESTORE_PROFILES)
          .doc(currentUser.uid)
          .set(patch, { merge: true });
        currentUser.prefs = Object.assign(currentUser.prefs || {}, patch);
      }
    } catch (e) {
      console.warn("[GeoLeban] Could not save preferences.", e);
    }
    return merged;
  }

  // Keeps the player's stored results in sync after a name change so the
  // leaderboard shows the new name.
  async function renameResults(uid, name) {
    const locals = localResults();
    let changed = false;
    locals.forEach((r) => {
      if (r.uid === uid && r.name !== name) {
        r.name = name;
        changed = true;
      }
    });
    if (changed) writeJSON(LOCAL_RESULTS_KEY, locals);

    if (mode !== "firebase") return;
    try {
      const snap = await fbDb
        .collection(FIRESTORE_RESULTS)
        .where("uid", "==", uid)
        .get();
      if (snap.empty) return;
      const batch = fbDb.batch();
      snap.docs.forEach((doc) => batch.update(doc.ref, { name: name }));
      await batch.commit();
    } catch (e) {
      // Rules may forbid updating results; the new name still applies to new
      // rounds, so don't fail the whole rename because of this.
      console.warn("[GeoLeban] Could not rename past results.", e);
    }
  }

  async function updateName(name) {
    await init();
    const clean = (name || "").trim();
    if (!clean) {
      const err = new Error("Name required");
      err.code = "app/name-required";
      throw err;
    }
    if (!currentUser) {
      const err = new Error("Not signed in");
      err.code = "app/not-signed-in";
      throw err;
    }
    const uid = currentUser.uid;

    if (mode === "firebase") {
      if (fbAuth.currentUser) {
        try {
          await fbAuth.currentUser.updateProfile({ displayName: clean });
        } catch (e) {
          console.warn("[GeoLeban] Could not update auth profile.", e);
        }
      }
      await fbDb
        .collection(FIRESTORE_PROFILES)
        .doc(uid)
        .set({ name: clean }, { merge: true });
    } else {
      const users = readJSON(LOCAL_USERS_KEY, {});
      Object.keys(users).forEach((email) => {
        if (users[email].uid === uid) {
          users[email].name = clean;
          localStorage.setItem(LOCAL_SESSION_KEY, email);
        }
      });
      writeJSON(LOCAL_USERS_KEY, users);
    }

    await renameResults(uid, clean);
    currentUser.name = clean;
    emit();
    return currentUser;
  }

  async function updatePassword(currentPassword, newPassword) {
    await init();
    if (!currentUser) {
      const err = new Error("Not signed in");
      err.code = "app/not-signed-in";
      throw err;
    }
    if (!newPassword || newPassword.length < 6) {
      const err = new Error("Weak password");
      err.code = "auth/weak-password";
      throw err;
    }

    if (mode === "firebase") {
      const user = fbAuth.currentUser;
      if (!user) {
        const err = new Error("Not signed in");
        err.code = "app/not-signed-in";
        throw err;
      }
      const cred = firebase.auth.EmailAuthProvider.credential(
        user.email,
        currentPassword || "",
      );
      await user.reauthenticateWithCredential(cred);
      await user.updatePassword(newPassword);
      return true;
    }

    const users = readJSON(LOCAL_USERS_KEY, {});
    const email = localStorage.getItem(LOCAL_SESSION_KEY);
    const rec = users[email];
    if (!rec) {
      const err = new Error("User not found");
      err.code = "auth/user-not-found";
      throw err;
    }
    const hash = await hashPassword(currentPassword || "", rec.salt);
    if (hash !== rec.hash) {
      const err = new Error("Wrong password");
      err.code = "auth/wrong-password";
      throw err;
    }
    const salt = randomSalt();
    rec.salt = salt;
    rec.hash = await hashPassword(newPassword, salt);
    writeJSON(LOCAL_USERS_KEY, users);
    return true;
  }

  return {
    init,
    onAuthChange,
    getCurrentUser,
    isRemote,
    signUp,
    signIn,
    signOut,
    saveResult,
    getMyResults,
    getAllResults,
    getPreferences,
    savePreferences,
    updateName,
    updatePassword,
  };
})();
