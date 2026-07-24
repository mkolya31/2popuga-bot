import { describe, expect, it } from "vitest";

import {
  attachConfirmationMessage,
  getProcedureStatuses,
  recordCareEvent,
  savePanelMessage,
  undoCareEvent,
} from "../src/care-service.js";
import { ensureAppState } from "../src/database/app-state.js";
import { openDatabase, type SQLiteDatabase } from "../src/database/sqlite.js";
import { DAY_MS } from "../src/procedures.js";

const BASELINE_DAY_NOW_MS = Date.parse("2026-07-23T10:00:00.000Z");
const BASELINE_AT_MS = Date.parse("2026-07-23T16:00:00.000Z");

function createDatabase(): SQLiteDatabase {
  const database = openDatabase(":memory:");
  ensureAppState(database, "Europe/Moscow", BASELINE_DAY_NOW_MS);
  return database;
}

function recordWater(
  database: SQLiteDatabase,
  nowMs: number,
  actorTelegramUserId = 42,
  actorDisplayName = "Максим",
) {
  return recordCareEvent(database, {
    actorDisplayName,
    actorTelegramUserId,
    actorUsername: actorTelegramUserId === 42 ? "maxim" : null,
    chatId: -1_001_234_567_890,
    nowMs,
    procedureCode: "water",
  });
}

describe("care service", () => {
  it("calculates initial deadlines and state transitions from the saved baseline", () => {
    const database = createDatabase();

    try {
      const initialStatuses = getProcedureStatuses(database, BASELINE_DAY_NOW_MS);

      expect(initialStatuses).toEqual([
        {
          dueAtMs: BASELINE_AT_MS + DAY_MS,
          lastEvent: null,
          procedureCode: "water",
          state: "normal",
        },
        {
          dueAtMs: BASELINE_AT_MS + 2 * DAY_MS,
          lastEvent: null,
          procedureCode: "food",
          state: "normal",
        },
        {
          dueAtMs: BASELINE_AT_MS + DAY_MS,
          lastEvent: null,
          procedureCode: "tray",
          state: "normal",
        },
      ]);

      expect(
        getProcedureStatuses(database, BASELINE_AT_MS + DAY_MS)[0]?.state,
      ).toBe("due");
      expect(
        getProcedureStatuses(database, BASELINE_AT_MS + 2 * DAY_MS)[0]?.state,
      ).toBe("overdue");
    } finally {
      database.close();
    }
  });

  it("records an event and calculates the next deadline from its actual time", () => {
    const database = createDatabase();
    const performedAtMs = Date.parse("2026-07-23T17:40:00.000Z");

    try {
      const result = recordWater(database, performedAtMs);

      expect(result.kind).toBe("created");
      expect(result.event).toMatchObject({
        actorDisplayName: "Максим",
        actorTelegramUserId: 42,
        actorUsername: "maxim",
        confirmationChatId: -1_001_234_567_890,
        confirmationMessageId: null,
        performedAtMs,
        procedureCode: "water",
        undoneAtMs: null,
      });

      attachConfirmationMessage(database, result.event.id, 123);

      const waterStatus = getProcedureStatuses(database, performedAtMs)[0];
      expect(waterStatus).toMatchObject({
        dueAtMs: performedAtMs + DAY_MS,
        procedureCode: "water",
        state: "normal",
      });
      expect(waterStatus?.lastEvent?.confirmationMessageId).toBe(123);
    } finally {
      database.close();
    }
  });

  it("deduplicates the same procedure for five minutes regardless of actor", () => {
    const database = createDatabase();
    const firstAtMs = Date.parse("2026-07-23T17:00:00.000Z");

    try {
      const first = recordWater(database, firstAtMs);
      const duplicate = recordWater(
        database,
        firstAtMs + 4 * 60_000,
        7,
        "Анна",
      );
      const afterWindow = recordWater(
        database,
        firstAtMs + 5 * 60_000 + 1,
        7,
        "Анна",
      );

      expect(first.kind).toBe("created");
      expect(duplicate).toMatchObject({
        event: {
          actorDisplayName: "Максим",
          actorTelegramUserId: 42,
          id: first.event.id,
        },
        kind: "duplicate",
      });
      expect(afterWindow).toMatchObject({
        event: {
          actorDisplayName: "Анна",
          actorTelegramUserId: 7,
        },
        kind: "created",
      });
      expect(
        database.prepare("SELECT COUNT(*) FROM care_events").pluck().get(),
      ).toBe(2);
    } finally {
      database.close();
    }
  });

  it("allows only the author to undo the newest event and restores the prior deadline", () => {
    const database = createDatabase();
    const firstAtMs = Date.parse("2026-07-23T17:00:00.000Z");
    const secondAtMs = firstAtMs + 10 * 60_000;

    try {
      const first = recordWater(database, firstAtMs);
      const second = recordWater(database, secondAtMs, 7, "Анна");

      expect(
        undoCareEvent(
          database,
          first.event.id,
          42,
          "Максим",
          secondAtMs + 1_000,
        ).kind,
      ).toBe("superseded");
      expect(
        undoCareEvent(
          database,
          second.event.id,
          42,
          "Максим",
          secondAtMs + 1_000,
        ).kind,
      ).toBe("forbidden");

      const undone = undoCareEvent(
        database,
        second.event.id,
        7,
        "Анна",
        secondAtMs + 2_000,
      );

      expect(undone).toMatchObject({
        event: { id: second.event.id },
        kind: "undone",
        nextDueAtMs: firstAtMs + DAY_MS,
      });
      expect(
        undoCareEvent(
          database,
          second.event.id,
          7,
          "Анна",
          secondAtMs + 3_000,
        ).kind,
      ).toBe("already_undone");
      expect(getProcedureStatuses(database, secondAtMs)[0]?.lastEvent?.id).toBe(
        first.event.id,
      );
    } finally {
      database.close();
    }
  });

  it("falls back to the initial baseline after undoing the first event", () => {
    const database = createDatabase();
    const performedAtMs = Date.parse("2026-07-23T17:00:00.000Z");

    try {
      const event = recordWater(database, performedAtMs).event;
      const result = undoCareEvent(
        database,
        event.id,
        42,
        "Максим",
        performedAtMs + 1_000,
      );

      expect(result).toMatchObject({
        kind: "undone",
        nextDueAtMs: BASELINE_AT_MS + DAY_MS,
      });
    } finally {
      database.close();
    }
  });

  it("stores the newest published panel in application state", () => {
    const database = createDatabase();

    try {
      savePanelMessage(database, -100, 55, BASELINE_DAY_NOW_MS + 1_000);

      expect(
        database
          .prepare(
            `
              SELECT panel_chat_id, panel_message_id, updated_at_ms
              FROM app_state
              WHERE singleton_id = 1
            `,
          )
          .get(),
      ).toEqual({
        panel_chat_id: -100,
        panel_message_id: 55,
        updated_at_ms: BASELINE_DAY_NOW_MS + 1_000,
      });
    } finally {
      database.close();
    }
  });
});
