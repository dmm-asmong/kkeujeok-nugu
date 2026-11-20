// 초성 search: "ㄱㅁㅈ" finds "김민지".
const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
export function initials(s: string) {
  return Array.from(s)
    .map((ch) => {
      const c = ch.charCodeAt(0) - 0xac00;
      return c >= 0 && c <= 11171 ? CHO[Math.floor(c / 588)] : ch;
    })
    .join("");
}
export function matchName(name: string, q: string) {
  const query = q.replace(/\s+/g, "").toLowerCase();
  if (!query) return true;
  const n = name.replace(/\s+/g, "").toLowerCase();
  if (n.includes(query)) return true;
  return /^[ㄱ-ㅎ]+$/.test(query) && initials(n).includes(query);
}
