// Tiny Redis-command layer. Uses Upstash Redis REST when env vars exist,
// otherwise an in-memory store (local dev / demo) that speaks the same commands.
export type Cmd = (string | number)[];

type MemEntry = { t: "s"; v: string; exp: number } | { t: "h"; v: Map<string, string>; exp: number };

const g = globalThis as unknown as {
  __knMem?: Map<string, MemEntry>;
  __knStats?: { commands: number; requests: number; byCmd: Record<string, number> };
};
const mem = (g.__knMem ??= new Map());
export const stats = (g.__knStats ??= { commands: 0, requests: 0, byCmd: {} });

function redisEnv(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

export function storageKind(): "redis" | "memory" {
  return redisEnv() ? "redis" : "memory";
}

function live(key: string): MemEntry | undefined {
  const e = mem.get(key);
  if (!e) return undefined;
  if (e.exp && e.exp <= Date.now()) {
    mem.delete(key);
    return undefined;
  }
  return e;
}

function hashOf(key: string, create: boolean): Map<string, string> | null {
  const e = live(key);
  if (e) {
    if (e.t !== "h") throw new Error("WRONGTYPE");
    return e.v;
  }
  if (!create) return null;
  const m = new Map<string, string>();
  mem.set(key, { t: "h", v: m, exp: 0 });
  return m;
}

function memOne(cmd: Cmd): unknown {
  const [name, ...a] = cmd;
  const op = String(name).toUpperCase();
  const s = a.map(String);
  switch (op) {
    case "GET": {
      const e = live(s[0]);
      return e && e.t === "s" ? e.v : null;
    }
    case "MGET":
      return s.map((k) => {
        const e = live(k);
        return e && e.t === "s" ? e.v : null;
      });
    case "SET": {
      let exp = 0;
      const i = s.findIndex((x) => x.toUpperCase() === "EXAT");
      if (i > 0) exp = Number(s[i + 1]) * 1000;
      if (s.some((x) => x.toUpperCase() === "NX") && live(s[0])) return null;
      mem.set(s[0], { t: "s", v: s[1], exp });
      return "OK";
    }
    case "DEL": {
      let n = 0;
      for (const k of s) if (live(k) && mem.delete(k)) n++;
      return n;
    }
    case "EXISTS":
      return s.filter((k) => live(k)).length;
    case "INCR": {
      const e = live(s[0]);
      const n = (e && e.t === "s" ? Number(e.v) : 0) + 1;
      mem.set(s[0], { t: "s", v: String(n), exp: e?.exp ?? 0 });
      return n;
    }
    case "EXPIREAT": {
      const e = live(s[0]);
      if (!e) return 0;
      e.exp = Number(s[1]) * 1000;
      return 1;
    }
    case "HSET": {
      const h = hashOf(s[0], true)!;
      let n = 0;
      for (let i = 1; i + 1 < s.length; i += 2) {
        if (!h.has(s[i])) n++;
        h.set(s[i], s[i + 1]);
      }
      return n;
    }
    case "HSETNX": {
      const h = hashOf(s[0], true)!;
      if (h.has(s[1])) return 0;
      h.set(s[1], s[2]);
      return 1;
    }
    case "HGET":
      return hashOf(s[0], false)?.get(s[1]) ?? null;
    case "HDEL": {
      const h = hashOf(s[0], false);
      if (!h) return 0;
      let n = 0;
      for (const f of s.slice(1)) if (h.delete(f)) n++;
      return n;
    }
    case "HLEN":
      return hashOf(s[0], false)?.size ?? 0;
    case "HGETALL": {
      const h = hashOf(s[0], false);
      if (!h) return [];
      const out: string[] = [];
      for (const [k, v] of h) out.push(k, v);
      return out;
    }
    default:
      throw new Error("unsupported command " + op);
  }
}

/** Run commands as one pipeline (one HTTP request to Upstash). */
export async function exec(cmds: Cmd[]): Promise<unknown[]> {
  if (cmds.length === 0) return [];
  stats.requests++;
  stats.commands += cmds.length;
  for (const c of cmds) {
    const k = String(c[0]).toUpperCase();
    stats.byCmd[k] = (stats.byCmd[k] ?? 0) + 1;
  }
  const env = redisEnv();
  if (!env) return cmds.map(memOne);
  const res = await fetch(`${env.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmds.map((c) => c.map(String))),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`storage error ${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: string }[];
  return data.map((d) => {
    if (d.error) throw new Error("storage: " + d.error);
    return d.result ?? null;
  });
}

export async function one(cmd: Cmd): Promise<unknown> {
  return (await exec([cmd]))[0];
}

export function flatToObj(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(v)) for (let i = 0; i + 1 < v.length; i += 2) out[String(v[i])] = String(v[i + 1]);
  return out;
}

/* Per-instance micro cache: many phones poll at once; one Redis read serves them all. */
type CacheEntry = { v: unknown; exp: number };
const g2 = globalThis as unknown as { __knCache?: Map<string, CacheEntry> };
const cache = (g2.__knCache ??= new Map());

export function cacheGet<T>(k: string): T | undefined {
  const e = cache.get(k);
  if (!e) return undefined;
  if (e.exp < Date.now()) {
    cache.delete(k);
    return undefined;
  }
  return e.v as T;
}
export function cacheSet(k: string, v: unknown, ms: number) {
  if (cache.size > 2000) {
    const now = Date.now();
    for (const [key, e] of cache) if (e.exp < now) cache.delete(key);
    if (cache.size > 2000) cache.clear();
  }
  cache.set(k, { v, exp: Date.now() + ms });
}
export function cacheDel(prefix: string) {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}
