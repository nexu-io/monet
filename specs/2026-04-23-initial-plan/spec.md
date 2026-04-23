# Claude Desktop 开源版实现方案（收缩版）

## 1. 背景与目标

目标是实现一个 **Claude Desktop 的开源版本**，聚焦以下核心能力：

1. Agent 对话执行
2. 工具调用
3. 会话管理
4. 模型供应商配置
5. 审批流与运行恢复

技术栈约束：

- Electron
- Node.js >= 24
- TypeScript
- Web UI: Next.js
- Controller: Node.js + Hono
- Database: SQLite
- UI 组件库: 优先 `@nexu-design/ui-web`，辅以 `@nexu-design/tokens`
- Agent / Chat 基础能力: **Vercel AI SDK v5**（重点采用 AI SDK UI）

首期模型供应商范围：

- OpenAI
- OpenRouter

设计原则：

1. **桌面优先**：优先保障本地体验、启动速度、稳定性。
2. **Agent-first**：围绕对话、工具、审批、恢复设计。
3. **先闭环再扩展**：先做稳定的 chat + persistence + tool + approval 主链路。
4. **最小暴露面**：Electron、工具、provider secrets、localhost API 都默认最小权限。
5. **避免过度设计**：暂不引入 skill、connector 等复杂层。
6. **明确非目标**：MVP 不做中途断流恢复，只做审批后的继续执行与重启后的状态恢复。

---

## 2. 产品范围

### 2.1 首期必须支持

1. Agent 对话执行
2. 工具调用
3. 会话管理（创建、查看、切换、归档）
4. 模型与供应商配置（仅 OpenAI / OpenRouter）
5. 工具审批流
6. 运行中断后的状态恢复

### 2.2 首期明确不做

1. Skill 系统
2. Connector 系统
3. 通用 shell tool
4. 多设备同步
5. 云端托管执行
6. Marketplace / 插件商店
7. 团队协作与复杂权限体系

---

## 3. 总体架构

建议采用 **Electron Shell + Next.js UI + 本地 Hono Controller + SQLite** 的单机架构。

```text
┌─────────────────────────────────────────────┐
│ Electron Main Process                       │
│ - 窗口生命周期                              │
│ - 本地服务编排                              │
│ - preload / IPC                             │
│ - 本地鉴权 token 管理                       │
│ - 单实例控制 / 崩溃恢复                     │
└───────────────┬─────────────────────────────┘
                │
         IPC / Local HTTP
                │
┌───────────────▼─────────────────────────────┐
│ Next.js Web UI                              │
│ - 会话列表                                  │
│ - Chat 界面                                  │
│ - Tool / Approval 执行态                    │
│ - 设置页（provider / model）                │
│ - shadcn/ui                                 │
│ - AI SDK UI(useChat)                        │
└───────────────┬─────────────────────────────┘
                │ HTTP/SSE
┌───────────────▼─────────────────────────────┐
│ Hono Controller                             │
│ - Chat API                                  │
│ - Session API                               │
│ - Provider API                              │
│ - Approval API                              │
│ - Agent Runtime                             │
│ - Tool Registry                             │
│ - Run Recovery Service                      │
└───────────────┬─────────────────────────────┘
                │
┌───────────────▼─────────────────────────────┐
│ SQLite                                      │
│ - sessions                                  │
│ - messages                                  │
│ - runs                                      │
│ - tool_calls                                │
│ - providers / models                        │
└─────────────────────────────────────────────┘
```

### 3.1 为什么采用本地 Hono Controller

虽然 Electron 内可以直接使用 AI SDK 的 `DirectChatTransport`，但本项目更适合优先采用：

- 前端：`useChat` + `DefaultChatTransport`
- 后端：Hono 中通过 `streamText(...).toUIMessageStreamResponse()` 输出 UI Message Stream

原因：

1. 更适合承载 **工具调用、审批、持久化、恢复、审计**。
2. 更容易保持 Web UI 与 Runtime 解耦。
3. 统一在 controller 层做鉴权、日志、重试、run 生命周期管理。

### 3.2 Next.js 在 Electron 中的运行方式

保留 Next.js，但采用以下约束：

1. `apps/web-ui` 使用 Next.js App Router。
2. 使用当前官方静态导出方式：`output: 'export'`。
3. **生产模式采用静态导出产物**，打包进 Electron。
4. **不运行 `next start`**，不引入第二个本地 Web 服务。
5. **不使用 `next export` 命令**，而是通过 `next build` 产出 `out/` 目录。
6. **不使用 Next.js API routes**，所有动态能力统一走 Hono Controller。

dev / prod 策略：

- **dev**：使用 `next dev` 提供 renderer，Electron 直接 `loadURL(http://127.0.0.1:<next-port>)`
- **prod**：加载 Next.js 静态导出产物，renderer 不依赖 Next.js server runtime
- Hono 在 dev / prod 中都作为唯一业务后端存在

生产环境建议：

- Electron 注册 `app://` 自定义协议，优先通过该协议加载打包后的 `out/` 目录
- 若实现复杂度需要，可短期用 `file://` 过渡，但长期建议统一为 `app://`

### 3.2.1 Next.js 静态导出约束

由于使用 `output: 'export'`，需要明确以下边界：

1. 不使用 Server Actions
2. 不使用依赖运行时请求对象的 Route Handlers
3. 不使用 `cookies()`
4. 不使用 ISR
5. 不使用 rewrites / redirects / headers / proxy
6. 不依赖默认 `next/image` 优化能力
7. 不依赖运行时动态路由预渲染

落地建议：

- 会话详情等运行时页面优先走客户端路由或 query 参数
- 所有运行时数据统一通过 Hono API 获取
- Next.js 在本项目中主要承担 UI、路由组织与构建职责，而不是服务端运行时职责

### 3.3 进程编排原则

Electron Main 负责：

1. `app.requestSingleInstanceLock()`，禁止多开
2. 通过 `utilityProcess.fork` 拉起 Hono controller，避免把 runtime 直接塞进 main process
3. controller 启动与健康检查
4. controller 端口选择与冲突处理
5. controller 崩溃后的 UI 错误提示与可选重启
6. 应用退出时清理子进程

推荐启动时序：

1. main 进程生成本次启动用的 bearer token
2. main 通过 `utilityProcess.fork` 启动 controller
3. controller 成功监听后回传 `{ port, tokenAccepted: true }`
4. main 将 `port` 与受限请求能力注入 preload
5. renderer 再启动并连接 `http://127.0.0.1:<port>`

renderer 注入建议：

- preload 通过 `contextBridge` 暴露 `apiBase` 与受限请求方法
- prod 不依赖 `NEXT_PUBLIC_API_BASE` 作为最终接口来源
- dev 可以用环境变量辅助，但 prod 以 preload 注入为准

说明：

- 文档中的 `IPC / Local HTTP` 以 **Local HTTP/SSE 为主链路**
- IPC 仅用于 main 与 controller 子进程之间的启动编排，不用于业务 API

### 3.3.1 Electron + Hono + Next 启动链路

建议把启动链路明确拆成 **dev** 与 **prod** 两条：

#### Dev 启动链路

1. `pnpm dev` 并行启动：
   - `apps/web-ui` → `next dev`
   - `apps/controller` → Hono dev server / watcher
   - `apps/desktop` → Electron main
2. Electron main 启动后先获取单实例锁。
3. main 检查 Hono dev 服务健康状态；若未就绪，则展示启动中界面或重试。
4. main 创建 preload 上下文，并注入：
   - `apiBase = http://127.0.0.1:<controller-port>`
   - 本次启动 bearer token
   - 受限 API 方法
5. BrowserWindow 在 dev 下加载 `http://127.0.0.1:<next-port>`。
6. renderer 中的 `useChat` / 数据请求统一访问本地 Hono。

#### Prod 启动链路

1. Electron main 启动后先获取单实例锁。
2. main 生成本次启动用 bearer token。
3. main 使用 `utilityProcess.fork` 拉起 Hono controller。
4. controller 完成以下动作后回传 ready 信号：
   - 绑定 `127.0.0.1:<ephemeral-port>`
   - 初始化 SQLite 连接
   - 执行必要 migration / health check
   - 注册 chat / session / provider 路由
5. main 收到 ready 信号后注册 `app://` 协议，并让 renderer 可读取静态导出的 `out/` 资源。
6. main 创建 preload 上下文，并注入：
   - `apiBase = http://127.0.0.1:<controller-port>`
   - bearer token
   - 受限 API 方法
7. BrowserWindow 在 prod 下加载 `app://index.html`（或等价入口）。
8. renderer 启动后通过 preload 拿到 `apiBase`，所有动态数据请求都走 Hono。
9. 若 controller 在运行时崩溃，main 捕获退出事件，更新 UI 到“本地服务异常”状态，并允许重试启动。

#### 关闭链路

1. 用户退出应用或触发更新。
2. main 先通知 controller 进入 shutdown 流程。
3. controller 停止接受新请求，并把 in-flight run 标记为 `interrupted`。
4. controller flush SQLite / 日志后退出。
5. main 再销毁窗口并结束应用。

---

## 4. 建议目录结构

```text
.
├─ apps/
│  ├─ desktop/                 # Electron main/preload
│  ├─ web-ui/                  # Next.js + shadcn/ui + AI SDK UI
│  └─ controller/              # Hono server / agent runtime
├─ packages/
│  ├─ shared/                  # 通用类型、schema、常量
│  ├─ database/                # Drizzle schema + migrations + repository
│  ├─ agent-core/              # runtime / loop control / run lifecycle
│  ├─ tools/                   # 内置工具与 tool registry
│  ├─ providers/               # OpenAI / OpenRouter provider factory
│  └─ ui/                      # 可复用 UI 组件
├─ specs/
├─ package.json
└─ pnpm-workspace.yaml
```

Monorepo 约定：

- 使用 **pnpm monorepo** 管理 workspace
- `apps/*` 与 `packages/*` 统一纳入 `pnpm-workspace.yaml`
- 依赖安装、脚本执行、过滤构建统一使用 `pnpm`

---

## 5. 核心模块设计

## 5.1 Desktop Shell（Electron）

职责：

- 启动桌面应用
- 管理窗口生命周期
- 启动本地 controller
- 通过 preload 暴露安全白名单能力
- 管理本地文件路径、日志目录、数据库目录
- 管理 renderer -> controller 的本地 bearer token

建议：

- `contextIsolation: true`
- `nodeIntegration: false`
- 所有系统级能力走 `preload + IPC`
- secrets 优先接入系统安全存储
- 数据目录统一放在 `app.getPath('userData')`
- 强制单实例

## 5.2 Web UI（Next.js）

职责：

- 展示会话列表与消息流
- 发起聊天请求
- 展示工具执行状态、审批状态、错误状态
- 管理 provider / model 配置
- 提供本地服务异常提示

设计系统约束：

- UI 优先使用 `@nexu-design/tokens` 管理设计 token
- 组件优先使用 `@nexu-design/ui-web`
- 仅在组件库无法覆盖时，再补充本地封装组件
- Nexu Design 源码仓库位于：`~/Projects/nexu-io/design`

关键实现：

- 使用 **AI SDK UI v5 `useChat`** 作为聊天主状态层
- 使用 `prepareSendMessagesRequest` 附带 `sessionId`、provider、model、auth token
- 基于 `messages[].parts` 渲染，而不是只渲染纯文本
- 首期至少支持以下 part 类型：
  - `text`
  - `reasoning`
  - `tool-*`
  - `dynamic-tool`
  - `step-start`
  - `file`
  - `source-url` / `source-document`

实现注意：

- tool 审批卡片只能在 `tool-input-available` 之后展示，避免展示半流式输入
- `reasoning` part 为“有则展示”，不能作为首期功能验收的硬依赖

页面建议：

1. `/`：主聊天页
2. `/sessions`：会话列表
3. `/settings/models`：provider / model 配置
4. `/settings/general`：通用设置

路由建议：

- 避免把运行时 session id 强绑定到静态导出路径结构
- 优先使用客户端状态或 query 参数承载当前会话上下文

## 5.3 Controller（Node + Hono）

职责：

- 暴露 chat / session / provider API
- 管理 agent 运行上下文
- 注册工具并执行工具循环
- 持久化会话、消息、运行记录
- 管理内联审批与 run 恢复

建议模块：

- `chat-router`
- `session-router`
- `provider-router`
- `runtime-service`
- `tool-execution-service`
- `message-persistence-service`
- `run-recovery-service`
- `local-auth-service`

## 5.4 Database（SQLite）

详细 schema 设计见：[database-schema.md](./database-schema.md)

建议存储：

- sessions
- messages
- runs
- tool_calls
- providers / models

关键要求：

- **消息持久化以 AI SDK v5 `UIMessage[]` 为准**
- `messages` 表增加 `ui_message_schema_version`
- `messages` 表增加 `idempotency_key`
- `messages` 表增加可空 `run_id`
- SQLite 开启 WAL 模式
- 大 tool output 只存摘要或截断结果，避免数据库膨胀

迁移策略：

- 读取历史 `UIMessage` 时先按 `ui_message_schema_version` 做 read-side upcast
- 遇到未知 part 类型时不静默覆盖原数据，而是按“未知 part”保留并降级展示
- 不在读请求中隐式重写历史消息行

### 5.4.1 数据访问层选型

推荐组合：

- 查询/ORM：**Drizzle ORM**
- SQLite 驱动：**better-sqlite3**
- 迁移工具：**drizzle-kit**

落地方式：

- `packages/database` 维护 Drizzle schema、repository 与 migration
- migration 产物使用可审查的 SQL 文件并提交到仓库
- controller 启动时自动执行待执行 migration，失败则阻止 ready 信号
- repository 层统一封装查询，上层不直接拼接 ad-hoc SQL

选型理由：

- 比 raw SQL 更省基础设施成本，同时保留 SQL-first 的可控性
- 比 Prisma 更适合 Electron + SQLite，本地打包成本更低
- 与 `better-sqlite3` 同步 API 配合更自然，适合本地桌面应用
- 迁移文件是普通 SQL，便于 review、回滚和审计

实现约束：

- JSON 字段在 repository 边界做 zod 校验
- `drizzle-kit` 仅作为 dev dependency
- 运行时只依赖 `drizzle-orm` + `better-sqlite3`

### 5.4.2 ID 生成约定

所有主键使用 **带语义前缀的 cuid2**。

建议前缀：

- session: `ses_`
- message: `msg_`
- run: `run_`
- tool call: `tcl_`
- provider: `pro_`
- provider model: `mod_`

示例：

- `ses_xxxxx`
- `msg_xxxxx`
- `run_xxxxx`

约束：

- 前缀仅用于可读性和调试，不替代 FK 与类型约束
- API 示例、OpenAPI schema、数据库写入逻辑都必须统一使用该约定

---

## 6. Agent Runtime 设计

## 6.1 执行模型

建议采用 **Vercel AI SDK v5 + Tool Calling + 多步循环** 作为主实现方式。

主流程：

1. 前端通过 `useChat` 发起请求
2. `prepareSendMessagesRequest` 附带 `sessionId`、provider、model、metadata
3. Hono chat route 读取当前 session 历史与 run 状态
4. Controller 组装 system prompt、上下文、可用工具集
5. 基于 AI SDK `tool()` 注册工具
6. 使用 `streamText` 执行模型调用
7. 使用 `stopWhen` / `maxSteps` 控制多步执行
8. 为每个 run 增加 `maxTokensPerRun`、`wallClockDeadlineAt`、单工具调用次数上限
9. 通过 `toUIMessageStreamResponse()` 输出给前端
10. 在服务端保存 `originalMessages + generated messages`

强约束：

- 必须固定 AI SDK v5 主版本
- 不允许无限循环，必须显式配置 `stopWhen`
- 不允许单一 tool 在一个 run 中无限重试
- 每个 run 必须记录 step 数、结束原因、错误状态

## 6.2 Runtime 分层

### a. Conversation Runtime

- 管理 session 消息上下文
- 控制 token 裁剪、summary、上下文窗口
- 管理 tool result 截断与历史压缩

### b. Agent Planner

- 判断是直接回答还是调用工具
- 决定是否进入多步执行
- 高风险操作仅输出待审批动作，不直接执行

### c. Tool Executor

- 执行具体工具
- 记录输入、输出、耗时、错误
- 对高风险工具触发审批

### d. Run Lifecycle Manager

- 管理 `pending -> running -> completed/failed/interrupted`
- 标记 orphan run
- 在应用重启后恢复可恢复状态

## 6.3 上下文与 token 管理

这是首期必须落地的核心能力：

1. **滑动窗口**：默认只带入最近 N 条消息 + 必要系统提示。
2. **长会话摘要**：超过阈值后生成 summary，替代更早的历史片段。
3. **工具结果截断**：过长输出只保留摘要、关键字段或附件引用。
4. **reasoning 处理**：UI 可展示，但不默认全量回灌到后续 prompt。
5. **大文件处理**：优先回灌摘要与引用，而不是原文。
6. **Run 总预算**：单次运行必须同时受 step、token、时间三种预算限制。

## 6.4 工具边界

首期只保留一种执行实体：**Tool**。

每个 tool 建议包含：

- `name`
- `description`
- `inputSchema`（zod）
- `riskLevel`
- `requiresApproval`
- `execute(context, input)`

---

## 7. Tool Calling 与审批流

## 7.1 工具注册表

工具实现建议以 AI SDK v5 的 `tool()` 为基础，再包一层应用元数据。

首期建议只做：

1. `fetch_url`
2. `read_file`（限制在用户授权目录）
3. `write_file`（必须审批）

`bash` 不进入 v0.1 demo slice，但建议提前按 MVP 规格设计，作为紧随其后的增强工具。

补充约束：

- `fetch_url` 默认仅允许 HTTPS
- `read_file` / `write_file` 都必须经过授权目录校验

## 7.2 轻量审批机制

v0.1 不做完整 approvals 系统，改为 **内联同步审批**。

高风险操作仍然必须支持确认，例如：

- 写文件/删文件
- 对外发送带敏感内容的数据

首期默认策略：

- `fetch_url`：直接执行
- `read_file`：在授权目录内直接执行
- `write_file`：必须确认

内联确认流：

1. 模型产生 tool call
2. Controller 判断工具是否需要审批
3. 若需要，则在 `tool-input-available` 后结束当前流式响应，并返回继续执行所需的确认上下文
4. 前端展示确认卡片，并拿到服务端生成的 `confirmationToken`
5. 用户批准/拒绝后，前端调用确认接口提交 `{ runId, toolCallId, decision, confirmationToken }`
6. Controller 校验 token、写回 `tool_calls`，再基于持久化状态启动新的 continuation request
7. Runtime 基于决策结果继续或终止执行

实现建议：

- 不引入独立 `approval_requests` 表
- 不引入独立 approvals router
- 不引入异步审批队列
- 决策结果直接写回 `tool_calls`
- `tool_calls` 增加：`approval_decision`、`approval_decided_at`
- 用户长时间不确认时默认拒绝
- `confirmationToken` 由服务端生成并绑定到当前 `toolCallId`

边界声明：

- 本方案中的“继续执行”仅指 **当前会话内的同步确认后重新发起 continuation request**
- **不包含独立审批队列，也不包含 mid-stream 网络断流恢复**
- 后续若需要异步审批，再把 `tool_calls` 上的审批字段抽成独立表

## 7.3 Bash Tool（后续）

`bash` 不属于当前 MVP。详细设计建议移到后续独立文档（如 `future/bash-tool.md`），当前只保留以下约束：

- `bash` 不进入 v0.1 demo slice
- 若后续引入，必须使用只读 allowlist + confirm 模式
- 不替代 `read_file` / `write_file` 这类结构化工具

---

## 8. 会话管理设计

## 8.1 Session 数据模型

建议核心表：

- `sessions`
  - `id`
  - `title`
  - `created_at`
  - `updated_at`
  - `archived_at`
  - `default_provider_id`
  - `default_model_id`

- `messages`
  - `id`
  - `session_id`
  - `run_id`
  - `role`
  - `ui_message_json`
  - `ui_message_schema_version`
  - `idempotency_key`
  - `created_at`

- `runs`
  - `id`
  - `session_id`
  - `status`
  - `provider_id`
  - `model_id`
  - `current_step`
  - `max_steps`
  - `wall_clock_deadline_at`
  - `finish_reason`
  - `started_at`
  - `ended_at`

- `tool_calls`
  - `id`
  - `run_id`
  - `tool_name`
  - `input_json`
  - `output_json`
  - `output_truncated`
  - `output_size_bytes`
  - `approval_decision`
  - `approval_decided_at`
  - `confirmation_token_hash`
  - `status`
  - `error_message`

## 8.2 删除与保留策略

- 首期优先采用 archive / soft delete
- hard delete 作为二级危险操作
- hard delete 时级联清理 messages / runs / tool_calls

索引与约束建议：

- `messages.session_id`, `runs.session_id`, `tool_calls.run_id` 建立索引
- 外键明确使用 `ON DELETE CASCADE`（仅 hard delete 路径触发）
- `messages.idempotency_key` 在 session 维度内唯一
- `messages.idempotency_key` 由客户端按用户消息生成，服务端用于幂等去重

## 8.3 会话能力

首期支持：

- 创建会话
- 会话列表展示
- 标题自动生成
- 查看历史消息
- 归档会话

后续再加：

- 内容搜索
- pin/favorite
- 标签分类
- 导出会话
- 会话分支

---

## 9. 模型与供应商配置

## 9.1 Provider 范围与实现策略

首期只支持：

- OpenAI
- OpenRouter

实现策略：

- 不重新抽象一整套模型 SDK
- 仅维护 provider 配置、模型元数据与 AI SDK provider factory 映射
- 运行时直接基于 AI SDK 官方 provider 包创建模型实例

推荐：

- `@ai-sdk/openai`
- OpenRouter 对应的 AI SDK provider 包，或兼容 OpenAI 的 provider 接入方式

Controller 内保留的最小接口：

- `validateConfig()`
- `createModelInstance()`
- `listConfiguredModels()`

模型解析规则：

- API 层优先接收 `providerId` + `modelId`
- 若 UI 当前只有 `modelName`，则必须先经 provider/models 接口解析成 `modelId`
- `runs` 持久化时统一写入 `provider_id` / `model_id`

## 9.2 配置项

每个 provider 配置至少包括：

- provider 类型
- display name
- api key / base url
- 默认模型
- 启用状态
- 超时配置

首期约束：

- provider 类型仅允许 `openai` / `openrouter`
- 先支持文本与工具调用能力
- 高级多模态能力不作为首期验收项

敏感信息建议：

- 非敏感元数据可进 SQLite
- API Key 等敏感字段存系统安全存储

---

## 10. API 设计草案

详细接口设计见：[api-design.md](./api-design.md)

## 10.1 Chat

- `POST /api/chat`
  - 输入：`sessionId`, `messages`, `providerId`, `modelId`, `attachments`, `runtimeOptions`
  - 输出：AI SDK UI Message Stream

Wire schema 约定：

- `messages` 采用 AI SDK v5 `UIMessage[]` 结构
- 每条 message 至少包含：`id`, `role`, `parts[]`
- `/api/chat` 为流式接口，前端通过 `useChat` + `DefaultChatTransport` 消费
- 该接口不要求通过 hey-api 生成 SDK 调用

- `POST /api/runs/:runId/stop`
  - 输入：`runId`
  - 输出：`{ ok: true }`

- `POST /api/runs/:runId/continue`
  - 输入：`runId`, `toolCallId`, `decision`, `confirmationToken`
  - 输出：AI SDK UI Message Stream

## 10.2 Sessions

- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/:id`
- `POST /api/sessions/:id/archive`

## 10.3 Providers

- `GET /api/providers`
- `POST /api/providers`
- `PATCH /api/providers/:id`
- `POST /api/providers/:id/validate`
- `GET /api/models`

约束：

- 首期只返回 OpenAI / OpenRouter 相关 provider

说明：

- `GET /api/models` 返回可选模型列表
- chat 请求最终应提交 `providerId` / `modelId`

## 10.4 Tools

- `GET /api/tools`
- `POST /api/tools/confirm`

说明：

- `GET /api/tools` 从 in-process tool registry 读取，不走数据库
- `POST /api/tools/confirm` 仅用于当前会话内同步确认
- 请求体至少包含：`runId`, `toolCallId`, `decision`, `confirmationToken`

## 11. 前端交互设计重点

## 11.1 Chat 主界面

需要重点支持以下 UI 状态：

1. 用户消息
2. assistant 流式输出
3. reasoning 折叠显示
4. tool call 执行中
5. tool result 展示
6. `write_file` 确认卡片
7. 错误与重试
8. 中止生成 / 重新生成
9. controller 未启动 / 本地服务异常状态

## 11.2 shadcn/ui 组件建议

- Sidebar：会话列表
- Tabs：设置页切换
- Dialog / Sheet：provider 配置
- Card：tool call / confirm / 状态展示
- Form：provider 配置表单
- Alert：controller 启动失败 / 本地服务异常提示

---

## 12. 安全设计

必须优先考虑：

1. Electron renderer 不直接暴露 Node 能力
2. 所有危险操作必须可审批
3. API key 不以明文存 SQLite
4. file/network 工具默认最小权限
5. controller 仅监听 `127.0.0.1`
6. renderer -> controller 请求必须带每次启动生成的 bearer token
7. renderer 配置严格 CSP，消息渲染必须做 XSS 防护
8. Linux 下若无系统安全存储，需要明确降级策略或禁用保存 secrets
9. `fetch_url` 需要 SSRF 防护

## 12.1 本地 HTTP 安全

本地 controller 虽只在本机运行，但不能默认信任本机所有进程。

必须实现：

1. controller 仅绑定 loopback 地址
2. Electron Main 启动时生成随机 session token
3. preload 向 renderer 注入受限请求能力
4. Hono 中间件校验 Authorization header
5. 拒绝未知 origin
6. 校验 `Host` header，仅允许 `127.0.0.1:<port>` / `localhost:<port>`
7. 不返回 `Access-Control-Allow-Origin`，不使用 cookie 作为认证方式

token 约束：

- token 不写入日志
- renderer reload 后重新注入
- 不通过普通全局变量暴露，而是通过 preload 暴露最小请求接口
- 所有业务请求统一使用 `Authorization` header

## 12.2 高风险工具安全边界

首期建议：

- 不实现通用 shell tool
- `read_file` 仅允许访问用户通过 OS 文件选择器授权的目录
- `write_file` 必须审批，并限制在授权目录
- 工具输入输出默认做长度限制与脱敏记录

若后续引入 `bash`：

- 默认只允许只读 allowlist 命令自动执行
- 写操作 / 网络命令必须确认
- 高风险命令默认拒绝
- 必须支持 timeout、cancel、output cap

目录授权规则：

- controller 持久化授权目录 allowlist
- 所有文件访问先做 `realpath` 再判断前缀，防止 symlink escape
- 默认按应用级授权目录执行，后续可扩展为 session 级授权

`fetch_url` 约束：

- 默认仅允许 HTTPS
- 阻止访问 loopback、RFC1918 私网、link-local、metadata IP
- 阻止访问 controller 自己的端口
- 限制重定向次数与响应体大小
- 后续若支持例外域名放通，必须走显式配置

---

## 13. 日志、观测与调试

建议记录：

- 应用日志
- 模型请求日志（脱敏）
- tool call 日志
- 内联确认决策日志
- 性能指标（首 token 时间、总耗时、错误率）

建议结合 AI SDK telemetry 记录最小必要指标。

---

## 14. 运行恢复与发布工程

## 14.1 Run 恢复策略

应用重启时扫描未完成 `runs`：

- `running`：标记为 `interrupted`
- `pending`：标记为 `failed` 或重新排队，按实现复杂度二选一

原则：

- 不做隐式继续执行
- 所有恢复都必须有明确 UI 状态

## 14.2 发布工程

从首期开始预留：

- macOS code signing / notarization
- Windows code signing
- 单实例运行
- auto-update 预留接口
- 数据目录与日志目录策略

工程建议：

- 优先采用 `electron-builder`
- 使用 `better-sqlite3` + `@electron/rebuild`，在 `apps/desktop` 的 postinstall 中对齐 Electron ABI
- 应用更新前应优雅停止 controller，并把 in-flight run 标记为 `interrupted`
- 打包时将 Next.js `out/` 目录作为 renderer 静态资源一起分发
- 启用 Electron fuses（禁用 `RunAsNode`、关闭不必要的 inspect/debug 能力、仅允许从打包产物加载）
- SQLite 文件默认放在 `app.getPath('userData')` 下，并以仅当前用户可读写权限创建

---

## 15. 里程碑拆分

## Milestone 0：脚手架与基础设施

- 初始化 pnpm monorepo workspace
- 接入 Electron + Next.js + Hono + TypeScript
- 建立 SQLite schema（Drizzle）与 drizzle-kit migration 流程
- 接入 shadcn/ui
- 优先接入 `@nexu-design/tokens` / `@nexu-design/ui-web`
- 打通 Electron 启动本地 controller + 静态导出的 web-ui
- 明确 dev 使用 `next dev`、prod 使用静态导出产物
- 完成 single-instance lock
- 完成本地 bearer token 鉴权
- controller 启动时自动执行待执行 migration，失败阻塞 ready 信号

交付标准：

- 桌面应用可启动
- UI 可访问 controller API
- 可写入并读取 SQLite
- controller 启动失败可被 UI 感知

## Milestone 1：最小聊天闭环

- 接入 OpenAI
- 基于 `useChat` + `/api/chat` 实现流式对话
- 持久化 sessions / messages
- 实现会话列表与详情页
- 完成 run lifecycle 与中断恢复基础状态

交付标准：

- 可创建会话并持续对话
- 重启应用后历史消息可恢复
- 未完成 run 在重启后状态正确

## Milestone 2：工具调用闭环

- 建立工具注册表
- 实现 `fetch_url` / `read_file` / `write_file`
- 接入 `write_file` 内联同步确认
- 前端展示 tool status / result / confirm
- 配置 `stopWhen` / `maxSteps`

交付标准：

- agent 可实际调用工具完成任务
- `write_file` 执行前必须确认

## Milestone 3：Provider 配置完善

- 接入 OpenRouter
- 支持 OpenAI / OpenRouter 配置与切换
- 完成模型配置页

交付标准：

- 用户可在 UI 中配置并切换 OpenAI / OpenRouter

## Milestone 4：日志、调试与发布完善

- 基础日志能力
- 发布流程完善
- auto-update 预留

交付标准：

- 具备可发布的桌面应用基础能力

---

## 16. 开发优先级建议

优先顺序建议：

1. **聊天闭环**
2. **会话持久化**
3. **工具调用 + 审批**
4. **provider 配置增强**
5. **日志与发布能力**

原因：

- 聊天闭环是所有体验的核心
- 工具、审批、恢复决定产品是否真正可用
- provider 扩展应建立在 runtime 稳定之上

---

## 17. 关键技术决策总结

1. **Chat 层使用 AI SDK UI + `useChat`**，快速获得流式消息、多 part 渲染和工具调用能力。
2. **Controller 采用 Hono + `streamText` + UI Message Stream**，而不是把执行逻辑塞进 renderer 或 Electron main。
3. **Web UI 使用静态导出的 Next.js**，生产模式不运行独立 Next server。
4. **消息以 `UIMessage` 持久化**，并带 schema version，避免消息结构漂移。
5. **首期只保留 Tool 一种执行实体**，避免过度设计。
6. **本地 HTTP 必须鉴权**，不能默认信任 localhost。
7. **敏感写操作走内联确认**，默认最小权限。

---

## 18. 首期落地建议

如果目标是尽快做出第一个 **v0.1 demo slice（小于完整 MVP）**，建议先只做：

- OpenAI 1 个 provider
- 1 个主聊天页面
- sessions 创建 / 列表 / 查看 / 归档
- `fetch_url` + `read_file`
- `write_file` 内联同步确认
- run lifecycle / interrupted state
- 基础 provider 配置页

暂不进入首期：

- OpenRouter 支持
- shell tool
- 调试页
- 发布工程完善

这样可以先把聊天、持久化、工具、审批、恢复这条主链路做稳定，再扩展范围。

---

## 19. 下一步建议

基于本方案，下一步可以继续输出：

1. Monorepo 初始化目录与 package 规划
2. SQLite schema 设计草案
3. Hono API contract
4. Chat 页面线框图
5. Tool TypeScript 类型定义
