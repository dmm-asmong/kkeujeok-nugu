// Pure scoring helpers shared by server and host screen.
export interface RankItem {
  id: string;
  nick: string;
  score: number;
  rank: number;
}
export interface MysteryItem {
  id: string;
  nick: string;
  correct: number;
  total: number;
}
type P = { id: string; nick: string; kicked?: boolean };

export function leaderboard(scores: Record<string, number>, players: P[]): RankItem[] {
  const list = players
    .filter((p) => !p.kicked)
    .map((p) => ({ id: p.id, nick: p.nick, score: scores[p.id] ?? 0, rank: 0 }))
    .sort((a, b) => b.score - a.score || a.nick.localeCompare(b.nick, "ko"));
  list.forEach((it, i) => {
    it.rank = i > 0 && list[i - 1].score === it.score ? list[i - 1].rank : i + 1;
  });
  return list;
}

/** 미스터리상: the lowest share of correct guesses among people who were shown. */
export function mystery(guessed: Record<string, { correct: number; total: number }>, players: P[]): MysteryItem[] {
  const byId = new Map(players.filter((p) => !p.kicked).map((p) => [p.id, p]));
  const items = Object.entries(guessed)
    .filter(([pid, g]) => g.total > 0 && byId.has(pid))
    .map(([pid, g]) => ({ id: pid, nick: byId.get(pid)!.nick, correct: g.correct, total: g.total }));
  if (!items.length) return [];
  const ratio = (m: MysteryItem) => m.correct / m.total;
  const min = Math.min(...items.map(ratio));
  return items.filter((m) => Math.abs(ratio(m) - min) < 1e-9).slice(0, 3);
}
