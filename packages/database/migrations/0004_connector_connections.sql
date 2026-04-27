CREATE TABLE `connector_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `connector_id` text NOT NULL,
  `provider` text NOT NULL,
  `provider_connection_id` text,
  `provider_metadata_json` text,
  `account_label` text,
  `status` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `last_connected_at` text,
  `last_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_connections_user_connector_provider_unique` ON `connector_connections` (`user_id`,`connector_id`,`provider`);
--> statement-breakpoint
CREATE INDEX `idx_connector_connections_user_id` ON `connector_connections` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_connector_connections_connector_id` ON `connector_connections` (`connector_id`);
--> statement-breakpoint
CREATE INDEX `idx_connector_connections_provider_connection_id` ON `connector_connections` (`provider_connection_id`);
--> statement-breakpoint
CREATE INDEX `idx_connector_connections_status` ON `connector_connections` (`status`);
