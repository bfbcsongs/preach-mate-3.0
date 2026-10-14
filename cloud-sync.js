(() => {
  "use strict";

  const NOTES_KEY = "notepal_notes_v2";
  const CATEGORIES_KEY = "notepal_categories_v2";
  const LOGO_KEY = "preach_mate_logo_v1";

  const SYNC_INTERVAL = 2500;

  let db = null;
  let currentUid = null;
  let cloudReady = false;
  let syncing = false;
  let timer = null;
  let lastSnapshot = "";
  let lastErrorMessage = "";
  let authGeneration = 0;

  function readLocal(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function readLogo() {
    try {
      return localStorage.getItem(LOGO_KEY) || "";
    } catch (error) {
      return "";
    }
  }

  function makeSnapshot() {
    const app = window.PreachMateApp;

    if (app && typeof app.getCloudData === "function") {
      return JSON.stringify(app.getCloudData());
    }

    return JSON.stringify({
      notes: readLocal(NOTES_KEY, []),
      categories: readLocal(CATEGORIES_KEY, [
        "All Notes", "Personal", "Study", "Work", "Ideas"
      ]),
      logo: readLogo()
    });
  }

  function getUser() {
    const api = window.PreachMateFirebase;
    return api && typeof api.getCurrentUser === "function"
      ? api.getCurrentUser()
      : null;
  }

  function getDatabase() {
    const api = window.PreachMateFirebase;
    return api && typeof api.getFirestore === "function"
      ? api.getFirestore()
      : null;
  }

  function showSyncError(error) {
    console.error("Preach Mate cloud sync error:", error);

    const message = error?.message || "Unknown cloud sync error";

    if (message !== lastErrorMessage) {
      lastErrorMessage = message;
      console.warn("Cloud sync failed. Check your connection and Firebase settings.");
    }
  }

  function normalizeCategories(input, notes) {
    const result = ["All Notes"];

    if (Array.isArray(input)) {
      input.forEach(category => {
        if (typeof category !== "string") return;

        category = category.trim();

        if (category && category !== "All Notes" && !result.includes(category)) {
          result.push(category);
        }
      });
    }

    if (!result.some(category => category !== "All Notes")) {
      result.push("Personal");
    }

    if (Array.isArray(notes)) {
      notes.forEach(note => {
        const category = typeof note?.category === "string"
          ? note.category.trim()
          : "";

        if (category && category !== "All Notes" && !result.includes(category)) {
          result.push(category);
        }
      });
    }

    return result;
  }

  function normalizeNotes(input, categories) {
    if (!Array.isArray(input)) return [];

    return input
      .filter(note => note && typeof note === "object")
      .map(note => {
        const result = { ...note };

        if (typeof result.id !== "string" || !result.id) {
          result.id = "n_" + Date.now().toString(36) +
            "_" + Math.random().toString(36).slice(2, 8);
        }

        if (typeof result.title !== "string") result.title = "";
        if (typeof result.content !== "string") result.content = "";
        if (typeof result.favorite !== "boolean") result.favorite = false;
        if (typeof result.pinned !== "boolean") result.pinned = false;

        if (
          typeof result.category !== "string" ||
          !categories.includes(result.category)
        ) {
          result.category =
            categories.find(category => category !== "All Notes") || "Personal";
        }

        if (!Number.isFinite(Number(result.updated))) {
          result.updated = Date.now();
        }

        return result;
      });
  }

  function notesCollection(uid) {
    return db.collection("users").doc(uid).collection("notes");
  }

  function settingsDocument(uid) {
    return db.collection("users").doc(uid)
      .collection("settings").doc("app");
  }

  async function readCloud(uid) {
    const [notesSnapshot, settingsSnapshot] = await Promise.all([
      notesCollection(uid).get(),
      settingsDocument(uid).get()
    ]);

    const notes = [];

    notesSnapshot.forEach(document => {
      const data = document.data() || {};

      notes.push({
        ...data,
        id: typeof data.id === "string" && data.id
          ? data.id
          : document.id
      });
    });

    const settings = settingsSnapshot.exists
      ? settingsSnapshot.data() || {}
      : {};

    return {
      notes,
      settings,
      hasCloudData:
        settings.initialized === true ||
        notesSnapshot.size > 0
    };
  }

  function saveLogoLocally(logo) {
    try {
      if (typeof logo === "string" && logo.startsWith("data:image/")) {
        localStorage.setItem(LOGO_KEY, logo);
      } else if (logo === "") {
        localStorage.removeItem(LOGO_KEY);
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  async function restoreCloud(uid, cloud) {
    if (getUser()?.uid !== uid) return;

    const settings = cloud.settings || {};

    const categories = normalizeCategories(
      settings.categories,
      cloud.notes
    );

    const notes = normalizeNotes(cloud.notes, categories);

    /*
     * Restore through app.js so its in-memory data and UI
     * are updated without reloading the page.
     */
    const app = window.PreachMateApp;

    if (!app || typeof app.applyCloudData !== "function") {
      throw new Error(
        "Preach Mate app bridge is missing. Update app.js first."
      );
    }

    const logo = typeof settings.logo === "string"
      ? settings.logo
      : undefined;

    app.applyCloudData({
      notes,
      categories,
      logo
    });

    lastSnapshot = makeSnapshot();
    cloudReady = true;
    lastErrorMessage = "";

    console.log("Preach Mate: cloud backup restored.");
  }

  async function uploadLocal(uid) {
    if (getUser()?.uid !== uid) {
      throw new Error("Account changed during sync.");
    }

    const data = JSON.parse(makeSnapshot());

    const initialCategories = normalizeCategories(
      data.categories,
      data.notes
    );

    const notes = normalizeNotes(data.notes, initialCategories);
    const categories = normalizeCategories(data.categories, notes);

    const collection = notesCollection(uid);
    const settingsRef = settingsDocument(uid);

    const existing = await collection.get();

    if (getUser()?.uid !== uid) {
      throw new Error("Account changed during sync.");
    }

    const localIds = new Set(notes.map(note => String(note.id)));
    const operations = [];

    existing.forEach(document => {
      if (!localIds.has(document.id)) {
        operations.push({ type: "delete", ref: document.ref });
      }
    });

    notes.forEach(note => {
      const id = String(note.id);

      operations.push({
        type: "set",
        ref: collection.doc(id),
        data: { ...note, id }
      });
    });

    while (operations.length) {
      const batch = db.batch();
      const chunk = operations.splice(0, 400);

      chunk.forEach(operation => {
        if (operation.type === "delete") {
          batch.delete(operation.ref);
        } else {
          batch.set(operation.ref, operation.data);
        }
      });

      await batch.commit();
    }

    if (getUser()?.uid !== uid) {
      throw new Error("Account changed during sync.");
    }

    await settingsRef.set({
      categories,
      logo: data.logo || "",
      initialized: true,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    lastSnapshot = makeSnapshot();
    lastErrorMessage = "";

    console.log("Preach Mate: cloud backup updated.");
  }

  async function waitForAppReady() {
    if (window.PreachMateApp?.isReady === true) return;

    await new Promise((resolve, reject) => {
      let finished = false;

      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        window.removeEventListener("preachmate:app-ready", done);
        resolve();
      };

      const timeout = setTimeout(() => {
        if (finished) return;
        finished = true;
        window.removeEventListener("preachmate:app-ready", done);
        reject(new Error("Preach Mate app startup timed out."));
      }, 15000);

      window.addEventListener("preachmate:app-ready", done);

      if (window.PreachMateApp?.isReady === true) done();
    });
  }

  async function initializeCloud(uid) {
    if (!uid) return;

    const generation = ++authGeneration;

    currentUid = uid;
    cloudReady = false;
    syncing = true;
    db = getDatabase();

    try {
      if (!db) {
        throw new Error("Firebase Firestore is unavailable.");
      }

      await waitForAppReady();

      if (generation !== authGeneration || getUser()?.uid !== uid) return;

      const cloud = await readCloud(uid);

      if (generation !== authGeneration || getUser()?.uid !== uid) return;

      if (cloud.hasCloudData) {
        await restoreCloud(uid, cloud);
        return;
      }

      /*
       * First-time backup only. Never upload local defaults
       * over an already initialized cloud backup.
       */
      await uploadLocal(uid);

      if (generation !== authGeneration || getUser()?.uid !== uid) return;

      cloudReady = true;
      lastSnapshot = makeSnapshot();

      console.log("Preach Mate: first cloud backup created.");
    } catch (error) {
      cloudReady = false;
      showSyncError(error);
    } finally {
      if (generation === authGeneration) syncing = false;
    }
  }

  async function checkForLocalChanges() {
    if (!cloudReady || syncing || !currentUid) return;

    const uid = currentUid;

    if (getUser()?.uid !== uid) {
      stopSync();
      return;
    }

    const snapshot = makeSnapshot();

    if (snapshot === lastSnapshot) return;

    syncing = true;

    try {
      await uploadLocal(uid);

      if (currentUid === uid && getUser()?.uid === uid) {
        lastSnapshot = makeSnapshot();
      }
    } catch (error) {
      showSyncError(error);
    } finally {
      syncing = false;
    }
  }

  function stopSync() {
    ++authGeneration;
    cloudReady = false;
    syncing = false;
    currentUid = null;
    lastSnapshot = "";
  }

  function handleAuthState(user) {
    if (!user) {
      stopSync();
      return;
    }

    if (currentUid === user.uid && (cloudReady || syncing)) return;

    initializeCloud(user.uid);
  }

  window.addEventListener("preachmate:auth-state-changed", event => {
    handleAuthState(event.detail?.user || null);
  });

  window.addEventListener("preachmate:app-ready", () => {
    const user = getUser();
    if (user) handleAuthState(user);
  });

  window.addEventListener("storage", () => {
    if (cloudReady) checkForLocalChanges();
  });

  if (!timer) {
    timer = setInterval(checkForLocalChanges, SYNC_INTERVAL);
  }

  handleAuthState(getUser());
})();
