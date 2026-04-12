# YourselfOnAir MVP Prototype

这是一个零依赖（无第三方 npm 包）可运行原型，用于把 `PRODUCT_PLAN_V1.md` 的产品结构落到可演示系统。

## 本地快速启动

```bash
npm run dev
```

打开：`http://localhost:3000`

## API 列表

读取类：
- `GET /api/health`
- `GET /api/workspaces`
- `GET /api/documents`
- `GET /api/tasks`
- `GET /api/task-templates`
- `GET /api/experts`
- `GET /api/policies`
- `GET /api/policy-change-requests`
- `GET /api/audit-logs`
- `GET /api/billing`
- `GET /api/distillation/self`
- `GET /api/distillation/expert`
- `GET /api/provenance`
- `GET /api/fusion/preview`
- `GET /api/write-usage`（需 `x-api-key`，返回今日写配额使用情况）
- `GET /api/state/export`（需 `x-api-key`，导出可迁移状态快照，含 state/writeUsage/auditLogs）
- `POST /api/state/import`（需 `x-api-key`，导入状态快照并返回导入统计）
- `GET /api/dashboard/summary`（需 `x-api-key`，返回 Dashboard 聚合统计与配额概览；支持 `workspaceId`、`recentAuditLimit` 查询参数）

### 列表接口查询参数（本轮新增）

以下列表接口支持统一查询参数：`/api/workspaces`、`/api/documents`、`/api/tasks`、`/api/policies`、`/api/policy-change-requests`、`/api/audit-logs`。

- `q`：全文模糊匹配（在记录 JSON 文本上匹配）。
- `status`：按 `status` 精确过滤（如 tasks 的 `running/done`）。
- `workspaceId`：按 `workspaceId` 精确过滤（如 documents）。
- `owner`：按 `owner` 精确过滤（如 workspaces）。
- `action`：按 `action` 精确过滤（如 audit-logs 的接口动作）。
- `method`：按 `method` 精确过滤（如 audit-logs 的 `POST/PATCH`）。
- `actor`：按 `actor` 精确过滤（如 audit-logs 的调用 API Key）。
- `dateField`：指定日期字段名（如 experts 的 `createdAt`、audit-logs 的 `createdAt`）。
- `dateFrom`：按日期下界过滤（`YYYY-MM-DD`，需配合 `dateField` 使用，含当天）。
- `dateTo`：按日期上界过滤（`YYYY-MM-DD`，需配合 `dateField` 使用，含当天）。
- `sortBy`：按字段排序（如 `id`、`name`）。
- `order`：排序方向，`asc`（默认）或 `desc`。
- `offset`：从第 N 条开始（非负整数）。
- `limit`：最多返回 N 条（非负整数，最大 100）。

示例：

```bash
curl "http://localhost:3000/api/tasks?status=running&sortBy=id&order=asc&limit=5"
```

写入类（本轮新增）：
- `POST /api/workspaces`
- `POST /api/documents`
- `POST /api/tasks`（可选 `workspaceId`，传入时必须是有效工作空间）
- `POST /api/tasks/from-template`
- `POST /api/policies`
- `POST /api/experts`
- `POST /api/policy-change-requests`
- `POST /api/state/import`（需 `x-api-key`，导入 `yoa-state-v2` 或 legacy state JSON 快照）
- `DELETE /api/tasks/:taskId`
- `DELETE /api/documents/:documentId`
- `DELETE /api/workspaces/:workspaceId`（可选 `?force=true` 级联删除关联 documents/tasks）
- `PATCH /api/tasks/:taskId/status`
- `PATCH /api/experts/:expertId/activate`
- `PATCH /api/policy-change-requests/:requestId/approve`
- `PATCH /api/policy-change-requests/:requestId/reject`

### Expert 多实例管理（本轮新增）

- `GET /api/experts`：查看所有 Expert 视角；支持列表查询参数。
- `POST /api/experts`：新增 Expert 视角（需 `expertName` + `fiveLayers`）。
- `PATCH /api/experts/:expertId/activate`：激活指定 Expert，并同步更新 `GET /api/distillation/expert` 输出。
- `GET /api/experts?status=true`：筛选当前激活的 Expert（`status=false` 可筛选未激活）。

### 任务完成约束（证据追溯）

- 当任务状态更新为 `done` 时，任务必须包含至少 1 条 `evidenceRefs`。
- 可在 `PATCH /api/tasks/:taskId/status` 请求体中携带 `evidenceRefs` 一并更新。
- `PATCH /api/tasks/:taskId/status` 支持部分更新：可仅更新 `status`、仅更新 `evidenceRefs`，或同时更新两者。
- 若请求体同时缺少 `status` 与 `evidenceRefs`，接口会返回 `400`。
- 若任务没有证据引用，`PATCH /api/tasks/:taskId/status` 会返回 `400`。

### 任务模板（本轮新增）

- `GET /api/task-templates`：查看可用任务模板（支持通用列表查询参数，如 `sortBy`、`limit`）。
- `POST /api/tasks/from-template`：按模板创建任务，必须传 `templateId`，可选 `workspaceId` / `prompt` / `evidenceRefs`。
- 当 `prompt` 未传入时，会使用模板中的 `promptTemplate`，并自动替换 `{workspaceName}` 变量。

### 写接口鉴权与配额

从当前版本开始，所有写接口（`POST/PATCH`）都要求请求头携带：

- `x-api-key: <WRITE_API_KEY>`

默认环境变量：

- `WRITE_API_KEY=dev-write-key`
- `WRITE_QUOTA_PER_DAY=20`（单个 API Key 每日写入上限）
- `STATE_FILE`（可选，设置后会在每次写操作后将内存状态持久化到该 JSON 文件，并在服务启动时自动加载）

超限会返回 `429 write quota exceeded`。

此外，成功通过鉴权的 `GET /api/write-usage` 与所有写入接口响应头都会返回：

- `X-Write-Quota-Date`
- `X-Write-Quota-Limit`
- `X-Write-Quota-Used`
- `X-Write-Quota-Remaining`

### 状态导入预演（本轮新增）

- `POST /api/state/import?dryRun=true`：执行导入预演，只返回导入结果统计，不会修改当前内存状态。
- 预演请求同样需要 `x-api-key`，且不会消耗写配额、不会写入审计日志、不会触发持久化落盘。

### Dashboard 汇总增强（本轮新增）

- `GET /api/dashboard/summary?workspaceId=<id>`：返回指定工作空间视角的 tasks/documents/counts 聚合。
- `recentAuditLimit`：控制 `recentAuditLogs` 返回条数，默认 `5`，最大 `50`。
- `recentAuditAction` / `recentAuditMethod` / `recentAuditActor`：按动作、HTTP 方法、调用方过滤 `recentAuditLogs`。
- `recentAuditTargetId`：按审计日志中的 `targetId` 精确过滤（如某个 `task-xxx` / `ws-xxx`）。
- `recentAuditDateFrom` / `recentAuditDateTo`：按审计日志 `createdAt` 日期范围过滤（`YYYY-MM-DD`，包含边界日期）。
- 响应新增字段：
  - `scope.workspaceId`
  - `completionRate`（任务完成率，`done / tasks`；当任务数为 0 时返回 `null`）
  - `recentAuditLogs`（最近写操作审计记录，默认倒序返回最近 5 条）

## 测试

```bash
npm test
```

## 可以直接云端测试吗？

可以，**现在就可以直接云端测试**。项目已包含 Docker 与 Render 配置。

### 方式 A：Render（最省事）

1. 把当前仓库推到 GitHub。
2. 在 Render 新建 `Web Service` 并选择仓库。
3. Render 自动识别 `render.yaml` + `Dockerfile`。
4. 部署后检查：`/`、`/api/health`。

### 方式 B：任意支持 Docker 的平台

```bash
docker build -t yourself-on-air-mvp .
docker run -p 3000:3000 yourself-on-air-mvp
```

## 与参考项目的技术对齐

本仓库已实装以下思路：
- Self 蒸馏二层结构：`Work Memory + Work Persona`
- Expert 蒸馏五层结构：表达DNA/心智模型/决策启发式/反模式/诚实边界
- 证据追溯：任务包含 `evidenceRefs`，并有 provenance 规则

详见：
- `docs/RESEARCH_NOTES.md`
- `docs/DEVELOPMENT_PLAN_V2.md`
- `docs/TECHNICAL_STANDARDS.md`

## 说明

- 当前环境对 npm registry 存在 403 限制，暂不依赖 Next.js 安装。
- 已先完成可运行验证与技术骨架，后续可迁移到 Next.js + TS。
