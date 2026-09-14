# GeoLeban — Firebase Setup

> **Status: connected.** `js/firebase-config.js` is already filled in with the
> `geoleban` project's web config and the app uses Firebase automatically.
> If the config is ever cleared (or the network is unreachable), the game falls
> back to **local mode** (accounts and scores in `localStorage`).

To finish enabling the shared cloud leaderboard, confirm these steps in the
[Firebase console](https://console.firebase.google.com/project/geoleban):

- **Step 2** — Email/Password sign-in is enabled.
- **Step 3** — Cloud Firestore database exists.
- **Step 5** — Firestore security rules are published.
- **Step 6** — Your hosting domain is authorized (localhost works by default).

Steps 1 and 4 are already done for this project and are kept below for
reference.

---

## 1. Create a Firebase project *(already done)*

1. Go to <https://console.firebase.google.com/> and sign in with a Google account.
2. Click **Add project**, give it a name (e.g. `geoleban`), and finish the wizard.
   - Google Analytics is optional; you can disable it.


## 2. Enable Email/Password sign-in

1. In the left menu open **Build → Authentication**.
2. Click **Get started**.
3. Under **Sign-in method** choose **Email/Password**, toggle **Enable**, and save.
   - Leave "Email link (passwordless sign-in)" disabled.

## 3. Create the Firestore database

1. In the left menu open **Build → Firestore Database**.
2. Click **Create database**.
3. Choose a location close to you and start in **Production mode**.

## 4. Register a web app and copy the config *(already done)*

1. Go to **Project settings** (gear icon) → **General**.
2. Scroll to **Your apps**, click the **`</>`** (Web) icon.
3. Give it a nickname (e.g. `geoleban-web`) and click **Register app**.
   - Do **not** enable Firebase Hosting unless you want it.
4. Copy the `firebaseConfig = { ... }` block.
5. Open `js/firebase-config.js` and paste the values into `FIREBASE_CONFIG`:

```js
const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "geoleban.firebaseapp.com",
  projectId: "geoleban",
  storageBucket: "geoleban.firebasestorage.app",
  messagingSenderId: "120391547497",
  appId: "1:120391547497:web:dfa8f8fba213a8d82700f8",
  measurementId: "G-43CK2VEN44",
};
```

> These keys are safe to expose in client code. Your data is protected by the
> security rules in the next step (not by hiding the keys).

## 5. Set Firestore security rules

Open **Firestore Database → Rules**, replace the contents with the following,
and click **Publish**:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // An admin is any signed-in user whose UID is listed in "admins".
    function isAdmin() {
      return request.auth != null
        && exists(/databases/$(database)/documents/admins/$(request.auth.uid));
    }

    // Each user can read/write only their own profile (it contains email);
    // admins can manage every profile.
    match /profiles/{userId} {
      allow read, write: if request.auth != null
                         && (request.auth.uid == userId || isAdmin());
    }

    // The admin allow-list is managed only from the Firebase console.
    match /admins/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false;
    }

    // Blocked emails: anyone can read (the game checks it), only admins write.
    match /blockedEmails/{email} {
      allow read: if true;
      allow write: if isAdmin();
    }

    // Results are public to read for the leaderboard.
    match /results/{resultId} {
      allow read: if true;
      allow create: if request.auth != null
                    && request.resource.data.uid == request.auth.uid
                    && request.resource.data.mode in ['gov', 'caza', 'city']
                    && request.resource.data.input in ['click', 'type']
                    && request.resource.data.points is int
                    && request.resource.data.points >= 0;
      // Owners may rename only their own past results; admins can edit/remove.
      allow update: if isAdmin() || (request.auth != null
                    && request.auth.uid == resource.data.uid
                    && request.auth.uid == request.resource.data.uid
                    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name']));
      allow delete: if isAdmin();
    }
  }
}
```

> The rules you get by default (`match /{document=**} { allow read, write: if false; }`)
> deny everything, so sign-up succeeds but the profile write and score saves
> fail silently. Replace them with the block above.


## 6. Allow your domain (for testing / hosting)

- `localhost` and `127.0.0.1` are allowed by default.
- If you host the game online, add the domain under
  **Authentication → Settings → Authorized domains**.

## 7. Run the project from a web server (important)

Firebase Authentication does **not** work when the page is opened directly as a
`file://` path. Serve the folder over HTTP. Any of these works:

```powershell
# Option A: Python (usually pre-installed)
python -m http.server 8000

# Option B: Node
npx serve .

# Option C: VS Code "Live Server" extension
#   right-click index.html -> Open with Live Server
```

Then open <http://localhost:8000>.

> The local fallback mode *does* work from `file://`, but the cloud features
> require HTTP(S). When opened via `file://` on some browsers,
> `crypto.subtle` is unavailable and a weaker local hash is used — another
> reason to use a local server.

---

## 8. Admin portal (optional)

`admin.html` is a small standalone page (no map, no game) that lets an admin:

- see the registered users (name + email),
- block / unblock an email (blocked emails can't sign in or sign up),
- delete a user's data (profile + results) and block them,
- change the admin username and password.

**One-time setup**

1. In **Authentication → Users**, click **Add user** and create the admin
   account. The username is the part before the domain:
   - **Email:** `username@geoleban.app` (for the login name `username`)
   - **Password:** `password` (change it later from the portal)
2. Copy that user's **UID**.
3. In **Firestore Database**, create a collection named `admins`, add a document
   whose **document ID is that UID**, and give it any field (e.g. `admin` = `true`).
4. Publish the rules from step 5 (they use the `admins` collection).
5. Open `admin.html` (locally, or at
   `https://<your-username>.github.io/GeoLeban/admin.html`) and log in with
   `username` / `password`.

> **Note:** the page is client-only. "Delete" removes the user's profile and
> results and blocks their email; it does **not** delete the Firebase Auth login
> itself (that requires the Admin SDK / Cloud Functions). A blocked user can no
> longer sign in or register.

## Data model

| Collection | Document | Fields |
| --- | --- | --- |
| `profiles` | `{uid}` | `name`, `email`, `createdAt` |
| `results` | auto id | `uid`, `name`, `mode`, `input`, `total`, `solved`, `accuracy`, `elapsedMs`, `limitMs`, `completed`, `points`, `custom`, `createdAt` |

- `mode`: `"gov"` (governorates), `"caza"` (districts) or `"city"` (cities & villages)
- `input`: `"click"` or `"type"`
- `completed`: whether the round finished before a timer expired
- `custom`: `true` for modified-count / hand-picked rounds (shown only in the Custom tab)
- `points`: 100/60/30 per question depending on the attempt it was solved on

> **Important:** the security rule above must allow `mode == "city"`, otherwise
> every custom city round is rejected by Firestore. The app now also keeps a
> local copy of your own results, so they still appear in your Custom board even
> if the cloud write fails — but republish the rules to persist them online.

Passwords are handled entirely by Firebase Authentication and are **never**
stored in Firestore.

## Scoring & ranking

- A question solved on the 1st attempt = **100** pts, 2nd = **60**, 3rd = **30**,
  failed/revealed = **0**.
- Accuracy = `solved / total × 100` (unanswered questions after a timeout count
  as wrong).
- Leaderboard ranks by **points**, then accuracy, then fastest time.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Badge "Local mode" is visible | `js/firebase-config.js` still has placeholders, or the page isn't served over HTTP. |
| `auth/operation-not-allowed` | Email/Password sign-in isn't enabled (step 2). |
| `auth/unauthorized-domain` | Add your domain under Authentication → Settings → Authorized domains (step 6). |
| `Missing or insufficient permissions` | Re-check the Firestore rules (step 5). |
| Leaderboard empty but results save | In Firestore, the `results` collection starts empty; play a round first. |
