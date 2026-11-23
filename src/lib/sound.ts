"use client";
// Small WebAudio kit: everything synthesized, nothing downloaded.
let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
  if (m) haltBgm(0.25);
  else if (bgmWanted) void bgm.start();
}
export function isMuted() {
  return muted;
}

function ac(): AudioContext | null {
  if (muted || typeof window === "undefined") return null;
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "triangle", gain = 0.18) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noiseHit(start: number, dur: number, gain: number) {
  const c = ac();
  if (!c) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 1800;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + start);
}

export const sfx = {
  unlock() {
    ac();
  },
  pop() {
    tone(660, 0, 0.09, "sine", 0.12);
    tone(990, 0.05, 0.08, "sine", 0.08);
  },
  tick(last = false) {
    tone(last ? 1320 : 880, 0, 0.05, "square", 0.05);
  },
  drumroll(seconds = 1.1) {
    const n = Math.floor(seconds / 0.045);
    for (let i = 0; i < n; i++) noiseHit(i * 0.045, 0.04, 0.05 + (i / n) * 0.18);
  },
  tada() {
    noiseHit(0, 0.25, 0.3);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, 0.02 + i * 0.07, 0.6, "triangle", 0.16));
  },
  start() {
    [392, 523.25, 659.25].forEach((f, i) => tone(f, i * 0.09, 0.22, "square", 0.06));
  },
  fanfare() {
    const seq = [523.25, 523.25, 659.25, 783.99, 659.25, 1046.5];
    seq.forEach((f, i) => tone(f, i * 0.13, i === seq.length - 1 ? 0.9 : 0.16, "triangle", 0.17));
  },
};

/* ---------- background music (CC0 "Happy Loop" by wipics, /audio/happy-loop.mp3) ---------- */
const BGM_URL = "/audio/happy-loop.mp3";
const BGM_VOLUME = 0.22; // the track is mastered loud; keep it under the voices and effects
let bgmWanted = false;
let bgmLoading = false;
let bgmBuf: AudioBuffer | null = null;
let bgmEnd = 0;
let bgmSrc: AudioBufferSourceNode | null = null;
let bgmGain: GainNode | null = null;

function haltBgm(fade = 0.4) {
  const c = ctx;
  const src = bgmSrc;
  const g = bgmGain;
  bgmSrc = null;
  bgmGain = null;
  if (!c || !src || !g) return;
  const t = c.currentTime;
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(g.gain.value, t);
  g.gain.linearRampToValueAtTime(0, t + fade);
  try {
    src.stop(t + fade + 0.05);
  } catch {
    /* already stopped */
  }
}

/** Length of the audible part: the mp3 ends with ~1s of silence that would make the loop stutter. */
function audibleEnd(buf: AudioBuffer) {
  const d = buf.getChannelData(0);
  let i = d.length - 1;
  while (i > 0 && Math.abs(d[i]) < 0.002) i--;
  return Math.min(buf.duration, (i + 1) / buf.sampleRate + 0.02);
}

export const bgm = {
  /** Safe to call many times (page open, every tap). Needs a user tap once on a fresh page load. */
  async start() {
    bgmWanted = true;
    if (bgmSrc) return;
    const c = ac();
    if (!c) return;
    if (!bgmBuf) {
      if (bgmLoading) return;
      bgmLoading = true;
      try {
        const res = await fetch(BGM_URL);
        if (!res.ok) throw new Error(String(res.status));
        bgmBuf = await c.decodeAudioData(await res.arrayBuffer());
        bgmEnd = audibleEnd(bgmBuf);
      } catch {
        bgmBuf = null; // music is optional: the game keeps working without it
      } finally {
        bgmLoading = false;
      }
    }
    if (!bgmBuf || !bgmWanted || muted || bgmSrc) return;
    const src = c.createBufferSource();
    const g = c.createGain();
    src.buffer = bgmBuf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = bgmEnd;
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(BGM_VOLUME, c.currentTime + 1.2);
    src.connect(g).connect(c.destination);
    src.start();
    bgmSrc = src;
    bgmGain = g;
  },
  stop() {
    bgmWanted = false;
    haltBgm();
  },
};
