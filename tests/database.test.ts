import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type SQLiteDatabase } from "../src/database/sqlite.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "2popuga-database-"));
  temporaryDirectories.push(directory);
  return join(directory, "nested", "bot.sqlite");
}

function close(database: SQLiteDatabase): void {
  if (database.open) {
    database.close();
  }
}

describe("openDatabase", () => {
  it("creates parent directories and applies the initial schema", () => {
    const database = openDatabase(createDatabasePath());

    try {
      const tableNames = database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .pluck()
        .all();

      expect(tableNames).toEqual([
        "app_state",
        "care_events",
        "reminders",
        "schema_migrations",
      ]);
      expect(
        database.prepare("SELECT version, name FROM schema_migrations").get(),
      ).toEqual({
        name: "initial_schema",
        version: 1,
      });
    } finally {
      close(database);
    }
  });

  it("enables foreign keys, WAL, and a busy timeout for file databases", () => {
    const database = openDatabase(createDatabasePath());

    try {
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(database.pragma("busy_timeout", { simple: true })).toBe(5000);
    } finally {
      close(database);
    }
  });

  it("can be reopened without applying a migration twice", () => {
    const databasePath = createDatabasePath();
    const firstConnection = openDatabase(databasePath);
    close(firstConnection);

    const secondConnection = openDatabase(databasePath);

    try {
      expect(
        secondConnection
          .prepare("SELECT COUNT(*) FROM schema_migrations")
          .pluck()
          .get(),
      ).toBe(1);
    } finally {
      close(secondConnection);
    }
  });

  it("rejects unsupported procedure codes", () => {
    const database = openDatabase(":memory:");

    try {
      expect(() =>
        database
          .prepare(
            `
              INSERT INTO care_events (
                procedure_code,
                performed_at_ms,
                actor_telegram_user_id,
                actor_display_name,
                confirmation_chat_id,
                created_at_ms
              ) VALUES (?, ?, ?, ?, ?, ?)
            `,
          )
          .run("unknown", 1_000, 42, "Maxim", -100, 1_000),
      ).toThrow();
    } finally {
      close(database);
    }
  });

  it("enforces that an event can only be undone by its author", () => {
    const database = openDatabase(":memory:");

    try {
      const result = database
        .prepare(
          `
            INSERT INTO care_events (
              procedure_code,
              performed_at_ms,
              actor_telegram_user_id,
              actor_display_name,
              confirmation_chat_id,
              created_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run("water", 1_000, 42, "Maxim", -100, 1_000);

      expect(() =>
        database
          .prepare(
            `
              UPDATE care_events
              SET
                undone_at_ms = ?,
                undone_by_telegram_user_id = ?,
                undone_by_display_name = ?
              WHERE id = ?
            `,
          )
          .run(2_000, 7, "Another user", result.lastInsertRowid),
      ).toThrow();
    } finally {
      close(database);
    }
  });

  it("rejects a database migrated by a newer application", () => {
    const databasePath = createDatabasePath();
    const database = openDatabase(databasePath);
    close(database);

    const newerDatabase = new Database(databasePath);
    newerDatabase
      .prepare(
        "INSERT INTO schema_migrations (version, name, applied_at_ms) VALUES (?, ?, ?)",
      )
      .run(2, "future_schema", Date.now());
    newerDatabase.close();

    expect(() => openDatabase(databasePath)).toThrow(
      "Database schema is newer than this application",
    );
  });
});
