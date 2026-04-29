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
  `last_error` text,
  CONSTRAINT `connector_connections_no_provider_metadata_secrets` CHECK (`provider_metadata_json` IS NULL OR (
    instr(lower(`provider_metadata_json`), 'access_token') = 0 AND
    instr(lower(`provider_metadata_json`), 'accesstoken') = 0 AND
    instr(lower(`provider_metadata_json`), 'refresh_token') = 0 AND
    instr(lower(`provider_metadata_json`), 'refreshtoken') = 0 AND
    instr(lower(`provider_metadata_json`), 'oauth_token') = 0 AND
    instr(lower(`provider_metadata_json`), 'oauthtoken') = 0 AND
    instr(lower(`provider_metadata_json`), 'api_key') = 0 AND
    instr(lower(`provider_metadata_json`), 'apikey') = 0 AND
    instr(lower(`provider_metadata_json`), 'x-api-key') = 0 AND
    instr(lower(`provider_metadata_json`), 'xapikey') = 0 AND
    instr(lower(`provider_metadata_json`), 'authorization') = 0 AND
    instr(lower(`provider_metadata_json`), 'bearer ') = 0 AND
    instr(lower(`provider_metadata_json`), 'client_secret') = 0 AND
    instr(lower(`provider_metadata_json`), 'clientsecret') = 0
  )),
  CONSTRAINT `connector_connections_no_last_error_secrets` CHECK (`last_error` IS NULL OR (
    instr(lower(`last_error`), 'access_token') = 0 AND
    instr(lower(`last_error`), 'accesstoken') = 0 AND
    instr(lower(`last_error`), 'refresh_token') = 0 AND
    instr(lower(`last_error`), 'refreshtoken') = 0 AND
    instr(lower(`last_error`), 'oauth_token') = 0 AND
    instr(lower(`last_error`), 'oauthtoken') = 0 AND
    instr(lower(`last_error`), 'api_key') = 0 AND
    instr(lower(`last_error`), 'apikey') = 0 AND
    instr(lower(`last_error`), 'x-api-key') = 0 AND
    instr(lower(`last_error`), 'xapikey') = 0 AND
    instr(lower(`last_error`), 'authorization') = 0 AND
    instr(lower(`last_error`), 'bearer ') = 0 AND
    instr(lower(`last_error`), 'client_secret') = 0 AND
    instr(lower(`last_error`), 'clientsecret') = 0
  ))
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
