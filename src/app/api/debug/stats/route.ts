import { stats, storageKind } from "@/lib/store";
import { json } from "@/lib/http";

// Command counter for the load simulation. Only exposed with the in-memory store.
export async function GET() {
  if (storageKind() !== "memory") return json({ error: "not available" }, 404);
  return json(stats);
}
export async function DELETE() {
  if (storageKind() !== "memory") return json({ error: "not available" }, 404);
  stats.commands = 0;
  stats.requests = 0;
  stats.byCmd = {};
  return json({ ok: true });
}
