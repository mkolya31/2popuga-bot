import type { SQLiteDatabase } from "./database/sqlite.js";
import {
  DAY_MS,
  PROCEDURES,
  getProcedure,
  type ProcedureCode,
} from "./procedures.js";

const DUPLICATE_WINDOW_MS = 5 * 60 * 1_000;

interface CareEventRow {
  actor_display_name: string;
  actor_telegram_user_id: number;
  actor_username: string | null;
  confirmation_chat_id: number;
  confirmation_message_id: number | null;
  created_at_ms: number;
  id: number;
  performed_at_ms: number;
  procedure_code: ProcedureCode;
  undone_at_ms: number | null;
}

interface AppStateBaselineRow {
  initial_baseline_at_ms: number;
}

export interface CareEvent {
  actorDisplayName: string;
  actorTelegramUserId: number;
  actorUsername: string | null;
  confirmationChatId: number;
  confirmationMessageId: number | null;
  createdAtMs: number;
  id: number;
  performedAtMs: number;
  procedureCode: ProcedureCode;
  undoneAtMs: number | null;
}

export interface RecordCareEventInput {
  actorDisplayName: string;
  actorTelegramUserId: number;
  actorUsername: string | null;
  chatId: number;
  nowMs: number;
  procedureCode: ProcedureCode;
}

export type RecordCareEventResult =
  | {
      event: CareEvent;
      kind: "duplicate";
    }
  | {
      event: CareEvent;
      kind: "created";
      previousEvent: CareEvent | null;
    };

export type UndoCareEventResult =
  | {
      kind: "not_found";
    }
  | {
      event: CareEvent;
      kind: "already_undone" | "forbidden" | "superseded";
    }
  | {
      event: CareEvent;
      kind: "undone";
      nextDueAtMs: number;
    };

export type ProcedureState = "normal" | "due" | "overdue";

export interface ProcedureStatus {
  dueAtMs: number;
  lastEvent: CareEvent | null;
  procedureCode: ProcedureCode;
  state: ProcedureState;
}

export function recordCareEvent(
  database: SQLiteDatabase,
  input: RecordCareEventInput,
): RecordCareEventResult {
  const record = database.transaction((): RecordCareEventResult => {
    const previousEvent = getLatestActiveEvent(database, input.procedureCode);

    if (
      previousEvent !== null &&
      previousEvent.performedAtMs >= input.nowMs - DUPLICATE_WINDOW_MS
    ) {
      return {
        event: previousEvent,
        kind: "duplicate",
      };
    }

    const result = database
      .prepare(
        `
          INSERT INTO care_events (
            procedure_code,
            performed_at_ms,
            actor_telegram_user_id,
            actor_display_name,
            actor_username,
            confirmation_chat_id,
            created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        input.procedureCode,
        input.nowMs,
        input.actorTelegramUserId,
        input.actorDisplayName,
        input.actorUsername,
        input.chatId,
        input.nowMs,
      );

    const event = getCareEvent(database, Number(result.lastInsertRowid));

    if (event === null) {
      throw new Error("Failed to read the newly-created care event");
    }

    return {
      event,
      kind: "created",
      previousEvent,
    };
  });

  return record();
}

export function attachConfirmationMessage(
  database: SQLiteDatabase,
  eventId: number,
  messageId: number,
): void {
  const result = database
    .prepare(
      `
        UPDATE care_events
        SET confirmation_message_id = ?
        WHERE id = ? AND confirmation_message_id IS NULL
      `,
    )
    .run(messageId, eventId);

  if (result.changes !== 1) {
    throw new Error(`Failed to attach confirmation message to event ${eventId}`);
  }
}

export function undoCareEvent(
  database: SQLiteDatabase,
  eventId: number,
  actorTelegramUserId: number,
  actorDisplayName: string,
  nowMs: number,
): UndoCareEventResult {
  const undo = database.transaction((): UndoCareEventResult => {
    const event = getCareEvent(database, eventId);

    if (event === null) {
      return { kind: "not_found" };
    }

    if (event.undoneAtMs !== null) {
      return { event, kind: "already_undone" };
    }

    if (event.actorTelegramUserId !== actorTelegramUserId) {
      return { event, kind: "forbidden" };
    }

    const newestEventId = database
      .prepare(
        `
          SELECT id
          FROM care_events
          WHERE procedure_code = ?
          ORDER BY performed_at_ms DESC, id DESC
          LIMIT 1
        `,
      )
      .pluck()
      .get(event.procedureCode) as number | undefined;

    if (newestEventId !== event.id) {
      return { event, kind: "superseded" };
    }

    const undoneAtMs = Math.max(nowMs, event.performedAtMs);
    const result = database
      .prepare(
        `
          UPDATE care_events
          SET
            undone_at_ms = ?,
            undone_by_telegram_user_id = ?,
            undone_by_display_name = ?
          WHERE id = ? AND undone_at_ms IS NULL
        `,
      )
      .run(undoneAtMs, actorTelegramUserId, actorDisplayName, event.id);

    if (result.changes !== 1) {
      throw new Error(`Failed to undo care event ${event.id}`);
    }

    const previousEvent = getLatestActiveEvent(database, event.procedureCode);
    const baselineAtMs = getInitialBaselineAtMs(database);
    const procedure = getProcedure(event.procedureCode);
    const nextDueAtMs =
      (previousEvent?.performedAtMs ?? baselineAtMs) + procedure.intervalMs;

    return {
      event: { ...event, undoneAtMs },
      kind: "undone",
      nextDueAtMs,
    };
  });

  return undo();
}

export function getProcedureStatuses(
  database: SQLiteDatabase,
  nowMs: number,
): ProcedureStatus[] {
  const baselineAtMs = getInitialBaselineAtMs(database);

  return PROCEDURES.map((procedure) => {
    const lastEvent = getLatestActiveEvent(database, procedure.code);
    const dueAtMs =
      (lastEvent?.performedAtMs ?? baselineAtMs) + procedure.intervalMs;
    const state: ProcedureState =
      nowMs < dueAtMs
        ? "normal"
        : nowMs < dueAtMs + DAY_MS
          ? "due"
          : "overdue";

    return {
      dueAtMs,
      lastEvent,
      procedureCode: procedure.code,
      state,
    };
  });
}

export function savePanelMessage(
  database: SQLiteDatabase,
  chatId: number,
  messageId: number,
  nowMs: number,
): void {
  const result = database
    .prepare(
      `
        UPDATE app_state
        SET
          panel_chat_id = ?,
          panel_message_id = ?,
          updated_at_ms = ?
        WHERE singleton_id = 1
      `,
    )
    .run(chatId, messageId, nowMs);

  if (result.changes !== 1) {
    throw new Error("Application state is not initialized");
  }
}

function getCareEvent(
  database: SQLiteDatabase,
  eventId: number,
): CareEvent | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          procedure_code,
          performed_at_ms,
          actor_telegram_user_id,
          actor_display_name,
          actor_username,
          confirmation_chat_id,
          confirmation_message_id,
          created_at_ms,
          undone_at_ms
        FROM care_events
        WHERE id = ?
      `,
    )
    .get(eventId) as CareEventRow | undefined;

  return row === undefined ? null : mapCareEvent(row);
}

function getLatestActiveEvent(
  database: SQLiteDatabase,
  procedureCode: ProcedureCode,
): CareEvent | null {
  const row = database
    .prepare(
      `
        SELECT
          id,
          procedure_code,
          performed_at_ms,
          actor_telegram_user_id,
          actor_display_name,
          actor_username,
          confirmation_chat_id,
          confirmation_message_id,
          created_at_ms,
          undone_at_ms
        FROM care_events
        WHERE procedure_code = ? AND undone_at_ms IS NULL
        ORDER BY performed_at_ms DESC, id DESC
        LIMIT 1
      `,
    )
    .get(procedureCode) as CareEventRow | undefined;

  return row === undefined ? null : mapCareEvent(row);
}

function getInitialBaselineAtMs(database: SQLiteDatabase): number {
  const row = database
    .prepare(
      `
        SELECT initial_baseline_at_ms
        FROM app_state
        WHERE singleton_id = 1
      `,
    )
    .get() as AppStateBaselineRow | undefined;

  if (row === undefined) {
    throw new Error("Application state is not initialized");
  }

  return row.initial_baseline_at_ms;
}

function mapCareEvent(row: CareEventRow): CareEvent {
  return {
    actorDisplayName: row.actor_display_name,
    actorTelegramUserId: row.actor_telegram_user_id,
    actorUsername: row.actor_username,
    confirmationChatId: row.confirmation_chat_id,
    confirmationMessageId: row.confirmation_message_id,
    createdAtMs: row.created_at_ms,
    id: row.id,
    performedAtMs: row.performed_at_ms,
    procedureCode: row.procedure_code,
    undoneAtMs: row.undone_at_ms,
  };
}
