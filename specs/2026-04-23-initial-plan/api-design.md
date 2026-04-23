# Monet API 接口设计（OpenAPI / hey-api）

## 1. 目标

本文件定义 Monet MVP 的 API 接口范围，并约定 OpenAPI schema 与前端 SDK 生成方式。

目标：

1. API 定义可由 Hono 路由直接导出 OpenAPI
2. web 前端通过 hey-api 自动生成 TypeScript SDK
3. 后续可直接生成 TanStack Query options / query keys / mutation options
4. API 文档与代码同源，减少手写 client 漂移

---

## 2. 参考 cloudspec 的约定

吸收 `~/Projects/cloudspec` 的方式，建议采用以下结构：

### 2.1 OpenAPI 定义方式

- 在 `apps/controller/src/openapi.ts` 中集中定义可复用 schema
- 使用 `@hono/zod-openapi`
- 共享 schema 使用 `.openapi("SchemaName")` 命名
- 各领域路由放在 `apps/controller/src/routes/*.ts`
- 路由文件中使用 `createRoute(...)` + `app.openapi(...)` 定义接口
- 在 `apps/controller/src/app.ts` 中统一挂载路由并暴露 `/openapi.json`

### 2.2 OpenAPI 产物

- 通过脚本生成并提交 `apps/controller/openapi.json`
- 前端 SDK 生成以该文件为输入

### 2.3 hey-api 生成方式

建议在仓库根目录放：

- `openapi-ts.config.ts`

建议输出目录：

- `apps/web-ui/src/lib/api/generated`

建议插件组合：

- `@hey-api/typescript`
- `@hey-api/client-fetch`（或按需要选 client）
- `@hey-api/sdk`
- `@tanstack/react-query`

说明：

- cloudspec 当前只生成 `typescript + sdk + client`
- Monet 建议在此基础上 **额外启用 TanStack Query 代码生成**

### 2.4 TanStack Query 生成策略

建议生成：

- `queryOptions`
- `queryKeys`
- `mutationOptions`
- 如后续出现分页接口，再启用 `infiniteQueryOptions`

注意：

- hey-api 生成的是 options / keys helper，不是必须直接生成 hooks
- 前端可在业务层手动组合 `useQuery` / `useMutation`

---

## 3. 推荐目录结构

```text
apps/
├─ controller/
│  ├─ src/
│  │  ├─ app.ts
│  │  ├─ openapi.ts
│  │  └─ routes/
│  │     ├─ chat.ts
│  │     ├─ sessions.ts
│  │     ├─ providers.ts
│  │     └─ tools.ts
│  ├─ openapi.json
│  └─ scripts/
│     └─ generate-openapi.ts
└─ web-ui/
   └─ src/
      └─ lib/
         └─ api/
            └─ generated/
```

---

## 4. API 设计原则

1. 路由按领域拆分，不做单个超大文件
2. 所有请求 / 响应尽量显式 schema 化
3. 流式接口与普通 JSON 接口分开建模
4. 首期只覆盖 MVP 所需接口，不预埋 skills / connectors
5. SDK 生成目录只放自动生成内容，不手改
6. 每个接口应标注 `v0.1` 或 `post-v0.1`

### 4.1 ID 约定

接口中的主键统一使用 **带语义前缀的 cuid2**。

示例：

- `sessionId`: `ses_xxxxx`
- `message.id`: `msg_xxxxx`
- `runId`: `run_xxxxx`
- `toolCallId`: `tcl_xxxxx`
- `providerId`: `pro_xxxxx`
- `modelId`: `mod_xxxxx`

---

## 5. 接口分组

## 5.1 Health / System

### `GET /api/health`

阶段：`v0.1`

用途：

- Electron main 检查 controller 是否 ready
- 调试 UI 查看本地服务状态

### `GET /api/openapi.json`

阶段：`v0.1`

用途：

- hey-api 输入源
- 本地 OpenAPI 调试

---

## 5.2 Chat

### `POST /api/chat`

阶段：`v0.1`

用途：

- 发起一次新的 chat / agent 执行
- 返回 AI SDK UI Message Stream

说明：

- 这是首期最核心接口
- 输入至少包含 `sessionId`、`messages`、`providerId`、`modelId`、`runtimeOptions`

Wire schema 约定：

- `messages` 采用 AI SDK v5 `UIMessage[]`
- 每条 message 至少包含：`id`, `role`, `parts[]`
- 该接口返回 AI SDK UI Message Stream
- Web 前端应通过 `useChat` + `DefaultChatTransport` 消费此接口，而不是依赖 hey-api 生成 SDK

示意请求体：

```json
{
  "sessionId": "ses_xxxxx",
  "providerId": "pro_xxxxx",
  "modelId": "mod_xxxxx",
  "messages": [
    {
      "id": "msg_xxxxx",
      "role": "user",
      "parts": [{ "type": "text", "text": "hello" }]
    }
  ],
  "runtimeOptions": {
    "maxSteps": 8
  }
}
```

### `POST /api/runs/:runId/stop`

阶段：`v0.1`

用途：

- 主动中止当前生成

### `POST /api/runs/:runId/continue`

阶段：`v0.1`

用途：

- 在用户完成 `write_file` 等确认后，继续当前 run 的后续执行

说明：

- 该接口会开启新的 UI Message Stream
- 客户端不复用原 SSE 连接

---

## 5.3 Sessions

### `GET /api/sessions`

阶段：`v0.1`

用途：

- 获取会话列表

### `POST /api/sessions`

阶段：`v0.1`

用途：

- 创建新会话

### `GET /api/sessions/:sessionId`

阶段：`v0.1`

用途：

- 获取单个会话详情
- 返回基础信息 + 最近消息或完整消息

### `POST /api/sessions/:sessionId/archive`

阶段：`v0.1`

用途：

- 归档会话

### `POST /api/sessions/:sessionId/unarchive`

阶段：`post-v0.1`

用途：

- 取消归档

### `PATCH /api/sessions/:sessionId`

阶段：`post-v0.1`

用途：

- 更新会话标题
- 更新默认 provider / model

---

## 5.4 Messages / Runs

### `GET /api/sessions/:sessionId/messages`

阶段：`post-v0.1`

用途：

- 获取某个会话的消息列表

### `GET /api/runs/:runId`

阶段：`post-v0.1`

用途：

- 获取某次 run 的状态

### `GET /api/runs/:runId/tool-calls`

阶段：`post-v0.1`

用途：

- 获取某次 run 的工具调用记录

说明：

- 用于调试页或 tool 执行详情展示

---

## 5.5 Providers

### `GET /api/providers`

阶段：`v0.1`

用途：

- 获取 provider 列表

### `POST /api/providers`

阶段：`post-v0.1`

用途：

- 新增 provider 配置

### `PATCH /api/providers/:providerId`

阶段：`post-v0.1`

用途：

- 更新 provider 配置

### `POST /api/providers/:providerId/validate`

阶段：`v0.1`

用途：

- 校验 provider 配置是否可用

### `GET /api/models`

阶段：`v0.1`

用途：

- 获取所有可选模型

### `GET /api/providers/:providerId/models`

阶段：`post-v0.1`

用途：

- 获取某个 provider 下的模型列表

---

## 5.6 Tools

### `GET /api/tools`

阶段：`post-v0.1`

用途：

- 获取首期可用工具列表

### `POST /api/tools/confirm`

阶段：`v0.1`

用途：

- 提交 `write_file` 等高风险工具的内联确认结果

说明：

- 首期不做完整 approvals 系统
- 该接口只服务于当前会话内同步确认
- 成功后客户端应继续调用 `POST /api/runs/:runId/continue`

请求体约定：

```json
{
  "runId": "run_xxxxx",
  "toolCallId": "tcl_xxxxx",
  "decision": "approved",
  "confirmationToken": "opaque-token-from-server"
}
```

处理约定：

- 服务端校验 `confirmationToken` 是否与当前 `toolCallId` 绑定
- 成功后写回 `tool_calls.approval_decision` / `approval_decided_at`
- 客户端随后重新发起 continuation request，而不是复用原 SSE 连接

---

## 6. OpenAPI Schema 建议

建议在 `apps/controller/src/openapi.ts` 中集中定义：

- `ErrorSchema`
- `SessionSchema`
- `SessionDetailSchema`
- `MessageSchema`
- `RunSchema`
- `ToolCallSchema`
- `ProviderSchema`
- `ProviderModelSchema`
- `ArchiveSessionRequestSchema`
- `UpdateSessionRequestSchema`
- `CreateProviderRequestSchema`
- `UpdateProviderRequestSchema`
- `ToolConfirmRequestSchema`
- `ContinueRunRequestSchema`
- `ChatRequestSchema`
- `RunStopRequestSchema`

错误响应建议统一：

- `ErrorResponseSchema`

---

## 7. hey-api 配置建议

建议配置形态：

```ts
import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: 'apps/controller/openapi.json',
  output: {
    path: 'apps/web-ui/src/lib/api/generated',
  },
  plugins: [
    '@hey-api/typescript',
    '@hey-api/client-fetch',
    '@hey-api/sdk',
    {
      name: '@tanstack/react-query',
      queryOptions: true,
      queryKeys: true,
      mutationOptions: true,
    },
  ],
})
```

生成结果建议：

- `types.gen.ts`
- `sdk.gen.ts`
- `client.gen.ts`
- TanStack Query options / keys helpers
- `index.ts` barrel export

生成 SDK 使用规则：

- 普通 JSON 接口使用 hey-api 生成 SDK
- `/api/chat` 流式接口由 `useChat` 直接消费，不强制走生成 SDK
- 生成 client 需要支持运行时注入 `apiBase` 与 `Authorization` header（来自 preload）

---

## 8. Monorepo 脚本建议

建议根目录脚本：

- `generate:openapi`
  - `pnpm --filter @monet/controller generate:openapi`
- `generate:api`
  - `pnpm generate:openapi && openapi-ts`

建议开发约束：

1. 后端接口变更后必须同步更新 `openapi.json`
2. 前端合并前必须重新生成 SDK
3. 生成目录禁止手动修改
4. CI 在 `openapi.json` 过期时直接失败

---

## 9. 首期最小接口集合

如果只为 v0.1 demo slice，最小集合建议是：

- `GET /api/health`
- `POST /api/chat`
- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/:sessionId`
- `POST /api/sessions/:sessionId/archive`
- `GET /api/providers`
- `POST /api/providers/:providerId/validate`
- `GET /api/models`
- `POST /api/tools/confirm`

这样足够支持：

- 基础聊天
- 会话管理
- provider 设置
- `write_file` 内联确认
