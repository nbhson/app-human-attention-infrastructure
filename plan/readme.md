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
