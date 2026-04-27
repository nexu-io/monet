CREATE TABLE `connector_oauth_states` (
  `id` text PRIMARY KEY NOT NULL,
  `state_hash` text NOT NULL,
  `user_id` text NOT NULL,
  `connector_id` text NOT NULL,
  `provider` text NOT NULL,
  `redirect_url` text,
  `expires_at` text NOT NULL,
  `consumed_at` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_oauth_states_state_hash_unique` ON `connector_oauth_states` (`state_hash`);
--> statement-breakpoint
CREATE INDEX `idx_connector_oauth_states_user_connector_provider` ON `connector_oauth_states` (`user_id`,`connector_id`,`provider`);
--> statement-breakpoint
CREATE INDEX `idx_connector_oauth_states_expires_at` ON `connector_oauth_states` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_connector_oauth_states_consumed_at` ON `connector_oauth_states` (`consumed_at`);
