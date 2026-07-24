import { describe, expect, it } from "vitest";

import type { CareEvent, ProcedureStatus } from "../src/care-service.js";
import {
  formatConfirmation,
  formatDuplicateNotice,
  formatStatus,
  formatUndoNotice,
} from "../src/messages.js";
import { DAY_MS } from "../src/procedures.js";

const event: CareEvent = {
  actorDisplayName: "Максим",
  actorTelegramUserId: 42,
  actorUsername: "maxim",
  confirmationChatId: -100,
  confirmationMessageId: 10,
  createdAtMs: Date.parse("2026-07-22T16:40:00.000Z"),
  id: 1,
  performedAtMs: Date.parse("2026-07-22T16:40:00.000Z"),
  procedureCode: "water",
  undoneAtMs: null,
};

describe("Telegram message formatting", () => {
  it("formats completion and duplicate notices in Moscow time", () => {
    expect(formatConfirmation(event, "Europe/Moscow")).toBe(
      [
        "✅ 💧 Вода заменена",
        "Максим · 22 июля, 19:40",
        "Следующий срок: 23 июля, 19:40",
      ].join("\n"),
    );
    expect(formatDuplicateNotice(event, "Europe/Moscow")).toContain(
      "Максим · 22 июля, 19:40",
    );
  });

  it("formats normal, due, and overdue status sections", () => {
    const nowMs = Date.parse("2026-07-23T10:00:00.000Z");
    const statuses: ProcedureStatus[] = [
      {
        dueAtMs: nowMs + 5 * 60 * 60_000 + 20 * 60_000,
        lastEvent: event,
        procedureCode: "water",
        state: "normal",
      },
      {
        dueAtMs: nowMs - 2 * 60 * 60_000,
        lastEvent: null,
        procedureCode: "food",
        state: "due",
      },
      {
        dueAtMs: nowMs - DAY_MS - 3 * 60 * 60_000,
        lastEvent: null,
        procedureCode: "tray",
        state: "overdue",
      },
    ];

    const message = formatStatus(statuses, nowMs, "Europe/Moscow");

    expect(message).toContain("🟢 Осталось 5 часов 20 минут");
    expect(message).toContain("🟡 Пора · после срока 2 часа");
    expect(message).toContain("🔴 Просрочено на 1 день 3 часа");
    expect(message).toContain("Последнее выполнение: 22 июля, 19:40");
    expect(message).toContain("Выполнил: Максим");
    expect(message).toContain("Последнее выполнение: нет данных");
  });

  it("formats the recalculated deadline after undo", () => {
    expect(
      formatUndoNotice(
        Date.parse("2026-07-24T16:00:00.000Z"),
        "Europe/Moscow",
      ),
    ).toBe("↩️ Отметка отменена\nНовый срок: 24 июля, 19:00");
  });
});
