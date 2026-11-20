import { me } from "@/lib/game";
import { checkCode, handle, playerAuth } from "@/lib/http";

type Ctx = { params: Promise<{ code: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handle(async () => {
    const code = checkCode((await params).code);
    const a = playerAuth(req);
    return me(code, a.pid, a.token);
  });
}
