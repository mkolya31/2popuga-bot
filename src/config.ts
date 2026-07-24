const DEFAULT_PORT = 3000;
const DEFAULT_TIME_ZONE = "Europe/Moscow";
const DEFAULT_WEBHOOK_PATH = "/telegram/webhook";
const DEFAULT_DATABASE_PATH = "./data/2popuga.sqlite";
const MINIMUM_WEBHOOK_SECRET_LENGTH = 32;

type Environment = Record<string, string | undefined>;

export interface AppConfig {
  allowedChatId: number;
  botToken: string;
  databasePath: string;
  nodeEnv: "development" | "test" | "production";
  port: number;
  timeZone: string;
  webhook: {
    baseUrl: string;
    path: string;
    secret: string;
    url: string;
  };
}

export class ConfigError extends Error {
  constructor(problems: string[]) {
    super(`Invalid environment configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(environment: Environment = process.env): AppConfig {
  const problems: string[] = [];

  const botToken = readRequired(environment, "BOT_TOKEN", problems);
  const allowedChatId = parseChatId(environment.ALLOWED_CHAT_ID, problems);
  const databasePath = parseDatabasePath(environment.DATABASE_PATH, problems);
  const nodeEnv = parseNodeEnvironment(environment.NODE_ENV, problems);
  const port = parsePort(environment.PORT, problems);
  const timeZone = parseTimeZone(environment.TZ, problems);
  const webhookBaseUrl = parseWebhookBaseUrl(environment.WEBHOOK_BASE_URL, problems);
  const webhookPath = parseWebhookPath(environment.WEBHOOK_PATH, problems);
  const webhookSecret = parseWebhookSecret(environment.WEBHOOK_SECRET, problems);

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return {
    allowedChatId,
    botToken,
    databasePath,
    nodeEnv,
    port,
    timeZone,
    webhook: {
      baseUrl: webhookBaseUrl,
      path: webhookPath,
      secret: webhookSecret,
      url: new URL(webhookPath, webhookBaseUrl).toString(),
    },
  };
}

function parseDatabasePath(value: string | undefined, problems: string[]): string {
  const databasePath = value?.trim() || DEFAULT_DATABASE_PATH;

  if (databasePath.includes("\0")) {
    problems.push("DATABASE_PATH must not contain null bytes");
    return DEFAULT_DATABASE_PATH;
  }

  return databasePath;
}

function readRequired(environment: Environment, name: string, problems: string[]): string {
  const value = environment[name]?.trim();

  if (value === undefined || value === "") {
    problems.push(`${name} is required`);
    return "";
  }

  return value;
}

function parseChatId(value: string | undefined, problems: string[]): number {
  const normalized = value?.trim();
  const chatId = Number(normalized);

  if (
    normalized === undefined ||
    normalized === "" ||
    !Number.isSafeInteger(chatId) ||
    chatId === 0
  ) {
    problems.push("ALLOWED_CHAT_ID must be a non-zero safe integer");
    return 0;
  }

  return chatId;
}

function parseNodeEnvironment(
  value: string | undefined,
  problems: string[],
): AppConfig["nodeEnv"] {
  const normalized = value?.trim() || "development";

  if (normalized !== "development" && normalized !== "test" && normalized !== "production") {
    problems.push("NODE_ENV must be development, test, or production");
    return "development";
  }

  return normalized;
}

function parsePort(value: string | undefined, problems: string[]): number {
  const normalized = value?.trim();

  if (normalized === undefined || normalized === "") {
    return DEFAULT_PORT;
  }

  const port = Number(normalized);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    problems.push("PORT must be an integer between 1 and 65535");
    return DEFAULT_PORT;
  }

  return port;
}

function parseTimeZone(value: string | undefined, problems: string[]): string {
  const timeZone = value?.trim() || DEFAULT_TIME_ZONE;

  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
  } catch {
    problems.push("TZ must be a valid IANA time zone");
    return DEFAULT_TIME_ZONE;
  }

  return timeZone;
}

function parseWebhookBaseUrl(value: string | undefined, problems: string[]): string {
  const normalized = value?.trim();

  if (normalized === undefined || normalized === "") {
    problems.push("WEBHOOK_BASE_URL is required");
    return "https://invalid.example";
  }

  try {
    const url = new URL(normalized);

    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname !== "/"
    ) {
      throw new Error("Invalid webhook base URL");
    }

    return url.toString();
  } catch {
    problems.push("WEBHOOK_BASE_URL must be an HTTPS origin without a path, query, or fragment");
    return "https://invalid.example";
  }
}

function parseWebhookPath(value: string | undefined, problems: string[]): string {
  const path = value?.trim() || DEFAULT_WEBHOOK_PATH;

  if (!path.startsWith("/") || path === "/" || /[\s?#]/u.test(path)) {
    problems.push("WEBHOOK_PATH must be an absolute path without whitespace, query, or fragment");
    return DEFAULT_WEBHOOK_PATH;
  }

  return path;
}

function parseWebhookSecret(value: string | undefined, problems: string[]): string {
  const secret = value?.trim();

  if (
    secret === undefined ||
    secret.length < MINIMUM_WEBHOOK_SECRET_LENGTH ||
    secret.length > 256 ||
    !/^[A-Za-z0-9_-]+$/u.test(secret)
  ) {
    problems.push(
      `WEBHOOK_SECRET must contain ${MINIMUM_WEBHOOK_SECRET_LENGTH}-256 characters: A-Z, a-z, 0-9, _ or -`,
    );
    return "";
  }

  return secret;
}
