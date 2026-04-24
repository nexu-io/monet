ALTER TABLE `runs` ADD COLUMN `consumed_tokens` integer DEFAULT 0 NOT NULL;
ALTER TABLE `runs` ADD COLUMN `consumed_tool_calls` integer DEFAULT 0 NOT NULL;
