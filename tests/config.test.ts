import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../src/config.js";

const validEnvironment = {
  ALLOWED_CHAT_ID: "-1001234567890",
  BOT_TOKEN: "123456:test-token",
  DATABASE_PATH: "./test-data/bot.sqlite",
  NODE_ENV: "production",
  PORT: "8080",
  TZ: "Europe/Moscow",
  WEBHOOK_BASE_URL: "https://2popuga.kolyach.me",
  WEBHOOK_PATH: "/telegram/webhook",
  WEBHOOK_SECRET: "a".repeat(32),
};

describe("loadConfig", () => {
  it("loads and normalizes a valid configuration", () => {
    const config = loadConfig(validEnvironment);

    expect(config).toEqual({
      allowedChatId: -1_001_234_567_890,
      botToken: "123456:test-token",
      databasePath: "./test-data/bot.sqlite",
      nodeEnv: "production",
      port: 8080,
      timeZone: "Europe/Moscow",
      webhook: {
        baseUrl: "https://2popuga.kolyach.me/",
        path: "/telegram/webhook",
        secret: "a".repeat(32),
        url: "https://2popuga.kolyach.me/telegram/webhook",
      },
    });
  });

  it("uses safe defaults for optional values", () => {
    const config = loadConfig({
      ALLOWED_CHAT_ID: "-1",
      BOT_TOKEN: "token",
      WEBHOOK_BASE_URL: "https://example.com",
      WEBHOOK_SECRET: "b".repeat(32),
    });

    expect(config.nodeEnv).toBe("development");
    expect(config.databasePath).toBe("./data/2popuga.sqlite");
    expect(config.port).toBe(3000);
    expect(config.timeZone).toBe("Europe/Moscow");
    expect(config.webhook.path).toBe("/telegram/webhook");
  });

  it("rejects a database path containing a null byte", () => {
    expect(() =>
      loadConfig({ ...validEnvironment, DATABASE_PATH: "./data/\0bot.sqlite" }),
    ).toThrow("DATABASE_PATH must not contain null bytes");
  });

  it("reports all missing required values without exposing secrets", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow("BOT_TOKEN is required");
    expect(() => loadConfig({})).toThrow("ALLOWED_CHAT_ID must be a non-zero safe integer");
    expect(() => loadConfig({})).toThrow("WEBHOOK_BASE_URL is required");
    expect(() => loadConfig({})).toThrow("WEBHOOK_SECRET must contain 32-256 characters");
  });

  it.each(["0", "65536", "not-a-number", "1.5"])("rejects invalid port %s", (port) => {
    expect(() => loadConfig({ ...validEnvironment, PORT: port })).toThrow(
      "PORT must be an integer between 1 and 65535",
    );
  });

  it.each(["", "0", "1.5", "not-a-number"])("rejects invalid chat ID %s", (chatId) => {
    expect(() => loadConfig({ ...validEnvironment, ALLOWED_CHAT_ID: chatId })).toThrow(
      "ALLOWED_CHAT_ID must be a non-zero safe integer",
    );
  });

  it.each([
    "http://example.com",
    "https://user@example.com",
    "https://example.com/path",
    "https://example.com?query=1",
  ])("rejects invalid webhook base URL %s", (baseUrl) => {
    expect(() => loadConfig({ ...validEnvironment, WEBHOOK_BASE_URL: baseUrl })).toThrow(
      "WEBHOOK_BASE_URL must be an HTTPS origin",
    );
  });

  it.each(["relative", "/", "/with space", "/path?query=1"])(
    "rejects invalid webhook path %s",
    (path) => {
      expect(() => loadConfig({ ...validEnvironment, WEBHOOK_PATH: path })).toThrow(
        "WEBHOOK_PATH must be an absolute path",
      );
    },
  );

  it.each(["short", "a".repeat(257), "invalid.secret".repeat(3)])(
    "rejects invalid webhook secret",
    (secret) => {
      expect(() => loadConfig({ ...validEnvironment, WEBHOOK_SECRET: secret })).toThrow(
        "WEBHOOK_SECRET must contain 32-256 characters",
      );
    },
  );
});
