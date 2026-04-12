# YourselfOnAir 开发计划 V2（可执行 + 可验收）

> 日期：2026-04-11
> 范围：MVP → Alpha 的工程路线，强调可追溯、可测试、可演进。

## 0. 目标与约束

- 目标：实现“Self 蒸馏 + Expert 蒸馏 + 融合输出 + 口径治理”的端到端最小闭环。
- 约束：当前网络对 npm registry 存在 403 限制，先采用零依赖 Node 方案，后续迁移到 Next.js。

## 1. 阶段拆分

### Phase A（已完成）
1. API骨架与静态控制台
2. Self/Expert 双蒸馏结构接入
3. 融合权重预览与证据规则展示
4. 基础自动化测试

### Phase B（下一迭代，1-2周）
1. 引入持久化层（PostgreSQL）
2. 上传与索引异步化（任务队列）
3. 文档生成任务模板（Word/PDF）✅（已完成 API 版：模板列表 + 按模板创建任务）
4. 审批流 V1（策略变更审批）✅（已完成 API 版：申请 + 审批 + 回写策略）

### Phase C（Alpha，2-4周）
1. RAG 检索与引用链路
2. Expert 多实例管理（多视角并行）✅（本轮已完成 API 版：列表 + 新建 + 激活）
3. 工作流模板市场雏形
4. API 鉴权 + 配额计量（MVP 已实现基础版：`x-api-key` + 每日写配额）

## 2. 每阶段验收标准

- 功能验收：关键 API 全部可访问且字段齐全。
- 质量验收：单测通过率 100%，核心接口有回归用例。
- 安全验收：禁止目录穿越；敏感策略有审批标记。
- 可运维验收：健康检查可用于云平台探活。

## 3. 交付物清单

- 代码：`server.js`、`api/data.js`、`public/*`、`tests/*`
- 文档：`README.md`、`docs/TECHNICAL_STANDARDS.md`、`docs/RESEARCH_NOTES.md`
- 部署：`Dockerfile`、`render.yaml`
