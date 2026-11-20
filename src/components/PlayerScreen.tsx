"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicState } from "@/lib/game";
import { api, ApiError, secondsLeft, sha256Hex, store, syncClock } from "@/lib/client";
import { matchName } from "@/lib/hangul";
import { usePoll, useTicker } from "@/lib/usePoll";
import { DrawPad, type DrawPadHandle } from "./DrawPad";

type Session = { pid: string; token: string; nick: string };
type Me = { id: string; nick: string; answers: string[]; drew: boolean; imgRev: number };
type Poll = { v: number; changed: boolean; state?: PublicState; now: number };

export default function PlayerScreen({ code }: { code: string }) {
  const skey = `kn-p:${code}`;
  const [session, setSession] = useState<Session | null>(() => store.get<Session>(skey));
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<PublicState | null>(null);
  const [status, setStatus] = useState<"ok" | "gone" | "kicked">("ok");
  const [net, setNet] = useState("");
  const [editing, setEditing] = useState(false);
  const [tokenHash, setTokenHash] = useState("");
  const ver = useRef(-1);
  useTicker(500);

  /* resume: check the saved session still exists */
  useEffect(() => {
    if (!session) return;
    let alive = true;
    api<Me>(`/api/rooms/${code}/me`, { headers: { "x-player-id": session.pid, "x-player-token": session.token } })
      .then((m) => alive && setMe(m))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 403) setStatus("kicked");
        else if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
          store.del(skey);
          setSession(null);
          if (e.status === 404) setStatus("gone");
        }
      });
    void sha256Hex(session.token).then((h) => alive && setTokenHash(h));
    return () => {
      alive = false;
    };
  }, [session, code, skey]);

  const poll = useCallback(async () => {
    try {
      const r = await api<Poll>(`/api/rooms/${code}/state?v=${ver.current}`);
      syncClock(r.now);
      ver.current = r.v;
      if (r.changed && r.state) setState(r.state);
      setNet("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setStatus("gone");
      else setNet("연결 다시 잇는 중…");
    }
  }, [code]);
  usePoll(poll, 1500, status === "ok");


  // Am I the person on the big screen? (tag = sha256(sha256(token):round), only my phone can compute it)
  const [tagCheck, setTagCheck] = useState<{ tag: string; mine: boolean } | null>(null);
  const curTag = state?.current?.tag ?? "";
  const round = state?.round ?? 0;
  useEffect(() => {
    if (!curTag || !tokenHash) return;
    let alive = true;
    void sha256Hex(`${tokenHash}:${round}`).then((h) => alive && setTagCheck({ tag: curTag, mine: h.slice(0, 16) === curTag }));
    return () => {
      alive = false;
    };
  }, [curTag, round, tokenHash]);
  const isTarget = !!curTag && tagCheck?.tag === curTag && tagCheck.mine;
  const kicked = status === "kicked" || (!!session && !!state?.kicked.includes(session.pid));

  if (status === "gone")
    return (
      <Shell code={code}>
        <div className="p-card center-card">
          <h1>방이 끝났어요</h1>
          <p>진행자가 방을 닫았거나 코드가 달라요. 그림과 답은 모두 지워졌어요.</p>
          <Link className="btn primary big" href="/">
            처음으로
          </Link>
        </div>
      </Shell>
    );
  if (kicked)
    return (
      <Shell code={code}>
        <div className="p-card center-card">
          <h1>진행자가 내보냈어요</h1>
          <p>잘못 들어온 거라면 진행자에게 말해 주세요.</p>
        </div>
      </Shell>
    );
  if (!state) return <div className="loading">방 찾는 중…</div>;

  if (!session)
    return (
      <Shell code={code}>
        <JoinForm
          code={code}
          disabled={state.phase === "final"}
          onJoined={(s) => {
            store.set(skey, s);
            setSession(s);
            setMe({ id: s.pid, nick: s.nick, answers: ["", "", ""], drew: false, imgRev: 0 });
          }}
        />
      </Shell>
    );
  if (!me) return <div className="loading">다시 들어가는 중…</div>;

  const auth = { "x-player-id": session.pid, "x-player-token": session.token };
  const done = me.drew && me.answers.some(Boolean);
  const canEdit = state.phase === "lobby" || state.phase === "draw" || (state.rounds === 0 && state.phase !== "final");
  const left = secondsLeft(state.phaseEndsAt);

  let body: React.ReactNode;
  if ((state.phase === "lobby" || state.phase === "draw" || editing) && (!done || editing) && canEdit) {
    body = (
      <Editor
        code={code}
        me={me}
        auth={auth}
        questions={state.questions}
        timer={state.phase === "draw" ? left : null}
        onSaved={(m) => {
          setMe(m);
          setEditing(false);
        }}
        onCancel={done ? () => setEditing(false) : undefined}
      />
    );
  } else if (state.phase === "lobby" || state.phase === "draw") {
    body = (
      <div className="p-card done-card">
        <span className="kicker">소개 완료</span>
        <h1>
          {me.nick}, 준비 끝!
          <br />
          이제 큰 화면을 봐요
        </h1>
        <p>{state.phase === "draw" ? `다른 사람들이 그리는 중이에요 · ${left}초` : "진행자가 곧 시작해요."}</p>
        <MyDoodle code={code} auth={auth} rev={me.imgRev} />
        <button className="btn ghost" onClick={() => setEditing(true)}>
          그림·답 고치기
        </button>
      </div>
    );
  } else if (state.phase === "vote" && state.current) {
    body = isTarget ? (
      <div className="p-card target-card">
        <span className="kicker">ROUND {state.round}</span>
        <h1>
          지금 화면 속
          <br />
          주인공은 <mark>바로 너</mark>
        </h1>
        <p>투표는 쉬어요. 표정 관리, 시작!</p>
        <div className="p-timer">{left}</div>
      </div>
    ) : (
      <VotePanel code={code} state={state} me={me} auth={auth} left={left} />
    );
  } else if (state.phase === "reveal" && state.reveal) {
    const r = state.reveal;
    const mine = r.pid === me.id;
    const right = r.correctVoters.includes(me.id);
    body = (
      <div className={`p-card result-card ${mine ? "mine" : right ? "right" : "wrong"}`}>
        <span className="kicker">ROUND {r.round} 정답</span>
        {mine ? (
          <h1>
            정체 공개!
            <br />
            {r.total}명 중 {r.correct}명이 알아봤어요
          </h1>
        ) : right ? (
          <h1>
            정답! <mark>+1</mark>
          </h1>
        ) : (
          <h1>아쉬워요</h1>
        )}
        <p className="answer-line">
          주인공은 <b>{r.nick}</b>
        </p>
        <p className="score-line">
          지금 내 점수 <b>{state.scores[me.id] ?? 0}</b>점
        </p>
      </div>
    );
  } else if (state.phase === "final") {
    const mine = state.leaderboard?.find((x) => x.id === me.id);
    body = (
      <div className="p-card final-card">
        <span className="kicker">끝!</span>
        <h1>
          {mine && mine.score > 0 ? `${mine.rank}등` : "수고했어요"}
          <small> · {mine?.score ?? 0}명 맞힘</small>
        </h1>
        {state.mystery && state.mystery.length > 0 && (
          <p className="mys-line">
            미스터리상: <b>{state.mystery.map((m) => m.nick).join(", ")}</b>
          </p>
        )}
        <ol className="p-rank">
          {state.leaderboard?.slice(0, 5).map((r) => (
            <li key={r.id} className={r.id === me.id ? "me" : ""}>
              <span>{r.rank}</span>
              <b>{r.nick}</b>
              <em>{r.score}</em>
            </li>
          ))}
        </ol>
        <p className="muted">큰 화면에서 낙서 갤러리를 같이 봐요. 방을 닫으면 그림과 답은 바로 지워져요.</p>
      </div>
    );
  } else {
    body = (
      <div className="p-card">
        <h1>잠깐만요…</h1>
      </div>
    );
  }

  const lateJoin = (state.phase === "vote" || state.phase === "reveal") && !done && state.rounds === 0 && !editing;

  return (
    <Shell code={code} nick={me.nick} net={net}>
      {body}
      {lateJoin && (
        <button className="btn ghost late" onClick={() => setEditing(true)}>
          나도 소개 올리기 (다음 라운드에 나올 수 있어요)
        </button>
      )}
    </Shell>
  );
}

function Shell({ code, nick, net, children }: { code: string; nick?: string; net?: string; children: React.ReactNode }) {
  return (
    <main className="phone">
      <header className="p-top">
        <span className="logo small">
          끄적<em>누구</em>
        </span>
        <span className="p-meta">
          {nick && <b>{nick}</b>}
          <span>{code}</span>
        </span>
      </header>
      {net && <div className="toast">{net}</div>}
      {children}
      <footer className="credit">만든 사람 · 양○○ (애즈몽)</footer>
    </main>
  );
}

function JoinForm({ code, disabled, onJoined }: { code: string; disabled: boolean; onJoined: (s: Session) => void }) {
  const [nick, setNick] = useState("");
  const [err, setErr] = useState("");
  const [suggest, setSuggest] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (n: string) => {
    setBusy(true);
    setErr("");
    setSuggest("");
    try {
      const r = await api<{ pid: string; token: string; nick: string }>(`/api/rooms/${code}/join`, { method: "POST", json: { nick: n } });
      onJoined({ pid: r.pid, token: r.token, nick: r.nick });
    } catch (e) {
      setErr((e as Error).message);
      if (e instanceof ApiError && typeof e.data.suggest === "string") setSuggest(e.data.suggest);
      setBusy(false);
    }
  };
  return (
    <form
      className="p-card join-card-p"
      onSubmit={(e) => {
        e.preventDefault();
        if (nick.trim()) void submit(nick);
      }}
    >
      <span className="kicker">방 {code}</span>
      <h1>
        뭐라고
        <br />
        불러 줄까요?
      </h1>
      <p>다들 알아볼 수 있는 이름이나 별명으로 적어 주세요.</p>
      <input
        className="nick-input"
        value={nick}
        onChange={(e) => setNick(e.target.value)}
        maxLength={12}
        placeholder="예: 김민지, 민지쌤"
        aria-label="닉네임"
        autoFocus
        disabled={disabled}
      />
      {err && <p className="err">{err}</p>}
      {suggest && (
        <button type="button" className="btn ghost" onClick={() => void submit(suggest)}>
          “{suggest}”(으)로 들어가기
        </button>
      )}
      <button className="btn primary big" disabled={busy || !nick.trim() || disabled}>
        {disabled ? "이미 끝난 게임이에요" : busy ? "들어가는 중…" : "들어가기"}
      </button>
    </form>
  );
}

function Editor({
  code,
  me,
  auth,
  questions,
  timer,
  onSaved,
  onCancel,
}: {
  code: string;
  me: Me;
  auth: Record<string, string>;
  questions: string[];
  timer: number | null;
  onSaved: (m: Me) => void;
  onCancel?: () => void;
}) {
  const pad = useRef<DrawPadHandle>(null);
  const draftKey = `kn-draft:${code}:${me.id}`;
  const [answers, setAnswers] = useState<string[]>(() => {
    const d = store.get<string[]>(`${draftKey}:a`);
    return me.answers.some(Boolean) ? me.answers : d ?? ["", "", ""];
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [base, setBase] = useState<string | null>(null);

  useEffect(() => {
    // editing an existing doodle: load it as the base layer
    if (!me.drew) return;
    let alive = true;
    fetch(`/api/rooms/${code}/img/${me.id}`, { headers: auth, cache: "no-store" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!b || !alive) return;
        const fr = new FileReader();
        fr.onload = () => alive && setBase(String(fr.result));
        fr.readAsDataURL(b);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, me.id, me.drew]);

  const filled = answers.filter((a) => a.trim()).length;
  const save = async () => {
    setErr("");
    const empty = pad.current?.isEmpty() ?? true;
    if (empty && !me.drew) return setErr("얼굴을 조금이라도 끄적여 주세요");
    if (filled < 3) return setErr("질문 세 개에 다 답해 주세요 (짧아도 돼요)");
    setBusy(true);
    try {
      const image = dirty || !me.drew ? await pad.current?.exportImage() : undefined;
      if (image === null) throw new Error("그림이 너무 복잡해요. 조금 지우고 다시 해 주세요");
      const r = await api<{ imgRev: number }>(`/api/rooms/${code}/profile`, { method: "POST", json: { answers, image }, headers: auth });
      store.del(`${draftKey}:a`);
      onSaved({ ...me, answers, drew: true, imgRev: r.imgRev });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="editor">
      <div className="editor-head">
        <h1>
          <span className="step-no">1</span> 내 얼굴 끄적이기
        </h1>
        {timer !== null && <span className={`p-chip ${timer <= 15 ? "hot" : ""}`}>{timer > 0 ? `${timer}초` : "시간 끝!"}</span>}
      </div>
      <DrawPad ref={pad} draftKey={draftKey} baseImage={base} onDirty={() => setDirty(true)} />
      <h1 className="editor-sub">
        <span className="step-no">2</span> TMI 세 줄
      </h1>
      <div className="tmi-form">
        {questions.map((q, i) => (
          <label key={i}>
            <span>{q}</span>
            <input
              value={answers[i] ?? ""}
              maxLength={40}
              placeholder="짧게 한 줄"
              onChange={(e) => {
                const next = answers.map((a, j) => (j === i ? e.target.value : a));
                setAnswers(next);
                store.set(`${draftKey}:a`, next);
              }}
            />
          </label>
        ))}
      </div>
      {err && <p className="err">{err}</p>}
      <div className="editor-actions">
        {onCancel && (
          <button className="btn ghost" onClick={onCancel}>
            취소
          </button>
        )}
        <button className="btn primary big" disabled={busy} onClick={save}>
          {busy ? "올리는 중…" : me.drew ? "고친 걸로 올리기" : `다 했어요 (${filled}/3)`}
        </button>
      </div>
      <p className="muted small">그림과 답은 이 방에서만 쓰이고, 방이 끝나면 지워져요.</p>
    </div>
  );
}

function MyDoodle({ code, auth, rev }: { code: string; auth: Record<string, string>; rev: number }) {
  const [src, setSrc] = useState<string>("");
  const pid = auth["x-player-id"];
  const token = auth["x-player-token"];
  useEffect(() => {
    let url = "";
    let alive = true;
    fetch(`/api/rooms/${code}/img/${pid}`, { headers: { "x-player-id": pid, "x-player-token": token }, cache: "no-store" })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && alive) {
          url = URL.createObjectURL(b);
          setSrc(url);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [code, pid, token, rev]);
  return <div className="my-doodle">{src ? <img src={src} alt="내 낙서" /> : <span />}</div>;
}

function VotePanel({ code, state, me, auth, left }: { code: string; state: PublicState; me: Me; auth: Record<string, string>; left: number }) {
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<{ round: number; pid: string } | null>(null);
  const [err, setErr] = useState("");
  const options = useMemo(() => state.roster.filter((p) => p.id !== me.id && matchName(p.nick, q)), [state.roster, me.id, q]);
  const myPick = pick?.round === state.round ? pick.pid : null;
  const closed = left <= 0;
  const choose = async (pid: string) => {
    if (closed) return;
    const prev = pick;
    setPick({ round: state.round, pid });
    setErr("");
    try {
      await api(`/api/rooms/${code}/vote`, { method: "POST", json: { target: pid }, headers: auth });
    } catch (e) {
      setPick(prev);
      setErr((e as Error).message);
    }
  };
  const picked = state.roster.find((p) => p.id === myPick);
  return (
    <div className="vote">
      <div className="vote-head">
        <span className="kicker">
          ROUND {state.round} / {state.totalRounds || state.round}
        </span>
        <span className={`p-chip ${left <= 5 ? "hot" : ""}`}>{closed ? "마감" : `${left}초`}</span>
      </div>
      <ol className="p-answers">
        {state.questions.map((qq, i) => (
          <li key={i}>
            <small>{qq}</small>
            <b>{state.current?.answers[i] || "(비밀)"}</b>
          </li>
        ))}
      </ol>
      <div className={`pick-line ${picked ? "has" : ""}`}>{picked ? <>내 선택: <b>{picked.nick}</b> · 바꿔도 돼요</> : "큰 화면 속 주인공은 누구?"}</div>
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 검색 (초성도 돼요: ㄱㅁㅈ)" aria-label="이름 검색" />
      {err && <p className="err">{err}</p>}
      <ul className="names">
        {options.map((p) => (
          <li key={p.id}>
            <button className={myPick === p.id ? "on" : ""} aria-pressed={myPick === p.id} disabled={closed} onClick={() => choose(p.id)}>
              {p.nick}
            </button>
          </li>
        ))}
        {options.length === 0 && <li className="muted">그런 이름이 없어요</li>}
      </ul>
    </div>
  );
}
