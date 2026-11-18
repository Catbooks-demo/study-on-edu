# 온프레미스 서버에 올리기

스터디온에듀를 사내 서버 한 대에 올리는 방법이에요. 두 가지 길이 있어요.

- **A. Docker Compose** (리눅스 서버 권장): PostgreSQL과 앱이 함께 뜨고, 앱은 서버 안(`127.0.0.1`)에서만 열려요. 바깥에서는 nginx를 거쳐 들어와요. CI의 `docker` 잡이 아래 A-2~A-6을 그대로 돌려 확인해요.
- **B. Windows PC에 직접** (지금 시연 PC 구성): Node 22 + PostgreSQL 16을 직접 깔고, 앱은 `127.0.0.1:3201`, 앞단 Node 프록시가 `:3200`을 열어요.

> 이 문서에는 실제 서버 주소를 쓰지 않아요. `<서버 주소>`, `<도메인>` 자리는 각자 환경에 맞게 바꿔 주세요. 공개 레포라서 비밀번호·키·내부 IP는 절대 커밋하지 않아요.

---

## A. Docker Compose

### A-1. 준비

```bash
docker --version          # 24 이상
docker compose version    # v2 이상
```

- 서버 계정이 `docker` 그룹에 들어 있거나 `sudo`를 쓸 수 있어야 해요.
- 포트: 앱은 기본 `127.0.0.1:3200`. 이미 쓰는 포트와 겹치면 `.env`의 `APP_PORT`를 바꿔요.

### A-2. 코드 받기

```bash
sudo mkdir -p /srv/study-on-edu && sudo chown "$USER" /srv/study-on-edu
git clone https://github.com/Catbooks-demo/study-on-edu.git /srv/study-on-edu
cd /srv/study-on-edu
git checkout main
```

### A-3. 설정 파일 (.env)

```bash
cp .env.example .env
chmod 600 .env
```

| 값 | 넣을 것 |
|---|---|
| `POSTGRES_PASSWORD` | DB 비밀번호. `openssl rand -base64 24` |
| `SESSION_SECRET` | 세션·대기열 입장 쿠키 서명 비밀값, **32자 이상** (짧으면 앱이 켜지지 않아요). `openssl rand -base64 32` |
| `APP_BASE_URL` | 수강생이 들어올 주소 (`https://<도메인>`). https면 쿠키에 Secure가 붙어요 |
| `APP_PORT` | 앱이 열 포트 (기본 3200, `127.0.0.1`에만) |
| `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY` | 토스페이먼츠 **테스트** 키(`test_`로 시작). 비우면 모의 결제. `live_` 키를 넣으면 앱이 켜지지 않아요 |
| `SEED_STAFF_EMAIL`, `SEED_STAFF_PASSWORD` | 시드가 만들 첫 관리자 계정. 시드 뒤에는 지워도 돼요 |
| `SEED_INSTRUCTOR_PASSWORD` | 시드가 만들 가상 강사 계정(`instructor+<slug>@studyon.test`) 비밀번호. 비우면 강사 계정을 만들지 않아요 |
| `JOBS_ENABLED` | 주기 작업(주문 만료·환불 재시도·구독 갱신·대기열 정리·웹훅 보내기). 앱을 하나만 띄우면 `true` 그대로 |
| `NEXT_PUBLIC_HEARTBEAT_SEC` | 플레이어 하트비트 주기(초, 기본 30). **빌드할 때** 들어가요 |

`DATABASE_URL`은 compose가 알아서 `db`로 바꿔 넣어요. `.env`는 레포에 올리지 않아요.

### A-4. 띄우기

```bash
docker compose up -d --build --wait
docker compose ps        # db, app 모두 healthy (앱 healthcheck = /readyz)
```

앱은 켜질 때마다 DB 마이그레이션을 먼저 적용해요(이미 적용된 것은 건너뜀). DB 포트는 바깥에 열지 않아요.

### A-5. 시드 (처음 한 번)

```bash
docker compose exec app npm run db:seed
```

분야 7개·강의·패키지·구독 플랜·쿠폰·라이브·공지·FAQ와 첫 관리자·가상 강사 계정을 넣어요. 다시 돌려도 이미 있는 것은 그대로예요.

### A-6. 확인

```bash
curl -fsS http://127.0.0.1:3200/healthz          # {"status":"ok"} (앱만)
curl -fsS http://127.0.0.1:3200/readyz           # {"status":"ready"} (DB 연결까지)
curl -fsS http://127.0.0.1:3200/status | grep 정상이에요
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3200/metrics   # 401 (지표 키 필요)
```

브라우저에서 강의를 골라 모의 결제까지 해 봐요. 직원 화면은 `/admin`, 운영 화면은 `/admin/ops`예요.

### A-7. nginx 연결

새 설정 파일을 하나 만들어요. 기존 사이트 설정은 건드리지 않아요.

```nginx
# /etc/nginx/conf.d/study-on-edu.conf
server {
    listen 80;                      # https면 443 + 인증서
    server_name <도메인 또는 서버 주소>;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_set_header Host $host;
        # 손님이 보낸 값을 이어 붙이지 않고 실제 접속 주소로 덮어쓴다 (둘 다 꼭)
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        # 라이브 채팅 SSE가 끊기지 않게
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**왜 덮어써야 하나요?** 앱은 요청 제한(로그인 10회/10분, 결제 60회/분 등)과 대기열에서 손님 IP를 `X-Forwarded-For`의 마지막 값으로, 그 헤더가 없으면 `X-Real-IP`로 구분해요. 손님이 보낸 값을 그대로 이어 붙이면(`$proxy_add_x_forwarded_for`) 제한을 피할 수 있어요. 앞단 프록시는 반드시 두 헤더를 **실제 접속 주소로 덮어써야** 해요(B의 Node 프록시도 같은 일을 해요).

### A-8. 매일 백업

```bash
mkdir -p /srv/study-on-edu/backups
crontab -e
# 매일 04:20에 백업, 30일 지난 것은 지움
20 4 * * * cd /srv/study-on-edu && docker compose exec -T db pg_dump -U studyon -Fc studyon > backups/studyon-$(date +\%F).dump && find backups -name 'studyon-*.dump' -mtime +30 -delete
```

되살리기:

```bash
docker compose stop app
docker compose exec -T db pg_restore -U studyon -d studyon --clean --if-exists < backups/studyon-YYYY-MM-DD.dump
docker compose start app
```

### A-9. 업데이트

```bash
cd /srv/study-on-edu
git pull --ff-only
docker compose up -d --build --wait
```

### A-10. 되돌리기

```bash
git log --oneline -5             # 돌아갈 커밋 고르기
git checkout <커밋>
docker compose up -d --build --wait
```

마이그레이션은 앞으로만 가요. 표를 바꾼 업데이트를 되돌릴 때는 업데이트 직전 백업으로 되살린 뒤 위 순서를 따라요.

### A-11. 읽기 전용 DB 계정 (필요할 때만)

외부 시스템이 DB를 직접 읽어야 할 때만 만들어요. 보통은 API(`/api/v1`)를 쓰세요.

```bash
docker compose exec -T db psql -U studyon -d studyon <<'SQL'
CREATE ROLE reader LOGIN PASSWORD '<읽기 계정 비밀번호>';
GRANT CONNECT ON DATABASE studyon TO reader;
GRANT USAGE ON SCHEMA public TO reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reader;
ALTER DEFAULT PRIVILEGES FOR ROLE studyon IN SCHEMA public GRANT SELECT ON TABLES TO reader;
-- 세션·키·기기·웹훅 비밀값이 든 표는 빼요
REVOKE SELECT ON sessions, staff_sessions, instructor_sessions, api_keys, devices, webhook_endpoints FROM reader;
SQL
```

같은 서버에서 붙을 때만 `compose.override.yml`로 서버 안에만 열어요.

```yaml
# compose.override.yml
services:
  db:
    ports:
      - "127.0.0.1:5434:5432"
```

---

## B. Windows PC에 직접 (시연 PC 구성)

시연 PC는 Docker 없이 이렇게 떠 있어요. 같은 PC에서 누비투어와 PostgreSQL을 함께 써요.

```
C:\Users\403\studyon-server\
  app\            ← 이 레포 clone (dev 브랜치)
  config.ps1      ← 환경변수 (비밀값 포함, 레포에 없음, 출력·복사 금지)
  start.ps1       ← DB → 앱(127.0.0.1:3201) → 프록시(:3200) 켜기
  stop.ps1        ← 프록시·앱 끄기 (-Db를 주면 DB도. 누비투어도 멈춰요)
  update.ps1      ← 최신 받기 → 설치 → 마이그레이션 → 빌드 → 다시 켜기
  backup.ps1      ← 매일 pg_dump (30일 보관)
  proxy.mjs       ← 앞단 Node 프록시
  logs\, backups\
```

| 구성 | 값 |
|---|---|
| PostgreSQL | 16, 포트 **5433** (`C:\Users\403\pg16`, 누비투어와 함께 씀), DB `studyon_prod`, 사용자 `studyon` |
| 앱 | `npx next start -H 127.0.0.1 -p 3201` (PC 안에서만) |
| 프록시 | `node proxy.mjs`가 `0.0.0.0:3200` → `127.0.0.1:3201` |
| 바깥 주소 | `http://<서버 주소>:3200` (`APP_BASE_URL`도 같게) |

### B-1. 처음 설치

```powershell
# PostgreSQL 16(포트 5433)에 사용자·DB 만들기
& C:\Users\403\pg16\pgsql\bin\psql.exe -p 5433 -U postgres -c "CREATE ROLE studyon LOGIN PASSWORD '<DB 비밀번호>'"
& C:\Users\403\pg16\pgsql\bin\psql.exe -p 5433 -U postgres -c "CREATE DATABASE studyon_prod OWNER studyon"

mkdir C:\Users\403\studyon-server\logs, C:\Users\403\studyon-server\backups
git clone https://github.com/Catbooks-demo/study-on-edu.git C:\Users\403\studyon-server\app
```

`config.ps1`에는 `.env.example`의 값을 `$env:이름 = "값"`으로 적어요. 예:

```powershell
$env:NODE_ENV = "production"
$env:DATABASE_URL = "postgresql://studyon:<DB 비밀번호>@localhost:5433/studyon_prod"
$env:APP_BASE_URL = "http://<서버 주소>:3200"
$env:SESSION_SECRET = "<32자 이상>"
$env:JOBS_ENABLED = "true"
$env:NEXT_PUBLIC_HEARTBEAT_SEC = "30"
```

그다음 한 번:

```powershell
cd C:\Users\403\studyon-server
.\update.ps1                      # npm ci → prisma migrate deploy → build → start.ps1
. .\config.ps1; cd app; npm run db:seed   # 시드 (SEED_STAFF_* 값을 config.ps1에 잠깐 넣고)
```

### B-2. 앞단 프록시 (proxy.mjs)

nginx 대신 Node 프록시가 같은 일을 해요. **손님이 보낸 `X-Forwarded-For`·`X-Real-IP`는 버리고 실제 접속 주소로 덮어써요.** (앱의 요청 제한이 이 값으로 사람을 구분해요.)

```js
// 스터디온에듀 앞단 프록시: 바깥 :3200 → 앱 127.0.0.1:3201
import http from "node:http";

const LISTEN_PORT = Number(process.env.STUDYON_PROXY_PORT ?? 3200);
const APP_PORT = Number(process.env.STUDYON_APP_PORT ?? 3201);

const server = http.createServer((req, res) => {
  const ip = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  const headers = { ...req.headers };
  delete headers["x-real-ip"];          // 손님이 보낸 값은 믿지 않는다
  delete headers["x-forwarded-host"];
  headers["x-forwarded-for"] = ip;      // 이어 붙이지 않고 덮어쓴다
  headers["x-forwarded-proto"] = "http";
  const up = http.request({ host: "127.0.0.1", port: APP_PORT, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("잠시 후 다시 시도해 주세요.");
  });
  req.pipe(up);
});
server.requestTimeout = 60_000;
server.listen(LISTEN_PORT, "0.0.0.0");
```

Windows 방화벽은 3200만 열고 3201·5433은 열지 않아요.

### B-3. 매일 쓰는 것

```powershell
cd C:\Users\403\studyon-server
.\start.ps1       # 켜기 (이미 켜져 있으면 건너뜀)
.\stop.ps1        # 끄기 (DB는 그대로)
.\update.ps1      # 업데이트: stop → git pull --ff-only → npm ci → migrate → 빌드 → start
.\backup.ps1      # 백업 (작업 스케줄러에 매일 등록)
Get-Content logs\app.log -Tail 50 -Wait   # 요청 로그 보기
```

되살리기: `.\stop.ps1` → `pg_restore -p 5433 -U studyon -d studyon_prod --clean --if-exists <파일>` → `.\start.ps1`.
되돌리기: `cd app; git checkout <커밋>` 뒤 `update.ps1`의 설치·마이그레이션·빌드 단계를 그대로 (`git pull`만 빼고).

---

## 운영 기능

### 상태 확인·로그

| 주소 | 용도 |
|---|---|
| `/healthz` | 앱이 살아 있는지 (DB는 안 봄) |
| `/readyz` | DB까지 붙는지 (compose healthcheck) |
| `/status` | 수강생용 상태 페이지 (로그인 없이, 대기열·점검 중에도 열림). 열린 장애 공지의 가장 나쁜 정도를 보여 줘요 |
| `/metrics` | Prometheus 지표 (`metrics` 범위 키 필요) |
| `/api/v1/openapi.json` | 외부 API 설명 |

- 앱 로그는 JSON 한 줄씩이에요. 요청마다 `{"msg":"요청","req_id","group","method","status","ms"}`를 남기고, 쿠키·쿼리 문자열·본문은 남기지 않아요.
- 모든 API 응답에 `x-request-id` 헤더가 붙어요. 앞단에서 같은 헤더를 보내면 그 값을 그대로 써요(영문·숫자·`._-` 64자까지). 수강생이 오류를 알려 주면 이 값으로 로그를 찾아요.

### API 키 발급

직원 화면의 키 관리(M6)가 생기기 전에는 서버 안에서 발급해요. 키 원문은 이때 한 번만 나와요.

```bash
docker compose exec app npm run -s apikey -- --name prometheus --scopes metrics      # A
. .\config.ps1; cd app; npm run -s apikey -- --name prometheus --scopes metrics       # B
```

범위: `read`(개인정보 가림), `read_pii`(원문), `write`(서비스 모드·장애 공지·대기열·쿠폰), `metrics`(/metrics만). 키당 분당 600회까지예요.

### Prometheus 설정 예시

```yaml
scrape_configs:
  - job_name: studyon
    metrics_path: /metrics
    scheme: http
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/studyon.key   # sok_… 키 한 줄
    static_configs:
      - targets: ["<서버 주소>:3200"]
```

주요 지표(접두사 `studyon_`): `http_requests_total{group,method,status}`, `http_request_duration_seconds{group}`(히스토그램), `active_playbacks`, `queue_waiting{target}`, `queue_admitted_total{target}`, `payment_attempts_total`·`payment_failures_total{method}`, `db_up`, `db_connections`, `db_slow_queries_total`(500ms 이상), `job_duration_seconds{job}`.
요청·결제 수는 앱 하나의 메모리 값이라 앱을 다시 켜면 0부터 다시 세요.

### 단계별 서비스 모드

`/admin/ops/mode`(admin) 또는 `POST /api/v1/service-mode`(write 키)로 바꿔요. 사유는 꼭 적고, 바꿀 때마다 작업 기록·웹훅(`service_mode.changed`)이 남아요.

| 모드 | 막는 것 | 그대로 되는 것 |
|---|---|---|
| `normal` | 없음 | 모두 |
| `degraded` | 추천·검색 자동완성·후기 쓰기 | 나머지 (목록 캐시 30초 → 300초) |
| `read_only` | 결제·가입·글쓰기(주문·구독·환불 신청·질문·문의·노트·라이브 예약·채팅) | 둘러보기·로그인·수강·라이브 입장 |
| `maintenance` | 수강생 화면 전부 (점검 화면) | 직원, `/status` |

자동 제안: 최근 1분 오류율 ≥ 5% 또는 p95 ≥ 1500ms면 `degraded`, 오류율 ≥ 20% 또는 p95 ≥ 5000ms면 `read_only`를 **제안만** 해요. 제안·기준·지금 지표는 운영 화면과 `GET /api/v1/service-mode`에서 볼 수 있어요.

### 장애 공지

`/admin/ops/incidents` 또는 `POST /api/v1/incidents`(write)로 올리고, `PATCH /api/v1/incidents/{id}`로 `identified → monitoring → resolved`까지 바꿔요. 열린 공지는 `/status`와 사이트 맨 위 배너에 바로 나오고 웹훅(`incident.created`·`incident.updated`)이 나가요.

### 대기열 (가상 대기실)

사이트(`site`)와 결제 캠페인(`checkout:<이름>`) 대기열은 **기본으로 꺼져 있어요.** 접속이 몰리면 켜요.

```bash
curl -X POST -H "Authorization: Bearer <write 키>" -H "Content-Type: application/json" \
  -d '{"target":"site","enabled":true,"rate_per_sec":50}' http://127.0.0.1:3200/api/v1/queue
```

- 기본 한도: 사이트 50명/초, 결제 캠페인 10명/초, 라이브 20명/초. 입장 허용은 10분, 60초 동안 새로고침이 없는 순번표는 만료돼요.
- 결제 캠페인은 `course_codes`로 대상 강의를 정해요(비우면 모든 주문). 할인 마감 전에 순번표를 받은 수강생은 마감 뒤 30분까지 그때 가격으로 주문할 수 있어요.
- 라이브 대기열(`live:<id>`)은 시작 10분 전부터 끝날 때까지 자동으로 켜져요. 그 사이에 직접 끄면 다시 켜지 않아요.
- 대기 인원·평균 대기·최근 1분 입장은 `/admin/ops/queue`, `GET /api/v1/queue`, 지표 `studyon_queue_waiting`에서 봐요.

### 웹훅

`/admin/webhooks`에서 https 주소를 등록해요(서명 비밀값은 등록 때 한 번만 보여요). 이벤트: `order.paid`, `order.refunded`, `subscription.status_changed`, `service_mode.changed`, `incident.created`, `incident.updated`.
받는 쪽은 `X-StudyOn-Signature: t=<unix초>,v1=<hex>`를 `HMAC-SHA256(비밀값, "<t>.<본문>")`로 다시 계산해 확인해요. 실패하면 1·5·30·120·720분 뒤 다시 보내고 6번째 실패면 멈춰요.

### 장애 시연

시연 장애는 팀이 직접 만들어요(앱에 장애 주입 기능은 없어요). 예를 들어 시연 서버에서 DB를 잠깐 멈추면 `/readyz`가 503, `/status`가 모두 "장애가 있어요", `studyon_db_up`이 0이 돼요. **운영 서버에서는 하지 말아 주세요.**
