ALTER TABLE `tool_calls` ADD COLUMN `connector_provider_execution_id` text;
--> statement-breakpoint
ALTER TABLE `tool_calls` ADD COLUMN `connector_provider_execution_metadata_json` text;
