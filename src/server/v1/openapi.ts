/**
 * 외부 시스템용 API 설명 (OpenAPI 3.1, copy and adapt from nubi-tour/src/server/v1/openapi.ts).
 * 경로를 더하면 여기도 같이 고친다 (tests/v1.test.ts가 route.ts 파일마다 확인한다).
 */
const listParams = [
  { name: "updated_since", in: "query", schema: { type: "string", format: "date-time" }, description: "이 시각 이후 바뀐 것만" },
  { name: "cursor", in: "query", schema: { type: "string" }, description: "앞 응답의 next_cursor" },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
];
const common = {
  "401": { description: "키 없음·틀림·폐기" },
  "403": { description: "범위 부족" },
  "429": { description: "키당 분당 600회 초과 (Retry-After 헤더, error.retry_at)" },
};
const list = (summary: string, extra: object[] = []) => ({
  get: {
    summary,
    security: [{ apiKey: [] }],
    parameters: [...listParams, ...extra],
    responses: { "200": { description: "`{data: [...], next_cursor: string|null}` — updated_at, id 오름차순" }, ...common },
  },
});
const status = (values: string) => [{ name: "status", in: "query", schema: { type: "string" }, description: values }];
const write = (method: "post" | "patch", summary: string, schema: object, ok = "200", params: object[] = []) => ({
  [method]: {
    summary,
    security: [{ apiKey: [] }],
    parameters: params,
    requestBody: { required: true, content: { "application/json": { schema } } },
    responses: { [ok]: { description: "성공" }, "400": { description: "입력 오류 (`{error:{code,message}}`)" }, ...common, "404": { description: "없음" } },
  },
});
const idParam = (name: string) => [{ name, in: "path", required: true, schema: { type: "string" } }];

const MODES = ["normal", "degraded", "read_only", "maintenance"];
const COMPONENTS = ["web", "player", "payments", "live", "api"];

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "스터디온에듀 외부 시스템 API",
    version: "1.0.0",
    description:
      "정산·CRM·운영 관제 같은 외부 시스템이 강의·주문·결제·구독 데이터를 읽고, 운영 손잡이(서비스 모드·장애 공지·대기열)를 당기는 API. " +
      "키 범위: read(개인정보 가림), read_pii(개인정보 원문), write(쓰기), metrics(/metrics만). " +
      "비밀번호 해시·세션·기기 키·결제 키·카드 번호(끝 4자리 말고)는 어떤 범위로도 나가지 않는다. 금액은 원(정수), 시각은 UTC ISO 8601. " +
      "모든 응답에 x-request-id 헤더가 붙는다 (보내면 그대로 쓴다). 웹훅: X-StudyOn-Signature = t=<unix초>,v1=<hex HMAC-SHA256(secret, `${t}.${본문}`)>.",
  },
  components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "API 키 (sok_…). 직원 화면 또는 `npm run apikey`로 발급" } } },
  paths: {
    "/api/v1/courses": list("강의 목록 (status: draft, in_review, published, rejected, hidden)"),
    "/api/v1/instructors": list("강사 목록 (모두 시연용 가상 활동명)"),
    "/api/v1/orders": list("주문 목록 — 환불액 refunded_amount·마지막 환불 시각 refunded_at 포함", status("pending, paid, cancelled, partially_refunded, refunded")),
    "/api/v1/orders/{code}": {
      get: {
        summary: "주문 하나 (주문번호 SO…)",
        security: [{ apiKey: [] }],
        parameters: idParam("code"),
        responses: { "200": { description: "`{data: order}`" }, ...common, "404": { description: "없음" } },
      },
    },
    "/api/v1/payments": list("결제·환불 결제 목록 (kind: charge, refund / method: toss, mock / status: pending, approved, failed, cancelled)"),
    "/api/v1/refunds": list("환불 요청 목록", status("requested, approved, rejected, done")),
    "/api/v1/subscriptions": list("구독 목록 (active, past_due, paused, cancelled, expired). 결제가 한 번도 안 된 구독은 빠진다"),
    "/api/v1/enrollments": list("수강권 목록 (source: order, bundle, subscription, free / status: active, expired, refunded)"),
    "/api/v1/progress": list(
      "진도 요약: 수강권마다 {enrollment_id, course_code, member_id, status, progress_ratio(0~1), completed(80% 이상), last_watched_at}. 쪽 나누기는 수강권 updated_at 기준",
    ),
    "/api/v1/inquiries": list("1:1 문의 목록", status("open, answered")),
    "/api/v1/inquiries/{id}/answer": write(
      "post",
      "문의 답변 (다시 보내면 고친다, 수강생에게 답변 알림)",
      { type: "object", required: ["answer"], properties: { answer: { type: "string", maxLength: 5000 } } },
      "200",
      idParam("id"),
    ),
    "/api/v1/coupons": write(
      "post",
      "쿠폰 만들기 (추천 코드 불가)",
      {
        type: "object",
        required: ["code", "kind", "value", "starts_at", "ends_at"],
        properties: {
          code: { type: "string", pattern: "^[A-Z0-9_-]{3,30}$" },
          name: { type: "string" },
          kind: { enum: ["fixed", "percent"] },
          value: { type: "integer", description: "fixed면 원, percent면 % (100 이하)" },
          max_discount: { type: "integer" },
          min_amount: { type: "integer" },
          target: { enum: ["all", "category", "course", "instructor"] },
          target_ref: { type: "string", description: "분야 코드·강의 코드·강사 slug" },
          per_user_once: { type: "boolean" },
          private: { type: "boolean", description: "true면 쿠폰함에 받은 회원만 쓸 수 있다(1인 1회로 고정)" },
          total_limit: { type: "integer" },
          starts_at: { type: "string", format: "date-time" },
          ends_at: { type: "string", format: "date-time" },
        },
      },
      "201",
    ),
    "/api/v1/coupons/{code}/grants": write(
      "post",
      "회원 쿠폰함에 쿠폰 넣기 (멱등). 새로 받은 회원마다 메시지함 안내 1개. 응답 `{coupon, granted, already, not_found}` (회원 id 목록)",
      {
        type: "object",
        required: ["member_ids"],
        properties: {
          member_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 500, description: "회원 id (v1 응답의 member id)" },
          message: {
            type: "object",
            properties: { title: { type: "string", maxLength: 100 }, body: { type: "string", maxLength: 2000 } },
            description: "메시지함 안내 문구 (없으면 기본 문구)",
          },
        },
      },
      "200",
      idParam("code"),
    ),
    "/api/v1/inbox": write(
      "post",
      "회원 메시지함에 안내 보내기 (돈과 상관없는 안내). 응답 `{sent, not_found}`",
      {
        type: "object",
        required: ["member_ids", "title", "body"],
        properties: {
          member_ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 500 },
          kind: { type: "string", pattern: "^[a-z_]{1,30}$", default: "notice" },
          title: { type: "string", maxLength: 100 },
          body: { type: "string", maxLength: 2000 },
          link: { type: "string", description: "/로 시작하는 사이트 안 경로만" },
        },
      },
      "201",
    ),
    "/api/v1/service-mode": {
      get: {
        summary: "지금 서비스 모드·최근 1분 지표·자동 제안·제안 기준·구성요소 상태",
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description:
              "`{mode, changed_by, reason, at, modes, window:{error_rate,p95_ms,rps}, suggestion: degraded|read_only|null, thresholds:{degraded:{error_rate:0.05,p95_ms:1500}, read_only:{error_rate:0.2,p95_ms:5000}}, components:[{component,status}]}`",
          },
          ...common,
        },
      },
      ...write("post", "서비스 모드 바꾸기 (사유 필수). degraded: 추천·자동완성·후기 쓰기 끔 / read_only: 결제·가입·글쓰기 막음 / maintenance: 직원만", {
        type: "object",
        required: ["mode", "reason"],
        properties: { mode: { enum: MODES }, reason: { type: "string", minLength: 1, maxLength: 300 } },
      }),
    },
    "/api/v1/incidents": {
      ...list("장애 공지 목록 (?status=open이면 해결 전 것만)"),
      ...write(
        "post",
        "장애 공지 쓰기 (상태 페이지·사이트 배너에 바로 나온다)",
        {
          type: "object",
          required: ["title", "body", "components", "severity"],
          properties: {
            title: { type: "string", maxLength: 100 },
            body: { type: "string", maxLength: 2000 },
            components: { type: "array", items: { enum: COMPONENTS } },
            severity: { enum: ["degraded", "outage"] },
          },
        },
        "201",
      ),
    },
    "/api/v1/incidents/{id}": write(
      "patch",
      "장애 공지 상태·안내 문구 바꾸기",
      {
        type: "object",
        required: ["status"],
        properties: { status: { enum: ["investigating", "identified", "monitoring", "resolved"] }, body: { type: "string", maxLength: 2000 } },
      },
      "200",
      idParam("id"),
    ),
    "/api/v1/queue": {
      get: {
        summary: "대기열 설정·통계 (target: site, checkout:<이름>, live:<라이브 id>)",
        security: [{ apiKey: [] }],
        responses: {
          "200": { description: "`{data:[{target, enabled, rate_per_sec, admit_ttl_sec, course_codes, waiting, avg_wait_sec, admitted_last_min}]}`" },
          ...common,
        },
      },
      ...write("post", "대기열 켜기·끄기·초당 입장 수 (사이트·결제 캠페인은 기본 꺼짐, 라이브는 시작 10분 전 자동)", {
        type: "object",
        required: ["target", "enabled", "rate_per_sec"],
        properties: {
          target: { type: "string", pattern: "^(site|checkout:[a-z0-9_-]{1,40}|live:[A-Za-z0-9_-]{1,40})$" },
          enabled: { type: "boolean" },
          rate_per_sec: { type: "integer", minimum: 1 },
          course_codes: { type: "array", items: { type: "string" }, description: "결제 캠페인 대상 강의 (비우면 모든 주문)" },
        },
      }),
    },
    "/metrics": {
      get: {
        summary: "Prometheus 지표 (metrics 범위 키). 접두사 studyon_",
        security: [{ apiKey: [] }],
        responses: {
          "200": {
            description:
              "text/plain: http_requests_total{group,method,status}, http_request_duration_seconds{group}, active_playbacks, queue_waiting{target}, queue_admitted_total{target}, payment_attempts_total{method}, payment_failures_total{method}, db_up, db_connections, db_slow_queries_total, job_duration_seconds{job}",
          },
          "401": common["401"],
          "403": common["403"],
        },
      },
    },
  },
} as const;
