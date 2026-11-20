"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HostMeta, HostPlayer } from "@/lib/game";
import { api, ApiError, secondsLeft, store, syncClock } from "@/lib/client";
import { leaderboard, mystery } from "@/lib/rank";
import { isMuted, setMuted, sfx } from "@/lib/sound";
import { usePoll, useTicker } from "@/lib/usePoll";
import { Qr } from "./Qr";
import { SettingsForm } from "./SettingsForm";

type Poll = { ver: number; pver: number; meta?: HostMeta; players?: HostPlayer[]; voteCount: number; storage: "redis" | "memory"; now: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function HostScreen({ code }: { code: string }) {
  const [token] = useState<string | null>(() => store.get<string>(`kn-host:${code}`));
  const [meta, setMeta] = useState<HostMeta | null>(null);
  const [players, setPlayers] = useState<HostPlayer[]>([]);
  const [voteCount, setVoteCount] = useState(0);
  const [storage, setStorage] = useState<"redis" | "memory">("redis");
  const [status, setStatus] = useState<"ok" | "gone" | "denied" | "deleted">("ok");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [muted, setMute] = useState(() => store.get<boolean>("kn-muted") ?? false);
  const [showPeople, setShowPeople] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState<"rank" | "mystery" | "gallery">("rank");
  const [imgs, setImgs] = useState<Record<string, string>>({});
  const ver = useRef(-1);
  const miss = useRef<{ n: number; since: number } | null>(null);
  const pver = useRef(-1);
  const revealing = useRef(0);
  const lastTick = useRef(-1);
  useTicker(250);

  useEffect(() => setMuted(muted), [muted]);

  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const r = await api<Poll>(`/api/rooms/${code}/host?v=${ver.current}&pv=${pver.current}`, { headers: { "x-host-token": token } });
      syncClock(r.now);
      ver.current = r.ver;
      pver.current = r.pver;
      if (r.meta) setMeta(r.meta);
      if (r.players) setPlayers(r.players);
      setVoteCount(r.voteCount);
      setStorage(r.storage);
      miss.current = null;
      setErr("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // never end the room on one bad answer: need 4 misses in a row over 8s+
        const m = (miss.current ??= { n: 0, since: Date.now() });
        m.n++;
        if (m.n >= 4 && Date.now() - m.since >= 8000) return setStatus((s) => (s === "deleted" ? s : "gone"));
        setErr("연결이 잠깐 끊겼어요. 다시 잇는 중…");
      }
      else if (e instanceof ApiError && e.status === 403) setStatus("denied");
      else setErr("연결이 잠깐 끊겼어요. 다시 잇는 중…");
    }
  }, [code, token]);
  usePoll(poll, 1500, !!token && status === "ok");

  const act = useCallback(
    async (a: Record<string, unknown>) => {
      if (!token) return;
      setBusy(true);
      try {
        await api(`/api/rooms/${code}/host`, { method: "POST", json: a, headers: { "x-host-token": token } });
        await poll();
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [code, token, poll],
  );

  const active = useMemo(() => players.filter((p) => !p.kicked), [players]);
  const ready = active.filter((p) => p.drew && p.answered > 0);
  const phase = meta?.phase;
  const left = secondsLeft(meta?.phaseEndsAt);
  const target = meta?.current?.pid;
  const eligible = Math.max(0, active.filter((p) => p.id !== target).length);

  /* images: fetched with the host key, kept as blob URLs */
  const requested = useRef(new Set<string>());
  const wantedList: string[] = [];
  if (meta?.current) wantedList.push(`${meta.current.pid}:${meta.current.imgRev}`);
  if (phase === "final") for (const p of active) if (p.drew) wantedList.push(`${p.id}:${p.imgRev}`);
  const wanted = wantedList.join(",");
  useEffect(() => {
    if (!token || !wanted) return;
    for (const key of wanted.split(",")) {
      const pid = key.split(":")[0];
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      fetch(`/api/rooms/${code}/img/${pid}`, { headers: { "x-host-token": token }, cache: "no-store" })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => {
          if (b) setImgs((m) => ({ ...m, [key]: URL.createObjectURL(b) }));
          else requested.current.delete(key);
        })
        .catch(() => requested.current.delete(key));
    }
  }, [wanted, code, token]);

  /* sounds */
  const prevCount = useRef(0);
  useEffect(() => {
    if (active.length > prevCount.current && prevCount.current > 0 && (phase === "lobby" || phase === "draw")) sfx.pop();
    prevCount.current = active.length;
  }, [active.length, phase]);
  const prevPhase = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = `${phase}:${meta?.round}`;
    if (prevPhase.current && prevPhase.current !== key) {
      if (phase === "draw") sfx.start();
      if (phase === "vote") sfx.pop();
      if (phase === "reveal") sfx.tada();
      if (phase === "final") sfx.fanfare();
    }
    prevPhase.current = key;
  }, [phase, meta?.round]);

  const doReveal = useCallback(
    async (round: number) => {
      if (revealing.current === round) return;
      revealing.current = round;
      sfx.drumroll(reduced() ? 0.3 : 1.1);
      await sleep(reduced() ? 300 : 1100);
      await act({ type: "reveal" });
    },
    [act],
  );

  // countdown ticks + auto reveal (time up, or everyone voted)
  useEffect(() => {
    if (!meta || meta.phase !== "vote") return;
    if (left <= 5 && left > 0 && lastTick.current !== left) sfx.tick(left === 1);
    lastTick.current = left;
    const allIn = eligible > 0 && voteCount >= eligible;
    if (left === 0 || allIn) void doReveal(meta.round);
  });

  if (!token || status === "denied")
    return (
      <Center title="이 브라우저엔 진행자 열쇠가 없어요">
        <p>방을 만든 브라우저에서만 진행할 수 있어요. 새로 방을 만들어 주세요.</p>
        <Link className="btn primary big" href="/host">
          새 방 만들기
        </Link>
      </Center>
    );
  if (status === "deleted")
    return (
      <Center title="방을 닫았어요">
        <p>그림과 답, 투표 기록을 모두 지웠어요. 수고했어요!</p>
        <Link className="btn primary big" href="/host">
          새 방 만들기
        </Link>
      </Center>
    );
  if (status === "gone")
    return (
      <Center title="방이 끝났어요">
        <p>2시간이 지났거나 이미 지운 방이에요.</p>
        <Link className="btn primary big" href="/host">
          새 방 만들기
        </Link>
      </Center>
    );
  if (!meta) return <div className="loading">방 불러오는 중…</div>;

  const origin = window.location.origin;
  const joinUrl = `${origin}/j/${code}`;
  const img = meta.current ? imgs[`${meta.current.pid}:${meta.current.imgRev}`] : undefined;
  const lb = phase === "final" ? leaderboard(meta.scores, active) : [];
  const mys = phase === "final" ? mystery(meta.guessed, active) : [];
  const kick = (p: HostPlayer) => {
    if (window.confirm(`${p.nick} 님을 내보낼까요? 그림과 답도 지워져요.`)) void act({ type: "kick", pid: p.id });
  };
  const endRoom = async () => {
    if (!window.confirm("방을 끝내고 모든 그림·답·점수를 지울까요? 되돌릴 수 없어요.")) return;
    await act({ type: "delete" });
    store.del(`kn-host:${code}`);
    setStatus("deleted");
  };
  const total = meta.settings.rounds === 0 ? meta.order.length : Math.min(meta.settings.rounds, meta.order.length);

  return (
    <div className={`stage phase-${phase}`} onPointerDown={() => sfx.unlock()}>
      <header className="stage-top">
        <span className="logo">
          끄적<em>누구</em>
        </span>
        <span className="room-pill">
          방 코드 <b>{code}</b>
        </span>
        <div className="top-actions">
          <button className="chip-btn" onClick={() => setShowPeople(true)}>
            참가 {active.length}명
          </button>
          <button
            className="chip-btn"
            aria-pressed={muted}
            onClick={() => {
              setMute(!muted);
              store.set("kn-muted", !muted);
              if (isMuted()) sfx.unlock();
            }}
          >
            {muted ? "소리 꺼짐" : "소리 켜짐"}
          </button>
          <button className="chip-btn danger" onClick={endRoom}>
            끝내기
          </button>
        </div>
      </header>

      {storage === "memory" && (
        <div className="notice" role="status">
          <b>저장소 미연결 · 데모 모드</b> Upstash Redis가 아직 연결되지 않아 서버 메모리에 임시 저장 중이에요. 여러 명이 동시에 하면 끊길 수 있어요. Vercel
          프로젝트 → Storage → Upstash for Redis를 연결해 주세요.
        </div>
      )}
      {err && <div className="toast">{err}</div>}

      {phase === "lobby" && (
        <>
          <section className="lobby">
            <div className="join-card">
              <Qr className="qr" url={joinUrl} />
              <div className="join-info">
                <p className="hand">폰 카메라로 찍거나 주소를 입력해요</p>
                <p className="join-url">
                  {window.location.host}/j/<b>{code}</b>
                </p>
                <div className="code-tiles" aria-label={`방 코드 ${code}`}>
                  {code.split("").map((ch, i) => (
                    <span key={i}>{ch}</span>
                  ))}
                </div>
              </div>
            </div>
            <div className="roster">
              <h2>
                들어온 사람 <b>{active.length}</b>명
                {ready.length > 0 && <small> · 벌써 다 그린 사람 {ready.length}명</small>}
              </h2>
              {active.length === 0 ? (
                <p className="empty hand">아직 아무도 없어요. QR을 크게 띄워 주세요!</p>
              ) : (
                <ul className="chips">
                  {active.map((p) => (
                    <li key={p.id} className={p.drew && p.answered ? "done" : ""}>
                      {p.nick}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
          <footer className="stage-bar">
            <div className="today">
              <span>오늘의 질문</span>
              {meta.settings.questions.map((q, i) => (
                <b key={i}>
                  {i + 1}. {q}
                </b>
              ))}
            </div>
            <button className="btn ghost" onClick={() => setShowSettings(true)}>
              질문·설정 바꾸기
            </button>
            <button className="btn primary big" disabled={busy || active.length === 0} onClick={() => act({ type: "start-draw" })}>
              그리기 시작 ({meta.settings.drawSeconds}초)
            </button>
          </footer>
        </>
      )}

      {phase === "draw" && (
        <>
          <section className="drawing">
            <div className="big-timer">
              <span className={`num ${left <= 10 ? "hot" : ""}`}>{left}</span>
              <p>{left > 0 ? "폰에서 내 얼굴 낙서하고 TMI 세 줄 쓰는 중" : "시간 끝! 다 됐으면 라운드를 시작해요"}</p>
              <ol className="draw-qs">
                {meta.settings.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </div>
            <div className="progress">
              <p className="progress-label">
                소개 완성 <b>{ready.length}</b> / {active.length}
              </p>
              <div className="bar">
                <i style={{ width: `${active.length ? (ready.length / active.length) * 100 : 0}%` }} />
              </div>
              <ul className="chips small">
                {active.map((p) => (
                  <li key={p.id} className={p.drew && p.answered ? "done" : ""}>
                    {p.nick}
                  </li>
                ))}
              </ul>
            </div>
            <aside className="mini-join">
              <Qr className="qr" url={joinUrl} />
              <span>
                늦게 왔다면 · <b>{code}</b>
              </span>
            </aside>
          </section>
          <footer className="stage-bar">
            <div className="today">
              <span>라운드</span>
              <b>{meta.settings.rounds === 0 ? "전원 다 맞히기" : `${meta.settings.rounds}명 맞히기`} · 투표 {meta.settings.voteSeconds}초</b>
            </div>
            <button className="btn ghost" disabled={busy} onClick={() => act({ type: "extend", seconds: 30 })}>
              +30초
            </button>
            <button className="btn primary big" disabled={busy || ready.length < 3} onClick={() => act({ type: "start-rounds" })}>
              {ready.length < 3 ? "3명 이상 완성하면 시작" : "라운드 시작"}
            </button>
          </footer>
        </>
      )}

      {(phase === "vote" || phase === "reveal") && meta.current && (
        <>
          <section className={`round ${phase === "reveal" ? "is-reveal" : ""}`}>
            <div className="portrait">
              <div className="frame">
                <span className="tape" aria-hidden />
                {img ? <img src={img} alt={phase === "reveal" ? `${meta.current.nick}의 낙서` : "주인공의 낙서"} /> : <div className="ph">그림 불러오는 중</div>}
                {phase === "reveal" && <div className="stamp">{meta.current.nick}</div>}
              </div>
            </div>
            <div className="tmi">
              <p className="round-no">
                ROUND {meta.round}
                <span> / {total || meta.round}</span>
              </p>
              {phase === "vote" ? (
                <>
                  <h2 className="ask">이 낙서의 주인공은 누구게?</h2>
                  <ol className="answers">
                    {meta.settings.questions.map((q, i) => (
                      <li key={i}>
                        <small>{q}</small>
                        <strong>{meta.current!.answers[i] || "(비밀이래요)"}</strong>
                      </li>
                    ))}
                  </ol>
                  <div className="vote-meter">
                    <div className="timer-bar">
                      <i style={{ width: `${Math.min(100, (left / meta.settings.voteSeconds) * 100)}%` }} />
                    </div>
                    <span className={`secs ${left <= 5 ? "hot" : ""}`}>{left}</span>
                    <span className="count">
                      투표 <b>{voteCount}</b>/{eligible}
                    </span>
                  </div>
                </>
              ) : (
                meta.reveal && (
                  <>
                    <h2 className="answer-name">
                      정답은 <mark>{meta.reveal.nick}</mark>
                    </h2>
                    <p className="hit">
                      {meta.reveal.total}명 중 <b>{meta.reveal.correct}</b>명이 맞혔어요
                      {meta.reveal.total > 0 && meta.reveal.correct === 0 && " · 완벽한 위장!"}
                      {meta.reveal.total > 2 && meta.reveal.correct === meta.reveal.total && " · 너무 티 났다!"}
                    </p>
                    <ul className="dist">
                      {meta.reveal.dist.slice(0, 5).map((d) => {
                        const max = Math.max(1, ...meta.reveal!.dist.map((x) => x.count));
                        return (
                          <li key={d.pid} className={d.pid === meta.reveal!.pid ? "right" : ""}>
                            <span className="dn">{d.nick}</span>
                            <span className="db">
                              <i style={{ width: `${(d.count / max) * 100}%` }} />
                            </span>
                            <b>{d.count}</b>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )
              )}
            </div>
          </section>
          <footer className="stage-bar">
            <div className="today">
              <span>진행</span>
              <b>
                {meta.round}번째 주인공 · 남은 소개 {Math.max(0, (total || 0) - meta.round)}명
              </b>
            </div>
            {phase === "vote" ? (
              <>
                <button className="btn ghost" disabled={busy} onClick={() => act({ type: "extend", seconds: 10 })}>
                  +10초
                </button>
                <button className="btn ghost" disabled={busy} onClick={() => act({ type: "skip" })}>
                  건너뛰기
                </button>
                <button className="btn primary big" disabled={busy} onClick={() => doReveal(meta.round)}>
                  정답 공개
                </button>
              </>
            ) : (
              <>
                <button className="btn ghost" disabled={busy} onClick={() => act({ type: "final" })}>
                  바로 결과 보기
                </button>
                <button className="btn primary big" disabled={busy} onClick={() => act({ type: "next" })}>
                  {meta.settings.rounds !== 0 && meta.round >= total ? "최종 결과 보기" : "다음 주인공"}
                </button>
              </>
            )}
          </footer>
        </>
      )}

      {phase === "final" && (
        <>
          <section className="final">
            <nav className="tabs" role="tablist">
              {(
                [
                  ["rank", "눈썰미 순위"],
                  ["mystery", "미스터리상"],
                  ["gallery", "낙서 갤러리"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </nav>
            {tab === "rank" && (
              <div className="rank">
                <div className="podium">
                  {[1, 0, 2].map((i) =>
                    lb[i] ? (
                      <div key={lb[i].id} className={`step s${lb[i].rank}`}>
                        <span className="medal">{lb[i].rank}등</span>
                        <b>{lb[i].nick}</b>
                        <span>{lb[i].score}개 맞힘</span>
                      </div>
                    ) : (
                      <div key={i} className="step empty" />
                    ),
                  )}
                </div>
                <ol className="rest">
                  {lb.slice(3, 12).map((r) => (
                    <li key={r.id}>
                      <span>{r.rank}</span>
                      <b>{r.nick}</b>
                      <em>{r.score}</em>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {tab === "mystery" && (
              <div className="mystery">
                <h2>
                  제일 알아보기 힘들었던 사람, <mark>미스터리상</mark>
                </h2>
                {mys.length === 0 ? (
                  <p className="hand">아직 소개된 사람이 없어요.</p>
                ) : (
                  <div className="mys-cards">
                    {mys.map((m) => {
                      const p = active.find((x) => x.id === m.id);
                      const src = p ? imgs[`${p.id}:${p.imgRev}`] : undefined;
                      return (
                        <figure key={m.id} className="frame">
                          <span className="tape" aria-hidden />
                          {src ? <img src={src} alt={`${m.nick}의 낙서`} /> : <div className="ph" />}
                          <figcaption>
                            <b>{m.nick}</b>
                            <span>
                              {m.total}명 중 {m.correct}명만 맞혔어요
                            </span>
                          </figcaption>
                        </figure>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {tab === "gallery" && (
              <div className="gallery" style={{ gridTemplateColumns: `repeat(${galleryCols(active.filter((p) => p.drew).length)}, minmax(0, 1fr))` }}>
                {active
                  .filter((p) => p.drew)
                  .map((p, i) => {
                    const src = imgs[`${p.id}:${p.imgRev}`];
                    return (
                      <figure key={p.id} className="gal" style={{ ["--tilt" as string]: `${((i * 37) % 7) - 3}deg` }}>
                        {src ? <img src={src} alt={`${p.nick}의 낙서`} loading="lazy" /> : <div className="ph" />}
                        <figcaption>{p.nick}</figcaption>
                      </figure>
                    );
                  })}
              </div>
            )}
          </section>
          <footer className="stage-bar">
            <div className="today">
              <span>끝!</span>
              <b>
                {meta.round}명을 함께 알아봤어요 · 참가 {active.length}명
              </b>
            </div>
            <button className="btn danger big" disabled={busy} onClick={endRoom}>
              방 끝내기 · 데이터 삭제
            </button>
          </footer>
        </>
      )}

      {showPeople && (
        <div className="overlay" onClick={() => setShowPeople(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="참가자 관리">
            <h2>참가자 {active.length}명</h2>
            <ul className="people">
              {active.map((p) => (
                <li key={p.id}>
                  <b>{p.nick}</b>
                  <span className={p.drew && p.answered ? "ok" : ""}>{p.drew && p.answered ? "소개 완료" : p.drew ? "답 쓰는 중" : "그리는 중"}</span>
                  <button className="mini danger" onClick={() => kick(p)}>
                    내보내기
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn ghost" onClick={() => setShowPeople(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
      {showSettings && (
        <div className="overlay" onClick={() => setShowSettings(false)}>
          <div className="sheet wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="질문과 설정">
            <SettingsForm
              initial={meta.settings}
              submitLabel="저장"
              busy={busy}
              onCancel={() => setShowSettings(false)}
              onSubmit={async (settings) => {
                await act({ type: "settings", settings });
                setShowSettings(false);
              }}
            />
          </div>
        </div>
      )}
      <footer className="credit stage-credit">끄적누구 · 만든 사람 양○○ (애즈몽)</footer>
    </div>
  );
}

/** Pick a column count so the whole class fits on one projector screen. */
function galleryCols(n: number) {
  const w = window.innerWidth * 0.95;
  const h = window.innerHeight * 0.6;
  for (let cols = 4; cols <= 16; cols++) {
    const rows = Math.ceil(n / cols);
    if (rows * (w / cols) * 1.22 <= h) return cols;
  }
  return 16;
}

function Center({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="center">
      <span className="logo">
        끄적<em>누구</em>
      </span>
      <h1>{title}</h1>
      {children}
    </main>
  );
}
