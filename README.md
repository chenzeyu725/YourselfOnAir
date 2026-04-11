# YourselfOnAir MVP Prototype

这是一个零依赖（无第三方 npm 包）可运行原型，用于把 `PRODUCT_PLAN_V1.md` 的产品结构落到可演示系统。

## 快速启动

```bash
npm run dev
```

打开：`http://localhost:3000`

## API 列表

- `GET /api/health`
- `GET /api/workspaces`
- `GET /api/documents`
- `GET /api/tasks`
- `GET /api/policies`
- `GET /api/billing`

## 测试

```bash
npm test
```

## 说明

- 当前环境无法访问 npm registry（403），所以未使用 Next.js 依赖安装。
- 已先完成信息架构验证与流程样板，后续可平滑迁移到 Next.js 技术栈。
