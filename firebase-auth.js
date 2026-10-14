/* ==========================================
   PREACH MATE — FIREBASE AUTH
   Login • Register • Google • Password Reset
   ========================================== */

(function () {
  "use strict";

  /* ==========================================
     FIREBASE CONFIG
     ========================================== */

  const firebaseConfig = {
    apiKey: "AIzaSyBLXaXG8EcxhGxqZCkFiqzLp9uF7vnYZS0",
    authDomain: "preach-mate.firebaseapp.com",
    projectId: "preach-mate",
    storageBucket: "preach-mate.firebasestorage.app",
    messagingSenderId: "977514996603",
    appId: "1:977514996603:web:76f5a961497af7dcb553de"
  };

  let auth = null;
  let db = null;
  let currentUser = null;
  let currentAuthMode = "login";
  let authReady = false;
  let authBusy = false;

  /* ==========================================
     TOAST
     ========================================== */

  function showToast(message) {
    if (typeof window.showToast === "function") {
      window.showToast(message);
      return;
    }

    let toast = document.getElementById(
      "pm-auth-toast"
    );

    if (!toast) {
      toast = document.createElement("div");
      toast.id = "pm-auth-toast";

      toast.style.cssText = `
        position:fixed;
        left:50%;
        bottom:28px;
        transform:translateX(-50%);
        z-index:1000000;
        max-width:90%;
        padding:12px 18px;
        border-radius:12px;
        background:#27272a;
        color:#fff;
        font-size:14px;
        box-shadow:0 5px 24px #0005;
        display:none;
        text-align:center;
      `;

      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.display = "block";

    clearTimeout(toast._timer);

    toast._timer = setTimeout(function () {
      toast.style.display = "none";
    }, 3500);
  }

  /* ==========================================
     ERROR MESSAGES
     ========================================== */

  function getFriendlyError(error) {
    const code = error && error.code
      ? error.code
      : "";

    const messages = {
      "auth/invalid-email":
        "Invalid email address.",

      "auth/user-not-found":
        "Walang account na gumagamit ng email na ito.",

      "auth/wrong-password":
        "Incorrect password.",

      "auth/invalid-credential":
        "Incorrect email or password.",

      "auth/email-already-in-use":
        "May account na gamit ang email na ito.",

      "auth/weak-password":
        "Gumamit ng mas malakas na password.",

      "auth/too-many-requests":
        "Masyadong maraming attempts. Subukan muli mamaya.",

      "auth/network-request-failed":
        "Network error. Tingnan ang internet connection.",

      "auth/popup-closed-by-user":
        "Isinara ang Google sign-in window.",

      "auth/popup-blocked":
        "Na-block ang Google sign-in popup.",

      "auth/cancelled-popup-request":
        "May naunang sign-in request na hindi pa tapos.",

      "auth/unauthorized-domain":
        "Hindi authorized ang domain na ito sa Firebase.",

      "auth/operation-not-allowed":
        "Hindi enabled ang sign-in method sa Firebase.",

      "auth/account-exists-with-different-credential":
        "May account na ang email na ito. Gamitin ang dating sign-in method.",

      "auth/credential-already-in-use":
        "Ang Google account na ito ay naka-link na sa ibang account.",

      "auth/requires-recent-login":
        "Mag-login muli bago gawin ang action na ito.",

      "auth/invalid-api-key":
        "Invalid ang Firebase API key.",

      "auth/app-not-authorized":
        "Hindi authorized ang app na ito sa Firebase."
    };

    if (messages[code]) {
      return messages[code];
    }

    if (error && error.message) {
      return (code ? code + ": " : "") +
        error.message;
    }

    return "May naganap na error. Subukan muli.";
  }

  function escapeHTML(value) {
    return String(value || "").replace(
      /[&<>"']/g,
      function (character) {
        const entities = {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        };

        return entities[character];
      }
    );
  }

  /* ==========================================
     FIREBASE INITIALIZATION
     ========================================== */

  function initFirebase() {
    try {
      if (!window.firebase) {
        console.error(
          "Firebase SDK is not loaded."
        );

        showToast(
          "Hindi nag-load ang Firebase. I-refresh ang app."
        );

        return false;
      }

      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }

      auth = firebase.auth();

      if (
        typeof firebase.firestore === "function"
      ) {
        db = firebase.firestore();
      }

      auth.onAuthStateChanged(
        function (user) {
          currentUser = user || null;
          authReady = true;

          renderAccountPanel();

          window.dispatchEvent(
            new CustomEvent(
              "preachmate:auth-state-changed",
              {
                detail: {
                  user: currentUser
                }
              }
            )
          );
        },
        function (error) {
          console.error(
            "Auth state error:",
            error
          );

          showToast(
            getFriendlyError(error)
          );
        }
      );

      return true;

    } catch (error) {
      console.error(
        "Firebase initialization error:",
        error
      );

      showToast(
        getFriendlyError(error)
      );

      return false;
    }
  }

  /* ==========================================
     STYLES
     ========================================== */

  function injectStyles() {
    if (
      document.getElementById(
        "pm-auth-styles"
      )
    ) {
      return;
    }

    const style = document.createElement("style");

    style.id = "pm-auth-styles";

    style.textContent = `
      #pm-account-panel {
        margin:12px 0;
        padding:14px;
        border-radius:14px;
        background:rgba(128,128,128,.08);
        border:1px solid rgba(128,128,128,.18);
        color:inherit;
        font-family:inherit;
      }

      #pm-account-panel * {
        box-sizing:border-box;
      }

      .pm-account-title {
        font-size:15px;
        font-weight:700;
        margin-bottom:5px;
      }

      .pm-account-subtitle {
        font-size:12px;
        opacity:.72;
        line-height:1.5;
        overflow-wrap:anywhere;
        margin-bottom:12px;
      }

      .pm-account-actions {
        display:flex;
        flex-direction:column;
        gap:8px;
      }

      .pm-auth-button {
        width:100%;
        min-height:42px;
        padding:10px 13px;
        border:1px solid rgba(128,128,128,.25);
        border-radius:10px;
        background:transparent;
        color:inherit;
        font:inherit;
        font-size:13px;
        font-weight:600;
        cursor:pointer;
        text-align:center;
      }

      .pm-auth-button:disabled {
        opacity:.55;
        cursor:wait;
      }

      .pm-auth-primary {
        background:#d97706;
        border-color:#d97706;
        color:#fff;
      }

      .pm-auth-google {
        background:#fff;
        color:#222;
        border-color:#ddd;
      }

      .pm-auth-danger {
        color:#ef4444;
      }

      #pm-auth-overlay {
        position:fixed;
        inset:0;
        z-index:999990;
        display:none;
        align-items:center;
        justify-content:center;
        padding:16px;
        background:rgba(0,0,0,.72);
        backdrop-filter:blur(5px);
        -webkit-backdrop-filter:blur(5px);
      }

      #pm-auth-overlay.pm-auth-visible {
        display:flex;
      }

      #pm-auth-modal {
        width:100%;
        max-width:420px;
        max-height:90vh;
        overflow-y:auto;
        position:relative;
        padding:24px;
        border-radius:20px;
        background:#202124;
        color:#f9fafb;
        border:1px solid #3f4145;
        box-shadow:0 20px 70px rgba(0,0,0,.5);
        font-family:inherit;
      }

      #pm-auth-modal * {
        box-sizing:border-box;
      }

      #pm-auth-close {
        position:absolute;
        top:12px;
        right:12px;
        width:36px;
        height:36px;
        border:0;
        border-radius:50%;
        background:#303134;
        color:#fff;
        font-size:23px;
        cursor:pointer;
      }

      .pm-auth-brand {
        text-align:center;
        margin:4px 0 22px;
      }

      .pm-auth-logo {
        width:54px;
        height:54px;
        display:flex;
        align-items:center;
        justify-content:center;
        margin:0 auto 12px;
        border-radius:16px;
        background:#d97706;
        color:#fff;
        font-size:25px;
        font-weight:800;
      }

      .pm-auth-brand h2 {
        margin:0 0 7px;
        font-size:23px;
        line-height:1.3;
      }

      .pm-auth-brand p {
        margin:0;
        font-size:13px;
        color:#b8b8bd;
        line-height:1.5;
      }

      .pm-auth-field {
        display:block;
        margin-bottom:15px;
      }

      .pm-auth-field span {
        display:block;
        margin-bottom:7px;
        font-size:13px;
        font-weight:600;
        color:#e5e7eb;
      }

      .pm-auth-field input {
        width:100%;
        min-height:46px;
        padding:12px;
        border:1px solid #484a50;
        border-radius:10px;
        outline:none;
        background:#292a2d;
        color:#fff;
        font:inherit;
        font-size:14px;
      }

      .pm-auth-field input:focus {
        border-color:#f59e0b;
        box-shadow:0 0 0 2px rgba(245,158,11,.15);
      }

      .pm-auth-field input::placeholder {
        color:#888b91;
      }

      .pm-auth-form .pm-auth-button {
        margin-top:4px;
        min-height:46px;
      }

      .pm-auth-divider {
        display:flex;
        align-items:center;
        gap:12px;
        margin:18px 0;
        color:#9ca3af;
        font-size:12px;
      }

      .pm-auth-divider::before,
      .pm-auth-divider::after {
        content:"";
        flex:1;
        height:1px;
        background:#414247;
      }

      .pm-auth-links {
        display:flex;
        flex-direction:column;
        align-items:center;
        gap:13px;
        margin-top:18px;
        text-align:center;
      }

      .pm-auth-link {
        padding:3px;
        border:0;
        background:none;
        color:#fbbf24;
        font:inherit;
        font-size:13px;
        cursor:pointer;
      }

      .pm-auth-message {
        display:none;
        margin-bottom:15px;
        padding:11px;
        border-radius:9px;
        background:#3b3030;
        color:#fecaca;
        font-size:13px;
        line-height:1.5;
        overflow-wrap:anywhere;
      }

      .pm-auth-message.pm-auth-success {
        background:#183528;
        color:#bbf7d0;
      }

      .pm-auth-note {
        margin-top:16px;
        color:#a1a1aa;
        font-size:11px;
        line-height:1.5;
        text-align:center;
      }

      @media (max-width:420px) {
        #pm-auth-modal {
          padding:21px 18px;
          border-radius:17px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  /* ==========================================
     ACCOUNT PANEL
     ========================================== */

  function findDrawer() {
    return (
      document.querySelector(".drawer") ||
      document.querySelector("#drawer") ||
      document.querySelector(".drawer-content") ||
      document.querySelector("#drawer-content") ||
      document.querySelector(".sidebar") ||
      document.querySelector("#sidebar")
    );
  }

  function ensureAccountPanel() {
  let panel = document.getElementById(
    "pm-account-panel"
  );

  if (panel) return panel;

  const drawer = findDrawer();

  if (!drawer) return null;

  panel = document.createElement("section");
  panel.id = "pm-account-panel";

  const footer = drawer.querySelector(".drawer-footer");

  if (footer) {
    drawer.insertBefore(panel, footer);
  } else {
    drawer.appendChild(panel);
  }

  return panel;
}


  function renderAccountPanel() {
    const panel = ensureAccountPanel();

    if (!panel) return;

    if (!authReady) {
      panel.innerHTML = `
        <div class="pm-account-title">
          Preach Mate Account
        </div>
        <div class="pm-account-subtitle">
          Checking account status...
        </div>
      `;

      return;
    }

    if (currentUser) {
      const name = escapeHTML(
        currentUser.displayName ||
        currentUser.email ||
        "Preach Mate User"
      );

      const email = escapeHTML(
        currentUser.email || ""
      );

      const emailPasswordUser =
        currentUser.providerData &&
        currentUser.providerData.some(
          function (provider) {
            return provider.providerId === "password";
          }
        );

      panel.innerHTML = `
        <div class="pm-account-title">
          Signed In
        </div>

        <div class="pm-account-subtitle">
          ${name}<br>${email}
        </div>

        ${
          emailPasswordUser &&
          !currentUser.emailVerified
            ? `
              <div class="pm-account-actions">
                <button
                  type="button"
                  class="pm-auth-button"
                  id="pm-verify-email"
                >
                  Verify Email
                </button>
              </div>
            `
            : ""
        }

        <div
          class="pm-account-actions"
          style="margin-top:8px"
        >
          <button
            type="button"
            class="pm-auth-button pm-auth-danger"
            id="pm-logout-button"
          >
            Log Out
          </button>
        </div>
      `;

      const verifyButton = document.getElementById(
        "pm-verify-email"
      );

      if (verifyButton) {
        verifyButton.onclick = sendVerificationEmail;
      }

      const logoutButton = document.getElementById(
        "pm-logout-button"
      );

      if (logoutButton) {
        logoutButton.onclick = logout;
      }

    } else {
      panel.innerHTML = `
        <div class="pm-account-title">
          Preach Mate Account
        </div>

        <div class="pm-account-subtitle">
          Sign in to your account.
        </div>

        <div class="pm-account-actions">
          <button
            type="button"
            class="pm-auth-button pm-auth-primary"
            id="pm-login-button"
          >
            Log In
          </button>

          <button
            type="button"
            class="pm-auth-button"
            id="pm-register-button"
          >
            Create Account
          </button>
        </div>
      `;

      document.getElementById(
        "pm-login-button"
      ).onclick = function () {
        openAuthDialog("login");
      };

      document.getElementById(
        "pm-register-button"
      ).onclick = function () {
        openAuthDialog("register");
      };
    }
  }

  /* ==========================================
     AUTH MODAL
     ========================================== */

  function ensureAuthDialog() {
    let overlay = document.getElementById(
      "pm-auth-overlay"
    );

    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "pm-auth-overlay";

    overlay.innerHTML = `
      <div
        id="pm-auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pm-auth-heading"
      >
        <button
          type="button"
          id="pm-auth-close"
          aria-label="Close"
        >&times;</button>

        <div class="pm-auth-brand">
          <div class="pm-auth-logo">P</div>

          <h2 id="pm-auth-heading">
            Welcome Back
          </h2>

          <p id="pm-auth-subtitle">
            Sign in to your Preach Mate account.
          </p>
        </div>

        <div
          id="pm-auth-message"
          class="pm-auth-message"
          role="status"
          aria-live="polite"
        ></div>

        <form
          id="pm-auth-form"
          class="pm-auth-form"
          novalidate
        >
          <label class="pm-auth-field">
            <span>Email Address</span>
            <input
              type="email"
              id="pm-auth-email"
              name="email"
              placeholder="you@example.com"
              autocomplete="email"
              required
            >
          </label>

          <label
            class="pm-auth-field"
            id="pm-auth-name-field"
            style="display:none"
          >
            <span>Your Name</span>
            <input
              type="text"
              id="pm-auth-name"
              name="name"
              placeholder="Your name"
              autocomplete="name"
            >
          </label>

          <label class="pm-auth-field">
            <span>Password</span>
            <input
              type="password"
              id="pm-auth-password"
              name="password"
              placeholder="Enter your password"
              autocomplete="current-password"
              minlength="6"
              required
            >
          </label>

          <label
            class="pm-auth-field"
            id="pm-auth-confirm-field"
            style="display:none"
          >
            <span>Confirm Password</span>
            <input
              type="password"
              id="pm-auth-confirm"
              name="confirmPassword"
              placeholder="Re-enter your password"
              autocomplete="new-password"
            >
          </label>

          <button
            type="submit"
            id="pm-auth-submit"
            class="pm-auth-button pm-auth-primary"
          >
            Log In
          </button>
        </form>

        <div
          class="pm-auth-divider"
          id="pm-auth-divider"
        >
          OR
        </div>

        <button
          type="button"
          id="pm-google-button"
          class="pm-auth-button pm-auth-google"
        >
          Continue with Google
        </button>

        <div class="pm-auth-links">
          <button
            type="button"
            id="pm-auth-forgot"
            class="pm-auth-link"
          >
            Forgot Password?
          </button>

          <button
            type="button"
            id="pm-auth-switch"
            class="pm-auth-link"
          >
            Create a new account
          </button>
        </div>

        <div class="pm-auth-note">
          Preach Mate by:paulm
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById(
      "pm-auth-close"
    ).onclick = closeAuthDialog;

    overlay.addEventListener(
      "click",
      function (event) {
        if (event.target === overlay) {
          closeAuthDialog();
        }
      }
    );

    document.getElementById(
      "pm-auth-form"
    ).onsubmit = handleAuthSubmit;

    /*
      IMPORTANT:
      Direct onclick assignment ensures that
      the Google button gets its handler.
    */

    document.getElementById(
      "pm-google-button"
    ).onclick = signInWithGoogle;

    document.getElementById(
      "pm-auth-forgot"
    ).onclick = function () {
      if (currentAuthMode !== "forgot") {
        currentAuthMode = "forgot";
        updateAuthDialog();
        return;
      }

      sendPasswordReset();
    };

    document.getElementById(
      "pm-auth-switch"
    ).onclick = function () {
      openAuthDialog(
        currentAuthMode === "register"
          ? "login"
          : "register"
      );
    };

    document.addEventListener(
      "keydown",
      function (event) {
        if (
          event.key === "Escape" &&
          overlay.classList.contains(
            "pm-auth-visible"
          )
        ) {
          closeAuthDialog();
        }
      }
    );

    return overlay;
  }

  function openAuthDialog(mode) {
    injectStyles();

    const overlay = ensureAuthDialog();

    currentAuthMode = mode || "login";

    updateAuthDialog();

    overlay.classList.add(
      "pm-auth-visible"
    );

    document.body.style.overflow = "hidden";
  }

  function closeAuthDialog() {
    const overlay = document.getElementById(
      "pm-auth-overlay"
    );

    if (overlay) {
      overlay.classList.remove(
        "pm-auth-visible"
      );
    }

    document.body.style.overflow = "";
  }

  function updateAuthDialog() {
    const registerMode =
      currentAuthMode === "register";

    const forgotMode =
      currentAuthMode === "forgot";

    const heading = document.getElementById(
      "pm-auth-heading"
    );

    const subtitle = document.getElementById(
      "pm-auth-subtitle"
    );

    const submit = document.getElementById(
      "pm-auth-submit"
    );

    const nameField = document.getElementById(
      "pm-auth-name-field"
    );

    const confirmField = document.getElementById(
      "pm-auth-confirm-field"
    );

    const passwordInput = document.getElementById(
      "pm-auth-password"
    );

    const confirmInput = document.getElementById(
      "pm-auth-confirm"
    );

    const nameInput = document.getElementById(
      "pm-auth-name"
    );

    const googleButton = document.getElementById(
      "pm-google-button"
    );

    const divider = document.getElementById(
      "pm-auth-divider"
    );

    const forgotButton = document.getElementById(
      "pm-auth-forgot"
    );

    const switchButton = document.getElementById(
      "pm-auth-switch"
    );

    if (registerMode) {
      heading.textContent = "Create Account";
      subtitle.textContent =
        "Create your Preach Mate account.";
      submit.textContent = "Create Account";

    } else if (forgotMode) {
      heading.textContent = "Reset Password";
      subtitle.textContent =
        "Enter your email to receive a password reset link.";
      submit.textContent = "Send Reset Link";

    } else {
      heading.textContent = "Welcome Back";
      subtitle.textContent =
        "Sign in to your Preach Mate account.";
      submit.textContent = "Log In";
    }

    nameField.style.display =
      registerMode ? "block" : "none";

    confirmField.style.display =
      registerMode ? "block" : "none";

    passwordInput.parentElement.style.display =
      forgotMode ? "none" : "block";

    passwordInput.required = !forgotMode;
    confirmInput.required = registerMode;
    nameInput.required = false;

    googleButton.style.display =
      forgotMode ? "none" : "block";

    divider.style.display =
      forgotMode ? "none" : "flex";

    forgotButton.style.display =
      forgotMode ? "none" : "block";

    switchButton.style.display =
      forgotMode ? "none" : "block";

    switchButton.textContent =
      registerMode
        ? "Already have an account? Log In"
        : "Create a new account";

    clearAuthMessage();
  }

  function showAuthMessage(message, success) {
    const box = document.getElementById(
      "pm-auth-message"
    );

    if (!box) {
      showToast(message);
      return;
    }

    box.textContent = message;
    box.style.display = "block";

    box.classList.toggle(
      "pm-auth-success",
      Boolean(success)
    );
  }

  function clearAuthMessage() {
    const box = document.getElementById(
      "pm-auth-message"
    );

    if (!box) return;

    box.textContent = "";
    box.style.display = "none";
    box.classList.remove(
      "pm-auth-success"
    );
  }

  function setAuthBusy(busy) {
    authBusy = Boolean(busy);

    const ids = [
      "pm-auth-submit",
      "pm-google-button",
      "pm-auth-forgot",
      "pm-auth-switch",
      "pm-auth-close"
    ];

    ids.forEach(function (id) {
      const element = document.getElementById(id);

      if (element) {
        element.disabled = authBusy;
      }
    });

    const submit = document.getElementById(
      "pm-auth-submit"
    );

    if (submit && authBusy) {
      submit.textContent = "Please wait...";
    } else if (submit) {
      if (currentAuthMode === "register") {
        submit.textContent = "Create Account";
      } else if (currentAuthMode === "forgot") {
        submit.textContent = "Send Reset Link";
      } else {
        submit.textContent = "Log In";
      }
    }

    const googleButton = document.getElementById(
      "pm-google-button"
    );

    if (googleButton) {
      googleButton.textContent = authBusy
        ? "Connecting to Google..."
        : "Continue with Google";
    }
  }

  /* ==========================================
     GOOGLE SIGN-IN — FIXED
     ========================================== */

  async function signInWithGoogle() {
    console.log(
      "Preach Mate: Google Sign-In button clicked."
    );

    if (authBusy) return;

    if (!window.firebase || !auth) {
      showAuthMessage(
        "Firebase is not ready. Refresh the app and try again."
      );

      console.error(
        "Google Sign-In stopped: Firebase Auth is unavailable."
      );

      return;
    }

    clearAuthMessage();
    setAuthBusy(true);

    try {
      const provider =
        new firebase.auth.GoogleAuthProvider();

      provider.setCustomParameters({
        prompt: "select_account"
      });

      const result = await auth.signInWithPopup(
        provider
      );

      currentUser = result.user || null;

      closeAuthDialog();
      renderAccountPanel();

      showToast(
        "Google sign-in successful."
      );

    } catch (error) {
      console.error(
        "Google Sign-In Error:",
        error.code,
        error.message,
        error
      );

      showAuthMessage(
        getFriendlyError(error)
      );

    } finally {
      setAuthBusy(false);
    }
  }

  /* ==========================================
     LOGIN / REGISTER
     ========================================== */

  async function handleAuthSubmit(event) {
    event.preventDefault();

    if (authBusy) return;

    if (!auth) {
      showAuthMessage(
        "Firebase is not ready. Refresh the app."
      );
      return;
    }

    clearAuthMessage();
    setAuthBusy(true);

    const email = document.getElementById(
      "pm-auth-email"
    ).value.trim();

    const password = document.getElementById(
      "pm-auth-password"
    ).value;

    const name = document.getElementById(
      "pm-auth-name"
    ).value.trim();

    const confirmPassword = document.getElementById(
      "pm-auth-confirm"
    ).value;

    try {
      if (currentAuthMode === "register") {
        if (password.length < 6) {
          throw new Error(
            "Password must contain at least 6 characters."
          );
        }

        if (password !== confirmPassword) {
          throw new Error(
            "Hindi magkapareho ang dalawang password."
          );
        }

        const result =
          await auth.createUserWithEmailAndPassword(
            email,
            password
          );

        if (name && result.user) {
          await result.user.updateProfile({
            displayName: name
          });
        }

        if (result.user) {
          try {
            await result.user.sendEmailVerification();
          } catch (verificationError) {
            console.error(
              "Verification email error:",
              verificationError
            );
          }
        }

        currentUser = result.user || null;

        closeAuthDialog();
        renderAccountPanel();

        showToast(
          "Account created successfully."
        );

      } else if (currentAuthMode === "forgot") {
        await auth.sendPasswordResetEmail(email);

        showAuthMessage(
          "Password reset link sent. Check your email.",
          true
        );

      } else {
        const result =
          await auth.signInWithEmailAndPassword(
            email,
            password
          );

        currentUser = result.user || null;

        closeAuthDialog();
        renderAccountPanel();

        showToast(
          "Logged in successfully."
        );
      }

    } catch (error) {
      console.error(
        "Authentication form error:",
        error
      );

      showAuthMessage(
        getFriendlyError(error)
      );

    } finally {
      setAuthBusy(false);
    }
  }

  /* ==========================================
     PASSWORD RESET
     ========================================== */

  async function sendPasswordReset() {
    if (authBusy) return;

    if (!auth) {
      showAuthMessage(
        "Firebase is not ready. Refresh the app."
      );
      return;
    }

    const email = document.getElementById(
      "pm-auth-email"
    ).value.trim();

    if (!email) {
      showAuthMessage(
        "Enter your email address first."
      );

      document.getElementById(
        "pm-auth-email"
      ).focus();

      return;
    }

    clearAuthMessage();
    setAuthBusy(true);

    try {
      await auth.sendPasswordResetEmail(email);

      showAuthMessage(
        "Password reset link sent. Check your email.",
        true
      );

    } catch (error) {
      console.error(
        "Password reset error:",
        error
      );

      showAuthMessage(
        getFriendlyError(error)
      );

    } finally {
      setAuthBusy(false);
    }
  }

  /* ==========================================
     EMAIL VERIFICATION
     ========================================== */

  async function sendVerificationEmail() {
    if (!auth || !auth.currentUser) {
      showToast("Please log in first.");
      return;
    }

    try {
      await auth.currentUser.sendEmailVerification();

      showToast(
        "Verification email sent. Check your inbox."
      );

    } catch (error) {
      console.error(
        "Email verification error:",
        error
      );

      showToast(
        getFriendlyError(error)
      );
    }
  }

  /* ==========================================
     LOGOUT
     ========================================== */

  async function logout() {
    if (!auth) return;

    if (
      !window.confirm(
        "Mag-logout sa Preach Mate account?"
      )
    ) {
      return;
    }

    try {
      await auth.signOut();

      currentUser = null;

      renderAccountPanel();

      showToast(
        "Logged out successfully."
      );

    } catch (error) {
      console.error(
        "Logout error:",
        error
      );

      showToast(
        getFriendlyError(error)
      );
    }
  }

  /* ==========================================
     START
     ========================================== */

  function start() {
    injectStyles();

    ensureAuthDialog();

    initFirebase();

    renderAccountPanel();

    /*
      Wait for the drawer if the main app
      creates it after this script loads.
    */

    const observer = new MutationObserver(
      function () {
        if (
          !document.getElementById(
            "pm-account-panel"
          )
        ) {
          renderAccountPanel();
        }
      }
    );

    observer.observe(
      document.body,
      {
        childList: true,
        subtree: true
      }
    );
  }

  /* ==========================================
     PUBLIC API
     ========================================== */

  window.PreachMateFirebase = {
    initFirebase: initFirebase,
    renderAccountPanel: renderAccountPanel,
    openAuthDialog: openAuthDialog,
    closeAuthDialog: closeAuthDialog,
    signInWithGoogle: signInWithGoogle,
    sendPasswordReset: sendPasswordReset,
    sendVerificationEmail: sendVerificationEmail,
    logout: logout,

    getCurrentUser: function () {
      return currentUser;
    },

    getFirestore: function () {
      return db;
    },

    isReady: function () {
      return authReady;
    }
  };

  /* ==========================================
     INITIALIZE
     ========================================== */

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }

})();
