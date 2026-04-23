# Monet 实现 Checklist

基于当前分支实现情况，对照 `spec.md` 输出当前实现 checklist。

> 基线文档：`./spec.md`
> 评估对象：当前分支 `feat/initial-version`

---

## 1. 当前判断

- [x] Milestone 0 大体完成
- [ ] Milestone 1 完成
- [ ] Milestone 2 完成
- [ ] Milestone 3 完成
- [ ] Milestone 4 完成

当前整体状态：

- [x] 基础工程骨架已搭好
- [x] 启动链路已初步打通
- [ ] 产品主链路已可用

---

## 2. 基础工程 Checklist

### 2.1 Monorepo

- [x] 已建立 pnpm monorepo
- [x] 已有 `apps/*` 结构
- [x] 已有 `packages/*` 结构
- [x] 已配置 workspace 基础脚本

证据：

- `package.json`
- `pnpm-workspace.yaml`

### 2.2 Electron Desktop Shell

- [x] 已有 Electron main 入口
- [x] 已有 preload bridge
- [x] 已有 controller 拉起逻辑
- [x] 已有 single-instance 控制
- [ ] 已完整实现 controller fail / restart UI 反馈

证据：

- `apps/desktop/src/main.ts`
- `apps/desktop/src/preload.ts`

### 2.3 Next.js Web UI

- [x] 已建立 Next.js App Router 基础结构
- [x] 已有首页路由
- [x] 已有 sessions 页面骨架
- [x] 已有 settings 页面骨架
- [ ] 已优先接入 `@nexu-design/tokens`
- [ ] 已优先接入 `@nexu-design/ui-web`
- [ ] 已建立 UI 实现优先复用 Nexu 设计系统的约束
- [ ] 已实现真实 chat UI
- [ ] 已实现真实 session 数据渲染
- [ ] 已实现真实 provider 配置交互

设计系统约束：

- UI 优先使用 `@nexu-design/tokens` 管理颜色、间距、圆角、字体等设计 token
- 组件优先使用 `@nexu-design/ui-web`
- 仅在组件库无法覆盖场景时，再补充本地封装组件
- 避免直接写一套与设计系统脱节的临时样式
- Nexu Design 设计系统源代码仓库位于：`~/Projects/nexu-io/design`

证据：

- `apps/web-ui/src/app/page.tsx`
- `apps/web-ui/src/app/sessions/page.tsx`
- `apps/web-ui/src/app/settings/models/page.tsx`
- `apps/web-ui/src/app/settings/general/page.tsx`

### 2.4 Hono Controller

- [x] 已建立 Hono app 基础结构
- [x] 已有 health route
- [ ] 已实现 chat route
- [ ] 已实现 session routes
- [ ] 已实现 provider routes
- [ ] 已实现 tools confirm / continue / stop routes

证据：

- `apps/controller/src/app.ts`
- `apps/controller/src/routes/health.ts`

### 2.5 Database / Drizzle

- [x] 已建立 `packages/database`
- [x] 已建立 Drizzle schema
- [x] 已建立初始 migration
- [x] 已建立 SQLite 连接层
- [ ] 已确认 schema 完全覆盖最新 spec 字段
- [ ] 已确认 ID 采用语义前缀 + cuid2

证据：

- `packages/database/src/index.ts`
- `packages/database/src/schema.ts`
- `packages/database/src/schema/*.ts`
- `packages/database/migrations/0000_initial_schema.sql`
- `packages/database/drizzle.config.ts`

---

## 3. 启动链路 Checklist

### 3.1 Dev 启动链路

- [x] Electron 可启动
- [x] web-ui 可作为单独 app 存在
- [x] controller 可作为单独 app 存在
- [ ] `pnpm dev` 并行链路已完整验证
- [ ] dev 下 Electron → Next dev → Hono 的联通已验证

### 3.2 Prod 启动链路

- [x] 已有 prod 启动设计
- [ ] `app://` 自定义协议已完整落地
- [ ] 静态导出产物加载已完整验证
- [ ] controller ready 信号与 BrowserWindow 加载顺序已完整验证
- [ ] controller 崩溃后的恢复 UX 已完整实现

---

## 4. 数据模型 Checklist

- [x] 已有 `sessions` 表
- [x] 已有 `messages` 表
- [x] 已有 `runs` 表
- [x] 已有 `tool_calls` 表
- [x] 已有 `providers` / `provider_models` 表
- [ ] 已核对 `messages.run_id`
- [ ] 已核对 `tool_calls.approval_decision`
- [ ] 已核对 `tool_calls.approval_decided_at`
- [ ] 已核对 `tool_calls.confirmation_token_hash`
- [ ] 已核对 `wall_clock_deadline_at`
- [ ] 已核对 `ON DELETE SET NULL` 等 FK 细节

---

## 5. 产品主链路 Checklist

### 5.1 Chat

- [ ] 已实现 `POST /api/chat`
- [ ] 已实现 `streamText(...).toUIMessageStreamResponse()`
- [ ] web-ui 已真实接入 `useChat`
- [ ] 已完成消息持久化
- [ ] 已完成 providerId / modelId 解析与落库

### 5.2 Sessions

- [ ] 已实现 `GET /api/sessions`
- [ ] 已实现 `POST /api/sessions`
- [ ] 已实现 `GET /api/sessions/:id`
- [ ] 已实现 `POST /api/sessions/:id/archive`
- [ ] web-ui 已接入 session 列表与详情

### 5.3 Providers / Models

- [ ] 已实现 `GET /api/providers`
- [ ] 已实现 `POST /api/providers/:id/validate`
- [ ] 已实现 `GET /api/models`
- [ ] 已接入 OpenAI
- [ ] 已接入 OpenRouter
- [ ] web-ui 已接入 provider / model 配置页

---

## 6. Tool Runtime Checklist

### 6.1 Tools

- [ ] 已实现 `fetch_url`
- [ ] 已实现 `read_file`
- [ ] 已实现 `write_file`
- [ ] 已建立 tool registry
- [ ] 已建立 tool execution logging

### 6.2 Inline Confirm

- [ ] 已实现 `tool-input-available` → confirm card
- [ ] 已实现 `/api/tools/confirm`
- [ ] 已实现 `confirmationToken` 生成
- [ ] 已实现 `confirmationToken` 校验
- [ ] 已实现 `/api/runs/:runId/continue`
- [ ] 已实现 `write_file` 内联同步确认闭环

### 6.3 Run Lifecycle / Recovery

- [ ] 已实现 run lifecycle 状态管理
- [ ] 已实现 interrupted 标记
- [ ] 已实现应用启动时 unfinished runs 扫描
- [ ] 已实现 stop endpoint 闭环

---

## 7. OpenAPI / SDK Checklist

- [ ] 已建立 `apps/controller/src/openapi.ts`
- [ ] 已建立 `@hono/zod-openapi` schema 定义
- [ ] 已建立 `apps/controller/openapi.json` 生成脚本
- [ ] 已建立 `openapi-ts.config.ts`
- [ ] 已建立 hey-api 生成目录
- [ ] 已启用 TanStack Query options / keys generation
- [ ] 已建立 CI freshness check（`openapi.json` 过期即失败）

---

## 8. 里程碑 Checklist

### Milestone 0

- [x] 初始化 pnpm monorepo workspace
- [x] 接入 Electron + Next.js + Hono + TypeScript
- [x] 建立 SQLite / Drizzle 基础设施
- [x] 接入 shadcn/ui 基础骨架
- [ ] 接入 `@nexu-design/tokens`
- [ ] 接入 `@nexu-design/ui-web`
- [ ] 打通完整 dev/prod 启动链路
- [ ] controller 启动时自动执行 migration 并完整验证

### Milestone 1

- [ ] 接入 OpenAI
- [ ] 基于 `useChat` + `/api/chat` 实现流式对话
- [ ] 持久化 sessions / messages
- [ ] 实现会话列表与详情页
- [ ] 完成 run lifecycle 与中断恢复基础状态

### Milestone 2

- [ ] 建立工具注册表
- [ ] 实现 `fetch_url` / `read_file` / `write_file`
- [ ] 接入 `write_file` 内联同步确认
- [ ] 前端展示 tool status / result / confirm
- [ ] 配置 `stopWhen` / `maxSteps`

### Milestone 3

- [ ] 接入 OpenRouter
- [ ] 支持 OpenAI / OpenRouter 配置与切换
- [ ] 完成模型配置页

### Milestone 4

- [ ] 基础日志能力
- [ ] 发布流程完善
- [ ] auto-update 预留

---

## 9. 当前优先级 Checklist

建议优先做：

- [ ] 实现 `/api/chat` + `useChat` 最小对话闭环
- [ ] 补 Session API
- [ ] 接入 OpenAI provider
- [ ] 落地 `fetch_url` / `read_file` / `write_file`
- [ ] 实现 `write_file` 内联确认链路
- [ ] 补 OpenAPI + hey-api 生成流程

---

## 10. 一句话结论

- [x] 工程骨架已搭好
- [ ] 产品主链路已打通
