import { Bot, type Context } from "grammy";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { createBotRuntime } from "../src/bot.js";
import type { AppConfig } from "../src/config.js";

const config: AppConfig = {
  allowedChatId: -1_001_234_567_890,
  botToken: "123456:test-token",
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

describe("Telegram bot runtime", () => {
  it("registers the configured webhook", async () => {
    const bot = createInitializedBot();
    const setWebhook = vi.spyOn(bot.api, "setWebhook").mockResolvedValue(true);
    const runtime = createBotRuntime(config, bot);

    await runtime.initialize();

    expect(setWebhook).toHaveBeenCalledWith(config.webhook.url, {
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
      secret_token: config.webhook.secret,
    });
  });

  it("rejects a webhook request without the configured secret", async () => {
    const runtime = createBotRuntime(config, createInitializedBot());
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
    const runtime = createBotRuntime(config, createInitializedBot());
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
