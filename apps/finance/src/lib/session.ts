// HMAC-signed session tokens. Uses the Web Crypto API only, so the exact same
// code verifies in Edge middleware and signs in a Node route handler.

const COOKIE = "mos_session";
const DEFAULT_TTL = 60 * 60 * 24 * 30; // 30 days

export { COOKIE as SESSION_COOKIE };

interface Payload {
  exp: number; // unix seconds
}

function secret(): string {
  const s = process.env.APP_SESSION_SECRET ?? "";
  if (s.length < 32) {
    // Fail closed: never sign or verify under a weak/empty key.
    throw new Error("APP_SESSION_SECRET must be set to at least 32 characters");
  }
  return s;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function utf8(s: string): BufferSource {
  return new TextEncoder().encode(s) as BufferSource;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    utf8(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSession(ttlSeconds = DEFAULT_TTL): Promise<string> {
  const payload: Payload = { exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), utf8(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

/** True only if the token's signature is valid AND it hasn't expired. */
export async function verifySessionToken(token?: string | null): Promise<boolean> {
  if (!token) return false;
  const [data, sigB64] = token.split(".");
  if (!data || !sigB64) return false;
  try {
    // secret() throws (fail closed) if APP_SESSION_SECRET is missing/weak;
    // the catch below turns that into a rejected verification.
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      fromB64url(sigB64) as BufferSource,
      utf8(data),
    );
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(data))) as Payload;
    return typeof payload.exp === "number" && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/**
 * The gate is ON when a real password is configured. In production it is ON
 * even without one (fail-secure: an unconfigured deploy exposes nothing).
 */
export function gateActive(): boolean {
  const pw = process.env.APP_PASSWORD ?? "";
  const configured = pw.length > 0 && !pw.startsWith("set-a-");
  return configured || process.env.NODE_ENV === "production";
}
