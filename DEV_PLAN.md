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
