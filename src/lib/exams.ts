import { diffDays } from "@/rules/time";

/**
 * 메인 "시험 선반"의 실제 2026년 일정 (2026-11-18 확인).
 * 정보처리기사: 큐넷 2026년 정기 기사 3회 실기 10.24~11.13, 최종 합격 발표 12.18
 * 공인중개사: 제37회 2026.10.31(토)
 * 수능: 2027학년도 수능 2026.11.19(목), 성적 통지 12.11(금)
 * 토익: 제585회 12.13(일), 제586회 12.27(일)
 * 날짜가 다 지나면 "끝남"으로 보이고, 다음 해 일정이 나오면 여기에 더한다.
 */
export interface ExamMilestone {
  label: string;
  date: string; // YYYY-MM-DD (한국 날짜)
}

export interface Exam {
  key: string;
  name: string;
  milestones: ExamMilestone[];
  href: string; // 관련 강의
}

export const EXAMS: Exam[] = [
  {
    key: "jeongcheogi",
    name: "정보처리기사 실기",
    milestones: [
      { label: "3회 실기 시작", date: "2026-10-24" },
      { label: "3회 실기 끝", date: "2026-11-13" },
      { label: "3회 최종 합격 발표", date: "2026-12-18" },
    ],
    href: "/courses?q=정보처리기사",
  },
  {
    key: "realtor",
    name: "공인중개사",
    milestones: [{ label: "제37회 시험", date: "2026-10-31" }],
    href: "/courses?category=CERT",
  },
  {
    key: "suneung",
    name: "수능",
    milestones: [
      { label: "2027학년도 수능", date: "2026-11-19" },
      { label: "성적 통지", date: "2026-12-11" },
    ],
    href: "/courses?category=EXAM",
  },
  {
    key: "toeic",
    name: "토익",
    milestones: [
      { label: "제585회 정기시험", date: "2026-12-13" },
      { label: "제586회 정기시험", date: "2026-12-27" },
    ],
    href: "/courses?q=토익",
  },
];

export type ExamStatus =
  | { state: "upcoming"; milestone: ExamMilestone; days: number } // days = 0이면 오늘
  | { state: "ended"; milestone: ExamMilestone };

/** 오늘(한국 날짜) 기준 가장 가까운 앞으로의 일정. 모두 지났으면 마지막 일정과 "끝남". */
export function examStatus(exam: Exam, today: string): ExamStatus {
  const next = [...exam.milestones].sort((a, b) => a.date.localeCompare(b.date)).find((m) => m.date >= today);
  if (next) return { state: "upcoming", milestone: next, days: diffDays(today, next.date) };
  return { state: "ended", milestone: exam.milestones[exam.milestones.length - 1] };
}

/** D-day 표기: 0 → "D-day", 3 → "D-3" */
export const ddayLabel = (days: number) => (days === 0 ? "D-day" : `D-${days}`);
