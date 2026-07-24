import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

import { migrations, type Migration } from "./migrations.js";

interface AppliedMigration {
  name: string;
  version: number;
}

export type SQLiteDatabase = Database.Database;

export function openDatabase(databasePath: string): SQLiteDatabase {
  const normalizedPath = databasePath.trim();

  if (normalizedPath === "") {
    throw new Error("Database path must not be empty");
  }

  const isInMemory = normalizedPath === ":memory:";
  const resolvedPath = isInMemory ? normalizedPath : resolve(normalizedPath);

  if (!isInMemory) {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const database = new Database(resolvedPath);

  try {
    configureDatabase(database, isInMemory);
    applyMigrations(database, migrations);
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}

function configureDatabase(database: SQLiteDatabase, isInMemory: boolean): void {
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  if (!isInMemory) {
    database.pragma("journal_mode = WAL");
    database.pragma("synchronous = NORMAL");
  }
}

function applyMigrations(
  database: SQLiteDatabase,
  availableMigrations: readonly Migration[],
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at_ms INTEGER NOT NULL CHECK (applied_at_ms >= 0)
    ) STRICT;
  `);

  const appliedMigrations = database
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
    .all() as AppliedMigration[];

  validateAppliedMigrations(appliedMigrations, availableMigrations);

  const applyMigration = database.transaction((migration: Migration) => {
    database.exec(migration.sql);
    database
      .prepare(
        "INSERT INTO schema_migrations (version, name, applied_at_ms) VALUES (?, ?, ?)",
      )
      .run(migration.version, migration.name, Date.now());
  });

  for (const migration of availableMigrations.slice(appliedMigrations.length)) {
    applyMigration(migration);
  }
}

function validateAppliedMigrations(
  appliedMigrations: readonly AppliedMigration[],
  availableMigrations: readonly Migration[],
): void {
  if (appliedMigrations.length > availableMigrations.length) {
    throw new Error("Database schema is newer than this application");
  }

  for (const [index, appliedMigration] of appliedMigrations.entries()) {
    const expectedMigration = availableMigrations[index];

    if (
      expectedMigration === undefined ||
      appliedMigration.version !== expectedMigration.version ||
      appliedMigration.name !== expectedMigration.name
    ) {
      throw new Error(
        `Database migration history mismatch at version ${appliedMigration.version}`,
      );
    }
  }
}
