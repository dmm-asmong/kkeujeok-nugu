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

type StorageConfig =
  | { kind: "rest"; url: string; token: string; urlVar: string }
  | { kind: "tcp"; url: string; urlVar: string }
  | { kind: "memory" };

/**
 * Finds Redis settings however the Vercel Marketplace named them:
 * KV_REST_API_URL / UPSTASH_REDIS_REST_URL, any prefixed variant (STORAGE_KV_REST_API_URL, MYDB_UPSTASH_REDIS_REST_URL…),
 * or a TCP url (REDIS_URL, KV_URL, *_REDIS_URL, *_KV_URL).
 */
export function detect(env: Record<string, string | undefined> = process.env): StorageConfig {
  const keys = Object.keys(env).filter((k) => env[k]);
  const rest: { urlVar: string; tokenVar: string }[] = [];
  for (const k of keys) {
    const m = /^(.*?)(KV_REST_API|UPSTASH_REDIS_REST)_URL$/.exec(k);
    if (!m) continue;
    const tokenVar = `${m[1]}${m[2]}_TOKEN`;
    if (env[tokenVar]) rest.push({ urlVar: k, tokenVar });
  }
  // prefer the un-prefixed names, then the shortest prefix
  rest.sort((x, y) => x.urlVar.length - y.urlVar.length);
  if (rest.length) {
    const r = rest[0];
    return { kind: "rest", url: env[r.urlVar]!.replace(/\/$/, ""), token: env[r.tokenVar]!, urlVar: r.urlVar };
  }
  const tcp = keys
    .filter((k) => /(^|_)(REDIS|KV)_URL$/.test(k) && /^rediss?:\/\//.test(env[k] ?? ""))
    .sort((x, y) => x.length - y.length)[0];
  if (tcp) return { kind: "tcp", url: env[tcp]!, urlVar: tcp };
  return { kind: "memory" };
}

let config: StorageConfig | null = null;
const cfg = () => (config ??= detect());

export function storageKind(): "redis" | "memory" {
  return cfg().kind === "memory" ? "memory" : "redis";
}

/** Safe to expose: which mode and which variable *names* were used, never values. */
export function storageInfo() {
  const c = cfg();
  const names = Object.keys(process.env)
    .filter((k) => /(KV|REDIS)/.test(k) && /(URL|TOKEN)$/.test(k) && process.env[k])
    .sort();
  return { storage: storageKind(), driver: c.kind, using: c.kind === "memory" ? null : c.urlVar, envNamesSeen: names };
}

/* TCP (rediss://) client, kept warm across invocations */
type TcpClient = import("ioredis").Redis;
const gt = globalThis as unknown as { __knTcp?: TcpClient };
async function tcpClient(url: string): Promise<TcpClient> {
  if (gt.__knTcp) return gt.__knTcp;
  const { default: Redis } = await import("ioredis");
  gt.__knTcp = new Redis(url, { maxRetriesPerRequest: 2, connectTimeout: 5000, enableAutoPipelining: false });
  return gt.__knTcp;
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
  const c = cfg();
  if (c.kind === "memory") return cmds.map(memOne);
  if (c.kind === "tcp") {
    const client = await tcpClient(c.url);
    const pipe = client.pipeline();
    for (const cmd of cmds) pipe.call(String(cmd[0]), ...cmd.slice(1).map(String));
    const out = (await pipe.exec()) ?? [];
    return out.map(([err, res]) => {
      if (err) throw new Error("storage: " + err.message);
      return res ?? null;
    });
  }
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${c.url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(cmds.map((x) => x.map(String))),
        cache: "no-store",
      });
      if (res.status >= 500 || res.status === 429) throw new Error(`storage http ${res.status}`);
      if (!res.ok) throw new StorageFatal(`storage http ${res.status}`);
      const data = (await res.json()) as { result?: unknown; error?: string }[];
      return data.map((d) => {
        if (d.error) throw new StorageFatal("storage: " + d.error);
        return d.result ?? null;
      });
    } catch (e) {
      if (e instanceof StorageFatal) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  throw lastErr;
}

class StorageFatal extends Error {}

export async function one(cmd: Cmd): Promise<unknown> {
  return (await exec([cmd]))[0];
}

export function flatToObj(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) out[k] = String(x);
    return out;
  }
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
