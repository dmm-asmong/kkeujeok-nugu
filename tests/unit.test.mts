// Pure-logic tests (no server needed): npm test
import assert from "node:assert/strict";
import { cleanText, parseImage, CODE_RE, newCode } from "../src/lib/util.ts";
import { leaderboard, mystery } from "../src/lib/rank.ts";
import { matchName, initials } from "../src/lib/hangul.ts";
import { detect } from "../src/lib/store.ts";

let n = 0;
const t = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log("  ✓", name);
};

t("cleanText strips tags/control chars and caps length", () => {
  assert.equal(cleanText("  <img src=x onerror=1>민지 \u0000\n ", 20), "img src=x onerror=1민");
  assert.equal(cleanText("가나다라마바사아자차카타파하", 12).length, 12);
  assert.equal(cleanText(123, 10), "");
  assert.equal(cleanText("a\u202eb", 10), "a b");
});
t("room codes avoid look-alike characters", () => {
  for (let i = 0; i < 500; i++) assert.ok(CODE_RE.test(newCode()));
  assert.ok(!CODE_RE.test("ABCD0"));
  assert.ok(!CODE_RE.test("ABCDI"));
});
t("parseImage accepts small png/webp only", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
  assert.ok(parseImage("data:image/png;base64," + png.toString("base64")));
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(40)]);
  assert.ok(parseImage("data:image/webp;base64," + webp.toString("base64")));
  assert.equal(parseImage("data:image/png;base64," + webp.toString("base64")), null);
  assert.equal(parseImage("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.equal(parseImage("data:image/png;base64," + Buffer.concat([png, Buffer.alloc(41 * 1024)]).toString("base64")), null);
});
t("leaderboard ranks ties together and skips kicked players", () => {
  const lb = leaderboard({ a: 3, b: 3, c: 1 }, [
    { id: "a", nick: "가" },
    { id: "b", nick: "나" },
    { id: "c", nick: "다" },
    { id: "d", nick: "라", kicked: true },
  ]);
  assert.deepEqual(lb.map((x) => [x.id, x.rank]), [["a", 1], ["b", 1], ["c", 3]]);
});
t("mystery = lowest share of correct guesses", () => {
  const m = mystery({ a: { correct: 1, total: 10 }, b: { correct: 5, total: 10 }, c: { correct: 0, total: 0 } }, [
    { id: "a", nick: "가" },
    { id: "b", nick: "나" },
    { id: "c", nick: "다" },
  ]);
  assert.deepEqual(m.map((x) => x.id), ["a"]);
});
t("초성 search", () => {
  assert.equal(initials("김민지"), "ㄱㅁㅈ");
  assert.ok(matchName("김민지", "ㄱㅁ"));
  assert.ok(matchName("김 민지", "민지"));
  assert.ok(!matchName("김민지", "ㅂ"));
});
t("storage env detection handles Marketplace prefixes and TCP urls", () => {
  assert.equal(detect({}).kind, "memory");
  assert.deepEqual(detect({ KV_REST_API_URL: "https://a.upstash.io/", KV_REST_API_TOKEN: "t" }), { kind: "rest", url: "https://a.upstash.io", token: "t", urlVar: "KV_REST_API_URL" });
  assert.equal((detect({ STORAGE_KV_REST_API_URL: "https://b", STORAGE_KV_REST_API_TOKEN: "t" }) as { urlVar: string }).urlVar, "STORAGE_KV_REST_API_URL");
  assert.equal((detect({ MY_UPSTASH_REDIS_REST_URL: "https://c", MY_UPSTASH_REDIS_REST_TOKEN: "t" }) as { urlVar: string }).urlVar, "MY_UPSTASH_REDIS_REST_URL");
  // url without a matching token is ignored
  assert.equal(detect({ KV_REST_API_URL: "https://a", KV_REST_API_READ_ONLY_TOKEN: "r" }).kind, "memory");
  assert.equal(detect({ REDIS_URL: "rediss://default:x@host:6379" }).kind, "tcp");
  assert.equal(detect({ STORAGE_REDIS_URL: "redis://h:6379" }).kind, "tcp");
  assert.equal(detect({ REDIS_URL: "https://not-tcp" }).kind, "memory");
  // REST wins over TCP
  assert.equal(detect({ REDIS_URL: "rediss://h", KV_REST_API_URL: "https://a", KV_REST_API_TOKEN: "t" }).kind, "rest");
});
console.log(`\n${n}개 테스트 통과`);
