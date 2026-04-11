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
- `GET /api/policies`
- `GET /api/policy-change-requests`
- `GET /api/billing`
- `GET /api/distillation/self`
- `GET /api/distillation/expert`
- `GET /api/provenance`
- `GET /api/fusion/preview`

写入类（本轮新增）：
- `POST /api/workspaces`
- `POST /api/documents`
- `POST /api/tasks`
- `POST /api/policies`
- `POST /api/policy-change-requests`
- `PATCH /api/tasks/:taskId/status`
- `PATCH /api/policy-change-requests/:requestId/approve`

### 任务完成约束（证据追溯）

- 当任务状态更新为 `done` 时，任务必须包含至少 1 条 `evidenceRefs`。
- 若任务没有证据引用，`PATCH /api/tasks/:taskId/status` 会返回 `400`。

### 写接口鉴权与配额

从当前版本开始，所有写接口（`POST/PATCH`）都要求请求头携带：

- `x-api-key: <WRITE_API_KEY>`

默认环境变量：

- `WRITE_API_KEY=dev-write-key`
- `WRITE_QUOTA_PER_DAY=20`（单个 API Key 每日写入上限）

超限会返回 `429 write quota exceeded`。

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
