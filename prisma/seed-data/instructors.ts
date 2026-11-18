/**
 * 가상 강사 20명. 활동명만 쓰고 실명·사진·경력은 쓰지 않는다(화면마다 "시연용 가상 강사" 배지).
 * 소개는 수업 방식만 말한다.
 */
export interface SeedInstructor {
  slug: string;
  display_name: string;
  bio: string;
}

export const INSTRUCTORS: SeedInstructor[] = [
  { slug: "hanbit-coder", display_name: "한빛코더", bio: "개념을 그림으로 먼저 보여 주고, 같은 코드를 직접 따라 치게 하는 수업을 해요. 처음 배우는 분이 막히는 곳에서 한 번 더 멈춰 가요." },
  { slug: "byte-fox", display_name: "바이트여우", bio: "화면을 만들며 배우는 프론트엔드 수업을 해요. 작은 예제를 하나씩 쌓아 끝에는 실제로 쓸 수 있는 화면이 남아요." },
  { slug: "cloud-carpenter", display_name: "구름목수", bio: "서버와 배포를 목수가 집 짓듯 차근차근 설명해요. 명령어 하나하나가 왜 필요한지부터 짚어요." },
  { slug: "data-cat", display_name: "데이터 고양이", bio: "숫자 뒤에 있는 이야기를 찾는 분석 수업을 해요. 표와 그래프를 같이 그려 보며 감을 익혀요." },
  { slug: "query-whale", display_name: "쿼리고래", bio: "SQL을 실무에서 자주 쓰는 모양대로 묶어 가르쳐요. 문제를 먼저 내고 쿼리를 함께 고쳐 가요." },
  { slug: "model-gardener", display_name: "모델정원사", bio: "머신러닝 모델을 정원 가꾸듯 데이터 손질부터 평가까지 순서대로 다뤄요. 수식은 꼭 필요한 만큼만 써요." },
  { slug: "pass-maker", display_name: "합격제조기", bio: "시험에 나오는 것만 골라 짧고 굵게 정리해요. 강마다 확인 문제로 마무리해요." },
  { slug: "gichul-owl", display_name: "기출부엉이", bio: "기출 문제를 밤새 뜯어본 부엉이처럼, 문제마다 출제 의도와 함정을 짚어 줘요." },
  { slug: "cert-compass", display_name: "자격나침반", bio: "처음 자격증을 준비하는 분께 공부 순서와 시간 배분부터 알려 드려요." },
  { slug: "talk-penguin", display_name: "말하는펭귄", bio: "입이 먼저 움직이는 회화 수업을 해요. 강마다 따라 말하기 구간이 있어요." },
  { slug: "word-squirrel", display_name: "단어다람쥐", bio: "단어와 문법을 도토리 모으듯 조금씩, 자주 꺼내 보게 해요. 시험 유형별 풀이 순서도 함께 다뤄요." },
  { slug: "jp-maple", display_name: "단풍말글", bio: "일본어를 여행과 일상 장면으로 배워요. 글자부터 천천히 시작해요." },
  { slug: "pixel-otter", display_name: "픽셀수달", bio: "보정·합성·모션을 실습 파일로 바로 따라 해요. 단축키는 외우기보다 손에 익게 반복해요." },
  { slug: "color-bear", display_name: "색감곰", bio: "색·글꼴·배치의 기본기를 예시를 고쳐 보며 익혀요. 왜 좋아 보이는지를 말로 설명할 수 있게 해요." },
  { slug: "grid-rabbit", display_name: "그리드토끼", bio: "피그마로 화면을 설계하고 사용자 관점으로 다시 보는 수업을 해요." },
  { slug: "growth-ant", display_name: "그로스개미", bio: "작은 실험을 꾸준히 쌓아 성장하는 마케팅을 다뤄요. 지표 읽기부터 시작해요." },
  { slug: "number-hedgehog", display_name: "숫자고슴도치", bio: "엑셀·재무·보고서처럼 숫자가 많은 업무를 덜 따갑게 풀어 드려요." },
  { slug: "math-lighthouse", display_name: "수학등대", bio: "개념이 어디서 왜 나왔는지 비춰 주고, 같은 개념을 여러 유형 문제로 확인해요." },
  { slug: "reading-moon", display_name: "국어달빛", bio: "지문을 읽는 순서와 기준을 세워 줘요. 문학은 작품을 보는 눈을, 독서는 구조를 잡는 법을 다뤄요." },
  { slug: "science-dino", display_name: "과탐공룡", bio: "외울 것과 이해할 것을 나눠 과학 개념을 정리해요. 그림 한 장으로 단원을 묶어 봐요." },
];

/** 추천 코드(REF-<slug>)를 가진 강사 두 명. */
export const REFERRAL_SLUGS = ["hanbit-coder", "pass-maker"] as const;
