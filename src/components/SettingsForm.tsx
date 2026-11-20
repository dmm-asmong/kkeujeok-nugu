"use client";
import { useState } from "react";
import { QUESTION_SETS, findSet } from "@/lib/questions";

export type SettingsValue = { setId: string; questions: string[]; rounds: number; drawSeconds: number; voteSeconds: number };

export const DEFAULT_SETTINGS: SettingsValue = {
  setId: "basic",
  questions: [...QUESTION_SETS[0].defaults],
  rounds: 8,
  drawSeconds: 90,
  voteSeconds: 20,
};

export function SettingsForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: SettingsValue;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (v: SettingsValue) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<SettingsValue>(initial);
  const set = findSet(v.setId);

  const swap = (i: number) => {
    const used = new Set(v.questions);
    const options = [...set.defaults, ...set.pool].filter((q) => !used.has(q));
    if (!options.length) return;
    const q = options[Math.floor(Math.random() * options.length)];
    setV({ ...v, questions: v.questions.map((x, j) => (j === i ? q : x)) });
  };

  return (
    <form
      className="settings"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <fieldset>
        <legend>TMI 질문 세트</legend>
        <div className="seg">
          {QUESTION_SETS.map((s) => (
            <button
              type="button"
              key={s.id}
              className={v.setId === s.id ? "on" : ""}
              aria-pressed={v.setId === s.id}
              onClick={() => setV({ ...v, setId: s.id, questions: [...s.defaults] })}
            >
              <b>{s.label}</b>
              <small>{s.hint}</small>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>질문 3개 (직접 고쳐도 돼요)</legend>
        {v.questions.map((q, i) => (
          <div className="qrow" key={i}>
            <span className="qnum">{i + 1}</span>
            <input
              value={q}
              maxLength={40}
              required
              aria-label={`질문 ${i + 1}`}
              onChange={(e) => setV({ ...v, questions: v.questions.map((x, j) => (j === i ? e.target.value : x)) })}
            />
            <button type="button" className="mini" onClick={() => swap(i)}>
              다른 질문
            </button>
          </div>
        ))}
      </fieldset>
      <div className="settings-grid">
        <label>
          <span>라운드 수</span>
          <select value={v.rounds} onChange={(e) => setV({ ...v, rounds: Number(e.target.value) })}>
            {[5, 8, 10, 12, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n}명 맞히기
              </option>
            ))}
            <option value={0}>전원 다 맞히기</option>
          </select>
        </label>
        <label>
          <span>그리기 시간</span>
          <select value={v.drawSeconds} onChange={(e) => setV({ ...v, drawSeconds: Number(e.target.value) })}>
            {[60, 90, 120, 180].map((n) => (
              <option key={n} value={n}>
                {n}초
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>투표 시간</span>
          <select value={v.voteSeconds} onChange={(e) => setV({ ...v, voteSeconds: Number(e.target.value) })}>
            {[15, 20, 30].map((n) => (
              <option key={n} value={n}>
                {n}초
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="settings-actions">
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            닫기
          </button>
        )}
        <button className="btn primary" disabled={busy}>
          {busy ? "잠깐만요…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
