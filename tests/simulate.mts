/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON in a test driver */
// Drives 35 fake players + 1 host through a full game against a running server
// (in-memory store), checks the rules, and estimates Redis commands per session.
// Usage: BASE=http://localhost:3100 npm run sim
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

const BASE = process.env.BASE ?? "http://localhost:3100";
const N = Number(process.env.PLAYERS ?? 35);
const POLL_MS = 1500;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (cond: unknown, msg: string) => {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
};

async function call(path: string, init: { method?: string; json?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(BASE + path, {
    method: init.method ?? (init.json ? "POST" : "GET"),
    headers: { ...(init.json ? { "Content-Type": "application/json" } : {}), ...init.headers },
    body: init.json ? JSON.stringify(init.json) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as Record<string, any> };
}

// tiny valid PNG (solid colour, 64x64)
function png(r: number, g: number, b: number) {
  const w = 64, h = 64;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const out = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return "data:image/png;base64," + out.toString("base64");
}

type P = { i: number; nick: string; pid: string; token: string; ver: number; state: any; polls: number; changed: number };

async function main() {
  console.log(`\n끄적누구 시뮬레이션 · ${N}명 · ${BASE}`);
  const statsOn = (await call("/api/debug/stats", { method: "DELETE" })).status === 200;

  console.log("\n[방 만들기]");
  const created = await call("/api/rooms", { json: { settings: { setId: "work", rounds: 8, drawSeconds: 30, voteSeconds: 10 } } });
  ok(created.status === 200 && /^[A-Z2-9]{5}$/.test(created.data.code), `방 코드 ${created.data.code}`);
  const code = created.data.code as string;
  const hostH = { "x-host-token": created.data.hostToken as string };

  console.log("\n[입장]");
  const players: P[] = [];
  await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const r = await call(`/api/rooms/${code}/join`, { json: { nick: i === 0 ? "<b>민지</b>" : `참가자${String(i).padStart(2, "0")}` } });
      if (r.status === 200) players[i] = { i, nick: r.data.nick, pid: r.data.pid, token: r.data.token, ver: -1, state: null, polls: 0, changed: 0 };
    }),
  );
  ok(players.filter(Boolean).length === N, `${N}명 동시 입장`);
  ok(players[0].nick === "b민지/b", `HTML 태그 제거된 닉네임: ${players[0].nick}`);
  const dup = await call(`/api/rooms/${code}/join`, { json: { nick: "참가자 01" } });
  ok(dup.status === 409 && typeof dup.data.suggest === "string", `중복 닉네임 거절 + 추천(${dup.data.suggest})`);
  const bad = await call(`/api/rooms/XXXXX/join`, { json: { nick: "a" } });
  ok(bad.status === 404, "없는 방 코드 404");
  const noHost = await call(`/api/rooms/${code}/host`, { json: { type: "start-draw" }, headers: { "x-host-token": "nope" } });
  ok(noHost.status === 403, "진행자 토큰 없으면 403");

  // background pollers (every phone + host), like the real app
  let running = true;
  let hostVer = -1, hostPver = -1, hostPlayers: any[] = [], voteCount = 0, hostPolls = 0;
  const pollers = players.map(async (p) => {
    await sleep(Math.random() * POLL_MS);
    while (running) {
      const r = await call(`/api/rooms/${code}/state?v=${p.ver}`);
      p.polls++;
      if (r.status === 200) {
        p.ver = r.data.v;
        if (r.data.changed) { p.state = r.data.state; p.changed++; }
      } else if (r.status === 404) p.state = { gone: true };
      await sleep(POLL_MS);
    }
  });
  const hostLoop = (async () => {
    while (running) {
      const r = await call(`/api/rooms/${code}/host?v=${hostVer}&pv=${hostPver}`, { headers: hostH });
      hostPolls++;
      if (r.status === 200) {
        hostVer = r.data.ver; hostPver = r.data.pver;
        if (r.data.players) hostPlayers = r.data.players;
        voteCount = r.data.voteCount;
      }
      await sleep(POLL_MS);
    }
  })();
  const host = (type: string, extra: Record<string, unknown> = {}) => call(`/api/rooms/${code}/host`, { json: { type, ...extra }, headers: hostH });
  const auth = (p: P) => ({ "x-player-id": p.pid, "x-player-token": p.token });
  const t0 = Date.now();
  const phaseCmds: Record<string, number> = {};
  const snap = async (label: string) => {
    if (statsOn) phaseCmds[label] = (await call("/api/debug/stats")).data.commands;
  };

  console.log("\n[로비 → 그리기]");
  await sleep(3000);
  ok((await host("start-draw")).status === 200, "그리기 시작");
  await sleep(2500);
  ok(players.every((p) => p.state?.phase === "draw"), "모든 폰이 그리기 화면으로 바뀜");
  const big = "data:image/png;base64," + Buffer.alloc(50 * 1024, 1).toString("base64");
  const tooBig = await call(`/api/rooms/${code}/profile`, { json: { answers: ["a", "b", "c"], image: big }, headers: auth(players[1]) });
  ok(tooBig.status === 413, "40KB 넘는 그림 거절");
  const fake = await call(`/api/rooms/${code}/profile`, { json: { answers: ["a", "b", "c"], image: "data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAA" }, headers: auth(players[1]) });
  ok(fake.status === 413, "PNG가 아닌 데이터 거절");
  const res = await Promise.all(
    players.map(async (p, i) => {
      await sleep(Math.random() * 4000);
      return call(`/api/rooms/${code}/profile`, {
        json: { answers: [`부캐 ${i}`, `점심 기준 ${i}`, i % 7 === 0 ? "" : `뿌듯 ${i}`], image: png((i * 37) % 255, (i * 91) % 255, (i * 53) % 255) },
        headers: auth(p),
      });
    }),
  );
  ok(res.every((r) => r.status === 200), "35명 낙서 + TMI 제출");
  const re = await call(`/api/rooms/${code}/profile`, { json: { answers: ["고친 답", "b", "c"] }, headers: auth(players[2]) });
  ok(re.status === 200, "그림은 그대로 두고 답만 고치기");
  const me = await call(`/api/rooms/${code}/me`, { headers: auth(players[2]) });
  ok(me.status === 200 && me.data.answers[0] === "고친 답", "새로고침 뒤 토큰으로 다시 들어오기(/me)");
  const wrongTok = await call(`/api/rooms/${code}/me`, { headers: { "x-player-id": players[2].pid, "x-player-token": "x" } });
  ok(wrongTok.status === 401, "잘못된 플레이어 토큰 401");
  await host("extend", { seconds: 30 });
  await sleep(2000);
  ok(hostPlayers.filter((p) => p.drew && p.answered).length === N, `진행자 화면: 완성 ${N}/${N}`);
  await snap("lobby+draw");

  console.log("\n[강퇴]");
  const kicked = players[N - 1];
  ok((await host("kick", { pid: kicked.pid })).status === 200, `${kicked.nick} 내보내기`);
  const kv = await call(`/api/rooms/${code}/me`, { headers: auth(kicked) });
  ok(kv.status === 403, "내보낸 사람은 403");
  const live = players.slice(0, N - 1);

  console.log("\n[라운드]");
  ok((await host("start-rounds")).status === 200, "라운드 시작");
  const score: Record<string, number> = {};
  let lateJoiner: P | null = null;
  let skipped = false;
  for (;;) {
    await sleep(2200);
    const st = live[0].state;
    if (st.phase === "final") break;
    if (st.phase !== "vote") { await sleep(500); continue; }
    const round = st.round;
    // who is it? only the target's phone can compute the tag
    const target = live.find((p) => sha(`${sha(p.token)}:${round}`).slice(0, 16) === st.current.tag);
    ok(!!target, `R${round}: 주인공 폰만 태그로 자기 차례 확인 (${target?.nick})`);
    ok(!("pid" in st.current) && !st.current.nick, `R${round}: 공개 상태에 주인공 이름 없음`);
    if (round === 2) {
      const lj = await call(`/api/rooms/${code}/join`, { json: { nick: "지각생" } });
      lateJoiner = { i: 99, nick: "지각생", pid: lj.data.pid, token: lj.data.token, ver: -1, state: null, polls: 0, changed: 0 };
      ok(lj.status === 200, "게임 중간 늦게 입장");
    }
    const selfVote = await call(`/api/rooms/${code}/vote`, { json: { target: target!.pid }, headers: auth(target!) });
    if (round === 1) ok(selfVote.status === 403, "주인공은 투표 불가");
    const voters = [...live.filter((p) => p !== target), ...(lateJoiner ? [lateJoiner] : [])];
    if (round === 1) {
      const sv = await call(`/api/rooms/${code}/vote`, { json: { target: voters[0].pid }, headers: auth(voters[0]) });
      ok(sv.status === 400, "나 자신에게 투표 불가");
    }
    let expected = 0;
    await Promise.all(
      voters.map(async (p, k) => {
        await sleep(Math.random() * 3000);
        const correct = (k + round) % 2 === 0;
        const pick = correct ? target!.pid : voters[(k + 1) % voters.length].pid;
        // change mind once for some
        if (k % 5 === 0) await call(`/api/rooms/${code}/vote`, { json: { target: voters[(k + 2) % voters.length].pid }, headers: auth(p) });
        const r = await call(`/api/rooms/${code}/vote`, { json: { target: pick }, headers: auth(p) });
        if (r.status === 200 && correct) {
          expected++;
          score[p.pid] = (score[p.pid] ?? 0) + 1;
        }
      }),
    );
    await sleep(1600);
    if (round === 1) ok(voteCount === voters.length, `진행자 화면 투표 수 ${voteCount}/${voters.length}`);
    if (round === 3 && !skipped) {
      skipped = true;
      const sk = await host("skip");
      ok(sk.status === 200, "R3 건너뛰기 (점수 없음, 라운드 수 안 줄어듦)");
      for (const p of voters) if ((voters.indexOf(p) + round) % 2 === 0) score[p.pid]--;
      continue;
    }
    const rv = await host("reveal");
    ok(rv.status === 200, `R${round} 정답 공개`);
    await sleep(1700);
    const r = live[0].state.reveal;
    ok(r && r.correct === expected && r.pid === target!.pid, `R${round}: 정답자 ${r?.correct}명 = 예상 ${expected}명`);
    const late = await call(`/api/rooms/${code}/vote`, { json: { target: target!.pid }, headers: auth(voters[0]) });
    ok(late.status === 409, `R${round}: 공개 뒤 투표 거절`);
    await host("next");
  }
  await snap("rounds");

  console.log("\n[최종]");
  await sleep(1800);
  const fin = live[0].state;
  ok(fin.phase === "final", "최종 화면");
  ok(fin.round === 8, `실제 소개된 사람 8명 (건너뛴 1명 제외, 화면 라운드 ${fin.round})`);
  const lbOk = fin.leaderboard.every((x: any) => (score[x.id] ?? 0) === x.score);
  ok(lbOk, "순위표 점수 = 시뮬레이션 기대 점수");
  ok(fin.leaderboard.length === N - 1 + 1, `순위표 인원 ${fin.leaderboard.length} (강퇴 제외 + 지각생)`);
  ok(Array.isArray(fin.mystery) && fin.mystery.length >= 1, `미스터리상: ${fin.mystery.map((m: any) => `${m.nick} ${m.correct}/${m.total}`).join(", ")}`);
  const img = await fetch(`${BASE}/api/rooms/${code}/img/${live[3].pid}`, { headers: hostH });
  ok(img.status === 200 && img.headers.get("content-type") === "image/png", "진행자 갤러리 이미지 읽기");
  const peek = await fetch(`${BASE}/api/rooms/${code}/img/${live[3].pid}`, { headers: auth(live[4]) });
  ok(peek.status === 403, "다른 참가자 그림은 직접 못 봄");
  await sleep(4000);
  await snap("final");

  console.log("\n[삭제]");
  ok((await host("delete")).status === 200, "방 끝내기 · 데이터 삭제");
  await sleep(2600);
  ok(live.every((p) => p.state?.gone), "모든 폰이 '방이 끝났어요'로 바뀜");
  running = false;
  await Promise.all([...pollers, hostLoop]);
  const tEnd = Date.now();

  const polls = players.reduce((a, p) => a + p.polls, 0);
  console.log(`\n폴링: 참가자 ${polls}회, 진행자 ${hostPolls}회, 경과 ${((tEnd - t0) / 1000).toFixed(0)}초`);
  if (statsOn) {
    const st = (await call("/api/debug/stats")).data;
    console.log("단계별 누적 명령:", phaseCmds);
    console.log(`Redis 명령 (단일 인스턴스, 마이크로캐시 적중): 총 ${st.commands}개 / HTTP ${st.requests}회`, st.byCmd);
    // Extrapolate to a 15-minute session: idle polling cost per minute + one-off event costs.
    const minutes = (tEnd - t0) / 60000;
    const pollCmdsPerMin = (st.byCmd.GET ?? 0) / minutes; // dominated by version reads
    const best = Math.round(st.commands + pollCmdsPerMin * (15 - minutes));
    // Worst case: every poll lands on a cold serverless instance (no cache sharing).
    const playerPolls15 = (15 * 60 * 1000) / POLL_MS * 30;
    const hostPolls15 = (15 * 60 * 1000) / POLL_MS * 2;
    const worst = Math.round(playerPolls15 * 1 + hostPolls15 + st.commands);
    console.log(`\n15분 세션 추정 (30명): 캐시 잘 맞을 때 ≈ ${best.toLocaleString()}개, 최악(캐시 0%) ≈ ${worst.toLocaleString()}개`);
    console.log(`Upstash 무료 50만/월 기준: 약 ${Math.floor(500000 / worst)}~${Math.floor(500000 / Math.max(best, 1))}회 수업`);
  }
  console.log(failures ? `\n실패 ${failures}개` : "\n모든 검사 통과");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
