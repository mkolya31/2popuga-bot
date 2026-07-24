import { Bot, type Context } from "grammy";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { createBotRuntime } from "../src/bot.js";
import type { AppConfig } from "../src/config.js";
import { ensureAppState } from "../src/database/app-state.js";
import { openDatabase, type SQLiteDatabase } from "../src/database/sqlite.js";
import { PANEL_TEXT } from "../src/messages.js";

const ALLOWED_CHAT_ID = -1_001_234_567_890;
const NOW_MS = Date.parse("2026-07-24T16:40:00.000Z");

const config: AppConfig = {
  allowedChatId: ALLOWED_CHAT_ID,
  botToken: "123456:test-token",
  databasePath: ":memory:",
  nodeEnv: "test",
  port: 3000,
  timeZone: "Europe/Moscow",
  webhook: {
    baseUrl: "https://2popuga.kolyach.me/",
    path: "/telegram/webhook",
    secret: "test_webhook_secret_1234567890_ab",
    url: "https://2popuga.kolyach.me/telegram/webhook",
  },
};

const openDatabases: SQLiteDatabase[] = [];

afterEach(() => {
  vi.restoreAllMocks();

  for (const database of openDatabases.splice(0)) {
    if (database.open) {
      database.close();
    }
  }
});

function createDatabase(): SQLiteDatabase {
  const database = openDatabase(":memory:");
  ensureAppState(database, config.timeZone, NOW_MS);
  openDatabases.push(database);
  return database;
}

function createInitializedBot(): Bot<Context> {
  return new Bot<Context>(config.botToken, {
    botInfo: {
      allows_users_to_create_topics: false,
      can_connect_to_business: false,
      can_join_groups: true,
      can_manage_bots: false,
      can_read_all_group_messages: false,
      first_name: "Test",
      has_main_web_app: false,
      has_topics_enabled: false,
      id: 123_456,
      is_bot: true,
      supports_join_request_queries: false,
      supports_inline_queries: false,
      username: "test_2popuga_bot",
    },
  });
}

function mockTelegramApi(bot: Bot<Context>) {
  let nextMessageId = 100;
  const calls: Array<{
    method: string;
    payload: Record<string, unknown>;
  }> = [];

  bot.api.config.use(async (_previous, method, payload) => {
    const capturedPayload = payload as Record<string, unknown>;
    calls.push({
      method,
      payload: capturedPayload,
    });

    if (method === "sendMessage") {
      const chatId = capturedPayload.chat_id;
      const text = capturedPayload.text;
      const message = {
        chat: createChat(Number(chatId)),
        date: Math.floor(NOW_MS / 1_000),
        message_id: nextMessageId,
        text,
      };
      nextMessageId += 1;

      return { ok: true, result: message } as never;
    }

    if (method === "editMessageText") {
      return {
        ok: true,
        result: {
          chat: createChat(Number(capturedPayload.chat_id)),
          date: Math.floor(NOW_MS / 1_000),
          message_id: capturedPayload.message_id,
          text: capturedPayload.text,
        },
      } as never;
    }

    return { ok: true, result: true } as never;
  });

  return {
    calls,
    callsFor(method: string) {
      return calls.filter((call) => call.method === method);
    },
  };
}

function createChat(chatId: number) {
  return {
    id: chatId,
    title: "Уход за попугаями",
    type: "supergroup" as const,
  };
}

function createUser(id = 42, firstName = "Максим") {
  return {
    first_name: firstName,
    id,
    is_bot: false,
    username: firstName === "Максим" ? "maxim" : undefined,
  };
}

function createStartUpdate(chatId = ALLOWED_CHAT_ID) {
  return {
    message: {
      chat: createChat(chatId),
      date: Math.floor(NOW_MS / 1_000),
      entities: [{ length: 6, offset: 0, type: "bot_command" }],
      from: createUser(),
      message_id: 1,
      text: "/start",
    },
    update_id: 10,
  } as never;
}

function createCallbackUpdate(
  data: string,
  updateId: number,
  user = createUser(),
  chatId = ALLOWED_CHAT_ID,
) {
  return {
    callback_query: {
      chat_instance: "test-chat-instance",
      data,
      from: user,
      id: `callback-${updateId}`,
      message: {
        chat: createChat(chatId),
        date: Math.floor(NOW_MS / 1_000),
        message_id: 50,
        text: PANEL_TEXT,
      },
    },
    update_id: updateId,
  } as never;
}

describe("Telegram bot runtime", () => {
  it("registers the configured webhook", async () => {
    const bot = createInitializedBot();
    const setWebhook = vi.spyOn(bot.api, "setWebhook").mockResolvedValue(true);
    const runtime = createBotRuntime(config, createDatabase(), bot);

    await runtime.initialize();

    expect(setWebhook).toHaveBeenCalledWith(config.webhook.url, {
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
      secret_token: config.webhook.secret,
    });
  });

  it("publishes and stores the main panel for /start in the allowed chat", async () => {
    const database = createDatabase();
    const bot = createInitializedBot();
    const api = mockTelegramApi(bot);
    createBotRuntime(config, database, bot, () => NOW_MS);

    await bot.handleUpdate(createStartUpdate());

    expect(api.callsFor("sendMessage")[0]?.payload).toEqual(
      expect.objectContaining({
        chat_id: ALLOWED_CHAT_ID,
        reply_markup: expect.objectContaining({
          inline_keyboard: [
            [
              {
                callback_data: "complete:water",
                text: "💧 Поменяли воду",
              },
              {
                callback_data: "complete:food",
                text: "🌾 Поменяли корм",
              },
            ],
            [
              {
                callback_data: "complete:tray",
                text: "🧽 Помыли поддон",
              },
            ],
            [{ callback_data: "status", text: "📋 Статус" }],
          ],
        }),
        text: PANEL_TEXT,
      }),
    );
    expect(
      database
        .prepare(
          "SELECT panel_chat_id, panel_message_id FROM app_state WHERE singleton_id = 1",
        )
        .get(),
    ).toEqual({
      panel_chat_id: ALLOWED_CHAT_ID,
      panel_message_id: 100,
    });
  });

  it("ignores messages from any other chat", async () => {
    const bot = createInitializedBot();
    const api = mockTelegramApi(bot);
    createBotRuntime(config, createDatabase(), bot, () => NOW_MS);

    await bot.handleUpdate(createStartUpdate(-999));

    expect(api.callsFor("sendMessage")).toHaveLength(0);
  });

  it("records a procedure and sends a confirmation with an undo button", async () => {
    const database = createDatabase();
    const bot = createInitializedBot();
    const api = mockTelegramApi(bot);
    createBotRuntime(config, database, bot, () => NOW_MS);

    await bot.handleUpdate(createCallbackUpdate("complete:water", 20));

    expect(api.callsFor("answerCallbackQuery")[0]?.payload).toEqual({
      callback_query_id: "callback-20",
    });
    expect(api.callsFor("sendMessage")[0]?.payload).toEqual(
      expect.objectContaining({
        chat_id: ALLOWED_CHAT_ID,
        reply_markup: expect.objectContaining({
          inline_keyboard: [
            [{ callback_data: "undo:1", text: "↩️ Отменить" }],
          ],
        }),
        text: [
          "✅ 💧 Вода заменена",
          "Максим · 24 июля, 19:40",
          "Следующий срок: 25 июля, 19:40",
        ].join("\n"),
      }),
    );
    expect(
      database
        .prepare(
          `
            SELECT
              procedure_code,
              actor_telegram_user_id,
              actor_display_name,
              confirmation_message_id
            FROM care_events
          `,
        )
        .get(),
    ).toEqual({
      actor_display_name: "Максим",
      actor_telegram_user_id: 42,
      confirmation_message_id: 100,
      procedure_code: "water",
    });
  });

  it("reports a duplicate from another user without creating a second event", async () => {
    const database = createDatabase();
    const bot = createInitializedBot();
    const api = mockTelegramApi(bot);
    let nowMs = NOW_MS;
    createBotRuntime(config, database, bot, () => nowMs);

    await bot.handleUpdate(createCallbackUpdate("complete:food", 25));
    nowMs += 4 * 60_000;
    await bot.handleUpdate(
      createCallbackUpdate(
        "complete:food",
        26,
        createUser(7, "Анна"),
      ),
    );

    expect(api.callsFor("sendMessage")).toHaveLength(2);
    expect(api.callsFor("sendMessage")[1]?.payload.text).toBe(
      "ℹ️ 🌾 Уже отмечено: Корм\nМаксим · 24 июля, 19:40",
    );
    expect(
      database.prepare("SELECT COUNT(*) FROM care_events").pluck().get(),
    ).toBe(1);
  });

  it("removes the older undo button when a new event is recorded", async () => {
    const database = createDatabase();
    const bot = createInitializedBot();
    const api = mockTelegramApi(bot);
    let nowMs = NOW_MS;
    createBotRuntime(config, database, bot, () => nowMs);

    await bot.handleUpdate(createCallbackUpdate("complete:tray", 27));
    nowMs += 6 * 60_000;
    await bot.handleUpdate(createCallbackUpdate("complete:tray", 28));

    expect(api.callsFor("editMessageReplyMarkup")[0]?.payload).toEqual({
      chat_id: ALLOWED_CHAT_ID,
      message_id: 100,
    });
    expect(
      database.prepare("SELECT COUNT(*) FROM care_events").pluck().get(),
    ).toBe(2);
  });

  it("undoes the newest procedure when its author presses the button", async () => {
    const database = createDatabase();
    const bot = createInitializedBot();
    const api = mockTelegramApi(bot);
    let nowMs = NOW_MS;
    createBotRuntime(config, database, bot, () => nowMs);

    await bot.handleUpdate(createCallbackUpdate("complete:water", 30));
    nowMs += 60_000;
    await bot.handleUpdate(createCallbackUpdate("undo:1", 31));

    expect(api.callsFor("editMessageText")[0]?.payload).toEqual(
      expect.objectContaining({
        chat_id: ALLOWED_CHAT_ID,
        message_id: 100,
        reply_markup: { inline_keyboard: [] },
        text: expect.stringContaining(
          "↩️ Отменено: Максим · 24 июля, 19:41",
        ),
      }),
    );
    expect(api.callsFor("sendMessage").at(-1)?.payload).toEqual({
      chat_id: ALLOWED_CHAT_ID,
      text: "↩️ Отметка отменена\nНовый срок: 25 июля, 19:00",
    });
    expect(
      database
        .prepare(
          "SELECT undone_at_ms, undone_by_telegram_user_id FROM care_events WHERE id = 1",
        )
        .get(),
    ).toEqual({
      undone_at_ms: nowMs,
      undone_by_telegram_user_id: 42,
    });
  });

  it("rejects an undo attempt from another user", async () => {
    const database = createDatabase();
    const bot = createInitializedBot();
    const api = mockTelegramApi(bot);
    createBotRuntime(config, database, bot, () => NOW_MS);

    await bot.handleUpdate(createCallbackUpdate("complete:water", 35));
    await bot.handleUpdate(
      createCallbackUpdate("undo:1", 36, createUser(7, "Анна")),
    );

    expect(api.callsFor("answerCallbackQuery").at(-1)?.payload).toEqual({
      callback_query_id: "callback-36",
      show_alert: true,
      text: "Отменить может только создатель отметки",
    });
    expect(
      database
        .prepare("SELECT undone_at_ms FROM care_events WHERE id = 1")
        .pluck()
        .get(),
    ).toBeNull();
  });

  it("answers the status button with all three procedures", async () => {
    const bot = createInitializedBot();
    const api = mockTelegramApi(bot);
    createBotRuntime(config, createDatabase(), bot, () => NOW_MS);

    await bot.handleUpdate(createCallbackUpdate("status", 40));

    const statusText = api.callsFor("sendMessage")[0]?.payload.text;
    expect(statusText).toContain("🐦 Уход за попугаями — статус");
    expect(statusText).toContain("💧 Вода");
    expect(statusText).toContain("🌾 Корм");
    expect(statusText).toContain("🧽 Поддон");
    expect(statusText).toContain("Последнее выполнение: нет данных");
  });

  it("rejects a webhook request without the configured secret", async () => {
    const runtime = createBotRuntime(
      config,
      createDatabase(),
      createInitializedBot(),
    );
    const app = createApp({
      state: { ready: true },
      webhookHandler: runtime.webhookHandler,
      webhookPath: config.webhook.path,
    });

    const response = await request(app)
      .post(config.webhook.path)
      .send({ update_id: 1 });

    expect(response.status).toBe(401);
  });

  it("accepts a webhook request with the configured secret", async () => {
    const runtime = createBotRuntime(
      config,
      createDatabase(),
      createInitializedBot(),
    );
    const app = createApp({
      state: { ready: true },
      webhookHandler: runtime.webhookHandler,
      webhookPath: config.webhook.path,
    });

    const response = await request(app)
      .post(config.webhook.path)
      .set("X-Telegram-Bot-Api-Secret-Token", config.webhook.secret)
      .send({ update_id: 2 });

    expect(response.status).toBe(200);
  });
});
