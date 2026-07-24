import type { CareEvent, ProcedureStatus } from "./care-service.js";
import { getProcedure } from "./procedures.js";

export const PANEL_TEXT = "🐦 Уход за попугаями";

export function formatConfirmation(
  event: CareEvent,
  timeZone: string,
): string {
  const procedure = getProcedure(event.procedureCode);
  const nextDueAtMs = event.performedAtMs + procedure.intervalMs;

  return [
    `✅ ${procedure.emoji} ${procedure.completionLabel}`,
    `${event.actorDisplayName} · ${formatDateTime(event.performedAtMs, timeZone)}`,
    `Следующий срок: ${formatDateTime(nextDueAtMs, timeZone)}`,
  ].join("\n");
}

export function formatDuplicateNotice(
  event: CareEvent,
  timeZone: string,
): string {
  const procedure = getProcedure(event.procedureCode);

  return [
    `ℹ️ ${procedure.emoji} Уже отмечено: ${procedure.statusLabel}`,
    `${event.actorDisplayName} · ${formatDateTime(event.performedAtMs, timeZone)}`,
  ].join("\n");
}

export function formatUndoneConfirmation(
  event: CareEvent,
  actorDisplayName: string,
  undoneAtMs: number,
  timeZone: string,
): string {
  return [
    formatConfirmation(event, timeZone),
    "",
    `↩️ Отменено: ${actorDisplayName} · ${formatDateTime(undoneAtMs, timeZone)}`,
  ].join("\n");
}

export function formatUndoNotice(
  nextDueAtMs: number,
  timeZone: string,
): string {
  return [
    "↩️ Отметка отменена",
    `Новый срок: ${formatDateTime(nextDueAtMs, timeZone)}`,
  ].join("\n");
}

export function formatStatus(
  statuses: readonly ProcedureStatus[],
  nowMs: number,
  timeZone: string,
): string {
  const sections = statuses.map((status) => {
    const procedure = getProcedure(status.procedureCode);
    const stateLine = formatStateLine(status, nowMs);
    const lastPerformed =
      status.lastEvent === null
        ? "нет данных"
        : formatDateTime(status.lastEvent.performedAtMs, timeZone);
    const actor =
      status.lastEvent === null ? "—" : status.lastEvent.actorDisplayName;

    return [
      `${procedure.emoji} ${procedure.statusLabel}`,
      "",
      stateLine,
      `Следующий срок: ${formatDateTime(status.dueAtMs, timeZone)}`,
      `Последнее выполнение: ${lastPerformed}`,
      `Выполнил: ${actor}`,
    ].join("\n");
  });

  return ["🐦 Уход за попугаями — статус", ...sections].join("\n\n");
}

export function formatDateTime(epochMs: number, timeZone: string): string {
  const date = new Date(epochMs);
  const datePart = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone,
  }).format(date);
  const timePart = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone,
  }).format(date);

  return `${datePart}, ${timePart}`;
}

function formatStateLine(status: ProcedureStatus, nowMs: number): string {
  if (status.state === "normal") {
    return `🟢 Осталось ${formatDuration(status.dueAtMs - nowMs)}`;
  }

  if (status.state === "due") {
    return `🟡 Пора · после срока ${formatDuration(nowMs - status.dueAtMs)}`;
  }

  return `🔴 Просрочено на ${formatDuration(nowMs - status.dueAtMs)}`;
}

function formatDuration(durationMs: number): string {
  const totalMinutes = Math.floor(Math.max(0, durationMs) / 60_000);

  if (totalMinutes < 1) {
    return "меньше минуты";
  }

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days} ${pluralize(days, "день", "дня", "дней")}`);
  }

  if (hours > 0) {
    parts.push(`${hours} ${pluralize(hours, "час", "часа", "часов")}`);
  }

  if (days === 0 && minutes > 0) {
    parts.push(`${minutes} ${pluralize(minutes, "минута", "минуты", "минут")}`);
  }

  return parts.slice(0, 2).join(" ");
}

function pluralize(
  value: number,
  singular: string,
  few: string,
  many: string,
): string {
  const modulo100 = value % 100;
  const modulo10 = value % 10;

  if (modulo100 >= 11 && modulo100 <= 14) {
    return many;
  }

  if (modulo10 === 1) {
    return singular;
  }

  if (modulo10 >= 2 && modulo10 <= 4) {
    return few;
  }

  return many;
}
