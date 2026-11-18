/**
 * 패키지 5개. courses는 강의 제목(공개 강의만). 가격은 seed-lib가 정가 합 × rate를 1,000원 아래 버림으로 정한다(60~75%).
 * 패키지는 강의별 부분 환불이 없고 패키지 전체로 계산한다.
 */
export interface SeedBundle {
  code: string;
  title: string;
  summary: string;
  rate: number; // 정가 합 대비 (0.6 ~ 0.75)
  courses: string[];
}

export const BUNDLES: SeedBundle[] = [
  {
    code: "SO-PKG-0001",
    title: "프론트엔드 입문 패키지",
    summary: "자바스크립트 기초부터 TypeScript, React 실전까지 한 번에 이어서 들어요.",
    rate: 0.7,
    courses: ["자바스크립트 기초 다지기", "TypeScript로 안전한 코드 쓰기", "React 실전: 컴포넌트 설계와 상태 관리"],
  },
  {
    code: "SO-PKG-0002",
    title: "정보처리기사 실기 합격 패키지",
    summary: "전 과목 정리, 코드 읽기, SQL 집중, 기출 10회 풀이를 묶었어요.",
    rate: 0.65,
    courses: [
      "정보처리기사 실기 한 권 정리: 전 과목 핵심",
      "정보처리기사 실기 프로그래밍: C·Java·Python 코드 읽기",
      "정보처리기사 실기 SQL·데이터베이스 집중",
      "정보처리기사 실기 기출 10회 풀이",
    ],
  },
  {
    code: "SO-PKG-0003",
    title: "데이터 분석가 첫걸음 패키지",
    summary: "SQL, 파이썬 분석, 통계 기초를 순서대로 익혀요.",
    rate: 0.72,
    courses: ["엑셀에서 SQL로: 데이터 분석 첫걸음", "파이썬 데이터 분석: pandas와 시각화", "통계 기초: 숫자로 의사결정하기"],
  },
  {
    code: "SO-PKG-0004",
    title: "UI·UX 디자이너 패키지",
    summary: "피그마 기초, UX 리서치, 디자인 시스템까지 화면 설계의 전 과정을 담았어요.",
    rate: 0.68,
    courses: ["피그마 UI 디자인 기초", "UX 리서치: 인터뷰와 사용성 테스트", "디자인 시스템 만들기: 토큰과 컴포넌트"],
  },
  {
    code: "SO-PKG-0005",
    title: "그로스 마케터 패키지",
    summary: "광고 지표, 퍼널 실험, 콘텐츠 운영, 엑셀 보고서까지 성장 업무의 기본기를 묶었어요.",
    rate: 0.66,
    courses: [
      "퍼포먼스 마케팅 입문: 광고 지표 읽는 법",
      "그로스 해킹: 퍼널 분석과 실험",
      "콘텐츠 마케팅과 SNS 운영 전략",
      "엑셀 실무: 함수와 피벗으로 보고서 만들기",
    ],
  },
];
