/**
 * og-passkey.js — Open Grace Director Portal
 * WebAuthn / Passkey authentication module
 *
 * Flow:
 *   1. Page loads → checkPasskeyAuth()
 *   2. If no credential registered → show register prompt
 *   3. If credential registered → silently authenticate with Face ID / Touch ID
 *   4. On success → reveal dashboard; on failure → show retry UI
 *
 * Storage: credential ID stored in localStorage (not secret — the private key
 * never leaves the secure enclave on device).
 */

const OG_PASSKEY_KEY   = 'og_passkey_credId_v1';
const OG_PASSKEY_USER  = 'og_passkey_registered_v1';
const RP_ID            = 'opengrace.org';
const RP_NAME          = 'Open Grace Director';

// ── Utility: base64url encode/decode ─────────────────────────────────────────

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64ToBuf(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0)).buffer;
}

// ── Check browser support ─────────────────────────────────────────────────────

function passkeySupported() {
  return window.PublicKeyCredential !== undefined &&
         typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';
}

async function platformAuthAvailable() {
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

// ── Registration ──────────────────────────────────────────────────────────────

async function registerPasskey(displayName = 'Joshua Kennedy') {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId    = crypto.getRandomValues(new Uint8Array(16));

  const options = {
    challenge,
    rp: { id: RP_ID, name: RP_NAME },
    user: {
      id: userId,
      name: 'joshua.kennedy@opengrace.org',
      displayName,
    },
    pubKeyCredParams: [
      { alg: -7,   type: 'public-key' }, // ES256
      { alg: -257, type: 'public-key' }, // RS256 fallback
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',   // device biometrics only
      userVerification: 'required',          // Face ID / Touch ID required
      residentKey: 'preferred',
    },
    timeout: 60000,
    attestation: 'none',
  };

  const credential = await navigator.credentials.create({ publicKey: options });
  const credId = bufToB64(credential.rawId);
  localStorage.setItem(OG_PASSKEY_KEY, credId);
  localStorage.setItem(OG_PASSKEY_USER, JSON.stringify({
    displayName,
    registeredAt: new Date().toISOString(),
    credId,
  }));
  return credential;
}

// ── Authentication ────────────────────────────────────────────────────────────

async function authenticatePasskey() {
  const credIdB64 = localStorage.getItem(OG_PASSKEY_KEY);
  if (!credIdB64) throw new Error('No credential registered');

  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const options = {
    challenge,
    rpId: RP_ID,
    allowCredentials: [{
      type: 'public-key',
      id: b64ToBuf(credIdB64),
      transports: ['internal'],
    }],
    userVerification: 'required',
    timeout: 60000,
  };

  const assertion = await navigator.credentials.get({ publicKey: options });
  return assertion; // success — browser verified biometrics
}

// ── Session token (in-memory only, clears on tab close) ──────────────────────

let _ogSessionValid = false;

function setSessionValid() { _ogSessionValid = true; }
function isSessionValid()  { return _ogSessionValid; }

// ── Gate UI ───────────────────────────────────────────────────────────────────

function buildGateUI() {
  const el = document.createElement('div');
  el.id = 'og-auth-gate';
  el.innerHTML = `
    <div class="og-gate-inner">
      <div class="og-gate-logo">
        <img src="/og_logo.jpg" alt="Open Grace">
      </div>
      <h1 class="og-gate-title">Open Grace</h1>
      <p class="og-gate-sub">Director Portal</p>
      <div id="og-gate-status" class="og-gate-status">Verifying identity…</div>
      <button id="og-gate-btn" class="og-gate-btn" style="display:none">
        <span id="og-gate-btn-icon">🔐</span>
        <span id="og-gate-btn-label">Authenticate</span>
      </button>
      <p id="og-gate-hint" class="og-gate-hint" style="display:none">
        Tap to use Face ID or Touch ID
      </p>
      <button id="og-gate-register" class="og-gate-register" style="display:none">
        Set up Face ID for this device
      </button>
      <button id="og-gate-fallback" class="og-gate-fallback" style="display:none">
        Use email code instead
      </button>
    </div>
  `;
  document.body.prepend(el);
}

function gateStatus(msg) {
  const el = document.getElementById('og-gate-status');
  if (el) el.textContent = msg;
}

function showGateBtn(label = 'Use Face ID', icon = '🔐') {
  const btn  = document.getElementById('og-gate-btn');
  const hint = document.getElementById('og-gate-hint');
  const lbl  = document.getElementById('og-gate-btn-label');
  const ico  = document.getElementById('og-gate-btn-icon');
  if (btn)  { lbl.textContent = label; ico.textContent = icon; btn.style.display = 'flex'; }
  if (hint) hint.style.display = 'block';
}

function showRegisterBtn() {
  const btn = document.getElementById('og-gate-register');
  if (btn) btn.style.display = 'block';
}

function showFallback() {
  const btn = document.getElementById('og-gate-fallback');
  if (btn) btn.style.display = 'block';
}

function removeGate() {
  const gate = document.getElementById('og-auth-gate');
  if (gate) {
    gate.style.opacity = '0';
    gate.style.transform = 'scale(1.04)';
    setTimeout(() => gate.remove(), 350);
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

async function checkPasskeyAuth() {
  // If already authenticated this session, skip
  if (isSessionValid()) return;

  // Check browser support
  if (!passkeySupported()) {
    // No WebAuthn support — fall through to Cloudflare gate
    return;
  }

  const hasPlatformAuth = await platformAuthAvailable();
  if (!hasPlatformAuth) {
    // Device has no biometrics — fall through
    return;
  }

  // Build the gate overlay
  buildGateUI();
  document.body.style.overflow = 'hidden';

  const hasCredential = !!localStorage.getItem(OG_PASSKEY_KEY);

  if (hasCredential) {
    // ── Auto-authenticate ──
    gateStatus('Verifying with Face ID…');
    try {
      await authenticatePasskey();
      setSessionValid();
      document.body.style.overflow = '';
      removeGate();
      return;
    } catch (err) {
      // Auto-auth failed (user cancelled or timed out) — show manual button
      gateStatus('Tap to verify your identity');
      showGateBtn('Use Face ID', '🔐');
      showFallback();

      document.getElementById('og-gate-btn').addEventListener('click', async () => {
        gateStatus('Verifying…');
        document.getElementById('og-gate-btn').style.display = 'none';
        try {
          await authenticatePasskey();
          setSessionValid();
          document.body.style.overflow = '';
          removeGate();
        } catch {
          gateStatus('Verification failed. Try again.');
          showGateBtn('Try Again', '🔁');
          showFallback();
        }
      });
    }
  } else {
    // ── No credential — offer registration ──
    gateStatus('Set up Face ID to access the director portal on this device.');
    showRegisterBtn();
    showFallback();

    document.getElementById('og-gate-register').addEventListener('click', async () => {
      gateStatus('Setting up Face ID…');
      document.getElementById('og-gate-register').style.display = 'none';
      try {
        const name = localStorage.getItem('og_settings_v1')
          ? (JSON.parse(localStorage.getItem('og_settings_v1')).directorName || 'Joshua Kennedy')
          : 'Joshua Kennedy';
        await registerPasskey(name);
        gateStatus('Face ID set up! Verifying…');
        await authenticatePasskey();
        setSessionValid();
        document.body.style.overflow = '';
        removeGate();
      } catch (err) {
        gateStatus('Setup failed. You can try again or use email code.');
        showRegisterBtn();
        showFallback();
      }
    });
  }

  // Fallback — redirect to Cloudflare OTP page
  document.getElementById('og-gate-fallback').addEventListener('click', () => {
    localStorage.removeItem(OG_PASSKEY_KEY);
    localStorage.removeItem(OG_PASSKEY_USER);
    window.location.reload();
  });
}

// ── PWA install prompt ────────────────────────────────────────────────────────

let _deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  // Show install banner after auth succeeds
  setTimeout(maybeShowInstallBanner, 3000);
});

function maybeShowInstallBanner() {
  if (!_deferredInstallPrompt) return;
  if (localStorage.getItem('og_pwa_installed')) return;

  const banner = document.createElement('div');
  banner.id = 'og-install-banner';
  banner.innerHTML = `
    <span>📱 Add to Home Screen for instant Face ID access</span>
    <button id="og-install-yes">Install</button>
    <button id="og-install-no">✕</button>
  `;
  document.body.appendChild(banner);

  document.getElementById('og-install-yes').addEventListener('click', async () => {
    _deferredInstallPrompt.prompt();
    const { outcome } = await _deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      localStorage.setItem('og_pwa_installed', '1');
    }
    banner.remove();
    _deferredInstallPrompt = null;
  });

  document.getElementById('og-install-no').addEventListener('click', () => {
    banner.remove();
  });
}

// ── Auto-run on load ──────────────────────────────────────────────────────────

checkPasskeyAuth();
