import { NextResponse } from "next/server";
import { GameError } from "./game";
import { CODE_RE, rateLimit } from "./util";

export function ip(req: Request) {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function checkCode(raw: string): string {
  const code = String(raw ?? "").toUpperCase();
  if (!CODE_RE.test(code)) throw new GameError(404, "방 코드를 다시 확인해 주세요");
  return code;
}

export function limit(key: string, n: number, ms: number) {
  if (!rateLimit(key, n, ms)) throw new GameError(429, "요청이 너무 많아요. 잠깐 뒤에 다시 해 주세요");
}

export async function body<T>(req: Request, maxBytes = 70000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new GameError(413, "보낸 내용이 너무 커요");
  try {
    return JSON.parse(text || "{}") as T;
  } catch {
    throw new GameError(400, "잘못된 요청이에요");
  }
}

export async function handle(fn: () => Promise<unknown>) {
  try {
    return json(await fn());
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message, ...e.extra }, e.status);
    console.error(e);
    return json({ error: "서버가 잠깐 삐끗했어요. 다시 해 주세요" }, 500);
  }
}

export const playerAuth = (req: Request) => ({
  pid: req.headers.get("x-player-id") ?? "",
  token: req.headers.get("x-player-token") ?? "",
});
