"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown>,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  let bodyInit = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    bodyInit = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body: bodyInit, cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? "문제가 생겼어요"), data);
  return data as T;
}

/* server clock offset so every screen counts down together */
let offset = 0;
export function syncClock(serverNow: unknown) {
  if (typeof serverNow === "number") offset = serverNow - Date.now();
}
export const now = () => Date.now() + offset;

export function secondsLeft(endsAt: number | null | undefined) {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt - now()) / 1000));
}

export async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const store = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};
