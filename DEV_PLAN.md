# YourselfOnAir 开发计划（执行版）

> 日期：2026-04-11
> 目标：从产品文档推进到“可运行 + 可演示 + 可测试”的 MVP 工程基线。

## 0. 本轮迭代计划（2026-04-12）

1. 同步仓库并确认基线测试通过，避免后续 PR/Merge 冲突。
2. 为 `POST /api/state/import` 增加 `dryRun=true` 预演能力，降低误导入风险。
3. 补充自动化测试，验证预演不会修改状态/配额/审计日志。
4. 更新 README 文档，明确预演接口行为与使用方式。

## 0.1 本轮增量计划（2026-04-12）

1. 保持主线 API 稳定前提下增强 Dashboard 查询能力。
2. 为 `GET /api/dashboard/summary` 增加 `recentAuditAction` / `recentAuditMethod` / `recentAuditActor` 过滤参数。
3. 补充自动化测试覆盖新增过滤逻辑。
4. 同步 README 说明，便于联调与验收。

## 0.2 本轮增量计划（2026-04-12，追加）

1. 在 `GET /api/dashboard/summary` 上补充 `recentAuditDateFrom` / `recentAuditDateTo` 日期范围过滤能力。
2. 增加参数校验：当日期范围非法（from > to）时返回 `400`。
3. 补充自动化测试覆盖日期过滤和错误分支。
4. 更新 README 文档，明确新增查询参数语义。

## 0.3 本轮增量计划（2026-04-12，继续）

1. 为 `GET /api/dashboard/summary` 增加 `recentAuditByDate` 字段，便于按日观察写操作趋势。
2. 确保统计遵循现有审计筛选条件（action/method/actor/targetId/date range）。
3. 补充自动化测试覆盖该聚合字段。
4. 更新 README 文档，明确新返回字段语义。

## 0.4 本轮增量计划（2026-04-12，继续）

1. 为 `GET /api/dashboard/summary` 增加 `recentAuditByActor` 聚合字段。
2. 确保聚合严格遵循现有审计筛选条件（action/method/actor/targetId/date range）。
3. 补充自动化测试验证 `recentAuditByActor` 与现有聚合字段协同可用。
4. 更新 README 文档，明确新增返回字段语义。

## 0.5 本轮增量计划（2026-04-12，继续）

1. 为 `GET /api/dashboard/summary` 增加 `recentAuditByTarget` 聚合字段。
2. 确保聚合严格遵循现有审计筛选条件（action/method/actor/targetId/date range）。
3. 补充自动化测试验证 `recentAuditByTarget` 与其他聚合字段可同时使用。
4. 更新 README 文档，明确新增返回字段语义。

## 0.6 本轮增量计划（2026-04-12，继续）

1. 为 `GET /api/dashboard/summary` 的审计筛选参数增加多值能力（逗号分隔）。
2. 支持 `recentAuditAction` / `recentAuditMethod` / `recentAuditActor` / `recentAuditTargetId` 多值并集过滤。
3. 补充自动化测试覆盖多值筛选与 `scope.recentAudit` 回显行为。
4. 更新 README 文档，明确多值传参示例。

## 0.7 本轮增量计划（2026-04-12，继续）

1. 为 `GET /api/dashboard/summary` 的 `taskStatus` / `documentStatus` 增加多值过滤能力（逗号分隔）。
2. 保持向后兼容：单值依然可用，并在 `scope` 中统一以数组回显筛选条件。
3. 补充自动化测试覆盖多值状态过滤与错误提示。
4. 更新 README 文档，给出多值查询示例。

## 0.8 本轮增量计划（2026-04-12，继续）

1. 为 `GET /api/dashboard/summary` 增加 `recentAuditGroupLimit`，支持对审计聚合结果进行 TopN 裁剪。
2. 确保该限制统一作用于 `recentAuditByAction` / `recentAuditByMethod` / `recentAuditByActor` / `recentAuditByTarget`。
3. 补充自动化测试覆盖有效限制与非法参数分支。
4. 更新 README 文档，明确新参数语义与回显字段。

## 0.9 本轮增量计划（2026-04-12，继续）

1. 为 `GET /api/dashboard/summary` 增加 `recentAuditOrder` 参数，支持 `recentAuditLogs` 升序/降序切换。
2. 保持默认行为不变（`desc`，最新日志在前）并在 `scope.recentAudit` 中回显排序方向。
3. 补充自动化测试覆盖默认排序、`asc` 排序与非法参数分支。
4. 更新 README 文档，明确排序参数语义。

## 0.10 本轮增量计划（2026-04-12，继续）

1. 为 `GET /api/dashboard/summary` 增加 `recentAuditOffset` 参数，支持 `recentAuditLogs` 窗口分页。
2. 保持默认行为不变（`offset=0`）并在 `scope.recentAudit` 中回显偏移量。
3. 补充自动化测试覆盖分页窗口与非法参数分支。
4. 更新 README 文档，明确分页参数语义与组合用法。

## 1. 计划拆分

1. 基线工程初始化（零依赖 Node Web 服务）
2. 按信息架构实现 8 个核心模块页面区块
3. 提供 5 组基础 API（workspaces/documents/tasks/policies/billing）
4. 提供最小自动化测试（健康检查 + 核心数据接口）
5. 文档化运行流程与下一阶段演进路径

## 2. 执行结果

- [x] 已完成：`server.js` + `public/*` 前后端一体原型
- [x] 已完成：MVP 核心导航与 8 大功能区可视化
- [x] 已完成：Mock API 数据模型与 JSON 输出
- [x] 已完成：Node 原生测试脚本
- [x] 已完成：README 启动与验证说明

## 3. 环境限制与应对

- 限制：npm registry 在当前环境返回 403，无法安装 Next.js 依赖。
- 应对：采用零依赖方案，保证可执行、可测试、可快速迭代；后续网络权限恢复后可迁移到 Next.js。

## 4. 下一阶段（你验收后）

1. 迁移到 Next.js + TypeScript + Tailwind 工程。
2. 引入数据库（PostgreSQL + pgvector）并替换内存数据。
3. 接入对象存储与文档解析任务队列。
4. 接入真实 LLM/RAG 管线与策略审批流。
