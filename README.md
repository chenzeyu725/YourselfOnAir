# YourselfOnAir MVP Prototype

这是一个零依赖（无第三方 npm 包）可运行原型，用于把 `PRODUCT_PLAN_V1.md` 的产品结构落到可演示系统。

## 本地快速启动
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

## 可以直接云端测试吗？

可以，**现在就可以直接云端测试**。项目已经补齐 Docker 部署配置，你可直接用 Render / Railway / Fly.io 之类平台部署。

### 方式 A：Render（最省事）

1. 把当前仓库推到 GitHub。
2. 在 Render 里新建 `Web Service`，选择本仓库。
3. Render 会自动识别根目录 `render.yaml` + `Dockerfile` 并构建。
4. 部署完成后访问：
   - `/` 查看页面
   - `/api/health` 看健康检查

### 方式 B：任意支持 Docker 的平台

```bash
docker build -t yourself-on-air-mvp .
docker run -p 3000:3000 yourself-on-air-mvp
```

然后访问 `http://localhost:3000/api/health`（云平台则换成你的域名）。

## 说明

- 当前环境无法访问 npm registry（403），所以未使用 Next.js 依赖安装。
- 已先完成信息架构验证与流程样板，后续可平滑迁移到 Next.js 技术栈。
