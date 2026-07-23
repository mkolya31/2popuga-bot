import { Bot, webhookCallback, type Context } from "grammy";
import type { RequestHandler } from "express";

import type { AppConfig } from "./config.js";

const ALLOWED_UPDATES = ["message", "callback_query"] as const;

export interface BotRuntime {
  initialize: () => Promise<void>;
  webhookHandler: RequestHandler;
}

export function createBotRuntime(
  config: AppConfig,
  bot: Bot<Context> = new Bot<Context>(config.botToken),
): BotRuntime {

  const webhookHandler = webhookCallback(bot, "express", {
    onTimeout: "throw",
    secretToken: config.webhook.secret,
    timeoutMilliseconds: 10_000,
  });

  return {
    webhookHandler,
    async initialize(): Promise<void> {
      await bot.init();
      await bot.api.setWebhook(config.webhook.url, {
        allowed_updates: ALLOWED_UPDATES,
        drop_pending_updates: false,
        secret_token: config.webhook.secret,
      });

      console.log(`Telegram webhook registered for @${bot.botInfo.username}`);
    },
  };
}
