import { submitProfile } from "@/lib/game";
import { body, checkCode, handle, limit, playerAuth } from "@/lib/http";

type Ctx = { params: Promise<{ code: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const code = checkCode((await params).code);
    const a = playerAuth(req);
    limit(`profile:${code}:${a.pid}`, 12, 60_000);
    const b = await body<{ answers?: unknown; image?: unknown }>(req, 64000);
    return submitProfile(code, a.pid, a.token, b);
  });
}
