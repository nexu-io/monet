CREATE TABLE `live_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `schema_version` integer DEFAULT 1 NOT NULL CHECK (`schema_version` >= 1),
  `session_id` text,
  `created_by_run_id` text,
  `created_by_tool_call_id` text,
  `title` text NOT NULL CHECK (length(trim(`title`)) > 0),
  `slug` text NOT NULL CHECK (length(trim(`slug`)) > 0),
  `description` text,
  `status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('draft', 'active', 'archived')),
  `pinned` integer DEFAULT 0 NOT NULL CHECK (`pinned` IN (0, 1)),
  `refresh_status` text DEFAULT 'idle' NOT NULL CHECK (`refresh_status` IN ('idle', 'refreshing', 'failed')),
  `refresh_started_at` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `last_refreshed_at` text,
  `last_refresh_error` text,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`created_by_tool_call_id`) REFERENCES `tool_calls`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_artifacts_slug_unique` ON `live_artifacts` (`slug`);
--> statement-breakpoint
CREATE INDEX `idx_live_artifacts_status_updated_at` ON `live_artifacts` (`status`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `idx_live_artifacts_pinned_updated_at` ON `live_artifacts` (`pinned`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `idx_live_artifacts_session_id` ON `live_artifacts` (`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_live_artifacts_created_by_run_id` ON `live_artifacts` (`created_by_run_id`);
--> statement-breakpoint
CREATE INDEX `idx_live_artifacts_created_by_tool_call_id` ON `live_artifacts` (`created_by_tool_call_id`);
--> statement-breakpoint
CREATE TABLE `live_artifact_tiles` (
  `id` text PRIMARY KEY NOT NULL,
  `artifact_id` text NOT NULL,
  `schema_version` integer DEFAULT 1 NOT NULL CHECK (`schema_version` >= 1),
  `position` integer NOT NULL CHECK (`position` >= 0),
  `title` text NOT NULL CHECK (length(trim(`title`)) > 0),
  `kind` text NOT NULL CHECK (`kind` IN ('markdown', 'metric', 'list', 'table', 'link_card', 'json')),
  `render_json` text NOT NULL CHECK (json_valid(`render_json`)),
  `source_json` text CHECK (`source_json` IS NULL OR json_valid(`source_json`)),
  `refresh_status` text DEFAULT 'idle' NOT NULL CHECK (`refresh_status` IN ('idle', 'refreshing', 'failed')),
  `refresh_started_at` text,
  `last_refreshed_at` text,
  `last_error` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`artifact_id`) REFERENCES `live_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_artifact_tiles_artifact_position_unique` ON `live_artifact_tiles` (`artifact_id`,`position`);
--> statement-breakpoint
CREATE INDEX `idx_live_artifact_tiles_artifact_position` ON `live_artifact_tiles` (`artifact_id`,`position`);
--> statement-breakpoint
CREATE INDEX `idx_live_artifact_tiles_refresh_status` ON `live_artifact_tiles` (`refresh_status`);
--> statement-breakpoint
CREATE TABLE `live_artifact_refreshes` (
  `id` text PRIMARY KEY NOT NULL,
  `artifact_id` text NOT NULL,
  `scope` text NOT NULL CHECK (`scope` IN ('artifact', 'tile')),
  `requested_tile_id` text,
  `status` text NOT NULL CHECK (`status` IN ('running', 'completed', 'partial_failed', 'failed')),
  `trigger` text DEFAULT 'manual' NOT NULL CHECK (`trigger` IN ('manual')),
  `started_at` text NOT NULL,
  `ended_at` text,
  `error_message` text,
  FOREIGN KEY (`artifact_id`) REFERENCES `live_artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`requested_tile_id`) REFERENCES `live_artifact_tiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_live_artifact_refreshes_artifact_started_at` ON `live_artifact_refreshes` (`artifact_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `idx_live_artifact_refreshes_status` ON `live_artifact_refreshes` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_live_artifact_refreshes_requested_tile_id` ON `live_artifact_refreshes` (`requested_tile_id`);
--> statement-breakpoint
CREATE TABLE `live_artifact_refresh_steps` (
  `id` text PRIMARY KEY NOT NULL,
  `refresh_id` text NOT NULL,
  `tile_id` text,
  `source_type` text NOT NULL CHECK (`source_type` IN ('tool', 'connector_tool')),
  `tool_name` text NOT NULL,
  `input_json` text NOT NULL CHECK (json_valid(`input_json`)),
  `connector_id` text,
  `connector_name` text,
  `connector_account_label` text,
  `connector_tool_name` text,
  `connector_provider_tool_id` text,
  `connector_arguments_summary` text,
  `connector_approval_policy_json` text CHECK (`connector_approval_policy_json` IS NULL OR json_valid(`connector_approval_policy_json`)),
  `approval_basis` text,
  `connector_provider_execution_id` text,
  `connector_provider_execution_metadata_json` text CHECK (`connector_provider_execution_metadata_json` IS NULL OR json_valid(`connector_provider_execution_metadata_json`)),
  `status` text NOT NULL CHECK (`status` IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  `error_message` text,
  `started_at` text NOT NULL,
  `ended_at` text,
  FOREIGN KEY (`refresh_id`) REFERENCES `live_artifact_refreshes`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`tile_id`) REFERENCES `live_artifact_tiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_live_artifact_refresh_steps_refresh_started_at` ON `live_artifact_refresh_steps` (`refresh_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `idx_live_artifact_refresh_steps_tile_started_at` ON `live_artifact_refresh_steps` (`tile_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `idx_live_artifact_refresh_steps_status` ON `live_artifact_refresh_steps` (`status`);
