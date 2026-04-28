ALTER TABLE `live_artifacts` ADD COLUMN `content_type` text DEFAULT 'html_page_v1' NOT NULL CHECK (`content_type` = 'html_page_v1');
--> statement-breakpoint
ALTER TABLE `live_artifacts` ADD COLUMN `current_revision_id` text;
--> statement-breakpoint
CREATE TABLE `live_artifact_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `artifact_id` text NOT NULL,
  `revision_id` text NOT NULL,
  `format` text DEFAULT 'html_template_v1' NOT NULL CHECK (`format` = 'html_template_v1'),
  `sanitized_html` text NOT NULL CHECK (length(trim(`sanitized_html`)) > 0),
  `data_json` text DEFAULT '{}' NOT NULL CHECK (json_valid(`data_json`)),
  `data_schema_json` text CHECK (`data_schema_json` IS NULL OR json_valid(`data_schema_json`)),
  `source_json` text CHECK (`source_json` IS NULL OR json_valid(`source_json`)),
  `sanitizer_version` text DEFAULT 'basic-html-v1' NOT NULL CHECK (length(trim(`sanitizer_version`)) > 0),
  `created_at` text NOT NULL,
  FOREIGN KEY (`artifact_id`) REFERENCES `live_artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `live_artifact_documents_artifact_revision_unique` ON `live_artifact_documents` (`artifact_id`,`revision_id`);
--> statement-breakpoint
CREATE INDEX `idx_live_artifact_documents_artifact_created_at` ON `live_artifact_documents` (`artifact_id`,`created_at`);
