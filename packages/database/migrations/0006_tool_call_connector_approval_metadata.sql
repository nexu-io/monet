ALTER TABLE `tool_calls` ADD COLUMN `connector_id` text;
--> statement-breakpoint
ALTER TABLE `tool_calls` ADD COLUMN `connector_name` text;
--> statement-breakpoint
ALTER TABLE `tool_calls` ADD COLUMN `connector_account_label` text;
--> statement-breakpoint
ALTER TABLE `tool_calls` ADD COLUMN `connector_tool_name` text;
--> statement-breakpoint
ALTER TABLE `tool_calls` ADD COLUMN `connector_provider_tool_id` text;
--> statement-breakpoint
ALTER TABLE `tool_calls` ADD COLUMN `connector_arguments_summary` text;
--> statement-breakpoint
ALTER TABLE `tool_calls` ADD COLUMN `connector_approval_policy_json` text;
