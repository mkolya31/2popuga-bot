export const DAY_MS = 24 * 60 * 60 * 1_000;

export type ProcedureCode = "water" | "food" | "tray";

export interface ProcedureDefinition {
  buttonLabel: string;
  code: ProcedureCode;
  completionLabel: string;
  emoji: string;
  intervalMs: number;
  statusLabel: string;
}

export const PROCEDURES: readonly ProcedureDefinition[] = [
  {
    buttonLabel: "💧 Поменяли воду",
    code: "water",
    completionLabel: "Вода заменена",
    emoji: "💧",
    intervalMs: DAY_MS,
    statusLabel: "Вода",
  },
  {
    buttonLabel: "🌾 Поменяли корм",
    code: "food",
    completionLabel: "Корм заменён",
    emoji: "🌾",
    intervalMs: 2 * DAY_MS,
    statusLabel: "Корм",
  },
  {
    buttonLabel: "🧽 Помыли поддон",
    code: "tray",
    completionLabel: "Поддон помыт",
    emoji: "🧽",
    intervalMs: DAY_MS,
    statusLabel: "Поддон",
  },
];

const proceduresByCode = new Map(
  PROCEDURES.map((procedure) => [procedure.code, procedure]),
);

export function isProcedureCode(value: string): value is ProcedureCode {
  return proceduresByCode.has(value as ProcedureCode);
}

export function getProcedure(code: ProcedureCode): ProcedureDefinition {
  const procedure = proceduresByCode.get(code);

  if (procedure === undefined) {
    throw new Error(`Unknown procedure code: ${code}`);
  }

  return procedure;
}
