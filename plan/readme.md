# Plan — app-human-attention-infrastructure

> Monorepo (pnpm + turbo, Fastify API + React web) cho hệ thống "human attention" —
> review queue, learning loop, provenance, metrics. Auth dùng OIDC + JWT/sid cookie,
> guard qua `requireRole(container, ...roles)`.

## Kết quả Review (audit đợt 1)

| # | Severity | Vị trí | Vấn đề | Fix |
|---|----------|--------|--------|-----|
| 1 | CRITICAL | routes/learning.ts:75 | `GET /api/learning/cycles` không có guard — lộ cycle outcomes/sample counts cho bất kỳ ai | `preHandler: requireRole(Role.Operate)` |
| 2 | CRITICAL | routes/provenance.ts:23 | `GET /api/tasks/:id/provenance` không guard — lộ toàn bộ causal trail của task | Guard OPERATOR |
| 3 | CRITICAL | routes/ops.ts:44 | `GET /api/ops/metrics` không guard — lộ task-state distribution + queue depth | Guard OPERATOR; **health giữ mở** chủ đích cho liveness probe |
| 4 | MAJOR | routes/metrics.ts:17 | Prometheus `/metrics` public — lộ breaker states, latency histograms | Optional `METRICS_BEARER_TOKEN` env; không set → warning lúc startup (Prometheus scrape không dùng được OIDC flow) |
| 5 | MAJOR | docker-compose.yml:10 | `5432:5432` bind 0.0.0.0 — cả LAN thấy Postgres với password dev "harness" | Bind `127.0.0.1:5432:5432` |
| 6 | ĐÃ CÓ SẴN | bootstrap.ts:273-291 | JWT_SECRET guard (finding ban đầu) — thực tế đã implement fail-fast ở production + warn ở dev | Không cần sửa |

## Quyết định thiết kế

- **Health mở, metrics đóng**: `/api/ops/health` chỉ trả `{ok, now}` — LB/container probe không có credential; `/api/ops/metrics` và learning/provenance là dữ liệu nội bộ nên guard OPERATOR (role thấp nhất, mọi user đều có).
- **`/metrics` dùng token riêng** thay vì `requireRole`: Prometheus không làm được OIDC flow; `METRICS_BEARER_TOKEN` là mô hình chuẩn cho scrape endpoint. So sánh constant-time (HMAC wrapper để bất biến độ dài).
- Gộp lại một `registerOpsRoutes(app, container)` đúng pattern của admin/settings (trước đây hàm nhận `db` trực tiếp nên không guard được).

## Trạng thái

- [x] Plan
- [x] Fix #1–#5
- [x] Typecheck pass (tsc 2 config)
- [x] Full API test suite: 28 files / 144 tests pass
- [x] Commit + self-review

## Review Log

### Vòng 1
- Lần đầu fix: tách `registerOpsMetricsRoutes` riêng → test `ops-routes.test.ts` cũ (dùng `db` trực tiếp) 404 → tái cấu trúc về một hàm nhận `container` (pattern nhất quán), cập nhật test theo pattern auth đầy đủ của `admin-routes.test.ts` (mock OIDC login + cookie). Bug trong chính bản fix: quên đăng ký `registerAuthRoutes` trong `buildApp` mới → login 404 "Invalid URL" — đã sửa, 4/4 test pass.
- Turbo build toàn bộ dependency graph: 26/26 tasks pass.

---

# Round 2 (2026-10-29) — enterprise upgrade

## Objective

Nâng cấp đợt 2: survey toàn repo rồi đánh vào các điểm yếu có impact cao nhất
(security → perf → dedupe/robustness → ops features → UI), cộng 2–4 feature
mới phù hợp domain "review control plane" (readiness probe, correlation id,
auth rate-limit). Không regressed các fix Round 1 (guards ops/learning/
provenance, metrics token, Postgres loopback).

## Findings (Round 2 audit)

| # | Severity | Vị trí | Vấn đề |
|---|----------|--------|--------|
| 1 | MAJOR (security) | `apps/api/src/routes/auth.ts` | `GET /api/auth/login` + `/api/auth/callback` không rate-limit — spam được IdP + grow `pendingLogins` |
| 2 | MAJOR (bug) | `apps/web/src/api/audit.ts`, `provenance.ts`, `triageRules.ts` | `fetch()` thiếu `credentials: 'include'` — trên LAN/direct-call (đúng scenario Round 1 đã fix cho login) Audit/Provenance/Triage sẽ 401 |
| 3 | MODERATE (perf) | `apps/api/src/routes/ops.ts` `orphanedTaskCount` | `select({id})` rồi `rows.length` — load toàn bộ row về JS chỉ để đếm → dùng SQL `count()` |
| 4 | MODERATE (dedupe) | 6 module `apps/web/src/api/*.ts` | 6 bản copy gần-identical của helper `json<T>()`; 3 bản (audit/provenance/ops) không có non-JSON guard, 3 bản lỗi class riêng lẻ |
| 5 | MODERATE (error handling) | `apps/web/src/api/ops.ts`, `audit.ts`, `provenance.ts` | Non-JSON body (gateway HTML, abort) quăng `SyntaxError` thô — không classify được (review.ts/reviews.ts đã fix từ trước, ops chưa) |
| 6 | MINOR (ops) | thiếu readiness endpoint | Chỉ có liveness (`/health`, `/api/ops/health`); không có readiness theo component cho orchestrator/k8s |
| 7 | MODERATE (ops) | `trace.ts` | Correlation id chỉ nằm trong OTel span — không có ở response header, debug production phải đào log |

## Planned changes

- **F1 (feature): readiness probe** — `GET /api/ops/ready` (mở như health, chỉ
  trả boolean checks): DB reachable → `{ok, checks:{db:true}}`, DB down → 503
  + `{ok:false, checks:{db:false}}` để LB ngừng route traffic trước khi chết.
- **F2 (feature): `x-correlation-id` response header** từ `registerTraceHook`
  — hỗ trợ ticket/debug: mỗi response mang id khớp với span + audit timeline.
- **F3 (security): auth rate-limit** — `login`/`callback` qua bucket
  `checkSensitiveRateLimit` (30 req/min/IP, 429 khi vượt); giới hạn spam mà
  không phá flow login của UI.
- **F4 (dedupe + robustness): shared HTTP client web** — `api/http.ts` với
  `HttpApiError(status)`, parser chống non-JSON, `getJson`/`requestJson` đều
  `credentials: 'include'`; 6 client module migration sang (fix F2/F5 finding).
- **F5 (perf): `orphanedTaskCount`** đếm bằng SQL `count()` thay vì select id.
- **F6 (UI): OpsPage** — thêm readiness card, card style dùng chung, trạng thái
  lỗi/loading nhất quán (design tokens sẵn có của theme.css).

## Trạng thái Round 2

- [x] Deep review (survey + target high-impact)
- [x] Plan
- [x] F1 readiness endpoint + test
- [x] F2 correlation-id response header + test
- [x] F3 auth rate-limit + test
- [x] F4 shared web http client (6 modules migrated)
- [x] F5 SQL count orphan
- [x] F6 OpsPage readiness card + polish
- [x] Typecheck + tests pass
- [x] Commit + self-review

## Review Log (Round 2)

### Vòng 1
- Rate-limit chọn bucket `sensitive` (30/min) thay vì bucket riêng 10/min: các
  test file thật (admin/settings/review-routes) login 4–6 lần/file trong cùng
  process — 10/min sẽ 429 oan; 30/min vẫn chặn spam mà test không phải sửa.

### Vòng 2 (hồi phục sau phiên bị ngắt + hoàn tất F4/F6)

- Phiên trước bị gián đoạn: working tree chỉ còn F1/F2/F3/F5 (API) nhưng plan
  đã tick F4/F6 — **sai thực tế** (apps/web không đổi nào). Đã verify WIP
  (11/11 test pass) rồi commit tách theo feature, sau đó mới implement F4/F6.
- F4: `api/http.ts` — `HttpApiError(status)` + `parseResponse` (non-JSON guard,
  `{error}` surfacing) + `getJson/postJson/putJson` luôn
  `credentials: 'include'`. Module có error class riêng (review/reviews/
  triageRules) truyền `toError` factory → `instanceof` trong pages giữ nguyên;
  audit/provenance/ops bỏ hẳn helper riêng. Fix luôn finding #2 (thiếu
  credentials) và #5 (non-JSON SyntaxError).
- F6: OpsPage thêm card "Readiness" (READY/NOT READY, tone xanh/đỏ theo
  `--color-success`/`--color-danger`), `opsApi.ready()`, Card nhận `tone`.
- Lưu ý môi trường: chạy `vitest` TỪ TRONG apps/web (không config local →
  `globals` off → RTL auto-cleanup không đăng ký) làm 23 test fail ảo
  "multiple elements" — web tests phải chạy từ root (`pnpm vitest run apps/web`,
  đúng cách turbo/root config làm). Không phải regression của round 2.
- Verify cuối: pnpm test 196 files / 1241 tests pass; typecheck 52/52; build
  27/27. Round-1 guards (ops/learning/provenance, metrics token, loopback PG)
  vẫn nguyên.
