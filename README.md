# ifc-viewer

## 项目概览

这是一个带持久化能力的 IFC 查看与标注系统。

- 前端：`Vue 3 + Vite + Element Plus + ThatOpen`
- 后端：`Node.js + TypeScript + Fastify + Prisma`
- 数据库：`Docker MySQL 8.4`

当前系统会持久化：

- IFC 原始文件
- 全量构件快照
- ThatOpen 提取的原始构件数据
- 规范化后的构件属性
- 自定义属性
- 三维标注
- IFC 溯源指纹

## 持久化与溯源

### 导入

1. 前端上传 IFC 文件。
2. 后端计算并写入：
   - `fileHash`：本次上传文件的完整 SHA-256
   - `sourceFingerprint`：去掉自定义持久化区后的 IFC 基础内容指纹
3. 如果上传的 IFC 已包含导出时写入的溯源元数据，后端会校验其中的 `sourceFingerprint` 是否与当前文件基础内容一致。
4. 校验通过后保存原始 IFC 文件，并由前端触发 ThatOpen 全量快照同步。

### 导出

导出 IFC 时会把以下溯源信息写回 IFC 自定义区：

- `sourceFingerprint`
- `baseContentHash`
- `importedFileHash`
- `exportedAt`

这样即使文件经过多次编辑和重新导出，也能判断它们是否来自同一个基础 IFC。

## 目录结构

- `src/`：前端应用
- `apps/api/`：后端 API 服务
- `apps/api/prisma/schema.prisma`：Prisma 数据模型
- `apps/api/prisma/migrations/`：数据库迁移
- `apps/api/storage/uploads/`：服务端保存的 IFC 文件
- `docker-compose.yml`：MySQL 容器编排

## 环境准备

### 1. 安装前端依赖

```sh
npm install
```

### 2. 安装后端依赖

```sh
cd apps/api
npm install
Copy-Item .env.example .env
cd ../..
```

### 3. 启动 MySQL

```sh
docker compose up -d mysql
```

默认映射端口为 `3307`，避免占用本机 `3306`。

### 4. 初始化数据库

首次初始化推荐使用 migration：

```sh
cd apps/api
npm run prisma:generate
npm run prisma:migrate
cd ../..
```

如果你之前已经用 `prisma db push` 建过本地库，建议先清理旧开发库后再按 migration 重新初始化，避免历史 schema 漂移。

## 启动方式

### 仅启动前端

```sh
npm run dev
```

### 仅启动后端

```sh
npm run dev:api
```

### 同时启动前后端

```sh
npm run dev:full
```

默认地址：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`
- 健康检查：`http://localhost:3001/api/health`

## 检查与构建

### 前端类型检查

```sh
npm run type-check
```

### 前端构建

```sh
npm run build-only
```

### 后端类型检查

```sh
cd apps/api
npm run lint
```

### 后端构建

```sh
cd apps/api
npm run build
```

## 核心接口

- `POST /api/models/upload`：上传 IFC，并完成哈希校验与入库
- `POST /api/models/:modelId/snapshot/start`：开始一次全量构件快照同步
- `POST /api/models/:modelId/snapshot/chunk`：分批写入构件原始数据与属性
- `POST /api/models/:modelId/snapshot/complete`：完成快照同步
- `POST /api/models/:modelId/snapshot/fail`：标记快照同步失败
- `GET /api/models/:modelId/overlays`：读取自定义属性和标注
- `PUT /api/models/:modelId/custom-properties`：新增或更新单个自定义属性
- `DELETE /api/models/:modelId/custom-properties/:propertyId`：删除自定义属性
- `PUT /api/models/:modelId/annotations`：新增或更新标注
- `DELETE /api/models/:modelId/annotations/:annotationId`：删除标注

## 说明

- Vite 已配置 `/api` 代理到 `http://localhost:3001`。
- 后端 `.env.example` 默认使用 `3307` 端口连接 Docker MySQL。
- 模型重新加载时，如果数据库中的原生快照状态不是 `READY`，前端会自动重新触发同步。
