PRAGMA foreign_keys=OFF;

CREATE TABLE `providers` (
  `id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `display_name` text NOT NULL,
  `base_url` text,
  `default_model_name` text,
  `enabled` integer DEFAULT true NOT NULL,
  `timeout_ms` integer,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);

CREATE TABLE `provider_models` (
  `id` text PRIMARY KEY NOT NULL,
  `provider_id` text NOT NULL,
  `model_name` text NOT NULL,
  `display_name` text NOT NULL,
  `supports_tools` integer DEFAULT false NOT NULL,
  `supports_reasoning` integer DEFAULT false NOT NULL,
  `enabled` integer DEFAULT true NOT NULL,
  `capabilities_json` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `provider_models_provider_id_model_name_unique` ON `provider_models` (`provider_id`,`model_name`);
CREATE INDEX `idx_provider_models_provider_id` ON `provider_models` (`provider_id`);
CREATE INDEX `idx_provider_models_enabled` ON `provider_models` (`enabled`);
CREATE INDEX `idx_providers_type` ON `providers` (`type`);
CREATE INDEX `idx_providers_enabled` ON `providers` (`enabled`);

CREATE TABLE `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `archived_at` text,
  `default_provider_id` text,
  `default_model_id` text,
  FOREIGN KEY (`default_provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`default_model_id`) REFERENCES `provider_models`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE INDEX `idx_sessions_updated_at` ON `sessions` (`updated_at`);
CREATE INDEX `idx_sessions_archived_at` ON `sessions` (`archived_at`);

CREATE TABLE `runs` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `status` text NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `current_step` integer DEFAULT 0 NOT NULL,
  `max_steps` integer NOT NULL,
  `max_tokens_per_run` integer,
  `wall_clock_deadline_at` text,
  `finish_reason` text,
  `started_at` text NOT NULL,
  `ended_at` text,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`model_id`) REFERENCES `provider_models`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `idx_runs_session_id_started_at` ON `runs` (`session_id`,`started_at`);
CREATE INDEX `idx_runs_status` ON `runs` (`status`);

CREATE TABLE `messages` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `run_id` text,
  `role` text NOT NULL,
  `ui_message_json` text NOT NULL,
  `ui_message_schema_version` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE UNIQUE INDEX `messages_session_id_idempotency_key_unique` ON `messages` (`session_id`,`idempotency_key`);
CREATE INDEX `idx_messages_session_id_created_at` ON `messages` (`session_id`,`created_at`);
CREATE INDEX `idx_messages_session_id_idempotency` ON `messages` (`session_id`,`idempotency_key`);
CREATE INDEX `idx_messages_run_id` ON `messages` (`run_id`);

CREATE TABLE `tool_calls` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `tool_name` text NOT NULL,
  `input_json` text NOT NULL,
  `output_json` text,
  `output_truncated` integer DEFAULT false NOT NULL,
  `output_size_bytes` integer,
  `approval_decision` text,
  `approval_decided_at` text,
  `confirmation_token_hash` text,
  `status` text NOT NULL,
  `error_message` text,
  `started_at` text NOT NULL,
  `ended_at` text,
  FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_tool_calls_run_id_started_at` ON `tool_calls` (`run_id`,`started_at`);
CREATE INDEX `idx_tool_calls_status` ON `tool_calls` (`status`);

PRAGMA foreign_keys=ON;
