# Monet 数据库 Schema 设计（SQLite）

## 1. 目标

本文件定义 Claude Desktop 开源版 MVP 的 SQLite 数据库设计，覆盖：

- sessions
- messages
- runs
- tool_calls
- providers
- provider_models

设计目标：

1. 以 `UIMessage[]` 为消息持久化主格式
2. 支持 agent run 生命周期与轻量确认流
3. 支持 OpenAI / OpenRouter 配置管理
4. 兼顾 SQLite 可维护性、可迁移性与审计能力

---

## 2. 全局约定

### 2.1 数据库配置

- 数据库：SQLite
- 模式：WAL
- 字符集：UTF-8
- 时间字段：统一存 ISO 8601 字符串或 unix epoch milliseconds，项目内保持一致

### 2.2 主键策略

首期建议所有主键使用字符串 ID（如 cuid2 / nanoid / uuidv7），避免本地合并或未来同步时的整数主键冲突。

### 2.3 删除策略

- 默认使用 archive / soft delete
- hard delete 作为二级危险操作
- hard delete 时触发级联删除

### 2.4 JSON 字段

以下字段使用 JSON 文本存储：

- `ui_message_json`
- `input_json`
- `output_json`
- `settings_json`
- `capabilities_json`

原则：

- 高频过滤字段尽量拆成独立列
- 低频、结构可变字段放 JSON

---

## 3. 实体关系概览

```text
sessions
  ├─< messages
  └─< runs
        └─< tool_calls

providers
  └─< provider_models

sessions.default_provider_id -> providers.id
sessions.default_model_id    -> provider_models.id
runs.provider_id             -> providers.id
runs.model_id                -> provider_models.id
```

---

## 4. 表设计

## 4.1 sessions

用途：保存会话基础信息。

建议字段：

- `id` TEXT PRIMARY KEY
- `title` TEXT NOT NULL
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL
- `archived_at` TEXT NULL
- `default_provider_id` TEXT NULL
- `default_model_id` TEXT NULL

约束：

- `default_provider_id` → `providers.id`
- `default_model_id` → `provider_models.id`

索引建议：

- `idx_sessions_updated_at(updated_at DESC)`
- `idx_sessions_archived_at(archived_at)`

说明：

- `title` 支持自动生成，但持久化后作为展示标题使用
- `archived_at IS NULL` 表示活跃会话

## 4.2 messages

用途：保存每条会话消息，主格式是 AI SDK v5 `UIMessage`。

建议字段：

- `id` TEXT PRIMARY KEY
- `session_id` TEXT NOT NULL
- `role` TEXT NOT NULL
- `ui_message_json` TEXT NOT NULL
- `ui_message_schema_version` TEXT NOT NULL
- `idempotency_key` TEXT NOT NULL
- `created_at` TEXT NOT NULL

约束：

- `session_id` → `sessions.id ON DELETE CASCADE`
- `(session_id, idempotency_key)` UNIQUE

索引建议：

- `idx_messages_session_id_created_at(session_id, created_at)`
- `idx_messages_session_id_idempotency(session_id, idempotency_key)`

说明：

- `role` 是索引友好冗余列，写入时从 `ui_message_json` 派生
- `ui_message_schema_version` 用于 read-side upcast
- 读取历史消息时若出现未知 part，保留原始 JSON，不做隐式覆盖

## 4.3 runs

用途：保存每次 agent 执行的生命周期。

建议字段：

- `id` TEXT PRIMARY KEY
- `session_id` TEXT NOT NULL
- `status` TEXT NOT NULL
- `provider_id` TEXT NOT NULL
- `model_id` TEXT NOT NULL
- `current_step` INTEGER NOT NULL DEFAULT 0
- `max_steps` INTEGER NOT NULL
- `max_tokens_per_run` INTEGER NULL
- `wall_clock_deadline_ms` INTEGER NULL
- `finish_reason` TEXT NULL
- `started_at` TEXT NOT NULL
- `ended_at` TEXT NULL

状态建议：

- `pending`
- `running`
- `completed`
- `failed`
- `interrupted`

约束：

- `session_id` → `sessions.id ON DELETE CASCADE`
- `provider_id` → `providers.id`
- `model_id` → `provider_models.id`

索引建议：

- `idx_runs_session_id_started_at(session_id, started_at DESC)`
- `idx_runs_status(status)`

说明：

- `current_step`、`max_steps` 用于控制 tool loop
- `finish_reason` 记录正常结束、预算耗尽、用户取消、确认拒绝、错误等原因

## 4.4 tool_calls

用途：记录每次工具调用，便于审计、调试和恢复。

建议字段：

- `id` TEXT PRIMARY KEY
- `run_id` TEXT NOT NULL
- `tool_name` TEXT NOT NULL
- `input_json` TEXT NOT NULL
- `output_json` TEXT NULL
- `output_truncated` INTEGER NOT NULL DEFAULT 0
- `output_size_bytes` INTEGER NULL
- `approval_decision` TEXT NULL
- `approval_decided_at` TEXT NULL
- `status` TEXT NOT NULL
- `error_message` TEXT NULL
- `started_at` TEXT NOT NULL
- `ended_at` TEXT NULL

状态建议：

- `pending`
- `running`
- `completed`
- `failed`

约束：

- `run_id` → `runs.id ON DELETE CASCADE`

索引建议：

- `idx_tool_calls_run_id_started_at(run_id, started_at)`
- `idx_tool_calls_status(status)`

说明：

- `output_truncated = 1` 时，`output_json` 仅保留摘要或截断内容
- `approval_decision` 仅用于需要确认的工具（如 `write_file`）
- 后续若要支持 side blob store，可加 `output_storage` / `output_blob_ref`

## 4.5 providers

用途：保存模型供应商配置元数据。

首期范围：

- OpenAI
- OpenRouter

建议字段：

- `id` TEXT PRIMARY KEY
- `type` TEXT NOT NULL
- `display_name` TEXT NOT NULL
- `base_url` TEXT NULL
- `default_model_name` TEXT NULL
- `enabled` INTEGER NOT NULL DEFAULT 1
- `timeout_ms` INTEGER NULL
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

约束：

- `type` 仅允许 `openai` / `openrouter`

索引建议：

- `idx_providers_type(type)`
- `idx_providers_enabled(enabled)`

说明：

- API key 等敏感字段不进 SQLite，存系统安全存储
- SQLite 只保存非敏感元数据与引用关系

## 4.6 provider_models

用途：保存可选模型元数据，支持 session / run 绑定具体模型。

建议字段：

- `id` TEXT PRIMARY KEY
- `provider_id` TEXT NOT NULL
- `model_name` TEXT NOT NULL
- `display_name` TEXT NOT NULL
- `supports_tools` INTEGER NOT NULL DEFAULT 0
- `supports_reasoning` INTEGER NOT NULL DEFAULT 0
- `enabled` INTEGER NOT NULL DEFAULT 1
- `capabilities_json` TEXT NULL
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

约束：

- `provider_id` → `providers.id ON DELETE CASCADE`
- `(provider_id, model_name)` UNIQUE

索引建议：

- `idx_provider_models_provider_id(provider_id)`
- `idx_provider_models_enabled(enabled)`

说明：

- `supports_reasoning` 为展示优化字段，“有则展示”，不作为首期功能硬依赖

---

## 5. 推荐 DDL 草案

> 下面是便于实现的 SQLite 草案，最终可以按 Drizzle / SQL migration 风格落地。

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  default_provider_id TEXT,
  default_model_id TEXT
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  ui_message_json TEXT NOT NULL,
  ui_message_schema_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  UNIQUE (session_id, idempotency_key)
);

CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT,
  default_model_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  timeout_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE provider_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  supports_tools INTEGER NOT NULL DEFAULT 0,
  supports_reasoning INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  capabilities_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
  UNIQUE (provider_id, model_name)
);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 0,
  max_steps INTEGER NOT NULL,
  max_tokens_per_run INTEGER,
  wall_clock_deadline_ms INTEGER,
  finish_reason TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (provider_id) REFERENCES providers(id),
  FOREIGN KEY (model_id) REFERENCES provider_models(id)
);

CREATE TABLE tool_calls (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  output_truncated INTEGER NOT NULL DEFAULT 0,
  output_size_bytes INTEGER,
  approval_decision TEXT,
  approval_decided_at TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC);
CREATE INDEX idx_sessions_archived_at ON sessions(archived_at);
CREATE INDEX idx_messages_session_id_created_at ON messages(session_id, created_at);
CREATE INDEX idx_runs_session_id_started_at ON runs(session_id, started_at DESC);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_tool_calls_run_id_started_at ON tool_calls(run_id, started_at);
CREATE INDEX idx_tool_calls_status ON tool_calls(status);
CREATE INDEX idx_providers_type ON providers(type);
CREATE INDEX idx_providers_enabled ON providers(enabled);
CREATE INDEX idx_provider_models_provider_id ON provider_models(provider_id);
CREATE INDEX idx_provider_models_enabled ON provider_models(enabled);
```

---

## 6. 迁移策略

### 6.1 迁移原则

1. schema 变更统一通过 migration 管理
2. 所有 migration 保持可重放、可审计
3. 不在读请求中隐式做 schema 修复

### 6.2 UIMessage 迁移

- 历史消息读取时按 `ui_message_schema_version` 做 read-side upcast
- 若出现未知 part 类型：
  - 保留原始 `ui_message_json`
  - UI 降级展示 unknown part
  - 不自动覆盖原始记录

### 6.3 大字段策略

- 若 `tool_calls.output_json` 体积过大，先做截断
- 首期不单独引入 blob store
- 后续若需要，可增加 blob 引用字段而不破坏当前表结构

---

## 7. 与运行时设计的对应关系

- `sessions`：对应聊天会话
- `messages`：对应 AI SDK `UIMessage[]`
- `runs`：对应一次 agent 执行过程
- `tool_calls`：对应每次工具调用审计轨迹
- `tool_calls.approval_decision`：对应高风险动作的内联确认结果
- `providers` / `provider_models`：对应 OpenAI / OpenRouter 配置页与会话默认模型

---

## 8. 首期非目标

本 schema 首期不覆盖：

- skills
- connectors
- 独立 approvals 表
- 多设备同步
- blob/file store 独立索引表
- 全文搜索索引

这些能力后续需要时再单独扩展 schema。
