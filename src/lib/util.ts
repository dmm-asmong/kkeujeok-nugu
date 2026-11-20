import { createHash, randomBytes, randomInt } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(24).toString("base64url");
export const newId = () => randomBytes(6).toString("base64url");

// No 0/O/1/I/L to avoid confusion when read off a projector.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newCode(len = 5) {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}
export const CODE_RE = /^[A-HJKMNP-Z2-9]{5}$/;

/** Strip control chars, angle brackets and excess spaces; cap length by code points. */
export function cleanText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  const s = input
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(s).slice(0, max).join("");
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Light, per-instance rate limiting (fixed window). Generous because a whole class shares one Wi-Fi IP. */
const g = globalThis as unknown as { __knRl?: Map<string, { n: number; reset: number }> };
const rl = (g.__knRl ??= new Map());
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const e = rl.get(key);
  if (!e || e.reset < now) {
    if (rl.size > 5000) rl.clear();
    rl.set(key, { n: 1, reset: now + windowMs });
    return true;
  }
  e.n++;
  return e.n <= limit;
}

export const MAX_IMG_BYTES = 40 * 1024;

/** Accepts a data URL of webp/png up to 40KB; returns the base64 payload and mime, or null. */
export function parseImage(dataUrl: unknown): { mime: string; b64: string } | null {
  if (typeof dataUrl !== "string" || dataUrl.length > 60000) return null;
  const m = /^data:(image\/(?:webp|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (buf.length < 16 || buf.length > MAX_IMG_BYTES) return null;
  const isPng = buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG";
  const isWebp = buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP";
  if (m[1] === "image/png" && !isPng) return null;
  if (m[1] === "image/webp" && !isWebp) return null;
  return { mime: m[1], b64: m[2] };
}
