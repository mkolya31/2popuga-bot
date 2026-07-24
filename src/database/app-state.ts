import type { SQLiteDatabase } from "./sqlite.js";

const INITIAL_BASELINE_HOUR = 19;

export interface AppState {
  createdAtMs: number;
  initialBaselineAtMs: number;
  panelChatId: number | null;
  panelMessageId: number | null;
  updatedAtMs: number;
}

interface AppStateRow {
  created_at_ms: number;
  initial_baseline_at_ms: number;
  panel_chat_id: number | null;
  panel_message_id: number | null;
  updated_at_ms: number;
}

export function ensureAppState(
  database: SQLiteDatabase,
  timeZone: string,
  nowMs: number = Date.now(),
): AppState {
  const initialBaselineAtMs = startHourInTimeZone(nowMs, timeZone, INITIAL_BASELINE_HOUR);

  database
    .prepare(
      `
        INSERT INTO app_state (
          singleton_id,
          initial_baseline_at_ms,
          created_at_ms,
          updated_at_ms
        ) VALUES (1, ?, ?, ?)
        ON CONFLICT (singleton_id) DO NOTHING
      `,
    )
    .run(initialBaselineAtMs, nowMs, nowMs);

  const row = database
    .prepare(
      `
        SELECT
          initial_baseline_at_ms,
          panel_chat_id,
          panel_message_id,
          created_at_ms,
          updated_at_ms
        FROM app_state
        WHERE singleton_id = 1
      `,
    )
    .get() as AppStateRow | undefined;

  if (row === undefined) {
    throw new Error("Failed to initialize application state");
  }

  return {
    createdAtMs: row.created_at_ms,
    initialBaselineAtMs: row.initial_baseline_at_ms,
    panelChatId: row.panel_chat_id,
    panelMessageId: row.panel_message_id,
    updatedAtMs: row.updated_at_ms,
  };
}

function startHourInTimeZone(nowMs: number, timeZone: string, hour: number): number {
  const dateParts = getZonedParts(nowMs, timeZone);
  const localTimeAsUtc = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    hour,
  );

  let result = localTimeAsUtc;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offsetMs = getTimeZoneOffsetMs(result, timeZone);
    const adjustedResult = localTimeAsUtc - offsetMs;

    if (adjustedResult === result) {
      break;
    }

    result = adjustedResult;
  }

  return result;
}

function getTimeZoneOffsetMs(epochMs: number, timeZone: string): number {
  const parts = getZonedParts(epochMs, timeZone);
  const zonedTimeAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return zonedTimeAsUtc - Math.trunc(epochMs / 1_000) * 1_000;
}

function getZonedParts(
  epochMs: number,
  timeZone: string,
): {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });
  const values = new Map(
    formatter
      .formatToParts(epochMs)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  const second = values.get("second");

  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    throw new Error(`Failed to resolve date parts for time zone ${timeZone}`);
  }

  return { day, hour, minute, month, second, year };
}
