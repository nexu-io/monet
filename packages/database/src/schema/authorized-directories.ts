import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const authorizedDirectories = sqliteTable("authorized_directories", {
  path: text("path").primaryKey(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull()
});
