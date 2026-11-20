export type QuestionSet = { id: string; label: string; hint: string; defaults: [string, string, string]; pool: string[] };

export const QUESTION_SETS: QuestionSet[] = [
  {
    id: "basic",
    label: "가벼운 기본",
    hint: "누구나 부담 없이",
    defaults: ["요즘 푹 빠져 있는 것", "나를 한 단어로 말하면", "절대 못 끊는 음식"],
    pool: [
      "주말에 제일 자주 하는 일",
      "최근에 산 것 중 최고",
      "어릴 때 장래희망",
      "나만 아는 소소한 특기",
      "내 폰 배경화면은",
      "아침형 vs 저녁형, 그리고 이유",
      "요즘 무한 반복 중인 노래",
      "가보고 싶은 여행지 한 곳",
    ],
  },
  {
    id: "campus",
    label: "대학생·수강생",
    hint: "강의·과정 첫 시간",
    defaults: ["이 수업에서 꼭 얻어 가고 싶은 것", "공부 잘되는 나만의 장소", "전공·일 말고 내가 잘하는 것"],
    pool: [
      "과제할 때 꼭 필요한 간식",
      "요즘 배우고 싶은 것 하나",
      "시험 기간 나의 생존 루틴",
      "인생 강의·인생 책 하나",
      "졸업(수료) 후 해 보고 싶은 일",
      "밤샘 vs 벼락치기 vs 미리미리",
      "자주 쓰는 앱 하나와 이유",
    ],
  },
  {
    id: "work",
    label: "직장인 연수",
    hint: "워크숍·사내 교육",
    defaults: ["회사 밖 나의 부캐", "점심 메뉴 고르는 나만의 기준", "일하면서 제일 뿌듯했던 순간 한 줄"],
    pool: [
      "출근길 루틴 하나",
      "업무 중 내 최애 단축키나 도구",
      "입사 전 상상한 회사 vs 지금",
      "퇴근 후 나를 살리는 것",
      "연차 하루가 생기면 할 일",
      "동료가 모르는 내 의외의 이력",
      "일 잘하는 사람의 조건, 한 단어로",
    ],
  },
];

export function findSet(id: string): QuestionSet {
  return QUESTION_SETS.find((s) => s.id === id) ?? QUESTION_SETS[0];
}
