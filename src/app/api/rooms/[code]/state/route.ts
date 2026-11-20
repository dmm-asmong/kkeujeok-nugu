import { pollPublic } from "@/lib/game";
import { checkCode, handle, ip, limit } from "@/lib/http";

type Ctx = { params: Promise<{ code: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const code = checkCode((await params).code);
    limit(`poll:${ip(req)}`, 2000, 60_000);
    const v = Number(new URL(req.url).searchParams.get("v") ?? -1);
    return { ...(await pollPublic(code, v)), now: Date.now() };
  });
}
