import { GameError, getImage } from "@/lib/game";
import { checkCode, json, playerAuth } from "@/lib/http";

type Ctx = { params: Promise<{ code: string; pid: string }> };

export async function GET(req: Request, { params }: Ctx) {
  try {
    const p = await params;
    const code = checkCode(p.code);
    const a = playerAuth(req);
    const host = req.headers.get("x-host-token") ?? undefined;
    const { buf, mime } = await getImage(code, String(p.pid), { host, pid: a.pid, token: a.token });
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    if (e instanceof GameError) return json({ error: e.message }, e.status);
    return json({ error: "오류" }, 500);
  }
}
