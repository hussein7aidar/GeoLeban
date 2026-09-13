/**
 * Firebase configuration.
 *
 * This project is connected to the "geoleban" Firebase project.
 *
 * If these values are ever cleared, the game automatically falls back to
 * local mode (results stored in this browser only).
 *
 * Step-by-step instructions: see FIREBASE_SETUP.md
 *
 * NOTE: These keys are safe to expose in client-side code. Your data is
 * protected by the Firestore security rules described in FIREBASE_SETUP.md.
 */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBa_L5W92cNZfU1g4b2LOw-NfbhI1sggjo",
  authDomain: "geoleban.firebaseapp.com",
  projectId: "geoleban",
  storageBucket: "geoleban.firebasestorage.app",
  messagingSenderId: "120391547497",
  appId: "1:120391547497:web:dfa8f8fba213a8d82700f8",
  measurementId: "G-43CK2VEN44",
};

/**
 * Returns true only when the minimum required Firebase fields are filled in.
 */
function isFirebaseConfigured() {
  return Boolean(
    FIREBASE_CONFIG.apiKey &&
      FIREBASE_CONFIG.authDomain &&
      FIREBASE_CONFIG.projectId &&
      FIREBASE_CONFIG.appId,
  );
}
