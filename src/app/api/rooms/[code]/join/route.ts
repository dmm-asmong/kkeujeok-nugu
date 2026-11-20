import { join } from "@/lib/game";
import { body, checkCode, handle, ip, limit } from "@/lib/http";

type Ctx = { params: Promise<{ code: string }> };

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    const code = checkCode((await params).code);
    limit(`join:${ip(req)}`, 150, 60_000);
    const b = await body<{ nick?: unknown }>(req, 1000);
    return join(code, b.nick);
  });
}
