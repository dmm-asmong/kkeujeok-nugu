import { exec, flatToObj, cacheGet, cacheSet, cacheDel, storageKind } from "./store";
import { cleanText, newCode, newId, newToken, parseImage, sha256, shuffle } from "./util";
import { findSet } from "./questions";
import { leaderboard, mystery, type MysteryItem, type RankItem } from "./rank";

export const TTL_SEC = 2 * 60 * 60;
export const MAX_PLAYERS = 60;
const VER_CACHE_MS = 1000;
const VOTE_GRACE_MS = 2500;

export type Phase = "lobby" | "draw" | "vote" | "reveal" | "final";
export interface Settings {
  setId: string;
  questions: string[];
  rounds: number; // 0 = everyone
  drawSeconds: number;
  voteSeconds: number;
}
export interface Current {
  pid: string;
  nick: string;
  answers: string[];
  imgRev: number;
  tag: string;
}
export interface DistItem {
  pid: string;
  nick: string;
  count: number;
}
export interface Reveal {
  round: number;
  pid: string;
  nick: string;
  total: number;
  correct: number;
  correctVoters: string[];
  dist: DistItem[];
}
export interface Meta {
  code: string;
  hostHash: string;
  createdAt: number;
  expAt: number; // unix seconds
  phase: Phase;
  phaseEndsAt: number | null;
  settings: Settings;
  order: string[];
  shown: string[];
  round: number;
  current: Current | null;
  scores: Record<string, number>;
  guessed: Record<string, { correct: number; total: number }>;
  reveal: Reveal | null;
  kicked: string[];
}
export interface Player {
  id: string;
  nick: string;
  tokenHash: string;
  joinedAt: number;
  answers: string[];
  drew: boolean;
  imgRev: number;
  mime?: string;
  kicked?: boolean;
}
export type { RankItem, MysteryItem };

export interface PublicState {
  phase: Phase;
  phaseEndsAt: number | null;
  questions: string[];
  voteSeconds: number;
  round: number;
  totalRounds: number;
  current: { answers: string[]; tag: string; nick?: string } | null;
  roster: { id: string; nick: string }[];
  reveal: Reveal | null;
  leaderboard: RankItem[] | null;
  mystery: MysteryItem[] | null;
  kicked: string[];
  scores: Record<string, number>;
  rounds: number;
  storage: "redis" | "memory";
}

export class GameError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const K = {
  meta: (c: string) => `kn:${c}:meta`,
  ver: (c: string) => `kn:${c}:ver`,
  pver: (c: string) => `kn:${c}:pver`,
  players: (c: string) => `kn:${c}:p`,
  nicks: (c: string) => `kn:${c}:n`,
  votes: (c: string, r: number) => `kn:${c}:v:${r}`,
  img: (c: string, pid: string) => `kn:${c}:i:${pid}`,
};

const nickKey = (n: string) => n.toLowerCase().replace(/\s+/g, "");
export const tagFor = (tokenHash: string, round: number) => sha256(`${tokenHash}:${round}`).slice(0, 16);

function parsePlayers(v: unknown): Record<string, Player> {
  const raw = flatToObj(v);
  const out: Record<string, Player> = {};
  for (const [k, s] of Object.entries(raw)) {
    try {
      out[k] = JSON.parse(s) as Player;
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

export function cleanSettings(input: Partial<Settings> | undefined): Settings {
  const set = findSet(String(input?.setId ?? "basic"));
  const qs = Array.isArray(input?.questions) ? input!.questions : set.defaults;
  const questions = [0, 1, 2].map((i) => cleanText(qs[i], 40) || set.defaults[i]);
  const rounds = Number(input?.rounds);
  const drawSeconds = Number(input?.drawSeconds);
  const voteSeconds = Number(input?.voteSeconds);
  return {
    setId: set.id,
    questions,
    rounds: Number.isInteger(rounds) && rounds >= 0 && rounds <= MAX_PLAYERS ? rounds : 8,
    drawSeconds: Number.isInteger(drawSeconds) && drawSeconds >= 30 && drawSeconds <= 300 ? drawSeconds : 90,
    voteSeconds: Number.isInteger(voteSeconds) && voteSeconds >= 10 && voteSeconds <= 60 ? voteSeconds : 20,
  };
}

/* ---------- reads ---------- */

/** Public version number, cached ~1s per instance so 30+ phones share one read. null = room gone. */
export async function getVer(code: string): Promise<number | null> {
  const ck = `ver:${code}`;
  const c = cacheGet<number | null>(ck);
  if (c !== undefined) return c;
  const [v] = await exec([["GET", K.ver(code)]]);
  const n = v == null ? null : Number(v);
  cacheSet(ck, n, VER_CACHE_MS);
  return n;
}

async function loadMeta(code: string): Promise<Meta | null> {
  const [m] = await exec([["GET", K.meta(code)]]);
  return m ? (JSON.parse(String(m)) as Meta) : null;
}

/** Meta as of the cached version (may be ~1s stale). */
async function metaCached(code: string): Promise<Meta | null> {
  const ver = await getVer(code);
  if (ver == null) return null;
  const ck = `meta:${code}:${ver}`;
  const c = cacheGet<Meta>(ck);
  if (c) return c;
  const m = await loadMeta(code);
  if (m) cacheSet(ck, m, 30000);
  return m;
}

export function totalRounds(meta: Meta): number {
  const r = meta.settings.rounds;
  return r === 0 ? meta.order.length : Math.min(r, Math.max(meta.order.length, meta.round));
}

function toPublic(meta: Meta, players: Record<string, Player>): PublicState {
  const roster = Object.values(players)
    .filter((p) => !p.kicked)
    .sort((a, b) => a.nick.localeCompare(b.nick, "ko"))
    .map((p) => ({ id: p.id, nick: p.nick }));
  let current: PublicState["current"] = null;
  if (meta.current && (meta.phase === "vote" || meta.phase === "reveal")) {
    current = { answers: meta.current.answers, tag: meta.current.tag };
    if (meta.phase === "reveal") current.nick = meta.current.nick;
  }
  const isFinal = meta.phase === "final";
  return {
    phase: meta.phase,
    phaseEndsAt: meta.phaseEndsAt,
    questions: meta.settings.questions,
    voteSeconds: meta.settings.voteSeconds,
    round: meta.round,
    totalRounds: totalRounds(meta),
    current,
    roster,
    reveal: meta.phase === "reveal" ? meta.reveal : null,
    leaderboard: isFinal ? leaderboard(meta.scores, Object.values(players)) : null,
    mystery: isFinal ? mystery(meta.guessed, Object.values(players)) : null,
    scores: meta.scores,
    rounds: meta.settings.rounds,
    kicked: meta.kicked,
    storage: storageKind(),
  };
}

/** Player poll: returns {changed:false} when nothing moved since `known`. */
export async function pollPublic(code: string, known: number) {
  const ver = await getVer(code);
  if (ver == null) throw new GameError(404, "방이 없거나 끝났어요");
  if (ver === known) return { v: ver, changed: false as const };
  const ck = `snap:${code}:${ver}`;
  let snap = cacheGet<PublicState>(ck);
  if (!snap) {
    const [m, p] = await exec([
      ["GET", K.meta(code)],
      ["HGETALL", K.players(code)],
    ]);
    if (!m) throw new GameError(404, "방이 없거나 끝났어요");
    const meta = JSON.parse(String(m)) as Meta;
    snap = toPublic(meta, parsePlayers(p));
    cacheSet(ck, snap, 30000);
    cacheSet(`meta:${code}:${ver}`, meta, 30000);
  }
  return { v: ver, changed: true as const, state: snap };
}

/* ---------- host ---------- */

function sanitizeMeta(meta: Meta) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { hostHash, ...rest } = meta;
  return rest;
}
export type HostMeta = ReturnType<typeof sanitizeMeta>;

async function requireHost(code: string, token: string, fresh: boolean): Promise<Meta> {
  const meta = fresh ? await loadMeta(code) : await metaCached(code);
  if (!meta) throw new GameError(404, "방이 없거나 끝났어요");
  if (!token || sha256(token) !== meta.hostHash) throw new GameError(403, "진행자 권한이 없어요");
  return meta;
}

export async function createRoom(input: Partial<Settings> | undefined) {
  const settings = cleanSettings(input);
  const token = newToken();
  const now = Date.now();
  const expAt = Math.floor(now / 1000) + TTL_SEC;
  for (let tries = 0; tries < 8; tries++) {
    const code = newCode();
    const meta: Meta = {
      code,
      hostHash: sha256(token),
      createdAt: now,
      expAt,
      phase: "lobby",
      phaseEndsAt: null,
      settings,
      order: [],
      shown: [],
      round: 0,
      current: null,
      scores: {},
      guessed: {},
      reveal: null,
      kicked: [],
    };
    const [ok] = await exec([["SET", K.meta(code), JSON.stringify(meta), "EXAT", expAt, "NX"]]);
    if (ok == null) continue;
    await exec([
      ["SET", K.ver(code), 1, "EXAT", expAt],
      ["SET", K.pver(code), 1, "EXAT", expAt],
    ]);
    cacheDel(`ver:${code}`);
    return { code, hostToken: token };
  }
  throw new GameError(503, "방 코드를 만들지 못했어요. 다시 눌러 주세요");
}

async function writeMeta(meta: Meta, extra: (string | number)[][] = []) {
  const res = await exec([
    ["SET", K.meta(meta.code), JSON.stringify(meta), "EXAT", meta.expAt],
    ["INCR", K.ver(meta.code)],
    ...extra,
  ]);
  const ver = Number(res[1]);
  cacheSet(`ver:${meta.code}`, ver, VER_CACHE_MS);
  cacheSet(`meta:${meta.code}:${ver}`, meta, 30000);
  return ver;
}

export async function hostPoll(code: string, token: string, knownVer: number, knownPver: number) {
  // Fast path: 1 request / 2 commands when nothing changed.
  const last = cacheGet<Meta>(`hostmeta:${code}`);
  const round = last?.phase === "vote" ? last.round : 0;
  const cmds: (string | number)[][] = [["MGET", K.ver(code), K.pver(code)]];
  if (round) cmds.push(["HLEN", K.votes(code, round)]);
  const res = await exec(cmds);
  const [verS, pverS] = res[0] as (string | null)[];
  if (verS == null) throw new GameError(404, "방이 없거나 끝났어요");
  const ver = Number(verS);
  const pver = Number(pverS ?? 0);
  let meta = last && cacheGet<number>(`hostmetaver:${code}`) === ver ? last : null;
  if (!meta) {
    meta = await requireHost(code, token, true);
    cacheSet(`hostmeta:${code}`, meta, 60000);
    cacheSet(`hostmetaver:${code}`, ver, 60000);
  } else if (!token || sha256(token) !== meta.hostHash) {
    throw new GameError(403, "진행자 권한이 없어요");
  }
  let voteCount = round ? Number(res[1] ?? 0) : 0;
  if (meta.phase === "vote" && meta.round !== round) {
    const [n] = await exec([["HLEN", K.votes(code, meta.round)]]);
    voteCount = Number(n ?? 0);
  }
  let players: Player[] | undefined;
  if (pver !== knownPver || ver !== knownVer) {
    const [p] = await exec([["HGETALL", K.players(code)]]);
    players = Object.values(parsePlayers(p));
  }
  return {
    ver,
    pver,
    meta: ver !== knownVer ? sanitizeMeta(meta) : undefined,
    players: players?.map(hostPlayerView),
    voteCount,
    storage: storageKind(),
  };
}

function hostPlayerView(p: Player) {
  return {
    id: p.id,
    nick: p.nick,
    joinedAt: p.joinedAt,
    drew: p.drew,
    answered: p.answers.filter(Boolean).length,
    imgRev: p.imgRev,
    kicked: !!p.kicked,
  };
}
export type HostPlayer = ReturnType<typeof hostPlayerView>;

const isReady = (p: Player | undefined) => !!p && !p.kicked && p.drew && p.answers.some(Boolean);

function startRound(meta: Meta, players: Record<string, Player>) {
  if (meta.settings.rounds === 0) {
    const fresh = shuffle(Object.values(players).filter((p) => isReady(p) && !meta.order.includes(p.id)).map((p) => p.id));
    meta.order.push(...fresh);
  }
  const limit = meta.settings.rounds === 0 ? Infinity : meta.settings.rounds;
  const nextPid = meta.order.find((pid) => !meta.shown.includes(pid) && isReady(players[pid]));
  meta.reveal = null;
  if (!nextPid || meta.round >= limit) {
    meta.phase = "final";
    meta.phaseEndsAt = null;
    meta.current = null;
    return;
  }
  const p = players[nextPid];
  meta.round += 1;
  meta.shown.push(nextPid);
  meta.current = { pid: p.id, nick: p.nick, answers: p.answers, imgRev: p.imgRev, tag: tagFor(p.tokenHash, meta.round) };
  meta.phase = "vote";
  meta.phaseEndsAt = Date.now() + meta.settings.voteSeconds * 1000;
}

async function loadPlayers(code: string) {
  const [p] = await exec([["HGETALL", K.players(code)]]);
  return parsePlayers(p);
}

export type HostAction =
  | { type: "settings"; settings: Partial<Settings> }
  | { type: "start-draw" }
  | { type: "extend"; seconds?: number }
  | { type: "start-rounds" }
  | { type: "reveal" }
  | { type: "next" }
  | { type: "skip" }
  | { type: "final" }
  | { type: "kick"; pid: string }
  | { type: "delete" };

export async function hostAction(code: string, token: string, action: HostAction) {
  const meta = await requireHost(code, token, true);
  const now = Date.now();
  switch (action.type) {
    case "settings": {
      if (meta.phase === "vote" || meta.phase === "reveal" || meta.phase === "final")
        throw new GameError(409, "게임 중에는 설정을 바꿀 수 없어요");
      meta.settings = cleanSettings({ ...meta.settings, ...action.settings });
      break;
    }
    case "start-draw": {
      if (meta.phase !== "lobby") throw new GameError(409, "이미 시작했어요");
      meta.phase = "draw";
      meta.phaseEndsAt = now + meta.settings.drawSeconds * 1000;
      break;
    }
    case "extend": {
      if (meta.phase !== "draw" && meta.phase !== "vote") throw new GameError(409, "지금은 시간을 늘릴 수 없어요");
      const add = Math.min(Math.max(Number(action.seconds) || 30, 5), 120) * 1000;
      meta.phaseEndsAt = Math.max(meta.phaseEndsAt ?? now, now) + add;
      break;
    }
    case "start-rounds": {
      if (meta.phase !== "draw" && meta.phase !== "lobby") throw new GameError(409, "이미 라운드 중이에요");
      const players = await loadPlayers(code);
      const ready = Object.values(players).filter(isReady);
      if (ready.length < 3) throw new GameError(409, "소개를 마친 사람이 3명 이상 있어야 시작할 수 있어요");
      meta.order = shuffle(ready.map((p) => p.id));
      meta.shown = [];
      meta.round = 0;
      startRound(meta, players);
      break;
    }
    case "reveal": {
      if (meta.phase !== "vote" || !meta.current) throw new GameError(409, "투표 중이 아니에요");
      const [[v], players] = await Promise.all([exec([["HGETALL", K.votes(code, meta.round)]]), loadPlayers(code)]);
      const votes = flatToObj(v);
      const target = meta.current.pid;
      const counts: Record<string, number> = {};
      const correctVoters: string[] = [];
      let total = 0;
      for (const [voter, pick] of Object.entries(votes)) {
        if (voter === target || !players[voter] || players[voter].kicked) continue;
        total++;
        counts[pick] = (counts[pick] ?? 0) + 1;
        if (pick === target) {
          correctVoters.push(voter);
          meta.scores[voter] = (meta.scores[voter] ?? 0) + 1;
        }
      }
      meta.guessed[target] = { correct: correctVoters.length, total };
      const dist = Object.entries(counts)
        .map(([pid, count]) => ({ pid, nick: players[pid]?.nick ?? "?", count }))
        .sort((a, b) => b.count - a.count || (a.pid === target ? -1 : 1))
        .slice(0, 6);
      if (!dist.some((d) => d.pid === target)) dist.push({ pid: target, nick: meta.current.nick, count: 0 });
      meta.reveal = { round: meta.round, pid: target, nick: meta.current.nick, total, correct: correctVoters.length, correctVoters, dist };
      meta.phase = "reveal";
      meta.phaseEndsAt = null;
      break;
    }
    case "next": {
      if (meta.phase !== "reveal") throw new GameError(409, "정답 공개 뒤에 넘어갈 수 있어요");
      startRound(meta, await loadPlayers(code));
      break;
    }
    case "skip": {
      if (meta.phase === "draw" || meta.phase === "lobby") return hostAction(code, token, { type: "start-rounds" });
      if (meta.phase !== "vote" && meta.phase !== "reveal") throw new GameError(409, "건너뛸 라운드가 없어요");
      if (meta.phase === "vote") {
        await exec([["DEL", K.votes(code, meta.round)]]);
        meta.round -= 1; // skipped person doesn't use up a round
      }
      startRound(meta, await loadPlayers(code));
      break;
    }
    case "final": {
      meta.phase = "final";
      meta.phaseEndsAt = null;
      meta.current = null;
      meta.reveal = null;
      break;
    }
    case "kick": {
      const players = await loadPlayers(code);
      const p = players[String(action.pid)];
      if (!p) throw new GameError(404, "그런 참가자가 없어요");
      p.kicked = true;
      if (!meta.kicked.includes(p.id)) meta.kicked.push(p.id);
      meta.order = meta.order.filter((x) => x !== p.id || meta.shown.includes(x));
      await exec([
        ["HSET", K.players(code), p.id, JSON.stringify(p)],
        ["HDEL", K.nicks(code), nickKey(p.nick)],
        ["DEL", K.img(code, p.id)],
        ["INCR", K.pver(code)],
      ]);
      if (meta.phase === "vote" && meta.current?.pid === p.id) {
        await exec([["DEL", K.votes(code, meta.round)]]);
        meta.round -= 1;
        players[p.id] = p;
        startRound(meta, players);
      }
      break;
    }
    case "delete": {
      const players = await loadPlayers(code);
      const keys = [K.meta(code), K.ver(code), K.pver(code), K.players(code), K.nicks(code)];
      for (let r = 1; r <= meta.round + 1; r++) keys.push(K.votes(code, r));
      for (const pid of Object.keys(players)) keys.push(K.img(code, pid));
      await exec([["DEL", ...keys]]);
      cacheDel(`ver:${code}`);
      cacheDel(`meta:${code}`);
      cacheDel(`snap:${code}`);
      cacheDel(`hostmeta`);
      cacheSet(`ver:${code}`, null, VER_CACHE_MS);
      return { deleted: true };
    }
    default:
      throw new GameError(400, "알 수 없는 동작");
  }
  const ver = await writeMeta(meta);
  cacheSet(`hostmeta:${code}`, meta, 60000);
  cacheSet(`hostmetaver:${code}`, ver, 60000);
  return { ok: true, ver };
}

/* ---------- players ---------- */

async function requirePlayer(code: string, pid: string, token: string): Promise<Player> {
  if (!pid || !token) throw new GameError(401, "다시 입장해 주세요");
  const [raw] = await exec([["HGET", K.players(code), pid]]);
  if (!raw) throw new GameError(401, "다시 입장해 주세요");
  const p = JSON.parse(String(raw)) as Player;
  if (sha256(token) !== p.tokenHash) throw new GameError(401, "다시 입장해 주세요");
  if (p.kicked) throw new GameError(403, "진행자가 내보냈어요", { kicked: true });
  return p;
}

export async function join(code: string, rawNick: unknown) {
  const nick = cleanText(rawNick, 12);
  if (!nick) throw new GameError(400, "닉네임을 1~12자로 적어 주세요");
  const meta = await metaCached(code);
  if (!meta) throw new GameError(404, "방 코드를 다시 확인해 주세요");
  if (meta.phase === "final") throw new GameError(409, "이미 끝난 게임이에요");
  const id = newId();
  const [count, added] = await exec([
    ["HLEN", K.players(code)],
    ["HSETNX", K.nicks(code), nickKey(nick), id],
  ]);
  if (!Number(added)) {
    const base = Array.from(nick).slice(0, 10).join("");
    const suggest = `${base}${Math.floor(Math.random() * 89) + 11}`;
    throw new GameError(409, "같은 닉네임이 이미 있어요", { dup: true, suggest });
  }
  if (Number(count) >= MAX_PLAYERS) {
    await exec([["HDEL", K.nicks(code), nickKey(nick)]]);
    throw new GameError(409, `한 방에 최대 ${MAX_PLAYERS}명까지 들어올 수 있어요`);
  }
  const token = newToken();
  const p: Player = { id, nick, tokenHash: sha256(token), joinedAt: Date.now(), answers: ["", "", ""], drew: false, imgRev: 0 };
  await exec([
    ["HSET", K.players(code), id, JSON.stringify(p)],
    ["EXPIREAT", K.players(code), meta.expAt],
    ["EXPIREAT", K.nicks(code), meta.expAt],
    ["INCR", K.pver(code)],
  ]);
  return { pid: id, token, nick };
}

export async function me(code: string, pid: string, token: string) {
  const p = await requirePlayer(code, pid, token);
  return { id: p.id, nick: p.nick, answers: p.answers, drew: p.drew, imgRev: p.imgRev };
}

export async function submitProfile(code: string, pid: string, token: string, body: { answers?: unknown; image?: unknown }) {
  const p = await requirePlayer(code, pid, token);
  const meta = await metaCached(code);
  if (!meta) throw new GameError(404, "방이 없거나 끝났어요");
  if (meta.phase === "final") throw new GameError(409, "게임이 끝났어요");
  if (meta.shown.includes(pid)) throw new GameError(409, "이미 소개된 뒤라 고칠 수 없어요");
  const arr = Array.isArray(body.answers) ? body.answers : [];
  const answers = [0, 1, 2].map((i) => cleanText(arr[i], 40));
  if (!answers.some(Boolean)) throw new GameError(400, "질문에 답을 적어 주세요");
  const cmds: (string | number)[][] = [];
  if (body.image !== undefined && body.image !== null) {
    const img = parseImage(body.image);
    if (!img) throw new GameError(413, "그림 파일이 너무 크거나 형식이 맞지 않아요");
    p.drew = true;
    p.imgRev += 1;
    p.mime = img.mime;
    cmds.push(["SET", K.img(code, pid), img.b64, "EXAT", meta.expAt]);
  }
  if (!p.drew) throw new GameError(400, "낙서를 먼저 그려 주세요");
  p.answers = answers;
  cmds.push(["HSET", K.players(code), pid, JSON.stringify(p)], ["INCR", K.pver(code)]);
  await exec(cmds);
  return { ok: true, imgRev: p.imgRev };
}

export async function vote(code: string, pid: string, token: string, target: unknown) {
  const meta = await metaCached(code);
  if (!meta) throw new GameError(404, "방이 없거나 끝났어요");
  if (meta.phase !== "vote" || !meta.current || !meta.phaseEndsAt || Date.now() > meta.phaseEndsAt + VOTE_GRACE_MS)
    throw new GameError(409, "투표 시간이 아니에요");
  const p = await requirePlayer(code, pid, token);
  if (p.id === meta.current.pid) throw new GameError(403, "내 차례엔 투표할 수 없어요");
  const t = String(target ?? "");
  if (t === p.id) throw new GameError(400, "나 자신은 고를 수 없어요");
  if (!/^[A-Za-z0-9_-]{8}$/.test(t)) throw new GameError(400, "사람을 골라 주세요");
  await exec([
    ["HSET", K.votes(code, meta.round), p.id, t],
    ["EXPIREAT", K.votes(code, meta.round), meta.expAt],
  ]);
  return { ok: true, round: meta.round };
}

export async function getImage(code: string, pid: string, auth: { host?: string; pid?: string; token?: string }) {
  if (auth.host) await requireHost(code, auth.host, false);
  else if (!(auth.pid === pid && auth.token && (await requirePlayer(code, pid, auth.token)))) throw new GameError(403, "볼 수 없어요");
  const [b64, raw] = await exec([
    ["GET", K.img(code, pid)],
    ["HGET", K.players(code), pid],
  ]);
  if (!b64 || !raw) throw new GameError(404, "그림이 없어요");
  const p = JSON.parse(String(raw)) as Player;
  return { buf: Buffer.from(String(b64), "base64"), mime: p.mime ?? "image/png" };
}
