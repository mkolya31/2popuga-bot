import { describe, expect, it } from "vitest";

import { ensureAppState } from "../src/database/app-state.js";
import { openDatabase } from "../src/database/sqlite.js";

describe("ensureAppState", () => {
  it("sets the initial baseline to 19:00 Moscow time on the first-run day", () => {
    const database = openDatabase(":memory:");

    try {
      const state = ensureAppState(
        database,
        "Europe/Moscow",
        Date.parse("2026-07-23T10:15:00.000Z"),
      );

      expect(state).toEqual({
        createdAtMs: Date.parse("2026-07-23T10:15:00.000Z"),
        initialBaselineAtMs: Date.parse("2026-07-23T16:00:00.000Z"),
        panelChatId: null,
        panelMessageId: null,
        updatedAtMs: Date.parse("2026-07-23T10:15:00.000Z"),
      });
    } finally {
      database.close();
    }
  });

  it("keeps the original baseline after subsequent starts", () => {
    const database = openDatabase(":memory:");

    try {
      const firstState = ensureAppState(
        database,
        "Europe/Moscow",
        Date.parse("2026-07-23T20:00:00.000Z"),
      );
      const restartedState = ensureAppState(
        database,
        "Europe/Moscow",
        Date.parse("2026-07-25T08:00:00.000Z"),
      );

      expect(restartedState).toEqual(firstState);
      expect(restartedState.initialBaselineAtMs).toBe(
        Date.parse("2026-07-23T16:00:00.000Z"),
      );
    } finally {
      database.close();
    }
  });

  it("uses the configured IANA time zone", () => {
    const database = openDatabase(":memory:");

    try {
      const state = ensureAppState(
        database,
        "America/New_York",
        Date.parse("2026-01-15T12:00:00.000Z"),
      );

      expect(state.initialBaselineAtMs).toBe(
        Date.parse("2026-01-16T00:00:00.000Z"),
      );
    } finally {
      database.close();
    }
  });
});
