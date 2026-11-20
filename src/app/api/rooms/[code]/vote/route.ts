import { vote } from "@/lib/game";
import { body, checkCode, handle, limit, playerAuth } from "@/lib/http";

type Ctx = { params: Promise<{ code: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const code = checkCode((await params).code);
    const a = playerAuth(req);
    limit(`vote:${code}:${a.pid}`, 30, 60_000);
    const b = await body<{ target?: unknown }>(req, 500);
    return vote(code, a.pid, a.token, b.target);
  });
}
