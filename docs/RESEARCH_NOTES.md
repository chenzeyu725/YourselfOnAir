# 外部参考调研记录（2026-04-11）

## 1) 你提供的 ChatGPT 链接

- 链接：`https://chatgpt.com/.../69d22e4d-aa24-8325-9eea-2e9001bf065d`
- 结果：页面重定向到登录页，当前环境无法读取该对话正文。
- 处理：先按你提供的4个GitHub项目公开信息抽取可落地能力；你可补充该对话摘要后，我再二次对齐。

## 2) GitHub 项目可落地技术点映射

### A. `yourself-skill` / `colleague-skill`（同类方向）

落地点：
- 将“个人蒸馏”拆为 `Work Memory` 与 `Work Persona` 两层。
- 数据接入强调多源（文档、聊天、复盘）并保留可追溯证据。

当前落地：
- `api/data.js` 的 `distillation.self` + `provenance`。
- 任务对象包含 `evidenceRefs`。

### B. `nuwa-skill`

落地点：
- Expert 采用五层结构：表达DNA、心智模型、决策启发式、反模式、诚实边界。
- 强调“诚实边界”并在系统显式展示。

当前落地：
- `api/data.js` 的 `distillation.expert.fiveLayers`。
- 前端新增“诚实边界”区块。

### C. `pig-skill`

- 当前环境未成功抓取公开 README 内容（仓库可见性/网络路径限制）。
- 处理：暂先以上述三者共同方法（蒸馏 + 结构化记忆 + 可追溯）推进；拿到更完整资料后补齐差异对比。
