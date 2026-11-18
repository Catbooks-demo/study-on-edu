/** 분야 7개 (spec 순서). 코드는 강의 코드 SO-<분야>-<4자리>에 쓴다. */
export const CATEGORIES = [
  { code: "DEV", name: "개발·프로그래밍" },
  { code: "DATA", name: "데이터·AI" },
  { code: "CERT", name: "자격증" },
  { code: "LANG", name: "어학" },
  { code: "DSGN", name: "디자인" },
  { code: "BIZ", name: "비즈니스·마케팅" },
  { code: "EXAM", name: "수능·내신" },
] as const;

export type CategoryCode = (typeof CATEGORIES)[number]["code"];
