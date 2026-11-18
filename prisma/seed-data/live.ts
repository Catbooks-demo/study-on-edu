/**
 * 라이브 12개: 강의에 붙은 것 8(course = 강의 제목), 단독 4. 시작은 오늘(KST)부터 day일 뒤 hour시, 길이 minutes분.
 * day는 1~27이라 언제 돌려도 "지금 < 시작 ≤ 지금 + 28일"이다.
 */
export interface SeedLive {
  title: string;
  description: string;
  by: string;
  course?: string;
  day: number;
  hour: number;
  minutes: number;
}

export const LIVE: SeedLive[] = [
  { title: "정처기 실기 D-30 라이브 특강: 빈출 코드 20문제", description: "시험 한 달 전, 자주 나오는 코드 문제를 함께 풀어요.", by: "pass-maker", course: "정보처리기사 실기 D-30 마무리 특강", day: 1, hour: 20, minutes: 90 },
  { title: "파이썬 자동화 질문 받는 시간", description: "수강하며 막힌 자동화 스크립트를 함께 고쳐요.", by: "hanbit-coder", course: "처음 만나는 파이썬: 변수부터 작은 자동화까지", day: 3, hour: 20, minutes: 60 },
  { title: "React 상태 설계 코드 리뷰", description: "수강생이 보낸 장바구니 코드를 같이 읽고 고쳐요.", by: "byte-fox", course: "React 실전: 컴포넌트 설계와 상태 관리", day: 5, hour: 21, minutes: 60 },
  { title: "SQL 리포트 쿼리 라이브 코딩", description: "재구매율·코호트 쿼리를 처음부터 함께 짜요.", by: "query-whale", course: "SQL 실무 쿼리 패턴", day: 7, hour: 20, minutes: 90 },
  { title: "토익 파트 7 시간 줄이기 실전", description: "다중 지문을 시간 안에 푸는 순서를 실시간으로 보여 드려요.", by: "word-squirrel", course: "토익 700에서 850으로: 파트별 전략", day: 9, hour: 19, minutes: 60 },
  { title: "피그마 오토 레이아웃 실습 라이브", description: "같은 화면을 오토 레이아웃으로 다시 짜 봐요.", by: "grid-rabbit", course: "피그마 UI 디자인 기초", day: 12, hour: 20, minutes: 60 },
  { title: "수능 수학 미분 고난도 풀이", description: "미분 단원 고난도 문제를 풀이 틀로 정리해요.", by: "math-lighthouse", course: "수능 수학 수학Ⅰ·수학Ⅱ 개념 완성", day: 16, hour: 21, minutes: 90 },
  { title: "정처기 실기 SQL 마지막 점검", description: "시험 직전 SQL 문제만 모아 풀어요.", by: "gichul-owl", course: "정보처리기사 실기 SQL·데이터베이스 집중", day: 22, hour: 20, minutes: 60 },
  { title: "개발자 커리어 이야기: 첫 코드 리뷰 받는 법", description: "처음 팀에 들어갔을 때 코드 리뷰를 주고받는 요령을 이야기해요.", by: "cloud-carpenter", day: 2, hour: 20, minutes: 60 },
  { title: "생성형 AI 업무 활용 공개 강의", description: "회의록 요약과 보고서 초안을 실시간으로 만들어 봐요. 회원이면 누구나 들어올 수 있어요.", by: "model-gardener", day: 10, hour: 19, minutes: 60 },
  { title: "디자인 포트폴리오 공개 피드백", description: "신청한 포트폴리오 몇 개를 골라 공개로 피드백해요.", by: "color-bear", day: 18, hour: 20, minutes: 90 },
  { title: "수능 국어 독서 지문 함께 읽기", description: "과학 지문 한 편을 구조로 읽는 과정을 그대로 보여 드려요.", by: "reading-moon", day: 26, hour: 21, minutes: 60 },
];
