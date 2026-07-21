"use client";

// Face ID / Touch ID / fingerprint via WebAuthn platform authenticator.
// This is a DEVICE unlock layer on top of the email/password account: you sign in
// once, enable Face ID, and from then on opening the app just needs the biometric.
// The credential is bound to this device + this domain. (It gates access to the
// already-stored session — a privacy + convenience lock, not a server-verified
// passkey; that can be layered later.)

const CRED_KEY = "lite-bio-cred"; // base64url credential id
const ON_KEY = "lite-bio-on"; // "1" when the user enabled it
const UNLOCK_KEY = "lite-bio-unlocked"; // sessionStorage: unlocked this session

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
function bytesToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export async function biometricAvailable(): Promise<boolean> {
  try {
    if (typeof window === "undefined" || !window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export function biometricEnabled(): boolean {
  try {
    return localStorage.getItem(ON_KEY) === "1" && !!localStorage.getItem(CRED_KEY);
  } catch {
    return false;
  }
}

// Register the device's Face ID/Touch ID. Prompts the biometric once to set up.
export async function registerBiometric(userLabel: string): Promise<boolean> {
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32) as BufferSource,
        rp: { name: "EILA" }, // rp.id defaults to current domain
        user: { id: randomBytes(16) as BufferSource, name: userLabel || "ila", displayName: userLabel || "EILA" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
        timeout: 60000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;
    if (!cred) return false;
    localStorage.setItem(CRED_KEY, bytesToB64url(cred.rawId));
    localStorage.setItem(ON_KEY, "1");
    sessionStorage.setItem(UNLOCK_KEY, "1"); // setting it up counts as unlocked now
    return true;
  } catch {
    return false;
  }
}

// Prompt Face ID to unlock. Resolves true if the biometric passes.
export async function verifyBiometric(): Promise<boolean> {
  try {
    const id = localStorage.getItem(CRED_KEY);
    if (!id) return false;
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32) as BufferSource,
        allowCredentials: [{ id: b64urlToBytes(id) as BufferSource, type: "public-key" }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    if (!assertion) return false;
    sessionStorage.setItem(UNLOCK_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function disableBiometric() {
  try {
    localStorage.removeItem(CRED_KEY);
    localStorage.removeItem(ON_KEY);
    sessionStorage.removeItem(UNLOCK_KEY);
  } catch {}
}

export function isUnlockedThisSession(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === "1";
  } catch {
    return false;
  }
}

export function relock() {
  try { sessionStorage.removeItem(UNLOCK_KEY); } catch {}
}
