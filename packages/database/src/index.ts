import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { schema } from "./schema";

export const databasePackageName = "@monet/database";

export * from "./schema";

export interface CreateDatabaseOptions {
  readonly filename: string;
  readonly readonly?: boolean;
}

export function createSqliteConnection(options: CreateDatabaseOptions): Database.Database {
  const connection = new Database(options.filename, {
    readonly: options.readonly ?? false,
    fileMustExist: false
  });

  connection.pragma("journal_mode = WAL");
  connection.pragma("synchronous = NORMAL");
  connection.pragma("busy_timeout = 5000");
  connection.pragma("foreign_keys = ON");

  return connection;
}

export function createDatabase(options: CreateDatabaseOptions) {
  const connection = createSqliteConnection(options);

  return drizzle(connection, {
    schema
  });
}
