# 스터디온에듀 (StudyOn Edu)

시연용 가상 온라인 강의 플랫폼이에요. 실제 회사·강사·서비스가 아니에요.

- 설계: [docs/superpowers/specs/2026-11-18-study-on-edu-design.md](docs/superpowers/specs/2026-11-18-study-on-edu-design.md)
- 기본 브랜치는 `dev`이고, 변경은 PR로만 올려요. CI(`web`·`e2e`·`docker`)가 초록이어야 머지해요.

## 실행 (개발)

```bash
cp .env.example .env          # DATABASE_URL·SESSION_SECRET 등을 채운다 (.env는 커밋하지 않는다)
npm ci
npx prisma migrate deploy
npm run db:seed
npm run dev                   # http://localhost:3000
```

- 수강생 화면 `/`, 강사 화면 `/instructor`, 직원 화면 `/admin`, 운영 화면 `/admin/ops`(대기열·서비스 모드·장애 공지), 상태 페이지 `/status`
- 토스 테스트 키가 없으면 모의 결제로 돌아요. `live_` 키는 받지 않아요.

## 배포

[docs/deploy.md](docs/deploy.md): Docker Compose(리눅스 서버)와 Windows PC 직접 설치(앱 `127.0.0.1:3201` + Node 프록시 `:3200` + PostgreSQL 16 `:5433`, `update.ps1`) 두 가지, nginx·프록시 헤더, 백업·업데이트·되돌리기, 지표·대기열·서비스 모드·웹훅 쓰는 법.

## 외부 시스템 API

- 설명: `/api/v1/openapi.json` (OpenAPI 3.1)
- 키: `npm run apikey -- --name <이름> --scopes read,write,metrics` (원문은 한 번만 보여요)
- 읽기: 강의·강사·주문·결제·환불·구독·수강권·문의·장애 공지·대기열·서비스 모드
- 쓰기(write): 서비스 모드, 장애 공지, 대기열 켜기·한도, 쿠폰(받은 회원만 쓰는 `private` 포함), 회원 쿠폰함 발급(`POST /api/v1/coupons/{code}/grants`), 회원 메시지함 안내(`POST /api/v1/inbox`)
- 회원 화면: 마이페이지 메시지함(`/my/inbox`, 안 읽은 수 표시)·쿠폰함(`/my/coupons`), 주문서의 '내 쿠폰'에서 바로 고르기
- 지표: `/metrics` (Prometheus, `metrics` 범위 키)
- 웹훅: `order.paid`, `order.refunded`, `subscription.status_changed`, `service_mode.changed`, `incident.created`, `incident.updated` (서명 `X-StudyOn-Signature`)

## 가상 이용자 데이터 (AXcellent 연결 시험용)

스터디온에듀에 실제 수강생이 없어서, 공개 통계로 만든 가상 회원 3만 명(그중 3,000명은 기간 안에 가입)이 각자 결제하고 강의를 본 결과로 **지난 60일(학습자가 결제하거나 강의를 본 날, 한국 시간 기준)** 데이터를 쌓고, 그 뒤로는 매일 같은 패턴으로 이어지게 한다. 설계는 "스터디온에듀 가상 이용자 설계" 문서(2026-11-18)를 따른다: 학습자 유형 13개(회원마다 ±30% 편차), 분야·연령·기기·시간대 비중, 결제 구성(단과 72·패키지 8·월 구독 16·연 구독 4%, 55%가 평균 25% 할인), 시험 달력(정보처리기사 3회 실기 10/24~11/13, 공인중개사 10/31, 토익 11/15·11/29, 수능 11/19 D-30), 추석 −15%, 이탈 곡선(1강 78% → 3강 44% → 마지막 강 분야 평균 약 17%), 구독(월 해지 10%, 연 갱신 40%, 결제 실패 4% 중 절반 회복, 일시정지), 환불(단과 4·패키지 6·월 1.5·연 5%, 어학·직무 쪽으로), 질문 5%(개발·데이터 8%)·후기 6%·문의 3%.

결제·수강권·진도·환불·구독·질문·후기·문의·라이브는 서버 함수(`addToCart`·`createOrder`·`mockPay`, `subscribe`·`payFirstInvoiceMock`·`cancelAtPeriodEnd`·`pause`·`changeCard`, `startPlayback`·`heartbeat`, `issueCertificate`, `requestRefund`·`approveRefund`, `askQuestion`·`answerQuestion`, `writeReview`, `createInquiry`·`answerInquiry`, `reserveSeat`·`enterLive`·`postChat`, `runJobsOnce`)를 그 시각으로 그대로 부른다. 그래서 금액·환불 계산·진도·수료·구독 상태가 실제 이용과 같은 규칙으로 맞는다.

```bash
npm run synth -- --dry-run        # 계획만 보기: DB·파일을 건드리지 않는다
npm run synth                     # 되채우기 (오늘 − 60일 ~ 지금)
npm run synth -- --replace        # 가상 데이터만 지우고(한 트랜잭션) 다시 넣기
npm run synth:daily               # 매일 모드: 10분마다 그때까지 된 몫 (--once: 한 차례만)
```

- 옵션: `--seed N`(기본 20261118, 같은 시드면 같은 회원·같은 계획), `--out DIR`(기본 `./synthetic-out`), `--force`, `--metrics`.
- `DATABASE_URL`이 가리키는 DB에 쓴다. 시드(`npm run db:seed`)가 먼저 있어야 한다. **되채우기 동안은 앱을 멈추거나 `JOBS_ENABLED=false`로** 둔다. 지난 시각으로 처리하는 동안 앱의 주기 작업이 지금 시각으로 끼어들면 구독 갱신·결제 기한이 어긋난다(최근 15분 안에 주기 작업 기록이 있으면 멈춘다, `--force`로 무시). 지난 시각으로 돌린 주기 작업 기록(`job_runs`)은 남기지 않는다. 매일 모드는 앱과 같은 PC에서 앱을 켠 채로 돌린다.
- 결제는 모의 결제(`method=mock`)로만 넣는다. 생성기 프로세스에서는 토스 키를 비운다(앱 설정은 그대로). 구독 결제 실패는 시연용 실패 카드(끝 4자리 `4000`)로 만든다.
- 되채우기는 서버 함수를 지난 시각(`now`)으로 부르고, 서버가 "지금"으로 찍는 칸(`created_at`·`updated_at`·환불 승인 시각 등)을 그 시각으로 옮겨 적는다. 매일 모드는 진짜 시계로 넣고 옮겨 적지 않는다.
- **시청 기록 줄 수**: 생성기 프로세스만 하트비트 주기를 1800초(`NEXT_PUBLIC_HEARTBEAT_SEC`)로 두고 서버 `startPlayback`·`heartbeat`를 그대로 부른다. 서버는 "지난 하트비트 뒤 흐른 시간 × 배속"만큼만 받으므로 진도 규칙은 그대로이고, `watch_events`는 30초마다가 아니라 **(세션, 강) 조각마다 한 줄**이다. 세션 하나(25~40분)는 강 2~4개라 보통 2~4줄. 기본 크기에서 세션 약 2.2만 개, `watch_events` 약 5.9만 줄(미리보기 어림).
- 매일 모드는 상태 파일(`--out/daily_state.json`)로 이어 가서 다시 켜도 두 번 넣지 않는다. 6시간 넘게 늦은 계획 결제는 넣지 않고 "놓침"으로 센다. 꺼져 있던 동안 놓친 시청 세션은 지금 시작한 것으로 넣는다. 하루가 끝나면 `--out/daily_answer_key.jsonl`에 그날 한 줄, `traffic.jsonl`에 그날 분 단위 계획을 더한다. 앞으로 오는 사건: 11/19 저녁 수능 해설 라이브 입장 폭주(평소 라이브의 5~10배), 수능 다음 날부터 수능·내신 ×0.4·자격증·어학·개발 ×1.25(2월 말까지), 11/23~11/30 할인 기간(×1.3, 할인가 결제 75%), 1월 새해 수요(×1.2, 어학·자격증 ×1.3).

**심어 둔 사건**

| 언제 | 무엇 | 데이터에 남는 것 |
| --- | --- | --- |
| 10/31(토) 18~21시 | 공인중개사 가답안 공개 뒤 자격증 해설 접속 약 4배 (수요) | 자격증 강의 다시보기 시청 행, `traffic.jsonl`의 자격증 페이지 뷰·대기열 |
| 11/2(월) 09:00~09:40 | 영상 진도 저장 오류 35% (장애) | 재생은 시작했는데 진도·시청 행이 없는 세션, 9~10시 반 재생 문의 약 30건(11시 일괄 답변), 11/3 10시 보상 쿠폰 안내(`SYNTH-SORRY1102`, 5,000원) |
| 11/19(목) 20시 | 수능 해설 라이브 (매일 모드) | 가상 라이브 하나와 예약·입장·채팅, 수능 페이지 뷰 5~10배 |

**서버 지표**: M7 지표 표가 아직 없어서 분 단위 접속·하트비트·오류율 계획값을 `--out/traffic.jsonl`과 정답지 `traffic`에만 쓴다(설계 규모, 하루 학습자 약 4,500명 기준). `--metrics`는 자리만 있고 지금은 안내만 찍는다. TODO(M7): 지표·장애 표가 합쳐지면 `--metrics`로 같은 값을 그 표에 넣는다.

**무엇이 가상인가 (표시)**

| 무엇 | 표시 |
| --- | --- |
| 가상 회원 | 이메일 `m00001@synth.studyon.test` ~ `m30000@…` (번호 = 가입 순서). 비밀번호는 아무도 모르는 값의 해시라 로그인할 수 없다 |
| 가상 직원 | `ops@synth.studyon.test`(이름 "가상 운영 담당", 역할 cs, 비활성). 환불 승인·거절, 문의 답변, 질문 답변 일부를 이 직원이 한다. 질문 답변 대부분은 그 강의의 강사(시드 강사)가 한다 |
| 가상 쿠폰 | `SYNTH-SALE20`·`SYNTH-SALE25`·`SYNTH-SALE30`(할인), `SYNTH-SORRY1102`(보상) |
| 가상 기기 | 기기 키 `synth-m00001-1` … (회원당 1~2대) |
| 지난 라이브 | 시드 라이브 12개의 기간 안 지난 회차(제목 뒤 "(M/D 회차)")와 수능 해설 라이브. 가상 직원의 작업 기록(`audit_logs.action = synth.live.create`)이 표시 |
| 회원에 딸린 것 | 위 회원의 주문·결제·환불·구독·청구·수강권·진도·시청 기록·수료증·질문(답변 포함)·후기·문의·보낸 편지함·라이브 자리·채팅 |

`--replace`는 위 표시가 붙은 행만 지운다(한 트랜잭션). 강의 평점은 남은 후기로 다시 계산하고, 주문·수료증 일련번호는 남은 행에 맞춘다. 시드 강의·라이브·쿠폰은 지우지 않는다.

**정답지는 로컬 전용**: `--out`의 `answer_key.json`(하루별 계획·시험 배수·분야별 주간 결제·이탈 곡선 결과·구독·환불·소통·라이브·심어 둔 사건·"시작 구간 효과")과 `member_personas.csv`(회원별 유형), `traffic.jsonl`은 저장소·DB에 넣지 않는다. 기본 `synthetic-out/`은 `.gitignore`·`.dockerignore`에 있고, 저장소 안 다른 폴더를 `--out`으로 주면 멈춘다.

**시작 구간 효과**: 기간 시작 전에 산 수강권·구독은 만들지 않는다. 그래서 처음 몇 주는 진도가 0에서 시작한 사람만 있어 하루 학습자(첫 주 약 110명 → 마지막 주 약 440명, 설계의 평상시는 4,500명)·완강·수료증·구독 갱신이 실제보다 적다. 정답지 `start_effect`에 적어 두었으니 분석 확인 때는 앞 4주를 빼고 본다.
