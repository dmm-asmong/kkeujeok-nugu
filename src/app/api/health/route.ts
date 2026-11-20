import { storageInfo } from "@/lib/store";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

// Reports storage mode and env var NAMES only (never values).
export async function GET() {
  return json({ ok: true, ...storageInfo() });
}
