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
  const FIRESTORE_RESULTS = "results";
  const FIRESTORE_PROFILES = "profiles";

  let mode = "local"; // "firebase" | "local"
  let started = false;
  let fbAuth = null;
  let fbDb = null;
  let currentUser = null; // { uid, name, email }
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
    try {
      const doc = await fbDb.collection(FIRESTORE_PROFILES).doc(fbUser.uid).get();
      if (doc.exists) {
        const data = doc.data();
        if (data.name) name = data.name;
        if (data.email) email = data.email;
      }
    } catch (e) {
      console.warn("[GeoLeban] Could not read profile.", e);
    }
    if (!name) name = email ? email.split("@")[0] : "Player";
    return { uid: fbUser.uid, name, email };
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
      const ref = await fbDb.collection(FIRESTORE_RESULTS).add(record);
      return Object.assign(record, { id: ref.id });
    }

    const all = readJSON(LOCAL_RESULTS_KEY, []);
    const withId = Object.assign(record, { id: makeId() });
    all.push(withId);
    writeJSON(LOCAL_RESULTS_KEY, all);
    return withId;
  }

  async function getMyResults() {
    await init();
    if (mode === "firebase" && currentUser) {
      try {
        const snap = await fbDb
          .collection(FIRESTORE_RESULTS)
          .where("uid", "==", currentUser.uid)
          .get();
        const arr = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
        arr.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return arr;
      } catch (e) {
        console.warn("[GeoLeban] Could not load your results.", e);
        return [];
      }
    }
    const all = readJSON(LOCAL_RESULTS_KEY, []);
    return all
      .filter((r) => !currentUser || r.uid === currentUser.uid)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function getAllResults() {
    await init();
    if (mode === "firebase") {
      try {
        const snap = await fbDb
          .collection(FIRESTORE_RESULTS)
          .orderBy("points", "desc")
          .limit(300)
          .get();
        return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      } catch (e) {
        // Missing index or offline: fall back to a plain fetch + client sort.
        try {
          const snap = await fbDb.collection(FIRESTORE_RESULTS).limit(300).get();
          const arr = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
          arr.sort((a, b) => (b.points || 0) - (a.points || 0));
          return arr;
        } catch (e2) {
          console.warn("[GeoLeban] Could not load the leaderboard.", e2);
          return [];
        }
      }
    }
    return readJSON(LOCAL_RESULTS_KEY, []);
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
  };
})();
