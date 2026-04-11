# 技术标准与实施规范（V2）

## 0. 协作与分支同步标准

- 每次任务开始前必须执行：`git fetch --all --prune`。
- 若存在远程主分支，先 rebase/merge 最新远程变更后再开发。
- 提交前必须确认：`git status` 清晰、无意外未跟踪文件。

## 1. 数据模型标准

### 1.1 Self Distillation
- 必须包含：`workMemory`、`workPersona`
- `workMemory` 至少包含：项目、流程偏好、决策依据
- `workPersona` 至少包含：语气、输出结构偏好、时间偏好

### 1.2 Expert Distillation（五层）
- 必须包含：
  1. `expressionDNA`
  2. `mentalModels`
  3. `decisionHeuristics`
  4. `antiPatterns`
  5. `honestBoundaries`

### 1.3 证据追溯
- 任务对象必须包含 `evidenceRefs`
- 无证据任务不得标记为 `done`

## 2. 融合引擎标准

- 输出必须可解释：返回权重来源（facts/self/expert/constraints）
- 推荐默认权重：`0.5 / 0.25 / 0.2 / 0.05`
- 任何对外口径输出，必须经过 `policies` 规则检查

## 3. API 标准

- 健康检查：`GET /api/health`，返回 `ok=true`
- 读取端点：`GET /api/*`
- 写入端点：
  - `POST /api/workspaces`
  - `POST /api/documents`
  - `POST /api/tasks`
  - `POST /api/policies`
  - `PATCH /api/tasks/:taskId/status`
- 非支持方法返回 405
- 蒸馏端点：
  - `GET /api/distillation/self`
  - `GET /api/distillation/expert`
  - `GET /api/provenance`
  - `GET /api/fusion/preview`

## 4. 安全标准

- 必须阻断目录穿越访问（如 `/../xxx`）
- 响应头默认包含基础安全头（`nosniff`、`DENY`）

## 5. 测试标准

- 至少覆盖：健康检查、工作区列表、蒸馏结构、融合输出
- 至少覆盖：405、目录穿越阻断、POST/PATCH 成功与失败路径
- 所有测试在 `node --test` 下可直接执行

## 6. 云部署标准

- 必须提供 `Dockerfile`
- 建议提供平台配置（如 `render.yaml`）
- 部署后必须验证：`/` 与 `/api/health`
