# 스터디온에듀 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실제로 운영되는 것처럼 동작하는 온라인 강의 플랫폼(수강생·강사·직원 화면, 외부 API, 장애에 버티는 운영 기능)을 만든다.

**Architecture:** 누비투어와 같은 구조다. Next.js App Router 앱 하나가 수강생 화면(`app/(site)`), 강사 화면(`app/instructor`), 직원 화면(`app/admin`), 화면용 API(`app/api/*`), 외부 API(`app/api/v1/*`)를 함께 낸다. 돈·진도·환불·정산·대기열 규칙은 DB를 모르는 순수 함수(`src/rules/*`)에 두고, DB 작업은 서비스 모듈(`src/server/*`)에 둔다. 주기 작업은 앱 안 스케줄러가 PostgreSQL advisory lock을 잡고 돌린다. 실시간 갱신은 SSE와 짧은 주기 조회로 한다.

**Tech Stack:** Node 22, Next.js 16(App Router, TypeScript strict), React 19, Tailwind CSS 4, Prisma 6 + PostgreSQL 16, zod 4, Vitest 3, Playwright, 토스페이먼츠 결제위젯 v2(테스트 키) + 모의 결제, Docker Compose, autocannon(부하 시험만). 버전은 `nubi-tour/package.json`과 같게 맞춘다.

**Spec:** `docs/superpowers/specs/2026-11-18-study-on-edu-design.md`. 먼저 읽는다. 특히 "규칙"과 "안 터지는 운영"을 읽는다. 이 계획과 spec이 어긋나면 spec을 따르고, 그 내용을 PR에 적는다.

**누비투어 재사용:** "copy and adapt from nubi-tour/<경로>"는 `C:\Users\403\Documents\nubi-tour`(GitHub `Catbooks-demo/nubi-tour`, `dev`)의 그 파일을 복사한 뒤 다음처럼 바꾼다는 뜻이다. 이름 `누비투어`·`nubi`·`nb_`는 `스터디온에듀`·`studyon`·`so_`로 바꾸고, 예약(Booking)은 주문(Order)으로 바꾼다. 나머지 동작은 그대로 둔다. 그 파일의 시험(`nubi-tour/tests/*`)도 같이 옮길 수 있는 것은 옮긴다.

## Global Constraints
- AXcellent용 주소·이벤트·규격·이름을 코드에 넣지 않는다. 이 사이트는 AXcellent를 모른다. 웹훅·API는 플랫폼 자기 규격이다.
- 실제 플랫폼(인프런·클래스101·패스트캠퍼스·탈잉·메가스터디·EBSi·에듀윌·유데미·콜로소)의 이름·로고·문구·화면을 쓰지 않는다. 강사는 모두 가상 활동명으로 하고 실명·사진·경력을 쓰지 않는다. 강사 노출 화면마다 "시연용 가상 강사" 배지를 단다.
- 법적 번호는 지어내지 않는다. 푸터 문구는 `스터디온에듀는 시연용 가상 서비스예요. 실제 강의를 판매하지 않아요.`로 하고, 그 아래에 빈칸 형식만 둔다: `사업자등록번호 ___-__-_____ · 원격평생교육시설 신고번호 제 ____ 호`.
- 공개 레포다. 키·비밀번호·실제 내부 주소를 커밋하지 않는다. `.env.example`만 커밋하고 `.env`는 읽지도 커밋하지도 않는다. 로그와 화면에도 키·비밀번호를 남기지 않는다.
- 토스 키가 `live_`로 시작하면 시작을 거부한다(`assertSafeTossKeys`). 키가 없으면 모의 결제(`method=mock`)를 쓴다. 구독 갱신은 항상 모의 정기 결제다.
- 시각은 UTC로 저장하고, 날짜 계산·월 구분·화면 표시는 `Asia/Seoul`로 한다(`src/rules/time.ts`만 쓴다. 날짜 라이브러리는 넣지 않는다).
- DB 표·컬럼 이름은 영어 snake_case(`@@map`/`@map`)로 한다. 상태 값은 spec의 영어 코드 그대로 쓴다.
  - 강의 `draft`·`in_review`·`published`·`rejected`·`hidden` / 주문 `pending`·`paid`·`cancelled`·`partially_refunded`·`refunded`
  - 구독 `active`·`past_due`·`paused`·`cancelled`·`expired` / 수강권 `active`·`expired`·`refunded`, 출처 `order`·`bundle`·`subscription`·`free`
  - 환불 `requested`·`approved`·`rejected`·`done` / 라이브 `scheduled`·`live`·`ended`·`cancelled` / 직원 `admin`·`cs`·`content`
  - 서비스 모드 `normal`·`degraded`·`read_only`·`maintenance` / 결제 수단 `toss`·`mock`
- 금액은 정수 원(`Int`)이다. 비율 계산 뒤 공제액은 `Math.floor`로 내린다(수강생에게 유리하게). 비율은 분자·분모 정수로 들고 `Math.floor(paid * num / den)`으로 계산한다(`0.29*100`처럼 부동소수 오차로 1원이 어긋나지 않게). 비교(max)도 교차 곱으로 한다.
- 사용자에게 보이는 문구는 모두 한국어 해요체로 쓴다. 오류 본문은 `{error:{code,message}}` 형식이다(`nubi-tour/src/server/http.ts`).
- **로컬에서 시험을 돌리지 않는다.** 각 작업의 확인은 "push → GitHub CI 초록"이다. 시험은 코드보다 먼저 쓴다. 시험을 지우거나 약하게 만들지 않는다. `dev`·`main`에 직접 push하지 않는다.
- 필수 체크 잡 이름은 `web`·`e2e`이고 바꾸지 않는다(M7에서 `docker`를 더한다).
- 커밋 메시지 끝에 다음 두 줄을 붙인다.
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01Bh3DcxyW4Nwr6Mb84d3wC5`
  PR 본문(한국어) 끝에는 `🤖 Generated with [Claude Code](https://claude.com/claude-code)`와 세션 주소를 붙인다.

## Review Focus
spec이 직접 말하지 않지만 실제 수강생을 가장 먼저 다치게 할 입력 다섯 가지다. 각 줄의 시험은 그 코드를 맡은 작업에 들어 있다.
1. **탐색바를 끝으로 끌거나, 2배속으로 위조한 하트비트가 한 번에 긴 구간을 보낼 때**: 서버는 실제로 흐른 시간 × 배속만큼만 본 것으로 쳐야 한다. 끌어 넘긴 강이 완료되거나 수료증이 나가면 안 된다. (Task 10 `acceptSegment`, Task 11 `heartbeat rejects skip-ahead`)
2. **같은 하트비트가 네트워크 재시도로 두 번 오거나 순서가 뒤바뀌어 올 때**: 본 초가 한 번만 늘어야 한다. 재시도가 환불 공제나 구독 몫 계산을 부풀리면 안 된다(`added_sec`는 새로 더해진 초만). (Task 11 `duplicate heartbeat counts once`)
3. **환불 신청을 두 번 누르거나, 직원 두 명이 같은 환불을 동시에 승인할 때**: 환불 요청도 환불 결제 행도 하나만 생겨야 한다. (Task 9 `concurrent approve refunds once`)
4. **한국 시간 자정·월말 경계**: 7일 전액 환불 마감은 KST 날짜로 센다. 정산 월도 KST로 정한다(`2026-11-30T15:30Z`는 12월 매출). (Task 6 KST 경계 시험, Task 17 `month boundary is KST`)
5. **구독 갱신 작업이 두 번 돌거나 해지 예약·일시정지와 겹칠 때**: 기간마다 청구는 하나여야 한다. 해지 예약이면 청구 없이 기간 끝에 `cancelled`가 된다. (Task 15 `renewal twice → one invoice`)

## 이 계획이 정한 것 (spec이 열어 둔 부분)
실행자는 아래를 그대로 따른다. 바꾸려면 PR에 이유를 적는다.
- **이름·쿠키**: 회원 `so_session`(30일), 직원 `so_staff`(12시간), 강사 `so_instructor`(12시간), 기기 `so_device`(1년, 브라우저가 만든 무작위 id), 대기열 입장 `so_q_<대상>`(10분, HMAC 서명). API 키 접두사는 `sok_`다.
- **번호**: 주문 `SO` + KST `yyMMdd` + 4자리(`SO2611180001`), 강의 `SO-<분야>-<4자리>`, 수료증 `SOC-<yyyy>-<6자리>`. 일련번호는 표 하나 `counters(key, last)`에서 원자적으로 늘린다. 분야 코드는 개발·프로그래밍 `DEV`, 데이터·AI `DATA`, 자격증 `CERT`, 어학 `LANG`, 디자인 `DSGN`, 비즈니스·마케팅 `BIZ`, 수능·내신 `EXAM`이다.
- **"7일 이내"**: 경과일은 `diffDays(kstDate(결제 시각), kstDate(지금))`로 센다(결제한 날 = 0). 전액 환불 조건은 `경과일 ≤ 7`이다. 예를 들어 11월 1일 결제는 11월 8일 23:59:59 KST까지 해당한다. 구독도 같다.
- **환불 진도율**: `Σ min(길이, 자료 받음 ? 길이 : 본 초) ÷ Σ 길이`다. 패키지는 묶음에 든 모든 강의의 강을 합쳐 계산한다. 기간 비율은 패키지 자체의 `access_days`를 쓴다(Bundle에 `access_days` 컬럼을 더하고 기본값은 365).
- **쿠폰 배분**: 쿠폰 할인은 대상 항목의 판매가 비율로 나누고, 나머지 원은 가장 비싼 항목에 몰아준다(`allocate`). 항목별 실제 낸 금액은 `order_items.paid_amount`에 저장한다. 환불은 이 값으로 계산한다. 쿠폰은 단건·패키지 주문에만 쓰고 구독에는 쓰지 않는다. 1인 1회 쿠폰의 사용 기록은 주문이 결제 전에 취소·만료되면 지우고, 환불했을 때는 남긴다.
- **구독 가격·기준 시간**: 월 플랜 29,000원, 연 플랜 290,000원이다. 구독 환불의 "기준 시간"은 플랜 컬럼 `refund_base_hours`로 두고 월 20시간, 연 240시간으로 한다. 구독 대상은 강의 컬럼 `in_subscription`(시드에서 약 70%를 대상으로 둔다)으로 정한다.
- **구독 결제 실패**: 기간 끝 24시간 전에 첫 시도를 하고, 실패하면 `past_due`로 바꾼 뒤 첫 실패 시각 기준 +1일, +3일, +5일에 재시도한다. **재시도 세 번이 모두 실패하면(실패 4회째) `expired`**로 한다. `past_due` 동안은 수강을 허용한다. 재시도가 성공하면 새 기간은 원래 기간 끝에서 시작한다. 모의 카드 끝 4자리가 `4000`이면 항상 실패하는 시연용 카드다.
- **구독 일시정지**: `active`일 때만 할 수 있고 바로 시작한다. 기간은 1~30일이고 최근 365일 안에 2번까지 허용한다. 시작할 때 `current_period_end`를 정지 일수만큼 미루고, 일찍 풀면 남은 온전한 날 수만큼 당긴다. 정지 중에는 구독으로 얻은 수강권을 재생할 수 없다.
- **구독 수강권**: 구독 대상 강의는 처음 "수강 시작"할 때 수강권을 만든다(`source=subscription`, `expires_at=null`). 구독이 `cancelled`·`expired`가 되면 그 수강권을 `expired`로 바꾸고 진도는 남긴다. 수강권은 (수강생, 강의)당 하나다. 구매가 구독보다 앞서고, 구매분을 환불했는데 구독이 살아 있으면 다시 `subscription`으로 바꾼다.
- **구독 환불 처리**: 승인되면 그 기간 청구를 환불하고 구독은 즉시 `cancelled`로 바꾼다.
- **동시 재생**: 재생 소유권 표 `playback_leases(user_id PK, device_id, lecture_id, beat_at)`를 둔다. 다른 기기가 시작하거나 하트비트를 보내면 소유권이 넘어가고, 앞 기기의 다음 하트비트는 409 `PLAYING_ELSEWHERE`를 받아 멈춘다. "동시 재생 수" 지표는 `beat_at`이 최근 60초 안인 행 수다.
- **하트비트**: 본문은 `{lecture_id, from_sec, to_sec, position_sec, rate, device_id}`이다. 구간은 영상 시간 기준이고, 브라우저가 지난 하트비트 뒤로 실제 재생된 구간을 보낸다. 주기는 `NEXT_PUBLIC_HEARTBEAT_SEC`(기본 30, e2e 2)이고 일시정지·끝·창 닫기 때도 보낸다(`sendBeacon`). 배속은 `0.5, 0.75, 1, 1.25, 1.5, 1.75, 2`만 받는다.
- **요청 제한 값**(429 + `Retry-After` 헤더 + 본문 `retry_at`):
  - 로그인: IP+이메일 10회/10분, IP 30회/10분
  - 가입: IP 5회/10분
  - 결제(주문 만들기·결제 준비·승인): 계정 20회/분, IP 60회/분
  - 질문·답변·후기·문의 쓰기: 계정 10회/10분
  - 라이브 채팅: 계정 30회/분
  - 외부 API: 키당 600회/분
- **서비스 모드 자동 제안**: 최근 1분 오류율 ≥ 5% 또는 p95 ≥ 1500ms이면 `degraded`를 제안하고, 오류율 ≥ 20% 또는 p95 ≥ 5000ms이면 `read_only`를 제안한다. 제안만 하고 바꾸는 것은 직원이다. `maintenance`는 제안하지 않는다.
- **대기열 기본 한도**: 사이트 50명/초, 결제 캠페인 10명/초, 라이브 20명/초. 입장 허용은 10분이고, 60초 동안 새로고침이 없는 대기 순번표는 만료한다. 라이브 대기열은 시작 10분 전부터 끝날 때까지 자동으로 켠다. 결제 캠페인 대상은 `queue_settings.course_codes`로 정한다(비어 있으면 모든 결제가 대상).
- **결제 마감 연장**: 결제 캠페인 대기열에서 할인 마감 전에 순번표를 받은 수강생은, 마감 뒤 30분까지 그 순번표 발급 시각의 가격으로 주문할 수 있다.
- **정산**: 패키지 판매분은 묶음 안 강의의 정가 비율로 강사에게 나눈다. 추천 코드(강사 쿠폰)로 그 강사 본인 강의를 산 경우만 90%다. 남의 강의는 70%다. 구독 풀은 그달 KST에 승인된 구독 결제 합에서 그달 완료된 구독 환불을 뺀 값이다. 시청 비중은 그달 구독 수강권 `watch_events.added_sec` 합으로 잰다. 환불 차감은 원래 적용한 비율(70%/90%) × 환불액이다. 합계가 음수면 지급액은 0으로 하고, 음수분은 다음 달 `carried_in`으로 넘긴다. 지급 예정일은 다음 달 10일이다.
- **직원 권한**:
  - `admin`: 모두
  - `cs`: 주문·환불·구독·수강생·문의·질문·후기·보낸 편지함
  - `content`: 강의 심사·강의·패키지·플랜·쿠폰·라이브·공지·FAQ·강사 보기
  - 정산 확정·운영(대기열·서비스 모드·장애 공지·장애 주입·지표)·직원·API 키는 `admin`만 할 수 있다.
- **장애 주입 위치**: DB 지연은 `route()` 감싸기와 `/readyz`에서 sleep으로 넣는다(Prisma 클라이언트는 건드리지 않는다). 확률 주입은 `roll(rate, rand)`로 해서 시험에서 난수를 주입할 수 있게 한다.
- **장바구니**: DB 표 `cart_items`를 둔다. 구매는 로그인한 회원만 할 수 있다. 결제 전 주문은 30분 뒤 작업이 `cancelled`로 바꾼다.
- **브랜드**: 이름은 스터디온에듀(StudyOn Edu)다. 주색은 짙은 보라 `#5B3DF5`, 강조색은 레몬 `#F5C518`, 배경은 `#FAFAF7`이다. 누비투어(하늘·바다)·캣북스와 겹치지 않게 했다. 썸네일은 분야별 SVG 그라데이션과 도형이고 외부 사진은 쓰지 않는다.
- **라이브 접근**: 강의에 붙은 라이브는 그 강의 수강권이 있어야 하고, 단독 라이브는 회원이면 누구나 들어올 수 있다.
- **후기 조건**: 진도율(완료한 강 길이 기준) ≥ 40%이고 강의당 하나다.
- **이탈 구간**: 강 i의 이탈률 = (강 i를 시작했고, 그 뒤 강은 하나도 시작하지 않았고, 완강하지 않은 수강생 수) ÷ (강 i를 시작한 수강생 수).

## 작업 방식 (모든 작업 공통)
- 마일스톤 하나 = 브랜치 하나 = `dev` 대상 PR 하나다. 첫 작업을 시작할 때 브랜치를 만들고, 첫 push 뒤 초안 PR(`gh pr create --draft --base dev`)을 연다. 마일스톤의 마지막 작업이 초록이면 초안을 풀고 머지를 기다린다. 다음 마일스톤은 머지된 `dev`에서 시작한다.
- 작업 하나는 커밋 두 개다. ① 시험만 담은 커밋(`test: …`)을 push하면 CI `web`이 빨강이어야 한다. 이유가 "없는 모듈·함수"나 기대값 불일치인지 확인한다. ② 구현 커밋(`feat: …`)을 push하면 `web`·`e2e`가 초록이어야 한다. 빨강이면 고친 커밋을 더 push한다. 로컬에서 시험을 돌리지 않는다.
- DB 시험은 `tests/helpers/{db,http,fixtures}.ts`(copy and adapt from `nubi-tour/tests/helpers/*`)를 쓴다. `beforeEach(resetDb)`로 시작하고, 시각은 인자 `now`로 주입한다.

---

## 마일스톤 1 — 뼈대·DB·인증 (브랜치 `feat/m1-foundation`)

### Task 1: 뼈대 — 설정·공통 서버 모듈·상태 확인·CI

**Files:**
- Create (copy and adapt from nubi-tour/<같은 경로>):
  - 설정: `package.json`(이름 `study-on-edu`, 버전과 `allowScripts` 그대로), `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`(무시 목록에 `scripts/load/**` 추가), `vitest.config.ts`, `playwright.config.ts`, `.gitignore`, `.gitattributes`, `.dockerignore`, `.env.example`
  - 공통 서버 모듈: `src/server/{db,tx,http,log,env,audit}.ts`
  - 화면·라이브러리: `src/lib/format.ts`, `src/rules/time.ts`, `src/app/healthz/route.ts`, `src/app/readyz/route.ts`, `src/instrumentation.ts`
  - 시험 도우미: `tests/helpers/{db,http}.ts`
  - 배포: `Dockerfile`, `compose.yml`(사용자·DB `studyon`, 이미지 `study-on-edu:latest`, 포트 `127.0.0.1:${APP_PORT:-3200}:3000`), `docker-entrypoint.sh`
  - CI: `.github/workflows/ci.yml`(잡 `web`·`e2e`만, `docker`는 Task 26). 아래 Step 3 참고
- Create: `src/app/layout.tsx`, `src/app/globals.css`(브랜드 색 변수), `src/app/(site)/page.tsx`(임시 메인: 로고·푸터 문구), `prisma/schema.prisma`(datasource·generator만), `tests/health.test.ts`, `tests/env.test.ts`, `e2e/smoke.spec.ts`

**Interfaces (Produces):**
- `db: PrismaClient`, `type Tx`, `log.info|warn|error(msg, fields?)`
- `getEnv(): Env`. 누비투어 항목에 다음을 더한다.
  - `FAULTS_ENABLED` 기본 `false`
  - `SEED_INSTRUCTOR_PASSWORD?`
  - `NEXT_PUBLIC_HEARTBEAT_SEC` 기본 `30`
- `HttpError(status, code, message)`, `route(fn)`, `readJson(req, schema)`, `readCookie(req, name)`, `clientIp(req)`, `errorResponse(e)`
- `audit(actor: string, action: string, target: string, detail?, tx?)`. actor 형식은 `staff:<id>`·`instructor:<id>`·`api:<키 이름>`·`system`이다.
- `src/rules/time.ts`: 누비투어의 `kstDate`·`addDays`·`diffDays`·`kstDateTime`·`kstEndOfDay`에 아래를 더한다.
  - `kstMonth(d: Date): string`(`YYYY-MM`)
  - `kstMonthRange(month: string): {start: Date; end: Date}`(KST 그달 1일 00:00 ~ 다음 달 1일 00:00, end 미포함)
  - `prevMonth(month: string): string`
  - `addMonthsClamped(d: Date, n: number): Date`(KST 날짜 기준 n달 뒤 같은 날·같은 시각. 그 날이 없으면 그달 말일. 1월 31일 + 1 → 2월 28/29일)
- npm scripts: 누비투어와 같다. 여기에 `load:login`·`load:checkout`·`load:live`(Task 23)를 더한다.

- [ ] **Step 1: 시험 작성**
  - `tests/health.test.ts`
    - `healthz returns ok`: `GET /healthz` → 200 `{status:"ok"}`
    - `readyz returns ready when db up`: 200 `{status:"ready"}`
    - `readyz returns 503 when db query fails`: `db.$queryRaw`를 throw로 바꾸면 503
  - `tests/env.test.ts`
    - `rejects live_ toss key`: `assertSafeTossKeys({TOSS_SECRET_KEY:"live_x"})`가 throw
    - `FAULTS_ENABLED defaults false`
    - `log scrubs secrets`: `log.scrub({password:"a", token:"b", nested:{api_key:"c"}})`의 모든 값이 `"[가림]"`
  - `tests/time.test.ts`
    - `kstMonth boundary`: `kstMonth(new Date("2026-11-30T15:30:00Z")) === "2026-12"`, `kstMonth(new Date("2026-11-30T14:59:59Z")) === "2026-11"`
    - `kstMonthRange`: `kstMonthRange("2026-12").start.toISOString() === "2026-11-30T15:00:00.000Z"`
    - `addMonthsClamped`: `2026-01-31T03:00Z` + 1 → `2026-02-28T03:00Z`
    - `prevMonth("2026-01") === "2025-12"`
  - `e2e/smoke.spec.ts` `home shows brand and demo footer`: `/`에 "스터디온에듀"와 "시연용 가상 서비스예요"가 보인다.
- [ ] **Step 2: 시험만 커밋·push → CI 빨강 확인.** 그다음 브랜치에서 초안 PR을 연다.
- [ ] **Step 3: 구현.** 위 파일들을 복사하고 고친다. CI는 `nubi-tour/.github/workflows/ci.yml`의 `web`·`e2e` 잡을 그대로 쓰되 다음만 바꾼다.
  - DB 이름·사용자를 `studyon`으로
  - e2e env에 `SEED_STAFF_EMAIL: admin@studyon.test`, `SEED_STAFF_PASSWORD: e2e-admin-pass`, `SEED_INSTRUCTOR_PASSWORD: e2e-instructor-pass`, `NEXT_PUBLIC_HEARTBEAT_SEC: "2"`, `FAULTS_ENABLED: "true"`
  - `npm run db:seed` 단계는 Task 4에서 넣는다(그 전에는 `prisma/seed.ts`가 없어 실패한다)
- [ ] **Step 4: 커밋·push → CI `web`·`e2e` 초록.**

### Task 2: 데이터 모델·마이그레이션·일련번호

**Files:**
- Modify: `prisma/schema.prisma`
- Create:
  - `prisma/migrations/20261118000000_init/migration.sql`(`prisma migrate dev --create-only`로 만들고, 아래 부분 인덱스는 SQL에 직접 더한다)
  - `src/server/codes.ts`(adapt from `nubi-tour/src/server/codes.ts`)
  - `tests/codes.test.ts`, `tests/schema.test.ts`

**Interfaces (Produces):** Prisma 모델 → 표. 모든 표에 `created_at`이 있고, 바뀌는 표는 `updated_at`(`@updatedAt`) + 인덱스를 둔다. 금액은 `Int`다.
- 카탈로그
  - `Category→categories`(code·name·sort)
  - `Tag→tags`, `CourseTag→course_tags`
  - `Instructor→instructors`(slug, display_name, bio, account_last4, status `active|suspended`)
  - `InstructorUser→instructor_users`(email, password_hash, instructor_id)
  - `InstructorSession→instructor_sessions`
- 강의
  - `Course→courses`: code unique, title, subtitle, category_id, instructor_id, level `beginner|intermediate|advanced`, price, sale_price?, sale_ends_at?, access_days?(null=평생, 기본 365), status, reject_reason?, intro, audience[], prerequisites[], faq Json, in_subscription Bool, rating_avg Float, rating_count Int, published_at?
  - `Section→sections`(course_id, title, sort)
  - `Lecture→lectures`(section_id, course_id, title, sort, duration_sec, is_preview, has_resource, script Json `{slides:[{at,title,bullets[]}], captions:[{at,text}]}`)
- 상품
  - `Bundle→bundles`(code, title, price, access_days?), `BundleCourse→bundle_courses`
  - `Plan→plans`(code `monthly|yearly`, interval `month|year`, price, refund_base_hours)
- 회원
  - `User→users`(email unique, password_hash, name, phone, birth_year?, interests[], marketing_opt_in)
  - `Session→sessions`
  - `Device→devices`(user_id, device_key, name, first_seen_at, last_seen_at, revoked_at?. 부분 unique `(user_id, device_key) WHERE revoked_at IS NULL`)
  - `PlaybackLease→playback_leases`
- 주문·결제
  - `CartItem→cart_items`(unique user+course / user+bundle)
  - `Order→orders`(code, user_id, list_total, discount_total, coupon_id?, coupon_discount, payable, refunded_amount, status, paid_at?, expires_at)
  - `OrderItem→order_items`(order_id, kind `course|bundle`, course_id?, bundle_id?, list_price, unit_price, coupon_share, paid_amount, refunded_amount, status `active|refunded`)
  - `Payment→payments`(order_id?, invoice_id?, kind `charge|refund`, method, amount, status `pending|approved|failed|cancelled`, toss_order_id? unique, toss_payment_key?, refund_of_id?, failure_reason?, approved_at?). 행을 쌓기만 하고 지우지 않는다.
  - `Coupon→coupons`(code unique, kind `fixed|percent`, value, max_discount?, min_amount?, target `all|category|course|instructor`, target_ref?, starts_at, ends_at, per_user_once, total_limit?, used_count, referral Bool, instructor_id?)
  - `CouponRedemption→coupon_redemptions`(unique coupon_id+user_id, order_id)
- 구독
  - `Subscription→subscriptions`(user_id, plan_id, status, current_period_start, current_period_end, cancel_at_period_end, failure_count, next_retry_at?, paused_until?, pauses Json `[{start, days}]`, card_label, card_last4)
  - `SubscriptionInvoice→subscription_invoices`(subscription_id, period_start, period_end, amount, status `pending|paid|failed|refunded`, attempts, last_attempt_at?, paid_at?. **unique (subscription_id, period_start)**)
- 학습
  - `Enrollment→enrollments`(**unique user_id+course_id**, source, order_item_id?, subscription_id?, starts_at, expires_at?, status)
  - `LectureProgress→lecture_progress`(unique user_id+lecture_id, course_id, ranges Json `[[s,e],…]`, watched_sec, last_position_sec, completed_at?, downloaded_at?, last_watched_at)
  - `WatchEvent→watch_events`(user_id, lecture_id, course_id, device_id, from_sec, to_sec, rate Float, added_sec, source. 인덱스 (course_id, created_at)·(source, created_at))
  - `Note→notes`
  - `Certificate→certificates`(number unique, user_id+course_id unique, issued_at, progress_ratio)
- 소통
  - `Question→questions`(lecture_id, course_id, user_id, title, body, answered_at?)
  - `Answer→answers`(question_id, author_kind `instructor|staff`, author_id, body)
  - `Review→reviews`(unique user+course, rating 1..5, body, hidden)
  - `Inquiry→inquiries`, `Notice→notices`, `Faq→faqs`
  - `Message→messages`(user_id?, channel `email|sms`, to, kind, subject, body)
- 라이브: `LiveSession→live_sessions`(course_id?, instructor_id, title, starts_at, ends_at, capacity 기본 300, status, replay_lecture_id?), `LiveSeat→live_seats`(unique session+user, reserved_at, entered_at?), `LiveChat→live_chats`
- 환불·정산
  - `Refund→refunds`(user_id, order_item_id?, invoice_id?, reason, basis Json, calc_amount, amount, adjust_reason?, status, decided_by?, approved_at?, done_at?, reject_reason?. **부분 unique `(order_item_id) WHERE status IN ('requested','approved')`**, invoice_id도 같은 부분 unique)
  - `Settlement→settlements`(unique instructor_id+month, sales_amount, sales_share, referral_amount, referral_share, subscription_share, refund_deduction, carried_in, total, payout, status `draft|confirmed`, confirmed_by?, confirmed_at?, pay_date)
  - `SettlementLine→settlement_lines`(kind `sale|referral|subscription|refund|carry`, ref, base_amount, rate Float, amount)
- 운영
  - `QueueSetting→queue_settings`(target PK, enabled, rate_per_sec, admit_ttl_sec 600, last_admit_at, next_seq, course_codes[])
  - `QueueTicket→queue_tickets`(target, seq, status `waiting|admitted|expired`, issued_at, last_seen_at, admitted_at?, expires_at?. 인덱스 (target, status, seq))
  - `ServiceMode→service_modes`(행을 쌓는다: mode, changed_by, reason. 현재 값은 최신 행)
  - `FaultSwitch→fault_switches`(key PK, enabled, value Json, updated_by)
  - `Incident→incidents`(title, body, components[], severity `degraded|outage`, status `investigating|identified|monitoring|resolved`, started_at, resolved_at?)
- 관리
  - `Staff→staff`, `StaffSession→staff_sessions`
  - `ApiKey→api_keys`(scopes에 `metrics` 추가)
  - `AuditLog→audit_logs`, `JobRun→job_runs`(name, started_at, ms, ok, detail)
  - `WebhookEndpoint→webhook_endpoints`(url, secret, events[], active), `WebhookDelivery→webhook_deliveries`(endpoint_id, event_id, type, payload Json, status `pending|done|failed`, attempts, next_attempt_at, last_status?)
  - `Counter→counters`(key PK, last)
- `codes.ts`
  - `nextCode(tx: Tx, key: string): Promise<number>`(`INSERT … ON CONFLICT DO UPDATE SET last = counters.last + 1 RETURNING last`)
  - `nextOrderCode(tx, now): Promise<string>`, `nextCourseCode(tx, categoryCode): Promise<string>`, `nextCertificateNo(tx, now): Promise<string>`

- [ ] **Step 1: 시험 작성**
  - `tests/codes.test.ts`
    - `order code format`: now=`2026-11-18T01:00Z` → `SO2611180001`, 다음 `SO2611180002`
    - `order code resets per KST day`: `2026-11-18T15:00Z` → `SO2611190001`
    - `20 concurrent codes unique`: `Promise.all` 20개가 모두 다름
    - `course code`: `nextCourseCode(tx,"DEV") === "SO-DEV-0001"`
    - `certificate no`: `SOC-2026-000001`
  - `tests/schema.test.ts`
    - `one open refund per item`: 같은 order_item에 `requested` 두 개를 넣으면 unique 위반
    - `one invoice per period`: 같은 (subscription_id, period_start)를 두 번 넣으면 위반
    - `one active device key`: 같은 (user, device_key) 활성 두 개는 위반이고, 하나를 revoke하면 다시 넣을 수 있다
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.** 스키마·마이그레이션·`codes.ts`를 만든다.
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 3: 인증 — 회원·직원·강사, 요청 제한, 권한표

**Files:**
- Create:
  - 인증 서버 (copy and adapt from nubi-tour/<같은 경로>): `src/server/auth/{password,session,current,users}.ts`, `src/server/auth/ratelimit.ts`, `src/proxy.ts`
  - 권한표·로그인 API: `src/server/roles.ts`, `src/app/api/auth/{signup,login,logout,me}/route.ts`, `src/app/api/admin/auth/{login,logout,me}/route.ts`, `src/app/api/instructor/auth/{login,logout,me}/route.ts`
  - 화면: `src/app/(site)/{login,signup}/page.tsx`, `src/app/admin/login/page.tsx`, `src/app/instructor/login/page.tsx`, `src/components/AuthForms.tsx`(adapt)
  - 시험: `tests/auth.test.ts`, `tests/ratelimit.test.ts`

**Interfaces (Produces):**
- `hashPassword`, `verifyPassword`(누비투어 그대로)
- 회원 세션: `issueUserSession`, `userFromRequest`, `requireUser(req): Promise<User>`(401 `LOGIN_REQUIRED`)
- 직원 세션: `issueStaffSession`, `requireStaff(req, perm?: Perm): Promise<Staff>`(401 / 권한 없으면 403 `FORBIDDEN` "이 작업은 권한이 없어요.")
- 강사 세션: `issueInstructorSession`, `requireInstructor(req): Promise<{user: InstructorUser; instructor: Instructor}>`
- 서버 컴포넌트용: `currentUser()`, `currentStaff()`, `currentInstructor()`
- `roles.ts`
  - `type Perm = 'catalog'|'review_courses'|'orders'|'refunds'|'subscriptions'|'students'|'instructors'|'settlements'|'live'|'support'|'content_pages'|'ops'|'staff'|'api_keys'|'audit'`
  - `can(role: StaffRole, perm: Perm): boolean`(권한표는 "이 계획이 정한 것"을 따른다. `audit`는 admin만)
- 요청 제한(누비투어에서 반환값을 바꾼다)
  - `rateLimit(key, limit, windowSec, now = Date.now()): {ok: boolean; retryAt: Date}`
  - `enforceLimit(key: string, limit: number, windowSec: number, now?): void`(넘으면 `HttpError(429,'RATE_LIMITED','요청이 너무 많아요. 잠시 후 다시 시도해 주세요.')` + `retryAt`)
  - `errorResponse`가 429일 때 `Retry-After`(초)와 `error.retry_at`(ISO)을 붙인다
  - `LIMITS = { login:{ipEmail:[10,600], ip:[30,600]}, signup:[5,600], checkout:{user:[20,60], ip:[60,60]}, write:[10,600], chat:[30,60], api:[600,60] }`
- `proxy.ts`: `/admin/*`(로그인 제외)에 `so_staff`가 없으면 `/admin/login?next=…`로, `/instructor/*`에 `so_instructor`가 없으면 `/instructor/login`으로 보낸다. 로그인 뒤 `next`는 같은 사이트 경로만 받는다.

- [ ] **Step 1: 시험 작성**
  - `tests/auth.test.ts`
    - `signup → me → logout`: 가입 201 + `so_session` 쿠키 → `me` 200 → 로그아웃 뒤 `me` 401
    - `duplicate email 409`, `short password 400`(메시지 "비밀번호는 8자 이상으로 정해 주세요.")
    - `password not stored raw`: `users.password_hash`에 원문이 없고 `scrypt$`로 시작
    - `staff perms`: `cs`가 `requireStaff(req,'settlements')`를 부르면 403, `admin`은 통과. `can('content','refunds') === false`, `can('cs','refunds') === true`
    - `instructor cookie separate`: 회원 쿠키로 `/api/instructor/auth/me`를 부르면 401
  - `tests/ratelimit.test.ts`
    - `11th wrong login → 429 with Retry-After`: 응답 헤더 `Retry-After`가 1~600, `body.error.retry_at`이 ISO
    - `rateLimit window`: `rateLimit("k",2,60,0)` 두 번 ok, 세 번째 `{ok:false}`, `retryAt.getTime() === 60_000`. `now=60_001`이면 다시 ok
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록. 초안을 풀고 M1 PR 머지를 기다린다.**

---

## 마일스톤 2 — 카탈로그·강의 화면·시드 (브랜치 `feat/m2-catalog`)

### Task 4: 시드

**Files:**
- Create:
  - `prisma/seed.ts`, `prisma/seed-lib.ts`(adapt from nubi-tour/prisma/{seed,seed-lib}.ts, `hash01` 결정적 난수 그대로)
  - 시드 데이터: `prisma/seed-data/{categories,instructors,courses,bundles,plans,coupons,live,notices}.ts`
  - 시험: `tests/seed.test.ts`

**Interfaces (Produces):** `runSeed(db, {staffEmail?, staffPassword?, instructorPassword?, now?}): Promise<{categories; instructors; courses; bundles; plans; coupons; liveSessions}>`. 강의는 `code`, 나머지는 각 자연 키로 upsert해서 멱등하게 한다.
- 카테고리 7개(spec 순서, 위 분야 코드)
- 가상 강사 20명. 활동명만 쓰고(예: "한빛코더", "데이터 고양이"), 실존 인물처럼 보이는 이름은 쓰지 않는다. `instructorPassword`가 있으면 강사마다 `instructor+<slug>@studyon.test` 계정을 만든다.
- 강의 64개
  - 분야마다 `published` 8~10개, 합 60
  - `in_review` 3개, `draft` 1개
  - 섹션 3~6개, 강 길이 300~1500초
  - 강의마다 미리보기 강 ≥ 1, 자료 첨부 강 ≥ 1
  - 정가 33,000~198,000원, 그중 약 1/3에 할인가와 할인 마감(앞으로 3~21일)
  - `access_days`는 365가 대부분이고, 평생(null) 6개, 90일 4개
  - 약 70% `in_subscription`
  - 가짜 영상 스크립트는 강 제목에서 슬라이드 4~8장, 자막은 30초마다
- 태그 `정처기실기`(자격증 강의 5개)
- 패키지 5개(강의 3~4개씩, 정가 합의 60~75%)
- 플랜 2개(월 29,000원·20시간, 연 290,000원·240시간)
- 쿠폰 4개
  - `WELCOME10`: 정률 10%, 최대 10,000원, 1인 1회
  - `D30SALE`: 자격증 분야 정액 5,000원
  - `ALLPASS20`: 정률 20%, 최소 100,000원
  - 강사 2명의 추천 코드 `REF-<slug>`: 정률 10%, referral
- 라이브: 오늘부터 28일 안에 12개(강의에 붙은 것 8, 단독 4, 정원 300)
- 공지 5, FAQ 12(환불·구독·기기·수료증·라이브)
- 직원: `staffEmail/staffPassword`가 있을 때만 `admin` 하나를 만든다

- [ ] **Step 1: 시험 작성** `tests/seed.test.ts`(빈 DB, `now` 고정)
  - `counts`: 카테고리 7, 강사 20, `published` 강의 60, `in_review` 3, 패키지 5, 플랜 2
  - `every category has ≥ 8 published`
  - `lecture durations 300..1500` + `each course ≥1 preview, ≥1 resource`
  - `codes match /^SO-(DEV|DATA|CERT|LANG|DSGN|BIZ|EXAM)-\d{4}$/`
  - `live within 28 days`: 모두 `now` < starts_at ≤ now+28일, 12개
  - `idempotent`: 두 번 돌려도 강의·강 수가 같다
  - `no staff without env`: env가 없으면 staff 0
  - `no real-looking footer numbers`: 시드 문자열에 `/\d{3}-\d{2}-\d{5}/`가 없다
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.** CI `e2e` 잡의 `prisma migrate deploy` 다음에 `npm run db:seed` 단계를 넣는다.
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 5: 카탈로그 서비스와 수강생 화면(메인·목록·상세·강사·패키지·구독·고객센터)

**Files:**
- Create:
  - 서비스·규칙: `src/server/catalog.ts`, `src/rules/pricing.ts`(이 작업은 `effectivePrice`만)
  - 레이아웃·메인·목록: `src/app/(site)/layout.tsx`(헤더·검색·푸터·배너 자리), `src/app/(site)/page.tsx`, `src/app/(site)/courses/page.tsx`, `src/app/(site)/courses/[code]/page.tsx`
  - 강사·패키지·구독: `src/app/(site)/instructors/[slug]/page.tsx`, `src/app/(site)/bundles/{page,[code]/page}.tsx`, `src/app/(site)/subscribe/page.tsx`(소개만, 가입은 Task 15)
  - 고객센터·약관: `src/app/(site)/support/{page,notices,faq}/page.tsx`, `src/app/(site)/terms/{service,privacy,refund}/page.tsx`
  - 컴포넌트·라이브러리: `src/components/{CourseCard,CourseThumb,CurriculumList,RatingBars,PriceBox,FilterBar,DemoBadge,Footer,Logo}.tsx`, `src/server/support.ts`(공지·FAQ 읽기), `src/lib/nav.ts`(adapt)
  - 시험: `tests/catalog.test.ts`, `tests/pricing.test.ts`

**Interfaces (Produces):**
- `effectivePrice(c: {price: number; sale_price: number|null; sale_ends_at: Date|null}, at: Date): {unit: number; onSale: boolean}`. 할인가는 `at < sale_ends_at`일 때만 적용한다.
- 강의 목록: `searchCourses(q: {q?: string; category?: string; level?: Level; priceMax?: number; ratingMin?: number; inSubscription?: boolean; sort?: 'popular'|'newest'|'rating'|'price_asc'|'price_desc'; page?: number}, now?): Promise<{items: CourseSummary[]; total: number}>`
  - `published`만 나온다. 한 쪽에 24개다. `popular`는 최근 7일 수강권 수 순이다.
  - `CourseSummary = {code, title, subtitle, category, instructor:{slug, display_name}, level, unit, list, onSale, sale_ends_at, rating_avg, rating_count, total_sec, in_subscription}`
- 강의 상세: `getCourse(code, now?): Promise<CourseDetail|null>`
  - 섹션·강(길이·미리보기)·강사·후기 분포(1~5 개수)·FAQ·수강 기간·환불 규정 요약을 담는다.
  - `published`가 아니면 null이다(미리보기는 강사·직원 화면에서만).
- 메인·강사: `homeSections(now): Promise<{popular: CourseSummary[]; promo: {title: "정보처리기사 실기 D-30"; items}; live: LiveSummary[]; notices}>`, `getInstructorPage(slug)`
- 화면 규칙
  - 강의 상세 아래에 환불 규정 문구를 둔다. `terms/refund`와 같은 원문을 쓰고, 7일·5%·자료 받음·기간제 공제·패키지 전체 계산·실제 낸 금액 기준·승인 후 5일을 담는다.
  - 강사 노출마다 `DemoBadge`("시연용 가상 강사")를 단다.
  - 메인 섹션 순서: 검색 → 카테고리 → 이번 주 인기 → 기획전 → 라이브 일정 → 구독 소개 → 공지

- [ ] **Step 1: 시험 작성**
  - `tests/pricing.test.ts`
    - `sale before end`: `effectivePrice({price:99000, sale_price:69000, sale_ends_at:T}, T-1ms).unit === 69000`
    - `sale at end`: `at=T`이면 99000
    - `no sale`: 99000, `onSale:false`
  - `tests/catalog.test.ts`(시드 사용)
    - `category filter`: `searchCourses({category:"DEV"})`가 모두 DEV
    - `inSubscription filter`: 모두 `in_subscription`
    - `price_asc sorted`: `unit` 오름차순
    - `unpublished hidden`: `in_review` 강의가 목록에 없고 `getCourse`도 null
    - `detail curriculum`: 섹션 순서·강 순서가 `sort`와 같고, `total_sec`가 강 길이 합
    - `rating distribution sums to rating_count`
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.** 서버 컴포넌트에서 DB를 바로 읽는다. 목록 캐시는 Task 21에서 모드별로 바꾸므로 지금은 `listCacheTtlSec()`가 30을 돌려주게만 둔다. `e2e/smoke.spec.ts`에 `browse to course detail`을 더한다: 메인 → 카테고리 "개발·프로그래밍" → 첫 강의 → "커리큘럼"과 "환불 규정"이 보인다.
- [ ] **Step 4: 커밋·push → CI 초록. M2 PR 머지를 기다린다.**

---

## 마일스톤 3 — 주문·결제·쿠폰·수강권·환불 (브랜치 `feat/m3-commerce`)

### Task 6: 규칙 — 쿠폰·배분·환불·기한 (순수 함수)

**Files:**
- Modify: `src/rules/pricing.ts`
- Create: `src/rules/refund.ts`, `src/rules/deadlines.ts`, `tests/rules/pricing.test.ts`, `tests/rules/refund.test.ts`, `tests/rules/deadlines.test.ts`

**Interfaces (Produces):**
- `pricing.ts`
  - `type CouponRule = {kind:'fixed'|'percent'; value: number; max_discount: number|null; min_amount: number|null; target:'all'|'category'|'course'|'instructor'; target_ref: string|null}`
  - `type PriceLine = {key: string; category: string; course_code: string|null; instructor_ids: string[]; list: number; unit: number}`(패키지는 `course_code=null`, `instructor_ids`에 묶음 강사들)
  - `couponApplies(rule, line): boolean`. `all`은 모두, `category`는 line.category, `course`는 course_code, `instructor`는 instructor_ids에 포함될 때다. 패키지 줄은 `all`일 때만 대상이다.
  - `couponDiscount(rule, eligibleSubtotal): number`
    - 정액: `min(value, subtotal)`
    - 정률: `floor(subtotal × value / 100)`, `max_discount`로 자른다
    - `min_amount`보다 작으면 0
  - `allocate(total: number, weights: number[]): number[]`: 합이 정확히 `total`이다.
  - `priceOrder(lines: PriceLine[], coupon: CouponRule|null): {lines: (PriceLine & {coupon_share: number; paid: number})[]; list_total: number; discount_total: number; coupon_discount: number; payable: number}`. `discount_total = Σ(list − unit)`이고 `payable = Σ unit − coupon_discount`다.
- `refund.ts`(spec "규칙 › 환불" 그대로)
  - `FULL_REFUND_DAYS = 7`, `FULL_REFUND_PROGRESS = 0.05`
  - `type LectureUse = {duration_sec: number; watched_sec: number; downloaded: boolean}`
  - `type RefundQuote = {kind:'full'|'prorated'; elapsed_days: number; progress_ratio: number; period_ratio: number|null; used_ratio: number; used_amount: number; refund: number; basis_ko: string}`
  - `refundProgress(lectures: LectureUse[]): number` = `Σ min(d, downloaded ? d : watched) ÷ Σ d`(Σd=0이면 0)
  - `courseRefund(i: {paid: number; paid_at: Date; now: Date; access_days: number|null; lectures: LectureUse[]}): RefundQuote`
    - `elapsed = diffDays(kstDate(paid_at), kstDate(now))`
    - 전액: `elapsed ≤ 7 && progress < 0.05 && 내려받은 강 없음`
    - 그 밖: `period = access_days ? min(1, elapsed/access_days) : null`, `used_ratio = min(1, max(progress, period ?? 0))`, `used_amount = floor(paid × used_ratio)`, `refund = max(0, paid − used_amount)`
    - `basis_ko` 예시: `"결제 후 10일 · 진도 3.0% · 기간 2.7% → 큰 값 3.0% 공제 2,970원"`
  - `subscriptionRefund(i: {paid: number; paid_at: Date; period_start: Date; period_end: Date; now: Date; watched_sec: number; base_hours: number}): RefundQuote`
    - 전액: `diffDays(kst(paid_at), kst(now)) ≤ 7 && watched_sec === 0`
    - 그 밖: `ratio = min(1, max(elapsed/period_days, watched_sec/(base_hours×3600)))`. elapsed와 period_days는 KST 날짜 차로 센다.
  - `courseRefundMethods(i): {progress_based: number; period_based: number|null; applied: number}`(직원 계산기용 나란히 보기)
- `deadlines.ts`
  - `QUESTION_DUE_DAYS = 7`, `REFUND_PROCESS_DAYS = 5`
  - `questionOverdue(created_at, answered_at|null, now): boolean`(`now − created_at > 7×24h`이고 미답변)
  - `refundDueAt(approved_at): Date`(+5일), `refundOverdue(approved_at, done_at|null, now): boolean`

`allocate`의 방식은 시그니처만으로 정해지지 않으므로 여기 적는다:
```ts
// 비례 배분: 내림으로 나누고, 남는 원은 가장 큰 가중치(같으면 앞) 하나에 몰아준다.
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const out = weights.map((w) => Math.floor((total * w) / sum));
  const rest = total - out.reduce((a, b) => a + b, 0);
  const big = weights.indexOf(Math.max(...weights));
  out[big] += rest;
  return out;
}
```

- [ ] **Step 1: 시험 작성** 모든 값을 적힌 그대로 단언한다.
  - `tests/rules/pricing.test.ts`
    - `allocate(10000,[1,1,1])`는 `[3334,3333,3333]`. 큰 값이 같으면 앞에 몰아준다. 합 10000.
    - `allocate(5000,[99000,33000])`는 `[3750,1250]`.
    - 정률 10% 최대 10,000원: 소계 150,000 → 10000, 소계 69,000 → 6900.
    - 정액 5,000원 소계 3,000 → 3000(음수 없음). `min_amount` 100,000에 소계 99,999 → 0.
    - `priceOrder`: 정가 99,000/할인가 69,000 + 정가 33,000 + 쿠폰 정률 10%(최대 할인 없음, 대상 all)
      - `list_total 132000`, `discount_total 30000`, `coupon_discount 10200`, `payable 91800`
      - 줄 paid `[62100, 29700]`
    - 대상이 `category:"CERT"`인 쿠폰이면 DEV 줄의 `coupon_share`는 0.
  - `tests/rules/refund.test.ts`(paid 99,000, 강 10개 × 600초)
    - `full within 7 days`: elapsed 3, 본 초 합 = 전체의 4% → `kind full`, `refund 99000`
    - `5% exactly is prorated`: elapsed 3, 5% → `refund 94050`
    - `download breaks full`: elapsed 0, 진도 0, 한 강 자료 받음 → `progress_ratio 0.1`, `refund 89100`
    - `period wins`: elapsed 10, 진도 3%, access 365 → `used_ratio 0.03`, `refund 96030`
    - `period larger`: elapsed 8, 진도 0, access 365 → `used_amount 2169`, `refund 96831`
    - `lifetime`: access null, elapsed 200, 진도 20% → `period_ratio null`, `refund 79200`
    - `completed → 0`: 진도 100% → 0. `watched > duration`은 길이로 자른다(진도 ≤ 1).
    - `coupon basis`: paid 62,100(쿠폰 뒤 실제 낸 금액), 진도 10%, elapsed 10 → `refund 55890`
    - `KST boundary`: paid_at `2026-11-01T14:59:59Z`이면 now `2026-11-08T14:59:59Z` → full, now `2026-11-08T15:00:00Z` → elapsed 8, prorated (Review Focus 4)
    - `subscription full`: paid 29,000, elapsed 2, watched 0 → 29000
    - `subscription prorated`: 기간 30일, elapsed 10, watched 3h, base 20h → `used_amount 9666`, `refund 19334`
    - `subscription watch wins`: elapsed 2, watched 12h → `refund 11600`
    - `methods side by side`: elapsed 10, 진도 3% → `{progress_based:96030, period_based:96288, applied:96030}`
  - `tests/rules/deadlines.test.ts`
    - 질문 created `2026-11-01T00:00Z`: now `2026-11-08T00:00Z` → false, `2026-11-08T00:00:01Z` → true, 답변 있으면 false
    - `refundDueAt` = approved + 5일
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 7: 장바구니·주문·쿠폰 사용·수강권·보낸 편지함

**Files:**
- Create:
  - 서비스: `src/server/cart.ts`, `src/server/orders.ts`, `src/server/coupons.ts`, `src/server/enrollments.ts`, `src/server/messages.ts`(adapt from nubi-tour/src/server/messages.ts: 예약 대신 user)
  - API: `src/app/api/cart/route.ts`(GET/POST/DELETE), `src/app/api/orders/route.ts`(POST), `src/app/api/orders/[code]/route.ts`(GET)
  - 화면: `src/app/(site)/cart/page.tsx`, `src/app/(site)/checkout/[code]/page.tsx`
  - 시험: `tests/orders.test.ts`, `tests/helpers/fixtures.ts`(`makeCourse`, `makeUser`, `makeBundle`, `loginCookie`)

**Interfaces:**
- Consumes: Task 6 `priceOrder`·`couponApplies`·`effectivePrice`, Task 2 `nextOrderCode`, Task 3 `requireUser`·`enforceLimit`
- Produces:
  - 장바구니: `addToCart(userId, {course_code?|bundle_code?})`(이미 산 강의는 409 `ALREADY_ENROLLED` "이미 수강 중인 강의예요."), `getCart(userId, now): Promise<{lines; pricing}>`
  - 주문: `createOrder(userId, {coupon_code?: string; price_at?: Date}, now = new Date()): Promise<Order>`
    - 트랜잭션 하나에서 장바구니로 줄을 만들고 쿠폰을 검사·잠근다(`SELECT … FOR UPDATE` coupons).
    - 1인 1회 쿠폰은 `coupon_redemptions`에 넣는다. unique 위반이면 409 `COUPON_USED` "이미 쓴 쿠폰이에요."
    - `total_limit`을 넘으면 409 `COUPON_EXHAUSTED`, 기간 밖이면 400 `COUPON_EXPIRED`
    - 주문·항목(`paid_amount`)을 저장하고 장바구니를 비운다. `expires_at = now + 30분`.
    - 제한: `enforceLimit(checkout user/ip)`
  - 쿠폰 확인: `validateCoupon(tx, code, userId, lines, now): Promise<Coupon>`
  - 미결제 주문 취소: `cancelPendingOrder(tx, orderId, why)`. `cancelled`로 바꾸고, 쿠폰 사용 기록을 지우고, `used_count`를 1 줄인다.
  - 수강권 부여: `grantForOrder(tx, orderId, now)`
    - 단건: `expires_at = access_days ? now + access_days일 : null`
    - 패키지: 묶음 강의마다 `source=bundle`, 기한은 `bundle.access_days`로 정한다
    - 이미 수강권이 있으면 `source`를 구매로 바꾸고 `expires_at`은 더 늦은 값을 쓴다
  - 수강권 환불: `refundEnrollments(tx, orderItemId, now)`(구독이 살아 있고 `in_subscription`이면 `subscription`으로 되돌린다)
  - 수강권 확인: `activeEnrollment(userId, courseId, now): Promise<Enrollment|null>`
    - `active`이고 기한 전이어야 한다
    - `subscription`이면 구독이 `active|past_due`여야 한다(`paused`는 안 된다)
  - 보낸 편지함: `recordMessage(tx, user: {id, email}, kind, subject, body)`(본문 앞에 `[스터디온에듀]`), `won(n)`

- [ ] **Step 1: 시험 작성** `tests/orders.test.ts`
  - `order totals match priceOrder`: 주문의 list_total·coupon_discount·payable과 항목 `paid_amount` 합 = payable
  - `code format`: `/^SO\d{10}$/`
  - `coupon once per user concurrent`: `WELCOME10`(1인 1회)로 같은 사용자가 `Promise.all`로 주문 둘 → 하나 성공, 하나 409 `COUPON_USED`, `used_count === 1`
  - `coupon total_limit`: limit 1에 다른 사용자 둘이 동시 주문 → 하나만 성공
  - `cancel releases coupon`: `cancelPendingOrder` 뒤 같은 쿠폰으로 다시 주문 가능
  - `already enrolled 409`
  - `price_at honors sale`: `sale_ends_at` 지난 뒤 `price_at = 마감 1분 전`이면 할인가(Task 22가 씀)
  - `grant bundle`: 패키지 강의 3개 수강권, `source bundle`, 만료 = now + 365일
  - `grant keeps later expiry`: 기존 만료가 더 늦으면 그대로 둔다
  - `subscription enrollment paused not active`: 구독 `paused`이면 `activeEnrollment` null
  - `checkout rate limit`: 같은 사용자 21번째 주문 → 429
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.** 장바구니·주문서 화면을 만든다. 주문서에는 쿠폰 입력·가격 내역·환불 규정 동의 체크를 둔다.
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 8: 결제 — 토스 테스트 + 모의

**Files:**
- Create:
  - 서비스 (copy and adapt from nubi-tour/src/server/payments/{toss,index}.ts): `src/server/payments/toss.ts`, `src/server/payments/index.ts`
  - API: `src/app/api/payments/{prepare,confirm,mock}/route.ts`
  - 화면: `src/app/(site)/pay/{success,fail}/page.tsx`, `src/components/PayButton.tsx`(adapt), `src/app/(site)/orders/[code]/done/page.tsx`
  - 시험: `tests/payments.test.ts`

**Interfaces:**
- Consumes: Task 7 `grantForOrder`·`cancelPendingOrder`·`recordMessage`
- Produces:
  - `preparePayment(orderCode, method: 'toss'|'mock' = 'toss', now?): Promise<{orderId; amount; orderName}>`(주문 `pending`이고 `expires_at` 전이어야 한다)
  - `prepareInvoicePayment(invoiceId, method, now?): Promise<{orderId; amount; orderName}>`(구독 첫 결제용, 청구 `pending`이어야 한다). `confirmPayment`·`mockPayInvoice(invoiceId, now?)`가 결제 행의 `order_id`/`invoice_id`를 보고 주문 또는 청구에 반영한다. 청구 반영은 `onInvoicePaid(tx, invoiceId, now)`를 부르고, 이 함수는 Task 15가 구현한다(그 전에는 청구 `paid`만 표시).
  - `confirmPayment({orderId, paymentKey, amount}, now?): Promise<Order>`
    - 누비투어의 멱등·조회·대조 흐름을 그대로 쓴다.
    - 승인되면 주문 `paid`, `paid_at`을 넣고 `grantForOrder`, 메시지 "결제가 완료됐어요. 내 강의실에서 바로 들을 수 있어요."
    - 주문이 `cancelled`가 된 뒤 온 승인은 바로 환불하고 409 `ORDER_CLOSED`
  - `mockPay(orderCode, now?)`(토스 키가 있으면 403)
  - `reconcilePending(now)`
  - `chargeMockInvoice(invoiceId, now, rand?): Promise<{ok: boolean; reason?: string}>`(Task 15가 쓴다)
    - 카드 끝 4자리가 `4000`이면 실패한다
    - Task 21 장애 주입 `payment_fail_rate`도 여기서 읽는다(지금은 훅 자리만)
  - `refundPayments(target: {orderId: string}|{invoiceId: string}, amount: number, reason: string): Promise<number>`: 누비투어 `refundCore`를 대상별로 adapt한다(`pg_advisory_xact_lock(hashtext('refund:'+id))`, 최근 승인 결제부터 거꾸로, 토스 멱등 키 = 환불 행 id).
  - 결제 시도·실패 지표 훅: `onPaymentAttempt(method, ok)`. 지금은 아무것도 하지 않고 Task 20이 채운다.

- [ ] **Step 1: 시험 작성** `tests/payments.test.ts`(토스는 `fetch` 가짜)
  - `confirm grants enrollments`
  - `same orderId twice → 1 payment row, fetch once`
  - `amount mismatch 400`
  - `expired order confirm → refunded + 409`: `cancelPendingOrder` 뒤 승인 → 환불 행 1, 409
  - `mockPay 403 with toss keys`
  - `refundPayments splits latest-first`(누비투어 시험 adapt): 결제 30,000 + 70,000에 환불 90,000 → 행 70,000 + 20,000
  - `mock card 4000 fails`: `chargeMockInvoice` → `{ok:false}`
  - `toss timeout leaves pending`: `fetch` reject → 결제 `pending`, 응답 502·`PAYMENT_PENDING`
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 9: 환불 요청·승인과 주기 작업 뼈대, 마이페이지 주문

**Files:**
- Create:
  - 서비스: `src/server/refunds.ts`, `src/server/learning-usage.ts`
  - 주기 작업 (copy and adapt from nubi-tour/src/server/jobs/{index,tasks}.ts): `src/server/jobs/index.ts`, `src/server/jobs/tasks.ts`, `src/server/jobs/lock.ts`
  - API: `src/app/api/refunds/route.ts`(POST 요청), `src/app/api/refunds/preview/route.ts`(GET 미리 보기), `src/app/api/admin/refunds/[id]/{approve,reject}/route.ts`
  - 화면: `src/app/(site)/my/{page,orders/page,orders/[code]/page}.tsx`, `src/components/RefundPanel.tsx`
  - 시험: `tests/refunds.test.ts`, `tests/jobs.test.ts`, `e2e/purchase.spec.ts`
- Modify: `src/instrumentation.ts`(스케줄러 시작)

**Interfaces:**
- Consumes: Task 6 `courseRefund`·`refundProgress`·`refundDueAt`, Task 8 `refundPayments`, Task 7 `refundEnrollments`
- Produces:
  - `usageFor(userId, courseIds: string[]): Promise<LectureUse[]>`(`learning-usage.ts`. 진도가 없으면 0이고 Task 11이 채운다)
  - `previewRefund(userId, orderItemId, now?): Promise<RefundQuote>`(남의 항목이면 404)
  - `requestRefund(userId, orderItemId, reason, now?): Promise<Refund>`
    - 항목을 잠그고(`FOR UPDATE`) `active`인지 확인한다
    - 열린 요청이 있으면 409 `REFUND_OPEN` "이미 환불 신청이 들어가 있어요."
    - basis에 그 시점 계산을 저장한다
  - `approveRefund(refundId, staffId, opts: {amount?: number; reason?: string} = {}, now?): Promise<Refund>`
    - 환불 행을 잠그고 `requested`일 때만 `approved`로 바꾼다. 아니면 409 `BAD_STATE`
    - 지금 시각으로 다시 계산한다. `amount`가 계산값과 다르면 `reason`이 필수다(400 `REASON_REQUIRED` "금액을 바꾸면 사유를 적어 주세요."). `amount`는 항목 paid_amount 이하여야 한다.
    - `refundPayments` 성공 시 `done`, 항목 `refunded`, 주문 `partially_refunded|refunded`, `refundEnrollments`, 메시지, `audit`
    - 결제사 실패 시 `approved`로 남긴다(작업이 다시 시도한다)
  - `rejectRefund(refundId, staffId, reason)`
  - `withJobLock(name: string, fn: () => Promise<T>): Promise<T|null>`
    - 트랜잭션 안에서 `pg_try_advisory_xact_lock(hashtext('job:'+name))`를 잡고 fn을 돌린다. 못 잡으면 null이다.
    - `job_runs`에 시간·성공 여부를 기록한다. `onJobRun(name, ms)` 지표 훅도 부른다.
  - `runJobsOnce(now?): Promise<Record<string, number>>`. 이 작업에서는 다음을 넣는다.
    - `expireOrders`: `pending`이고 `expires_at < now`
    - `retryRefunds`: `approved`이고 아직 `done`이 아닌 것
    - `reconcilePending`
    - 이후 작업이 이 목록에 더한다.
  - 스케줄러: 60초마다 돈다(`JOBS_ENABLED`).

- [ ] **Step 1: 시험 작성**
  - `tests/refunds.test.ts`
    - `full refund within 7 days`: mockPay 뒤 3일 → 요청·승인 → 환불 행 = paid_amount, 주문 `refunded`, 수강권 `refunded`, 감사 기록 1
    - `partial order`: 항목 2개 중 1개 환불 → 주문 `partially_refunded`
    - `bundle whole`: 패키지 항목 하나를 환불하면 묶음 강의 수강권이 모두 `refunded`
    - `adjust needs reason`: amount를 바꾸고 reason이 없으면 400
    - `concurrent request once`: `Promise.all`로 `requestRefund` 둘 → 하나 성공, 하나 409 `REFUND_OPEN`
    - `concurrent approve refunds once`(Review Focus 3): 직원 두 명이 `Promise.all`로 승인 → 성공 하나 + 409 하나, 환불 결제 행 1개, 주문 `refunded_amount` = 한 번 몫
    - `rejected then can request again`
    - `foreign item 404`
  - `tests/jobs.test.ts`
    - `expire pending order after 30 min`: 쿠폰 기록이 풀린다
    - `job lock`: 다른 연결이 `pg_advisory_lock(hashtext('job:expireOrders'))`를 쥐고 있으면 `withJobLock`가 null
    - `retry stuck refund`: 토스 실패로 `approved`에 남은 환불이 다음 실행에 `done`
  - `e2e/purchase.spec.ts` `signup, buy with coupon, see classroom, preview refund`
    - 가입 → 강의 상세 → 장바구니 → 주문서에서 `WELCOME10` → 모의 결제 → 완료 화면 주문번호 `SO…`
    - 마이페이지 주문 → "환불 신청"에 "예상 환불액"이 결제액과 같게 보임
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.** 마이페이지 환불 패널은 미리 보기(경과일·진도·공제 근거 `basis_ko`) → 사유 입력 → 신청 순서다.
- [ ] **Step 4: 커밋·push → CI 초록. M3 PR 머지를 기다린다.**

---

## 마일스톤 4 — 플레이어·진도·기기·수료증·질문·후기 (브랜치 `feat/m4-learning`)

### Task 10: 규칙 — 진도 (순수 함수)

**Files:**
- Create: `src/rules/progress.ts`, `tests/rules/progress.test.ts`

**Interfaces (Produces):**
- `type Range = [number, number]`(정수 초, 시작 포함 끝 미포함)
- 상수: `LECTURE_DONE_RATIO = 0.9`, `COURSE_COMPLETE_RATIO = 0.8`, `REVIEW_MIN_RATIO = 0.4`, `RATES = [0.5,0.75,1,1.25,1.5,1.75,2]`, `HEARTBEAT_SLACK = {factor: 1.2, sec: 5}`
- 구간 합치기
  - `mergeRanges(ranges: Range[]): Range[]`
  - `addWatched(existing: Range[], seg: Range, duration_sec: number): {ranges: Range[]; watched_sec: number; added_sec: number}`
- 하트비트 구간 받기
  - `acceptSegment(seg: Range, rate: number, last_beat_at: Date|null, now: Date, heartbeat_sec: number): Range|null`
  - 배속이 RATES 밖이면 null을 돌려주고, 호출한 쪽이 400을 낸다.
  - 허용 길이 = `(last_beat_at ? (now − last_beat_at)초 : heartbeat_sec) × rate × 1.2 + 5`다. 넘는 부분은 잘라 `[s, s+허용]`으로 한다. `s ≥ e`면 null이다.
- 완료 판정
  - `lectureDone(watched_sec, duration_sec): boolean`(`watched ≥ 0.9 × duration`)
  - `courseProgress(lectures: {duration_sec: number; done: boolean}[]): number`
  - `isCompleted(ratio): boolean`, `canReview(ratio): boolean`

방식이 시그니처로 정해지지 않는 부분:
```ts
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e); // 겹치거나 맞닿으면 합친다
    else out.push([s, e]);
  }
  return out;
}
// addWatched: seg를 [0, duration]으로 자르고(시작은 내림, 끝은 내림), 합친 뒤 길이 합을 watched로 한다.
// added = 새 watched − 이전 watched (≥ 0). 이 값만 watch_events.added_sec에 쓴다.
```

- [ ] **Step 1: 시험 작성** `tests/rules/progress.test.ts`
  - `merge overlap`: `mergeRanges([[0,30],[20,50],[60,90]])` → `[[0,50],[60,90]]`
  - `merge touching`: `[[0,30],[30,60]]` → `[[0,60]]`
  - `drops empty`: `[[5,5]]` → `[]`
  - `rewatch counts once`: existing `[[0,60]]` + seg `[0,60]` → `added_sec 0`, watched 60
  - `out of order`: `[60,90]` 다음 `[30,60]` → `[[30,90]]`, added 30
  - `clamp to duration`: duration 100, seg `[90,130]` → `[90,100]`, added 10
  - `speed counts video time`: rate 2, 30초 경과, seg `[0,60]` → 그대로 `[0,60]`
  - `skip-ahead truncated`(Review Focus 1): rate 1, last 30초 전, seg `[0,600]` → `[0,41]`(30×1×1.2+5=41)
  - `forged rate 3 rejected`: `acceptSegment(…, 3, …)` → null
  - `lecture done at 90%`: duration 600, watched 539 → false, 540 → true
  - `course progress by done length`: 길이 `[600,300,100]`, done `[true,false,true]` → `0.7`. `isCompleted(0.7)` false, `isCompleted(0.8)` true
  - `canReview(0.39)` false, `canReview(0.4)` true
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 11: 재생 API — 접근·하트비트·기기·동시 재생·노트·자료

**Files:**
- Create:
  - 서비스: `src/server/player.ts`, `src/server/devices.ts`, `src/server/notes.ts`
  - 재생 API: `src/app/api/player/{start,heartbeat}/route.ts`, `src/app/api/player/lectures/[id]/{route,download}/route.ts`(GET 재생 정보 / POST 자료 받기 → 가짜 PDF)
  - 노트·기기 API: `src/app/api/notes/{route,[id]/route}.ts`, `src/app/api/devices/{route,[id]/route}.ts`
  - 화면: `src/app/(site)/my/devices/page.tsx`(기기 관리: 이름·첫/마지막 사용·해제)
  - 시험: `tests/player.test.ts`, `tests/devices.test.ts`
- Modify: `src/server/learning-usage.ts`(진짜 `lecture_progress`를 읽는다)

**Interfaces:**
- Consumes: Task 10 전부, Task 7 `activeEnrollment`
- Produces:
  - `lectureAccess(userId|null, lectureId, now): Promise<{lecture; course; enrollment: Enrollment|null; preview: boolean}>`
    - 미리보기 강은 누구나 볼 수 있다
    - 그 밖에는 수강권이 있어야 하고, 없으면 403 `NO_ACCESS` "수강권이 있어야 볼 수 있어요."
    - 구독 대상 강의에 활성 구독이 있으면 여기서 구독 수강권을 만든다
  - `registerDevice(tx, userId, deviceKey, userAgent, now): Promise<Device>`
    - 활성 기기가 2대인데 새 키가 오면 409 `DEVICE_LIMIT` "등록 기기가 2대를 넘었어요. 마이페이지 › 기기 관리에서 쓰지 않는 기기를 해제해 주세요."
    - 이름은 UA에서 "Windows · Chrome"처럼 만든다
  - 기기 목록·해제: `listDevices(userId)`, `revokeDevice(userId|staff, deviceId)`. 해제한 기기의 재생 소유권도 지운다.
  - `startPlayback(userId, {lecture_id, device_id}, now): Promise<{resume_sec: number; lease: true}>`: 기기를 등록하고 소유권을 가져온다(앞 기기를 밀어낸다).
  - `heartbeat(userId, body: {lecture_id; from_sec; to_sec; position_sec; rate; device_id}, now): Promise<{watched_sec; done; course_progress}>`
    - 소유권 기기가 아니면 409 `PLAYING_ELSEWHERE` "다른 기기에서 재생을 시작해서 여기서는 멈췄어요."
    - `acceptSegment` → `addWatched`(`lecture_progress`를 `FOR UPDATE`로 잠근다) → `watch_events`에 `added_sec`를 기록(added 0이어도 행은 남긴다. 분석용)
    - `last_position_sec`, 완료 시각을 갱신하고 소유권 `beat_at`을 갱신한다
    - 미리보기만 보는 사람(수강권 없음)은 진도를 저장하지 않고 200만 돌려준다
  - `markDownloaded(userId, lectureId, now)`(`downloaded_at`을 처음 한 번만 넣는다)
  - 노트: `addNote(userId, {lecture_id, at_sec, body ≤ 2000})`, `listNotes(userId, courseId?)`
  - 동시 재생 수: `activePlaybacks(now): Promise<number>`(Task 20 지표)

- [ ] **Step 1: 시험 작성**
  - `tests/player.test.ts`
    - `no enrollment 403`, `preview allowed without login`
    - `heartbeat accumulates`: 30초 간격 세 번 `[0,30],[30,60],[60,90]` → watched 90
    - `duplicate heartbeat counts once`(Review Focus 2): 같은 본문 두 번 → watched 30, 두 번째 `added_sec 0`
    - `heartbeat rejects skip-ahead`(Review Focus 1): `from 0,to 1500`, 경과 30초 → watched 41, 강 미완료
    - `bad rate 400`(rate 3)
    - `done at 90% → course_progress updates`
    - `expired enrollment 403`
    - `paused subscription 403`
    - `download marks progress for refund`: `markDownloaded` 뒤 `previewRefund`의 `progress_ratio`가 그 강 길이만큼 오르고 `kind`는 prorated
  - `tests/devices.test.ts`
    - `third device 409 DEVICE_LIMIT`
    - `revoke frees slot`
    - `second device takes over`: A `startPlayback` → B `startPlayback` → A 하트비트 409 `PLAYING_ELSEWHERE`, B 하트비트 200
    - `same device restart keeps lease`
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 12: 플레이어 화면·내 강의실·수료증

**Files:**
- Create:
  - 플레이어: `src/app/(site)/learn/[courseCode]/[lectureId]/page.tsx`, `src/components/player/{FakeVideo,PlayerControls,CurriculumSidebar,NotesPanel,QuestionsPanel,ResourceButton}.tsx`, `src/components/player/usePlayback.ts`
  - 수료증: `src/server/certificates.ts`, `src/app/api/certificates/route.ts`(POST 발급), `src/app/(site)/certificates/[number]/page.tsx`(인쇄용)
  - 내 강의실: `src/server/classroom.ts`, `src/app/(site)/my/classroom/page.tsx`, `src/app/(site)/my/notes/page.tsx`
  - 시험: `tests/certificates.test.ts`, `tests/classroom.test.ts`, `e2e/learn.spec.ts`

**Interfaces:**
- Consumes: Task 11 API, Task 10 `courseProgress`·`isCompleted`
- Produces:
  - `myClassroom(userId, now): Promise<{active: ClassCard[]; completed: ClassCard[]; expired: ClassCard[]}>`
    - `ClassCard = {course_code, title, progress_ratio, resume: {lecture_id, position_sec}|null, expires_at}`
    - 이어보기 대상은 `last_watched_at`이 가장 최근인 강이다
  - `issueCertificate(userId, courseId, now): Promise<Certificate>`
    - 진도율 < 0.8이면 409 `NOT_COMPLETED` "진도율 80%를 넘으면 수료증을 받을 수 있어요."
    - 이미 있으면 그것을 돌려준다(멱등)
    - 번호는 `nextCertificateNo`, `progress_ratio`를 저장한다
- `usePlayback` 동작
  - 실제 길이만큼 진행하고, 배속을 바꾸면 영상 시간이 그만큼 빨리 흐른다.
  - 슬라이드·자막이 `script.at`에 맞춰 바뀐다.
  - 하트비트는 `NEXT_PUBLIC_HEARTBEAT_SEC`마다 보내고, pause·ended·`visibilitychange` 때는 `sendBeacon`으로 보낸다.
  - `PLAYING_ELSEWHERE`를 받으면 멈추고 안내한다. `DEVICE_LIMIT`이면 기기 관리 링크를 보여 준다.
  - 이어보기는 `resume_sec`에서 시작한다.
  - 자료 받기 전에 "자료를 받으면 이 강은 본 것으로 계산돼 환불 금액이 줄어요."를 확인받는다.

- [ ] **Step 1: 시험 작성**
  - `tests/certificates.test.ts`
    - `79% → 409`, `80% → issued SOC-2026-000001`, `issue twice same number`
  - `tests/classroom.test.ts`
    - `buckets`: 완강 강의는 completed, 만료는 expired
    - `resume is latest lecture`
  - `e2e/learn.spec.ts` `watch, resume, and progress grows`
    - 모의 결제로 산 강의 → 플레이어에서 2배속, 약 10초 재생
    - 진도율 > 0, 새로고침하면 이어보기 위치 > 0
    - 두 번째 브라우저 컨텍스트(다른 기기)에서 재생하면 첫 컨텍스트에 "다른 기기에서 재생을 시작해서"가 보인다
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 13: 질문·답변·후기·1:1 문의·회원 정보

**Files:**
- Create:
  - 서비스: `src/server/qa.ts`, `src/server/reviews.ts`, `src/server/inquiries.ts`(adapt from nubi-tour/src/server/inquiries.ts)
  - API: `src/app/api/questions/{route,[id]/answers/route}.ts`, `src/app/api/reviews/route.ts`, `src/app/api/inquiries/route.ts`, `src/app/api/me/route.ts`(PATCH 회원 정보)
  - 화면: `src/app/(site)/my/{questions,inquiries,profile}/page.tsx`, `src/app/(site)/support/inquiry/page.tsx`
  - 시험: `tests/qa.test.ts`, `tests/reviews.test.ts`

**Interfaces:**
- Consumes: Task 6 `questionOverdue`, Task 10 `canReview`, Task 3 `enforceLimit(write)`
- Produces:
  - 질문·답변
    - `askQuestion(userId, {lecture_id, title, body}, now)`: 수강권이 있어야 한다. 제한은 write다.
    - `answerQuestion(author: {kind:'instructor'|'staff'; id}, questionId, body, now)`: 강사는 자기 강의만 답할 수 있고, 아니면 403이다. 답하면 `answered_at`을 넣고 질문자에게 메시지를 남긴다.
    - `listQuestions(filter: {courseIds?; unansweredOnly?}, now): Promise<(Question & {overdue: boolean})[]>`
  - 후기
    - `writeReview(userId, courseCode, {rating 1..5, body 10..1000}, now)`: 진도 40% 미만이면 403 `REVIEW_TOO_EARLY` "진도율 40%부터 후기를 쓸 수 있어요.", 두 번째면 409. 쓰면 `rating_avg`·`rating_count`를 다시 계산한다.
    - `hideReview(staffId, id, hidden)`: 평점을 다시 계산한다.
  - 문의: `createInquiry(userId, {category:'payment'|'refund'|'player'|'subscription'|'live'|'etc', title, body})`, `answerInquiry(actor, id, answer)`

- [ ] **Step 1: 시험 작성**
  - `tests/qa.test.ts`
    - `ask needs enrollment 403`
    - `instructor answers own only`
    - `overdue flag after 7 days`
    - `answer clears overdue`
    - `11th question in 10 min → 429`
  - `tests/reviews.test.ts`
    - `39% → 403`, `40% → ok`, `second 409`
    - `rating avg recalculated on hide`: 5점·1점 → 3.0, 1점 숨김 → 5.0, `rating_count` 1
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.** 상세 화면 후기 정렬은 최신·높은 별점·낮은 별점이다.
- [ ] **Step 4: 커밋·push → CI 초록. M4 PR 머지를 기다린다.**

---

## 마일스톤 5 — 구독·라이브 (브랜치 `feat/m5-subscriptions-live`)

### Task 14: 규칙 — 구독 청구 일정·일시정지 (순수 함수)

**Files:**
- Create: `src/rules/billing.ts`, `tests/rules/billing.test.ts`

**Interfaces (Produces):**
- 상수: `RENEW_BEFORE_MS = 24*3600_000`, `RETRY_DAYS = [1,3,5]`, `MAX_FAILURES = 4`, `PAUSE_MAX_DAYS = 30`, `PAUSES_PER_YEAR = 2`
- `periodEnd(start: Date, interval:'month'|'year'): Date`. `addMonthsClamped(start, 1|12)`을 쓴다.
- `renewalDue(period_end: Date, now: Date): boolean`(`now ≥ period_end − 24h`)
- `afterFailure(failure_count_after: number, first_failed_at: Date): {status:'past_due'; next_retry_at: Date} | {status:'expired'}`. 실패 1·2·3회면 `first_failed_at + RETRY_DAYS[n−1]`일 뒤에 다시 하고, 4회면 expired다.
- `canPause(pauses: {start: Date; days: number}[], days: number, now: Date): {ok: true} | {ok: false; reason_ko: string}`
  - `days`가 1~30 밖이면 `"일시정지는 1~30일 사이로 정해 주세요."`
  - 최근 365일 안에 2번이면 `"일시정지는 1년에 2번까지 할 수 있어요."`
- `resumeEarly(period_end: Date, paused_until: Date, now: Date): Date`(남은 온전한 날 수 `floor((paused_until − now)/1일)`만큼 당긴다)

- [ ] **Step 1: 시험 작성** `tests/rules/billing.test.ts`
  - `month end clamp`: start `2026-01-31T03:00Z` → `2026-02-28T03:00Z`
  - `year`: `2028-02-29` → `2029-02-28`
  - `renewalDue`: end − 24h − 1ms → false, end − 24h → true
  - `failure schedule`: first `2026-12-01T00:00Z`
    - count 1 → `2026-12-02T00:00Z`
    - count 2 → `2026-12-04T00:00Z`
    - count 3 → `2026-12-06T00:00Z`
    - count 4 → `{status:'expired'}`
  - `pause limits`: 31일 거부. 최근 365일에 2번이면 거부. 366일 전 1번 + 최근 1번이면 허용.
  - `resume early`: 10일 정지 중 3일 만에 풀면 end를 7일 당긴다
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 15: 구독 서비스·갱신 작업·마이페이지 구독

**Files:**
- Create:
  - 서비스: `src/server/subscriptions.ts`
  - API: `src/app/api/subscriptions/{route,[id]/cancel,[id]/resume-cancel,[id]/pause,[id]/resume,[id]/card,[id]/refund}/route.ts`
  - 화면: `src/app/(site)/subscribe/checkout/page.tsx`, `src/app/(site)/my/subscription/page.tsx`
  - 시험: `tests/subscriptions.test.ts`
- Modify:
  - `src/server/jobs/tasks.ts`(`renewSubscriptions`·`retryFailedInvoices`·`endSubscriptions`·`resumePaused` 추가)
  - `src/server/refunds.ts`(구독 환불: `requestSubscriptionRefund`, `approveRefund`가 invoice 대상도 처리)
  - `src/server/learning-usage.ts`(`subscriptionWatchedSec(subId, from, to)`)

**Interfaces:**
- Consumes: Task 14 전부, Task 8 `prepareInvoicePayment`·`mockPayInvoice`·`onInvoicePaid`(여기서 구현: 청구 `paid` → 구독 `active`, 기간 설정)·`chargeMockInvoice`·`refundPayments`, Task 6 `subscriptionRefund`
- Produces:
  - `subscribe(userId, planCode, {card_last4: string}, now): Promise<{subscription; invoice; pay: {orderId; amount}}>`
    - 이미 `active|past_due|paused`면 409 `ALREADY_SUBSCRIBED` "이미 구독 중이에요."
    - 첫 청구는 `pending`이고, 토스나 모의로 결제하면 `active`가 된다
  - 해지 예약·취소: `cancelAtPeriodEnd(userId, subId)`, `undoCancel(userId, subId)`
  - 일시정지: `pause(userId, subId, days, now)`, `resume(userId, subId, now)`
  - 카드 바꾸기: `changeCard(userId, subId, last4)`. `past_due`면 바로 재시도한다.
  - `renewSubscriptions(now): Promise<number>`
    - 대상: `active`이고 `!cancel_at_period_end`이고 `renewalDue`인 구독
    - 새 기간 청구를 `INSERT … ON CONFLICT (subscription_id, period_start) DO NOTHING`으로 만들고, 만든 행만 청구한다
    - 성공하면 새 기간으로 넘기고 메시지를 남긴다
    - 실패하면 `past_due`, `failure_count = 1`, `next_retry_at`
  - `retryFailedInvoices(now)`: `afterFailure`를 따른다. 4회째 실패면 `expired` + 구독 수강권 `expired` + 메시지 "결제가 세 번 더 실패해서 구독이 끝났어요. 진도는 남아 있어 다시 구독하면 이어서 볼 수 있어요."
  - `endSubscriptions(now)`: 기간이 끝난 해지 예약 → `cancelled` + 구독 수강권 `expired`
  - `resumePaused(now)`: `paused_until`이 지나면 `active`
  - `retryInvoiceNow(actor, subId, now)`: 직원 화면의 "지금 다시 결제"다. `past_due`일 때만 할 수 있고, 결과는 `afterFailure` 규칙을 그대로 따른다.
  - 상태가 바뀔 때마다 `onSubscriptionStatus(sub, from, to)` 훅을 부른다(Task 25 웹훅)
  - 구독 환불 요청: `requestSubscriptionRefund(userId, subId, reason, now)`(basis는 `subscriptionRefund`, watched는 그 기간 `subscriptionWatchedSec`)

- [ ] **Step 1: 시험 작성** `tests/subscriptions.test.ts`
  - `subscribe then mock pay → active, period +1 month`
  - `subscription grants plan courses lazily`: 구독 대상 강의는 `lectureAccess`가 통과하고 수강권 `source subscription`이 생긴다. 대상 아닌 강의는 403이다.
  - `renewal success moves period`
  - `renewal twice → one invoice`(Review Focus 5): `runJobsOnce` 두 번, `Promise.all`로 두 번 → 그 기간 청구 1행, 결제 1행
  - `cancel at period end → no invoice, cancelled at end, enrollments expired, progress kept`
  - `card 4000 → past_due → retries at +1,+3,+5 → expired`. 각 시점 `now`를 주입한다. 4회째 뒤 `expired`, 메시지 1개
  - `past_due keeps access`
  - `retry success keeps cycle`: 새 period_start = 원래 period_end
  - `pause extends period and blocks playback`, `third pause in a year 400`
  - `refund within 7 days no watch → full, subscription cancelled`
  - `refund prorated uses period watch`(watch_events로 만든 3시간 → Task 6 값 19334)
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 16: 라이브 — 예약·입장·채팅·다시보기

**Files:**
- Create:
  - 서비스: `src/server/live.ts`
  - API: `src/app/api/live/[id]/{reserve,enter,chat}/route.ts`, `src/app/api/live/[id]/chat/stream/route.ts`(SSE)
  - 화면: `src/app/(site)/live/{page,[id]/page,[id]/room/page}.tsx`, `src/components/live/{FakeBroadcast,ChatPanel}.tsx`
  - 시험: `tests/live.test.ts`
- Modify: `src/server/jobs/tasks.ts`(`advanceLiveStatus`)

**Interfaces:**
- Produces:
  - `ENTRY_OPENS_BEFORE_MS = 10*60_000`
  - `reserveSeat(userId, sessionId, now): Promise<LiveSeat>`
    - 세션을 잠그고(`FOR UPDATE`), 정원이 차면 409 `LIVE_FULL` "예약이 다 찼어요."
    - 강의에 붙은 세션은 수강권이 있어야 한다
    - 같은 사람이 다시 예약하면 기존 자리를 돌려준다
  - `enterLive(userId, sessionId, now): Promise<{room_url: string}>`
    - 자리가 있어야 한다(없으면 403 `NO_SEAT`)
    - `now < starts_at − 10분`이면 409 `NOT_YET` "입장은 시작 10분 전부터 할 수 있어요."
    - `ended|cancelled`면 409
    - `entered_at`을 넣는다. Task 22가 앞에 대기열 문을 둔다.
  - `postChat(userId, sessionId, body ≤ 200, now)`: 입장한 사람만 쓸 수 있다. 제한은 chat이다.
  - `chatSince(sessionId, afterId|null): Promise<LiveChat[]>`
  - SSE: 2초마다 `chatSince` → `event: chat`, 10초마다 `event: viewers`(최근 60초 하트비트 수), 연결은 최대 5분(브라우저가 다시 붙는다)
  - `advanceLiveStatus(now)`: `scheduled→live`(starts_at), `live→ended`(ends_at)
  - `attachReplay(actor, sessionId, sectionId): Promise<Lecture>`: 길이는 ends−starts, 스크립트는 "다시보기", `replay_lecture_id`에 연결한다

- [ ] **Step 1: 시험 작성** `tests/live.test.ts`
  - `capacity 300 concurrent`: 정원 2에 `Promise.all` 세 명 → 2 성공, 1 `LIVE_FULL`
  - `course live needs enrollment`
  - `enter 11 min before → NOT_YET, 10 min before → ok`
  - `chat only after enter`, `chatSince returns after id`
  - `status advances by job`
  - `replay attaches lecture with duration`
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록. M5 PR 머지를 기다린다.**

---

## 마일스톤 6 — 강사 화면·정산·직원 관리 (브랜치 `feat/m6-portal-admin`)

### Task 17: 정산 — 규칙과 월 작업

**Files:**
- Create: `src/rules/settlement.ts`, `src/server/settlements.ts`, `tests/rules/settlement.test.ts`, `tests/settlements.test.ts`
- Modify: `src/server/jobs/tasks.ts`(`monthlySettlement`: KST 매월 1일에 전월분을 계산하고, 이미 있는 `draft`는 다시 계산하고, `confirmed`는 건드리지 않는다)

**Interfaces (Produces):**
- `rules/settlement.ts`
  - 상수: `SALE_RATE = 0.7`, `REFERRAL_RATE = 0.9`, `SUBSCRIPTION_SHARE = 0.5`, `PAY_DAY = 10`
  - `settle(i: {sales: {amount: number; referral: boolean}[]; refunds: {amount: number; rate: number}[]; pool: number; instructor_sec: number; total_sec: number; carried_in: number}): {sales_amount; sales_share; referral_amount; referral_share; subscription_share; refund_deduction; carried_in; total; payout; carry_out}`
  - 계산
    - 판매 줄마다 `floor(amount × rate)`
    - `subscription_share = total_sec ? floor(pool × 0.5 × instructor_sec / total_sec) : 0`
    - `refund_deduction = Σ floor(amount × rate)`
    - `total = sales_share + referral_share + subscription_share − refund_deduction + carried_in`(carried_in ≤ 0)
    - `payout = max(0,total)`, `carry_out = min(0,total)`
  - `payDate(month): string`: 다음 달 10일, `YYYY-MM-DD`
- `server/settlements.ts`
  - `computeMonth(month: 'YYYY-MM', now): Promise<number>`
    - `kstMonthRange`로 승인 결제·완료 환불을 모은다
    - 패키지 항목은 `allocate(paid, 묶음 강의 정가)`로 강사별로 나눈다
    - 추천 판정은 주문 쿠폰이 `referral`이고 `instructor_id`가 그 강의 강사일 때다
    - 구독 풀과 강사별 `added_sec`를 모은다
    - `settlements`·`settlement_lines`를 upsert하고(`draft`만), 계산한 강사 수를 돌려준다
  - `confirmSettlement(staffId, id)`: admin만 할 수 있고 감사 기록을 남긴다. 확정 뒤 다시 계산하면 건너뛴다.
  - `instructorSettlements(instructorId)`

- [ ] **Step 1: 시험 작성**
  - `tests/rules/settlement.test.ts`
    - `sales 70% / referral 90%`: 판매 `[99000(일반), 50000(추천)]` → `sales_share 69300`, `referral_share 45000`
    - `subscription share`: pool 1,000,000, 강사 3,600초 / 전체 36,000초 → 50000
    - `zero total_sec → 0`
    - `refund deduction at original rate`: 환불 99,000 @0.7 → 69300 차감
    - `negative carries`: 판매 0, 환불 69,300 차감 → `payout 0`, `carry_out −69300`. 다음 달 carried_in으로 들어간다.
    - `payDate("2026-11") === "2026-12-10"`
  - `tests/settlements.test.ts`
    - `month boundary is KST`(Review Focus 4): approved_at `2026-11-30T15:30Z` 판매는 `computeMonth("2026-12")`에 들어가고 "2026-11"에는 없다
    - `bundle split by list price`: 강사 A 강의 정가 60,000, B 40,000, 패키지 paid 80,000 → A 몫 기준 48,000, B 32,000
    - `referral only own course`: A의 추천 코드로 B 강의를 사면 B는 70%
    - `refund in refund month`: 11월 판매를 12월에 환불하면 12월 정산에서 차감되고 11월은 그대로
    - `recompute draft idempotent`: 두 번 계산해도 줄 수가 같다
    - `confirmed untouched`
    - `cs cannot confirm 403`
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 18: 강사 화면 (`/instructor`)

**Files:**
- Create:
  - 서비스·규칙: `src/server/instructor.ts`, `src/rules/analytics.ts`
  - 화면: `src/app/instructor/(portal)/{layout,page}.tsx`, `src/app/instructor/(portal)/courses/{page,new/page,[code]/page}.tsx`, `src/app/instructor/(portal)/{questions,settlements,referral}/page.tsx`
  - API: `src/app/api/instructor/courses/{route,[code]/route,[code]/submit/route}.ts`, `src/app/api/instructor/referral/route.ts`
  - 시험: `tests/rules/analytics.test.ts`, `tests/instructor.test.ts`

**Interfaces:**
- Produces:
  - 분석 규칙
    - `dropoff(lectureIds: string[], students: {started: Set<string>; completed: boolean}[]): {lecture_id; started: number; dropped: number; ratio: number}[]`("이 계획이 정한 것"의 정의)
    - `completionRate(ratios: number[]): number`(≥ 0.8인 비율)
  - `instructorDashboard(instructorId, now): Promise<{students; month_revenue; expected_payout; courses: {code, title, completion_rate, rating_avg}[]; dropoff_by_course; unanswered: (Question & {overdue})[]}>`. expected_payout은 이번 달 `computeMonth`를 미리 보기로 계산한 값이다(저장하지 않음).
  - 강의 만들기·고치기: `upsertCourseDraft(instructorId, input)`
    - 섹션·강·길이·스크립트를 함께 저장한다
    - `published` 강의에서 제목·부제·소개·가격·할인을 고치면 바로 반영한다. 섹션·강을 고치면 강의가 `in_review`로 바뀌어 승인 때까지 목록에서 빠진다. 공개본과 변경본을 나눠 저장하지 않는 단순화다. 저장 전에 "커리큘럼을 고치면 심사가 끝날 때까지 강의가 목록에서 빠져요."로 확인받는다. 이미 산 수강생의 재생은 막지 않는다.
    - 남의 강의는 404다
  - 심사 요청: `submitForReview(instructorId, code)`. `draft|rejected`만 `in_review`로 바꿀 수 있고, 강이 하나도 없으면 400이다.
  - 추천 코드: `createReferralCoupon(instructorId)`. 코드는 `REF-<slug>`, 정률 10%, 강사마다 하나(멱등)다.

- [ ] **Step 1: 시험 작성**
  - `tests/rules/analytics.test.ts`
    - 강 `[a,b,c]`, 수강생 5명: started `{a}`, `{a}`, `{a,b}`, `{a,b,c}`(완강), `{a,b,c}`(미완)
    - 결과: a dropped 2/5, b 1/3, c 1/2
  - `tests/instructor.test.ts`
    - `other instructor's course 404`
    - `submit empty course 400`
    - `submit → in_review`
    - `dashboard unanswered overdue flag`
    - `referral idempotent`
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.** 모든 강사 화면에 `DemoBadge`를 단다.
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 19: 직원 관리 화면 (`/admin`)

**Files:**
- Create:
  - 공통 (copy and adapt from nubi-tour/<같은 경로>): `src/components/admin/ui.tsx`, `src/app/admin/actions.ts`, `src/server/apikeys.ts`(아래 변경)
  - 콘솔 화면 `src/app/admin/(console)/…`
    - `layout.tsx`, `page.tsx`(대시보드)
    - `reviews-queue/page.tsx`(강의 심사), `courses/{page,[code]/page}.tsx`, `bundles`, `plans`, `coupons`
    - `orders/{page,[code]/page}.tsx`, `refunds/{page,[id]/page}.tsx`(계산기), `subscriptions`
    - `students/[id]/page.tsx`, `instructors/{page,[id]/page}.tsx`, `settlements`, `live`
    - `inquiries`, `questions`, `reviews`, `notices`, `faqs`, `messages`, `staff`, `api-keys`, `audit`
  - 서비스·API: `src/server/admin.ts`, `src/app/api/admin/**/route.ts`
  - 시험: `tests/admin.test.ts`, `e2e/admin.spec.ts`

**Interfaces:**
- Consumes: Task 3 `requireStaff(req, perm)`, Task 9 `approveRefund`/`rejectRefund`, Task 6 `courseRefundMethods`, Task 11 `revokeDevice`, Task 15 구독 동작, Task 16 `attachReplay`, Task 17 `confirmSettlement`
- Produces:
  - `dashboardCounts(now): Promise<{today_sales; today_orders; refund_requests; new_subscriptions; cancellations; payment_failures; unanswered_questions; open_inquiries; overdue_refunds}>`(오늘 = KST 날짜)
  - 강의 심사: `approveCourse(staffId, code)`(`in_review → published`, `published_at`), `rejectCourse(staffId, code, reason)`(사유 필수, 강사에게 메시지)
  - `refundCalculator(refundId, now): Promise<{progress_based; period_based; applied; basis_ko}>`
  - API 키
    - `issueApiKey(name, scopes: ('read'|'read_pii'|'write'|'metrics')[], createdBy)`(접두사 `sok_`)
    - `authApiKey(req, need: 'read'|'write'|'metrics')`. `metrics`는 `metrics` 범위만 통과한다.
  - 모든 쓰기는 `audit`를 남긴다. 직원·API 키·감사 기록 화면은 `admin`만 쓸 수 있다.
  - 대시보드의 작은 그래프 자리(동시 재생·대기열·오류율)는 Task 20이 채운다.

- [ ] **Step 1: 시험 작성**
  - `tests/admin.test.ts`
    - `approve course publishes`, `reject needs reason`
    - `calculator side by side`: Task 6 `methods side by side` 값과 같다
    - `perm matrix via routes`: `content`가 환불 승인 API → 403, `cs`가 강의 승인 → 403, `cs`가 API 키 발급 → 403
    - `dashboardCounts`: 만든 데이터와 같다(KST 오늘 경계)
    - `api key metrics scope`: `read` 키로 `authApiKey(req,'metrics')` → 403
    - `revoke device from admin`: 감사 기록 1
  - `e2e/admin.spec.ts` `staff approves refund`: 이 테스트가 먼저 API로 가입·주문·모의 결제·환불 신청을 만든다 → 시드 관리자로 로그인 → 환불 목록에서 그 신청 → 계산기에 진도 방식·경과일 방식 두 값 표시 → 승인 → 상태 "환불 완료"
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록. M6 PR 머지를 기다린다.**

---

## 마일스톤 7 — 안 터지는 운영·외부 API·배포 (브랜치 `feat/m7-resilience`)

### Task 20: 지표·상태 페이지·장애 공지

**Files:**
- Create:
  - 지표: `src/server/metrics.ts`, `src/app/metrics/route.ts`
  - 상태 페이지·장애 공지: `src/server/status.ts`, `src/app/(site)/status/page.tsx`, `src/app/admin/(console)/ops/{page,incidents/page}.tsx`
  - 시험: `tests/metrics.test.ts`, `tests/status.test.ts`
- Modify:
  - `src/server/http.ts`(`route(fn, opts?: {group?: string})`가 경로 묶음·상태·시간을 기록)
  - `src/server/db.ts`(`log: [{emit:'event', level:'query'}]`, 500ms 이상이면 느린 쿼리로 센다)
  - 훅 채우기: `src/server/payments/index.ts`, `src/server/jobs/lock.ts`
  - `src/app/admin/(console)/page.tsx`(작은 그래프)

**Interfaces (Produces):**
- `routeGroup(pathname): string`: 숫자·id·코드 조각을 `:id`로 바꾼다(예: `/api/player/lectures/:id/download`).
- `route()`는 `x-request-id`를 받거나 새로 만들어 응답 헤더에 넣는다. 요청마다 JSON 한 줄 `{msg:"요청", req_id, group, method, status, ms}`를 남긴다. 쿠키·쿼리 문자열·본문은 넣지 않는다.
- 기록 함수: `recordRequest(group, method, status, ms)`, `incPayment(method, ok)`, `observeJob(name, ms)`, `incSlowQuery()`
- `renderMetrics(now): Promise<string>`. Prometheus 텍스트이고 접두사는 `studyon_`이다.
  - `http_requests_total{group,method,status}`
  - `http_request_duration_seconds_bucket{group,le}`(le `0.05,0.1,0.25,0.5,1,2.5,5,10,+Inf`) + `_sum`·`_count`
  - `active_playbacks`, `queue_waiting{target}`, `queue_admitted_total{target}`
  - `payment_attempts_total{method}`, `payment_failures_total{method}`
  - `db_connections`(`pg_stat_activity` 현재 DB), `db_slow_queries_total`, `job_duration_seconds{job}`
- `recentWindow(now): {error_rate: number; p95_ms: number; rps: number}`: 최근 60초 링 버퍼다. 직원 화면 그래프용으로 1분 단위 60개를 보관한다.
- `GET /metrics`: `authApiKey(req,'metrics')`가 필요하고, 없으면 401이다.
- `componentStatus(now): Promise<{component: 'web'|'player'|'payments'|'live'|'api'; status: 'operational'|'degraded'|'outage'; incident?}[]>`. 열린 장애 공지의 가장 나쁜 severity를 쓰고, DB가 안 되면 모두 `outage`다.
- 장애 공지 쓰기: `createIncident(actor, …)`, `updateIncident(actor, id, {status, body})`. 감사 기록을 남긴다.
- 상태 페이지 문구: `정상이에요`·`느려요`·`장애가 있어요`

- [ ] **Step 1: 시험 작성**
  - `tests/metrics.test.ts`
    - `routeGroup('/api/player/lectures/clx123/download') === '/api/player/lectures/:id/download'`
    - `histogram buckets cumulative`: 30ms·300ms·3s 기록 → `le="0.05"` 1, `le="0.5"` 2, `le="+Inf"` 3, `_count` 3
    - `5xx counted`
    - `/metrics 401 without key, 200 with metrics scope, text contains studyon_active_playbacks`
    - `no PII in metrics`: 출력에 `@`가 없다
    - `request log line`: 잡아 둔 `console.log` 한 줄에 `req_id`·`group`·`status`가 있고, `cookie`·`?` 쿼리가 없다. 응답 헤더 `x-request-id`도 같은 값이다.
  - `tests/status.test.ts`
    - `open outage incident on payments → payments outage, others operational`
    - `resolved incident ignored`
    - `/status renders without login`
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 21: 단계별 서비스 모드·장애 주입

**Files:**
- Create:
  - 규칙·서비스: `src/rules/servicemode.ts`, `src/server/servicemode.ts`, `src/server/faults.ts`
  - 화면: `src/components/ModeBanner.tsx`, `src/app/(site)/maintenance/page.tsx`, `src/app/admin/(console)/ops/{mode,faults}/page.tsx`
  - 시험: `tests/rules/servicemode.test.ts`, `tests/servicemode.test.ts`, `tests/faults.test.ts`
- Modify:
  - `src/server/http.ts`(`route(fn, {feature})`가 `guardMode`와 장애 주입을 먼저 부른다)
  - 레이아웃: `src/app/(site)/layout.tsx`(배너, maintenance면 직원이 아닐 때 점검 화면)
  - 목록 캐시: `src/server/catalog.ts`(`listCacheTtlSec(mode)`: normal 30, degraded 300)
  - `src/app/readyz/route.ts`(DB 지연 주입)
  - 화면 쓰기 API 전부에 `feature`를 붙인다. 표는 아래와 같다.

**Interfaces (Produces):**
- `type Feature = 'browse'|'auth'|'play'|'write'|'heavy'`
- `allows(mode, feature): boolean`
  - `normal`: 모두
  - `degraded`: heavy만 막는다
  - `read_only`: write·heavy를 막는다(browse·auth·play 허용)
  - `maintenance`: 모두 막는다(직원은 guard를 건너뛴다)
- `suggestMode(w: {error_rate; p95_ms}): 'degraded'|'read_only'|null`("이 계획이 정한 것"의 기준)
- 기능 분류
  - heavy: 추천("함께 보면 좋은 강의"), 검색 자동완성 `/api/search/suggest`, 후기 쓰기
  - write: 가입, 주문, 결제, 구독, 환불 신청, 질문·답변, 문의, 노트, 라이브 예약·채팅
  - play: 재생 시작·하트비트, 라이브 입장
  - auth: 로그인·로그아웃
- `currentMode(): Promise<{mode; changed_by; reason; at}>`(메모리 5초 캐시)
- `setMode(actor, mode, reason)`: 사유는 필수다. 행을 쌓고, 감사 기록을 남기고, 공지 배너를 띄우고, `onModeChanged`(웹훅 훅)를 부른다.
- `guardMode(feature, isStaff=false)`: 막히면 503 `SERVICE_MODE`. 문구:
  - degraded: "지금은 접속이 많아 이 기능을 잠시 쉬고 있어요."
  - read_only: "지금은 결제·가입·글쓰기를 잠시 막았어요. 수강은 그대로 할 수 있어요."
  - maintenance: "점검 중이에요. 잠시 후 다시 와 주세요."
- 장애 주입
  - `faultsEnabled(): boolean`(env `FAULTS_ENABLED`)
  - `getFaults(): Promise<FaultSet>`(5초 캐시. env가 false면 항상 빈 값)
  - `roll(rate: number, rand = Math.random): boolean`
  - `injectBefore(req, feature)`
    - `db_delay_ms`: sleep. 500ms 이상이면 `incSlowQuery`
    - `path_delay`: `{prefix, ms}`
    - `login_5xx_rate`: 로그인 경로에서 503
    - `heartbeat_error_rate`: 하트비트에서 500
  - `payment_fail_rate`: `chargeMockInvoice`·`mockPay`에서 실패 처리
  - `setFault(staffId, key, {enabled, value})`: admin만 할 수 있고 감사 기록을 남긴다. env가 false면 404다.

- [ ] **Step 1: 시험 작성**
  - `tests/rules/servicemode.test.ts`
    - 모드 4 × 기능 5 표 전체를 단언한다
    - `suggestMode({error_rate:0.05,p95_ms:0}) === 'degraded'`, `({0.2,0}) === 'read_only'`, `({0.01,1499}) === null`, `({0,1500}) === 'degraded'`
  - `tests/servicemode.test.ts`
    - `read_only blocks order 503 but heartbeat ok`
    - `degraded blocks review write`
    - `maintenance blocks login but staff passes`
    - `setMode needs reason`, `audit row per change`
  - `tests/faults.test.ts`
    - `env false → faults inert and API 404`
    - `login_5xx_rate 1 → 503`
    - `roll(0.3, ()=>0.29) true / ()=>0.3 false`
    - `payment_fail_rate 1 → mockPay fails, payment_failures_total +1`
    - `db_delay_ms 600 → readyz ≥ 600ms and slow query counted`
    - `non-admin 403`
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 22: 대기열 (가상 대기실)

**Files:**
- Create:
  - 규칙·서비스: `src/rules/queue.ts`, `src/server/queue.ts`
  - API: `src/app/api/queue/{join,[ticketId]}/route.ts`
  - 화면: `src/app/(site)/waiting/page.tsx`, `src/app/admin/(console)/ops/queue/page.tsx`
  - 시험: `tests/rules/queue.test.ts`, `tests/queue.test.ts`, `e2e/queue.spec.ts`
- Modify:
  - 사이트 문: `src/app/(site)/layout.tsx`
  - 결제 캠페인 문: `src/app/(site)/checkout/[code]/page.tsx`, `src/app/api/orders/route.ts`(`price_at` = 마감 연장)
  - 라이브 문: `src/server/live.ts`(`enterLive`)
  - `src/server/jobs/tasks.ts`(`queueHousekeeping`: 60초 미접속 대기표 만료, 라이브 대기열 자동 켜기·끄기)

**Interfaces (Produces):**
- `rules/queue.ts`
  - `admitCount(last_admit_at_ms: number, now_ms: number, rate_per_sec: number, waiting: number, burst_sec = 10): {n: number; next_last_admit_at_ms: number}`
  - `etaSeconds(ahead: number, rate_per_sec: number): number` = `ceil(ahead / rate)`
- `server/queue.ts`
  - `type Target = 'site' | \`checkout:${string}\` | \`live:${string}\``
  - 설정: `getSetting(target)`(메모리 2초 캐시), `updateSetting(staffId, target, {enabled, rate_per_sec ≥ 1, course_codes?})`(감사 기록)
  - `gate(req, target, now): Promise<{pass: true} | {pass: false; ticket_id: string}>`
    - 대기열이 꺼져 있거나 서명이 맞는 `so_q_<target>` 쿠키가 기한 안이면 통과다
    - 그 밖에는 `join`해서 바로 입장되면 쿠키를 붙여 통과하고, 아니면 대기표를 준다
  - `join(target, now): Promise<QueueTicket>`: `next_seq`를 원자적으로 늘린다
  - `poll(ticketId, now): Promise<{status; ahead: number; eta_sec: number; admit_token?: string}>`
    - `advance`를 부르고 `last_seen_at`을 갱신한다
    - 입장이 허용되면 `admit_token`을 준다. 응답이 `Set-Cookie so_q_<target>`(HttpOnly, 600초)을 붙인다.
  - `advance(target, now)`: 트랜잭션에서 `pg_advisory_xact_lock(hashtext('queue:'+target))`를 잡는다 → `admitCount` → 가장 오래된 `waiting` n개를 `admitted`로(`ORDER BY seq LIMIT n FOR UPDATE SKIP LOCKED`, `expires_at = now + admit_ttl`) → `last_admit_at` 갱신 → 지표 `queue_admitted_total += n`
  - 토큰: `signAdmit(ticketId, target, exp)` / `verifyAdmit(token, target, now)`(HMAC-SHA256, `SESSION_SECRET`)
  - `queueStats(target): Promise<{waiting; avg_wait_sec; admitted_last_min}>`
- 대기 화면: 내 순번(앞사람 수), 예상 대기 시간, 3초마다 자동 새로고침, 입장되면 `next`로 보낸다. 문구는 "지금 접속이 많아 순서대로 들어가고 있어요. 이 화면을 닫지 말아 주세요."
- 사이트 문 예외 경로: `/waiting`, `/status`, `/maintenance`, `/api/queue/*`, `/api/player/*`, `/healthz`, `/readyz`, `/metrics`, `/admin*`, `/instructor*`

입장 수 계산(시그니처로 정해지지 않음):
```ts
export function admitCount(last: number, now: number, rate: number, waiting: number, burstSec = 10) {
  const from = Math.max(last, now - burstSec * 1000); // 오래 쉬었어도 한 번에 burst초 몫까지만
  const n = Math.min(waiting, Math.floor(((now - from) / 1000) * rate));
  // 기다리는 사람이 남으면 쓴 몫만큼만 시계를 앞으로(나머지 소수 몫 보존), 다 들였으면 지금으로
  const next = waiting > n ? from + (n / rate) * 1000 : now;
  return { n, next_last_admit_at_ms: next };
}
```
바로 입장(대기자 0)은 `admitCount(last, now, rate, 1)`이 1이면 통과시키는 것과 같다. 그래서 초당 한도를 넘는 순간부터 순번표가 나간다.

- [ ] **Step 1: 시험 작성**
  - `tests/rules/queue.test.ts`
    - `rate 10, 1s elapsed, 100 waiting → n 10`
    - `0.25s, rate 10 → n 2, clock advances 200ms`(소수 몫 보존: 다음 0.05초 뒤 호출에서 n 1)
    - `burst cap`: 1시간 쉼, rate 10, 대기 1000 → n 100
    - `all admitted → next = now`
    - `etaSeconds(25, 10) === 3`
  - `tests/queue.test.ts`
    - `disabled passes`
    - `over rate gets ticket`: rate 1에 `join` 5개를 같은 시각에 → 1개 바로 입장, 4개 waiting, ahead `0,1,2,3`
    - `poll admits in order`: 2초 뒤 poll → seq 2·3 admitted
    - `concurrent advance no double admit`: `Promise.all` advance 5번 → admitted 합이 `admitCount` 결과와 같다
    - `forged cookie rejected`
    - `expired admit token re-queues`
    - `stale ticket expires after 60s`
    - `deadline extension`: 할인 마감 1분 전 발급된 checkout 표로 마감 20분 뒤 주문 → 할인가, 마감 31분 뒤 → 정가
    - `live auto-enabled 10 min before`
  - `e2e/queue.spec.ts` `waiting room admits`: 관리자 API로 site 대기열 rate 1 → 컨텍스트 3개가 동시에 `/` → 적어도 하나가 "순서대로 들어가고 있어요"를 보고 → 몇 초 안에 메인으로 넘어간다. 끝나면 대기열을 끈다.
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 23: 부하 시험 스크립트

**Files:**
- Create:
  - 스크립트: `scripts/load/{common.mjs,summary.mjs,morning-login.mjs,checkout-rush.mjs,live-entry.mjs}`, `scripts/load/seed-load-users.ts`, `scripts/load/README.md`
  - 시험: `tests/load-summary.test.ts`
- Modify: `package.json`(devDependency `autocannon@^8`, scripts `load:login|load:checkout|load:live|load:users`)

**Interfaces (Produces):**
- `seed-load-users.ts --count 500`: `load-0001@studyon.test`… 계정을 만든다. 비밀번호는 env `LOAD_USER_PASSWORD`로 받고 없으면 거부한다. 일부에게 모의 결제한 강의와 라이브 자리를 준다.
- 공통 옵션 `--base http://127.0.0.1:3200 --connections 100 --duration 30`
  - 요청마다 `X-Forwarded-For`에 다른 사설 주소(`10.x.x.x`)를 넣는다. 여러 사람처럼 보이게 하는 것이고, nginx 뒤에서는 nginx 값이 붙는다.
- 시나리오 세 가지
  - `morning-login`: 로그인 → 내 강의실 → 재생 시작 → 하트비트 2번
  - `checkout-rush`: 대기열 `checkout:<slug>` join·poll → 주문 → 모의 결제
  - `live-entry`: 예약자 전원이 시작 시각에 `enter`(대기열) → 채팅 1번
- `summarize(results): {scenario; requests; rps; p50_ms; p95_ms; p99_ms; s2xx; s429; s503; s5xx; queued}`
  - `printTable(rows)`로 `console.table`에 낸다
  - 끝에 `/metrics`(env `LOAD_METRICS_KEY`가 있을 때)의 `studyon_queue_waiting`·`studyon_active_playbacks`를 덧붙인다

- [ ] **Step 1: 시험 작성** `tests/load-summary.test.ts`
  - `summarize`: autocannon 결과 모양의 고정 객체 → p95·429 수·rps가 맞다
  - `no secrets in output`: 출력 문자열에 비밀번호 값이 없다
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.** 스크립트는 CI에서 돌리지 않는다. README에 순서를 적는다: 대기열 켜기 → 시나리오 → 결과 표 읽는 법.
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 24: 외부 시스템 API v1·OpenAPI

**Files:**
- Create:
  - 공통 (copy and adapt from nubi-tour/src/server/v1/{paginate,serialize,openapi}.ts): `src/server/v1/{paginate,serialize,openapi}.ts`
  - 읽기 경로 `src/app/api/v1/…`: `courses`, `instructors`, `orders`, `orders/[code]`, `payments`, `refunds`, `subscriptions`, `enrollments`, `progress`, `inquiries`(각 `route.ts`)
  - 쓰기 경로: `inquiries/[id]/answer`, `coupons`(POST), `service-mode`(POST), `incidents`(POST)
  - 문서·시험: `src/app/api/v1/openapi.json/route.ts`, `tests/v1.test.ts`

**Interfaces (Produces):**
- 목록은 누비투어와 같다. `?updated_since&cursor&limit(1..200, 기본 50)` → `{data, next_cursor}`, 정렬은 `updated_at, id` 오름차순이다.
- `read`는 이름 `maskKo`(`김*진`), 전화 `010-****-1234`, 이메일 `k***@example.com`으로 가린다. `read_pii`는 원문이다. 비밀번호 해시·세션·기기 키·카드 정보(끝 4자리 말고)는 어느 범위에도 나가지 않는다.
- 진도 요약: `progress`는 수강권마다 `{enrollment_id, course_code, user_id, progress_ratio, completed, last_watched_at}`다.
- 쓰기 경로는 Task 13 `answerInquiry`, 쿠폰 만들기(referral 불가), Task 21 `setMode`(reason 필수), Task 20 `createIncident`를 부른다. actor는 `api:<키 이름>`이다.
- `OPENAPI`: 제목은 "스터디온에듀 외부 시스템 API"다. 모든 v1 경로와 `/metrics`를 담는다.

- [ ] **Step 1: 시험 작성** `tests/v1.test.ts`(adapt from nubi-tour/tests/v1.test.ts)
  - `401 without key / revoked`, `read key cannot write 403`, `metrics key cannot read 403`
  - `read masks PII`: 응답 JSON에 원문 이름·전화·이메일이 없다(정규식)
  - `read_pii shows raw`
  - `never leaks secrets`: 어떤 응답에도 `password_hash`·`device_key`·`token`이 없다
  - `cursor pages`: 3쪽에 걸쳐 읽은 합 = 총 수이고 중복이 없다
  - `service-mode via API needs reason, writes audit api:<name>`
  - `openapi covers every route file`: `src/app/api/v1/**/route.ts`를 모두 OPENAPI.paths에서 찾는다(누비투어 시험 방식)
  - `600/min limit → 429`
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 25: 웹훅

**Files:**
- Create:
  - 서비스·화면: `src/server/webhooks.ts`, `src/app/admin/(console)/webhooks/page.tsx`, `src/app/api/admin/webhooks/{route,[id]/route,[id]/test/route}.ts`
  - 시험: `tests/webhooks.test.ts`
- Modify: 훅 자리를 `emitEvent`로 채운다.
  - `src/server/payments/index.ts`(주문 결제)
  - `src/server/refunds.ts`(환불 완료)
  - `src/server/subscriptions.ts`(`onSubscriptionStatus`)
  - `src/server/servicemode.ts`(`onModeChanged`)
  - `src/server/jobs/tasks.ts`(`deliverWebhooks`)

**Interfaces (Produces):**
- 이벤트 종류: `order.paid`, `order.refunded`, `subscription.status_changed`, `service_mode.changed`
- `emitEvent(tx, type, data)`: 그 type을 구독한 활성 주소마다 `webhook_deliveries`를 만든다. 같은 트랜잭션이라 롤백되면 같이 사라진다. 본문은 `{id: evt_<uuid>, type, created_at, data}`이고, data에는 `read` 범위처럼 가린 개인정보만 담는다.
- `deliverWebhooks(now, fetchImpl = fetch): Promise<{sent; failed}>`
  - 대상은 `pending`이고 `next_attempt_at ≤ now`인 것이다. `FOR UPDATE SKIP LOCKED`로 최대 50개를 잡는다.
  - 시간 초과는 5초다.
  - 2xx면 `done`이다. 아니면 `RETRY_MIN = [1,5,30,120,720]` 순서로 다음 시각을 정하고, 6번째 실패면 `failed`다.
- 서명
  - `sign(secret, t, body): string`
  - 헤더 `X-StudyOn-Event: <type>`, `X-StudyOn-Delivery: <delivery id>`, `X-StudyOn-Signature: t=<unix초>,v1=<hex HMAC-SHA256(secret, "${t}.${body}")>`
- 주소 등록: `createEndpoint(staffId, {url (https만, 개발 중에는 http://localhost 허용), events})`
  - secret `whsec_` + 32바이트를 만든다. 원문은 이때 한 번만 보여 주고, 서명에 필요하므로 DB에 저장한다. 로그·목록 화면에는 앞 10자만 낸다.
  - 직원 화면에 "시험 보내기"를 둔다.

- [ ] **Step 1: 시험 작성** `tests/webhooks.test.ts`
  - `paid order enqueues one delivery`
  - `rollback drops delivery`(트랜잭션 안에서 emit 뒤 throw)
  - `signature verifies`: 받은 헤더로 다시 계산한 값이 같다
  - `retry schedule`: 500 응답 → 다음 시도 +1분, +5분 … 6번째 실패 `failed`
  - `two runners deliver once`: `Promise.all(deliverWebhooks)` → fetch 1번
  - `payload masks PII`
  - `secret never logged`: `log` 출력을 잡아 secret이 없는지 본다
- [ ] **Step 2: 시험만 커밋·push → CI 빨강.**
- [ ] **Step 3: 구현.**
- [ ] **Step 4: 커밋·push → CI 초록.**

### Task 26: 배포 문서와 CI `docker` 잡

**Files:**
- Create: `docs/deploy.md`(adapt from nubi-tour/docs/deploy.md)
- Modify:
  - `README.md`(실행·배포·부하 시험·API 링크)
  - `.env.example`(`FAULTS_ENABLED=false`, `SEED_INSTRUCTOR_PASSWORD=`, `NEXT_PUBLIC_HEARTBEAT_SEC=30`, `APP_PORT=3200`, `LOAD_USER_PASSWORD=`, `LOAD_METRICS_KEY=`)
  - `.github/workflows/ci.yml`(잡 `docker`: nubi-tour의 `docker` 잡 adapt. 아래 Step 1)

**Interfaces:** compose는 Task 1과 같다(`db` 바깥 노출 없음, `app` `127.0.0.1:${APP_PORT:-3200}`, healthcheck `/readyz`).

- [ ] **Step 1: CI `docker` 잡 작성.** 순서는 `docker compose up -d --build --wait` → `exec -T app npm run db:seed` → 아래 확인이다. 이 잡이 이 작업의 시험이다.
  - `curl -fsS /healthz`, `/readyz`
  - `/`에 "스터디온에듀"
  - `/courses?category=DEV`에 "SO-DEV-"
  - `/status`에 "정상이에요"
  - `/metrics`는 키 없이 401(`curl -o /dev/null -w '%{http_code}'`가 `401`)
  - 재시작 뒤 데이터 유지
- [ ] **Step 2: 잡만 커밋·push → `docker` 결과 확인.** 앞 작업들로 앱은 이미 있으므로 초록이어도 된다. 빨강이면 compose·entrypoint를 고친다.
- [ ] **Step 3: `docs/deploy.md` 작성.** 누비투어 순서를 그대로 쓴다. 준비 → clone → `.env` 값 설명 → compose → 시드 → nginx 예시(`<서버 주소>` 자리표시자, 실제 주소 금지) → 상태 확인 → 백업 → 업데이트·되돌리기 → 읽기 전용 DB 계정 SQL. 여기에 다음 절을 더한다.
  - **운영 기능**: 지표 키 발급과 Prometheus 설정 예시, 대기열·서비스 모드 쓰는 법
  - **장애 시연**: `FAULTS_ENABLED=true`는 시연 서버에만
  - **부하 시험**: 운영 DB에서 하지 말 것
- [ ] **Step 4: 커밋·push → CI `web`·`e2e`·`docker` 초록. 초안을 풀고 M7 PR 머지를 기다린다.** 그 뒤 `dev → main` PR 하나가 첫 배포본이다. 필수 체크 지정은 예진 님이 한다(spec).

---

## 순서와 의존
M1(1→2→3) → M2(4→5) → M3(6→7→8→9) → M4(10→11→12→13) → M5(14→15→16) → M6(17→18→19) → M7(20→21→22→23→24→25→26).
- Task 8의 지표·장애 훅과 Task 15·21의 웹훅 훅은 빈 자리로 먼저 두고, Task 20·21·25가 채운다.
- Task 19가 `apikeys.ts`를 만들고, Task 20(`/metrics`)·Task 24(v1)가 그것을 쓴다.
- Task 22는 Task 7 `createOrder`의 `price_at`과 Task 16 `enterLive`에 문을 단다.

## spec 대조표 (자체 검토용)
- 수강생 흐름 찾기→맛보기→구매→수강→완강·수료증→후기→환불: Task 5, 7, 8, 11, 12, 13, 9
- 라이브: Task 16, 22
- 강사 화면: Task 18 / 정산: Task 17 / 직원 화면: Task 19
- 운영: 대기열 Task 22, 요청 제한 Task 3(쓰는 곳 7·13·16·24), 서비스 모드 Task 21, 지표·상태 Task 20, 장애 주입 Task 21, 부하 시험 Task 23
- 로그(JSON 한 줄): Task 1. 요청 id는 Task 20 `route()`에서 `x-request-id`를 받거나 만들어 로그에 넣는다.
- 외부 API·웹훅·OpenAPI: Task 24, 25 / 시드: Task 4 / 배포: Task 1, 26
