CREATE TABLE `connector_oauth_states` (
  `id` text PRIMARY KEY NOT NULL,
  `state_hash` text NOT NULL,
  `user_id` text NOT NULL,
  `connector_id` text NOT NULL,
  `provider` text NOT NULL,
  `redirect_url` text,
  `expires_at` text NOT NULL,
  `consumed_at` text,
  `created_at` text NOT NULL,
  CONSTRAINT `connector_oauth_states_no_redirect_url_secrets` CHECK (`redirect_url` IS NULL OR (
    instr(lower(`redirect_url`), 'access_token') = 0 AND
    instr(lower(`redirect_url`), 'accesstoken') = 0 AND
    instr(lower(`redirect_url`), 'refresh_token') = 0 AND
    instr(lower(`redirect_url`), 'refreshtoken') = 0 AND
    instr(lower(`redirect_url`), 'oauth_token') = 0 AND
    instr(lower(`redirect_url`), 'oauthtoken') = 0 AND
    instr(lower(`redirect_url`), 'api_key') = 0 AND
    instr(lower(`redirect_url`), 'apikey') = 0 AND
    instr(lower(`redirect_url`), 'x-api-key') = 0 AND
    instr(lower(`redirect_url`), 'xapikey') = 0 AND
    instr(lower(`redirect_url`), 'authorization') = 0 AND
    instr(lower(`redirect_url`), 'bearer ') = 0 AND
    instr(lower(`redirect_url`), 'client_secret') = 0 AND
    instr(lower(`redirect_url`), 'clientsecret') = 0
  ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_oauth_states_state_hash_unique` ON `connector_oauth_states` (`state_hash`);
--> statement-breakpoint
CREATE INDEX `idx_connector_oauth_states_user_connector_provider` ON `connector_oauth_states` (`user_id`,`connector_id`,`provider`);
--> statement-breakpoint
CREATE INDEX `idx_connector_oauth_states_expires_at` ON `connector_oauth_states` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_connector_oauth_states_consumed_at` ON `connector_oauth_states` (`consumed_at`);
