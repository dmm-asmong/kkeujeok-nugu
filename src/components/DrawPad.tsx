"use client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

const SIZE = 512;
const PAPER = "#fffdf8";
export const COLORS = [
  { c: "#1c1a17", n: "먹" },
  { c: "#e2462c", n: "토마토" },
  { c: "#f08a24", n: "귤" },
  { c: "#f1c232", n: "겨자" },
  { c: "#2e8b57", n: "풀" },
  { c: "#2557d6", n: "파랑" },
  { c: "#e86fa0", n: "분홍" },
  { c: "#8a5a3b", n: "갈색" },
  { c: "#f3c7a4", n: "살구" },
];
const SIZES = [
  { w: 5, n: "가늘게" },
  { w: 12, n: "보통" },
  { w: 26, n: "굵게" },
];
type Stroke = { c: string; w: number; pts: number[] };

export type DrawPadHandle = { exportImage: () => Promise<string | null>; isEmpty: () => boolean };

const MAX_B64 = Math.floor((40 * 1024 * 4) / 3) - 64;

export const DrawPad = forwardRef<DrawPadHandle, { draftKey?: string; baseImage?: string | null; onDirty?: () => void }>(
  function DrawPad({ draftKey, baseImage, onDirty }, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const strokes = useRef<Stroke[]>([]);
    const base = useRef<HTMLImageElement | null>(null);
    const drawing = useRef<Stroke | null>(null);
    const [color, setColor] = useState(COLORS[0].c);
    const [eraser, setEraser] = useState(false);
    const [size, setSize] = useState(SIZES[1].w);
    const [count, setCount] = useState(0);

    const paint = useCallback((ctx: CanvasRenderingContext2D, s: Stroke) => {
      ctx.strokeStyle = s.c;
      ctx.fillStyle = s.c;
      ctx.lineWidth = s.w;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const p = s.pts;
      if (p.length <= 2) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length - 2; i += 2) {
        const mx = (p[i] + p[i + 2]) / 2;
        const my = (p[i + 1] + p[i + 3]) / 2;
        ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
      }
      ctx.lineTo(p[p.length - 2], p[p.length - 1]);
      ctx.stroke();
    }, []);

    const redraw = useCallback(() => {
      const ctx = canvas.current?.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, SIZE, SIZE);
      if (base.current) ctx.drawImage(base.current, 0, 0, SIZE, SIZE);
      for (const s of strokes.current) paint(ctx, s);
    }, [paint]);

    const saveDraft = useCallback(() => {
      if (!draftKey || !canvas.current) return;
      try {
        localStorage.setItem(draftKey, canvas.current.toDataURL("image/png"));
      } catch {
        /* storage full: skip */
      }
    }, [draftKey]);

    useEffect(() => {
      redraw();
      let src = baseImage ?? null;
      if (!src && draftKey) {
        try {
          src = localStorage.getItem(draftKey);
        } catch {
          src = null;
        }
      }
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        base.current = img;
        redraw();
        setCount((c) => c + 1);
      };
      img.src = src;
    }, [baseImage, draftKey, redraw]);

    const pos = (e: React.PointerEvent | PointerEvent) => {
      const r = canvas.current!.getBoundingClientRect();
      return [((e.clientX - r.left) * SIZE) / r.width, ((e.clientY - r.top) * SIZE) / r.height];
    };

    const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      canvas.current!.setPointerCapture(e.pointerId);
      const [x, y] = pos(e);
      drawing.current = { c: eraser ? PAPER : color, w: eraser ? size * 1.8 : size, pts: [x, y] };
      const ctx = canvas.current!.getContext("2d")!;
      paint(ctx, drawing.current);
    };
    const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const s = drawing.current;
      if (!s) return;
      const ctx = canvas.current!.getContext("2d")!;
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      for (const ev of events) {
        const [x, y] = pos(ev);
        const lx = s.pts[s.pts.length - 2];
        const ly = s.pts[s.pts.length - 1];
        if (Math.hypot(x - lx, y - ly) < 1.5) continue;
        s.pts.push(x, y);
        ctx.strokeStyle = s.c;
        ctx.lineWidth = s.w;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    };
    const onUp = () => {
      const s = drawing.current;
      if (!s) return;
      drawing.current = null;
      strokes.current.push(s);
      redraw();
      setCount((c) => c + 1);
      saveDraft();
      onDirty?.();
    };

    const undo = () => {
      strokes.current.pop();
      redraw();
      setCount((c) => c + 1);
      saveDraft();
    };
    const clear = () => {
      if (!window.confirm("다 지우고 새로 그릴까요?")) return;
      strokes.current = [];
      base.current = null;
      if (draftKey) localStorage.removeItem(draftKey);
      redraw();
      setCount((c) => c + 1);
    };

    useImperativeHandle(ref, () => ({
      isEmpty: () => strokes.current.length === 0 && !base.current,
      exportImage: async () => {
        const src = canvas.current;
        if (!src) return null;
        for (const dim of [SIZE, 384, 256, 192]) {
          const c = document.createElement("canvas");
          c.width = dim;
          c.height = dim;
          const ctx = c.getContext("2d")!;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(src, 0, 0, dim, dim);
          for (const q of [0.82, 0.66, 0.5]) {
            const url = c.toDataURL("image/webp", q);
            if (url.startsWith("data:image/webp") && url.length - 23 <= MAX_B64) return url;
            if (!url.startsWith("data:image/webp")) break; // no webp encoder (e.g. Safari): fall through to PNG
          }
          const png = c.toDataURL("image/png");
          if (png.length - 22 <= MAX_B64) return png;
        }
        return null;
      },
    }));

    const empty = count >= 0 && strokes.current.length === 0 && !base.current;

    return (
      <div className="pad">
        <div className="pad-sheet">
          <canvas
            ref={canvas}
            width={SIZE}
            height={SIZE}
            className="pad-canvas"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            aria-label="낙서 그림판"
          />
          {empty && <p className="pad-hint">여기에 내 얼굴을 끄적여요<br />못 그릴수록 더 재밌어요</p>}
        </div>
        <div className="pad-tools" role="toolbar" aria-label="그리기 도구">
          <div className="swatches">
            {COLORS.map((k) => (
              <button
                key={k.c}
                type="button"
                className={`swatch ${!eraser && color === k.c ? "on" : ""}`}
                style={{ background: k.c }}
                aria-label={`${k.n} 색`}
                aria-pressed={!eraser && color === k.c}
                onClick={() => {
                  setColor(k.c);
                  setEraser(false);
                }}
              />
            ))}
          </div>
          <div className="pad-row">
            {SIZES.map((s) => (
              <button
                key={s.w}
                type="button"
                className={`size ${size === s.w ? "on" : ""}`}
                aria-label={`${s.n} 붓`}
                aria-pressed={size === s.w}
                onClick={() => setSize(s.w)}
              >
                <i style={{ width: Math.max(6, s.w * 0.9), height: Math.max(6, s.w * 0.9) }} />
              </button>
            ))}
            <button type="button" className={`tool ${eraser ? "on" : ""}`} aria-pressed={eraser} onClick={() => setEraser((v) => !v)}>
              지우개
            </button>
            <button type="button" className="tool" onClick={undo} disabled={strokes.current.length === 0}>
              되돌리기
            </button>
            <button type="button" className="tool" onClick={clear}>
              새로
            </button>
          </div>
        </div>
      </div>
    );
  },
);
