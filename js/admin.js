/**
 * GeoLeban admin portal (standalone, client-only).
 *
 * - Admin signs in with username + password. A username is mapped to the
 *   Firebase Auth email "<username>@geoleban.app".
 * - Only accounts whose UID exists in the "admins" Firestore collection are
 *   treated as admins (create that document once from the Firebase console).
 * - The page can: list users (name/email), block/unblock an email, delete a
 *   user's data (profile + results) and block them, and change the admin
 *   username/password.
 *
 * It does NOT play the game and has no map.
 */
(function () {
  "use strict";

  const ADMIN_DOMAIN = "geoleban.app";
  const $ = (id) => document.getElementById(id);

  if (typeof isFirebaseConfigured !== "function" || !isFirebaseConfigured()) {
    $("login-msg").textContent =
      "Firebase is not configured (js/firebase-config.js).";
    return;
  }

  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();

  let adminUser = null;

  /* ------------------------------- Helpers -------------------------------- */

  function usernameToEmail(username) {
    const s = (username || "").trim().toLowerCase();
    if (!s) return "";
    return s.indexOf("@") !== -1 ? s : s + "@" + ADMIN_DOMAIN;
  }

  function friendly(err) {
    const code = err && err.code;
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
      return "Wrong password.";
    }
    if (code === "auth/user-not-found") {
      return "No admin account for that username. Create it in the Firebase console first.";
    }
    if (code === "auth/invalid-email" || code === "auth/invalid-login-credentials") {
      return "Invalid username or password.";
    }
    if (code === "auth/email-already-in-use") {
      return "That username is already taken.";
    }
    if (code === "auth/too-many-requests") {
      return "Too many attempts. Try again later.";
    }
    if (code === "auth/requires-recent-login") {
      return "Please log in again and retry.";
    }
    if (code === "auth/network-request-failed") {
      return "Network error.";
    }
    if (code === "permission-denied") {
      return "Permission denied — check the Firestore rules.";
    }
    return (err && err.message) || "Something went wrong.";
  }

  function setMsg(el, text, ok) {
    el.textContent = text || "";
    el.className = "msg" + (ok ? " ok" : "");
  }

  async function refresh() {
    setMsg($("users-msg"), "Loading…");
    let users = [];
    let blocked = [];
    try {
      const profiles = await db.collection("profiles").get();
      users = profiles.docs.map((d) => Object.assign({ uid: d.id }, d.data()));
    } catch (e) {
      setMsg($("users-msg"), "Could not load users: " + friendly(e));
      return;
    }
    try {
      const snap = await db.collection("blockedEmails").get();
      blocked = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    } catch (e) {
      /* blocked list is optional */
    }
    setMsg($("users-msg"), "");
    renderUsers(users, blocked);
    renderBlocked(blocked);
  }

  /* ------------------------------ Rendering ------------------------------- */

  function renderUsers(users, blocked) {
    const blockedEmails = new Set(
      blocked.map((b) => (b.email || b.id || "").toLowerCase()),
    );
    const body = $("users-body");
    body.innerHTML = "";
    users
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .forEach((u) => {
        const email = (u.email || "").toLowerCase();
        const isBlocked = blockedEmails.has(email);
        const tr = document.createElement("tr");

        const tdName = document.createElement("td");
        tdName.textContent = u.name || "—";
        tr.appendChild(tdName);

        const tdEmail = document.createElement("td");
        tdEmail.textContent = email || "—";
        tr.appendChild(tdEmail);

        const tdUid = document.createElement("td");
        tdUid.textContent = u.uid;
        tr.appendChild(tdUid);

        const tdCreated = document.createElement("td");
        tdCreated.textContent = u.createdAt
          ? new Date(u.createdAt).toLocaleString()
          : "—";
        tr.appendChild(tdCreated);

        const tdStatus = document.createElement("td");
        tdStatus.textContent = isBlocked ? "Blocked" : "Active";
        if (isBlocked) tdStatus.className = "danger";
        tr.appendChild(tdStatus);

        const tdActions = document.createElement("td");

        const blockBtn = document.createElement("button");
        blockBtn.textContent = isBlocked ? "Unblock" : "Block";
        blockBtn.addEventListener("click", () =>
          isBlocked ? unblockEmail(email) : blockEmail(email),
        );
        tdActions.appendChild(blockBtn);

        const delBtn = document.createElement("button");
        delBtn.textContent = "Delete";
        delBtn.className = "danger";
        delBtn.style.marginLeft = "6px";
        delBtn.addEventListener("click", () => deleteAccount(u.uid, email));
        tdActions.appendChild(delBtn);

        tr.appendChild(tdActions);
        body.appendChild(tr);
      });
    if (!users.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = "No users.";
      tr.appendChild(td);
      body.appendChild(tr);
    }
  }

  function renderBlocked(blocked) {
    const body = $("blocked-body");
    body.innerHTML = "";
    blocked
      .sort((a, b) => (b.blockedAt || 0) - (a.blockedAt || 0))
      .forEach((b) => {
        const email = b.email || b.id;
        const tr = document.createElement("tr");

        const tdEmail = document.createElement("td");
        tdEmail.textContent = email;
        tr.appendChild(tdEmail);

        const tdAt = document.createElement("td");
        tdAt.textContent = b.blockedAt
          ? new Date(b.blockedAt).toLocaleString()
          : "—";
        tr.appendChild(tdAt);

        const tdAction = document.createElement("td");
        const btn = document.createElement("button");
        btn.textContent = "Unblock";
        btn.addEventListener("click", () => unblockEmail(email));
        tdAction.appendChild(btn);
        tr.appendChild(tdAction);

        body.appendChild(tr);
      });
    if (!blocked.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.textContent = "No blocked emails.";
      tr.appendChild(td);
      body.appendChild(tr);
    }
  }

  /* ------------------------------ Operations ------------------------------ */

  async function blockEmail(email) {
    const clean = (email || "").trim().toLowerCase();
    if (!clean || clean.indexOf("@") === -1) {
      setMsg($("block-msg"), "Enter a valid email.");
      return;
    }
    try {
      await db.collection("blockedEmails").doc(clean).set({
        email: clean,
        blockedAt: Date.now(),
        by: adminUser ? adminUser.email : "",
      });
      setMsg($("block-msg"), "Blocked " + clean + ".", true);
      $("block-email").value = "";
      refresh();
    } catch (e) {
      setMsg($("block-msg"), friendly(e));
    }
  }

  async function unblockEmail(email) {
    const clean = (email || "").trim().toLowerCase();
    try {
      await db.collection("blockedEmails").doc(clean).delete();
      setMsg($("block-msg"), "Unblocked " + clean + ".", true);
      refresh();
    } catch (e) {
      setMsg($("block-msg"), friendly(e));
    }
  }

  async function deleteAccount(uid, email) {
    if (
      !window.confirm(
        "Delete this user's data (profile + results) and block " +
          (email || "this account") +
          "?",
      )
    ) {
      return;
    }
    try {
      // Delete results in chunks (Firestore batch limit is 500).
      const snap = await db
        .collection("results")
        .where("uid", "==", uid)
        .get();
      const refs = snap.docs.map((d) => d.ref);
      for (let i = 0; i < refs.length; i += 450) {
        const batch = db.batch();
        refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }
      await db.collection("profiles").doc(uid).delete();
      if (email) {
        await db.collection("blockedEmails").doc(email).set({
          email: email,
          blockedAt: Date.now(),
          by: adminUser ? adminUser.email : "",
        });
      }
      setMsg($("users-msg"), "Deleted data for " + (email || uid) + ".", true);
      refresh();
    } catch (e) {
      setMsg($("users-msg"), friendly(e));
    }
  }

  async function saveCredentials() {
    const cur = $("cred-current").value;
    const newUser = $("cred-username").value.trim();
    const newPass = $("cred-password").value;
    const msgEl = $("cred-msg");
    setMsg(msgEl, "");
    if (!cur) return setMsg(msgEl, "Enter your current password.");
    if (!newUser && !newPass) return setMsg(msgEl, "Nothing to change.");
    if (newPass && newPass.length < 6) {
      return setMsg(msgEl, "New password must be at least 6 characters.");
    }
    const user = auth.currentUser;
    try {
      const cred = firebase.auth.EmailAuthProvider.credential(user.email, cur);
      await user.reauthenticateWithCredential(cred);
      if (newUser) await user.updateEmail(usernameToEmail(newUser));
      if (newPass) await user.updatePassword(newPass);
      setMsg(msgEl, "Credentials updated.", true);
      $("cred-current").value = "";
      $("cred-username").value = "";
      $("cred-password").value = "";
      $("who").textContent = user.email;
    } catch (e) {
      setMsg(msgEl, friendly(e));
    }
  }

  /* --------------------------------- Views -------------------------------- */

  async function isAdmin(uid) {
    try {
      const doc = await db.collection("admins").doc(uid).get();
      return doc.exists;
    } catch (e) {
      return false;
    }
  }

  function showLogin() {
    adminUser = null;
    $("login-view").classList.remove("hidden");
    $("portal-view").classList.add("hidden");
  }

  function showPortal(user) {
    adminUser = user;
    $("login-view").classList.add("hidden");
    $("portal-view").classList.remove("hidden");
    $("who").textContent = user.email;
    refresh();
  }

  /* ------------------------------- Bindings ------------------------------- */

  $("login-btn").addEventListener("click", async () => {
    const username = $("login-user").value.trim();
    const password = $("login-pass").value;
    setMsg($("login-msg"), "");
    if (!username || !password) {
      setMsg($("login-msg"), "Enter username and password.");
      return;
    }
    try {
      await auth.signInWithEmailAndPassword(
        usernameToEmail(username),
        password,
      );
      $("login-pass").value = "";
    } catch (e) {
      setMsg($("login-msg"), friendly(e));
    }
  });

  $("login-pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("login-btn").click();
  });

  $("logout-btn").addEventListener("click", () => auth.signOut());
  $("refresh-btn").addEventListener("click", refresh);
  $("block-btn").addEventListener("click", () =>
    blockEmail($("block-email").value),
  );
  $("cred-save").addEventListener("click", saveCredentials);

  auth.onAuthStateChanged(async (user) => {
    if (user && (await isAdmin(user.uid))) {
      showPortal(user);
    } else {
      // Do not sign non-admins out here; they may still be logged into the game.
      showLogin();
    }
  });
})();
