import { GameError, hostAction, hostPoll, type HostAction } from "@/lib/game";
import { body, checkCode, handle, limit } from "@/lib/http";

type Ctx = { params: Promise<{ code: string }> };
const tok = (req: Request) => req.headers.get("x-host-token") ?? "";

export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const code = checkCode((await params).code);
    const sp = new URL(req.url).searchParams;
    return { ...(await hostPoll(code, tok(req), Number(sp.get("v") ?? -1), Number(sp.get("pv") ?? -1))), now: Date.now() };
  });
}

const TYPES = new Set(["settings", "start-draw", "extend", "start-rounds", "reveal", "next", "skip", "final", "kick", "delete"]);

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const code = checkCode((await params).code);
    limit(`host:${code}`, 90, 60_000);
    const a = await body<HostAction>(req, 4000);
    if (!a || !TYPES.has(a.type)) throw new GameError(400, "알 수 없는 동작");
    return hostAction(code, tok(req), a);
  });
}
