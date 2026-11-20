import { createRoom } from "@/lib/game";
import { body, handle, ip, limit } from "@/lib/http";

export async function POST(req: Request) {
  return handle(async () => {
    limit(`create:${ip(req)}`, 12, 10 * 60_000);
    const b = await body<{ settings?: Record<string, unknown> }>(req, 4000);
    return createRoom(b.settings);
  });
}
