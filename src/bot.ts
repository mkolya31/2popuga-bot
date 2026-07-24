import { Bot, InlineKeyboard, webhookCallback, type Context } from "grammy";
import type { RequestHandler } from "express";

import {
  attachConfirmationMessage,
  getProcedureStatuses,
  recordCareEvent,
  savePanelMessage,
  undoCareEvent,
  type CareEvent,
} from "./care-service.js";
import type { AppConfig } from "./config.js";
import type { SQLiteDatabase } from "./database/sqlite.js";
import {
  formatConfirmation,
  formatDuplicateNotice,
  formatStatus,
  formatUndoNotice,
  formatUndoneConfirmation,
  PANEL_TEXT,
} from "./messages.js";
import {
  getProcedure,
  isProcedureCode,
} from "./procedures.js";

const ALLOWED_UPDATES = ["message", "callback_query"] as const;
const COMPLETE_CALLBACK_PREFIX = "complete:";
const UNDO_CALLBACK_PREFIX = "undo:";

export interface BotRuntime {
  initialize: () => Promise<void>;
  webhookHandler: RequestHandler;
}

export function createBotRuntime(
  config: AppConfig,
  database: SQLiteDatabase,
  bot: Bot<Context> = new Bot<Context>(config.botToken),
  now: () => number = Date.now,
): BotRuntime {
  registerHandlers(bot, config, database, now);

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

function registerHandlers(
  bot: Bot<Context>,
  config: AppConfig,
  database: SQLiteDatabase,
  now: () => number,
): void {
  bot.use(async (context, next) => {
    if (context.chat?.id !== config.allowedChatId) {
      return;
    }

    await next();
  });

  bot.command("start", async (context) => {
    const panelMessage = await context.reply(PANEL_TEXT, {
      reply_markup: createPanelKeyboard(),
    });

    savePanelMessage(
      database,
      panelMessage.chat.id,
      panelMessage.message_id,
      now(),
    );
  });

  bot.callbackQuery(/^complete:/u, async (context) => {
    const procedureCode = context.callbackQuery.data.slice(
      COMPLETE_CALLBACK_PREFIX.length,
    );

    if (!isProcedureCode(procedureCode)) {
      await context.answerCallbackQuery({
        show_alert: true,
        text: "Неизвестная процедура",
      });
      return;
    }

    await context.answerCallbackQuery();

    const eventNowMs = now();
    const actorDisplayName = getActorDisplayName(context.from);
    const result = recordCareEvent(database, {
      actorDisplayName,
      actorTelegramUserId: context.from.id,
      actorUsername: context.from.username ?? null,
      chatId: config.allowedChatId,
      nowMs: eventNowMs,
      procedureCode,
    });

    if (result.kind === "duplicate") {
      await context.reply(
        formatDuplicateNotice(result.event, config.timeZone),
      );
      return;
    }

    const confirmationMessage = await context.reply(
      formatConfirmation(result.event, config.timeZone),
      {
        reply_markup: new InlineKeyboard().text(
          "↩️ Отменить",
          `${UNDO_CALLBACK_PREFIX}${result.event.id}`,
        ),
      },
    );

    attachConfirmationMessage(
      database,
      result.event.id,
      confirmationMessage.message_id,
    );

    if (
      result.previousEvent !== null &&
      result.previousEvent.confirmationMessageId !== null
    ) {
      await removeEventKeyboard(bot, result.previousEvent);
    }
  });

  bot.callbackQuery("status", async (context) => {
    await context.answerCallbackQuery();
    const statusNowMs = now();
    const statuses = getProcedureStatuses(database, statusNowMs);
    await context.reply(
      formatStatus(statuses, statusNowMs, config.timeZone),
    );
  });

  bot.callbackQuery(/^undo:/u, async (context) => {
    const eventId = parseEventId(
      context.callbackQuery.data.slice(UNDO_CALLBACK_PREFIX.length),
    );

    if (eventId === null) {
      await context.answerCallbackQuery({
        show_alert: true,
        text: "Некорректная отметка",
      });
      return;
    }

    const actorDisplayName = getActorDisplayName(context.from);
    const undoneAtMs = now();
    const result = undoCareEvent(
      database,
      eventId,
      context.from.id,
      actorDisplayName,
      undoneAtMs,
    );

    if (result.kind !== "undone") {
      await context.answerCallbackQuery({
        show_alert: true,
        text: getUndoErrorMessage(result.kind),
      });
      return;
    }

    await context.answerCallbackQuery();

    if (result.event.confirmationMessageId !== null) {
      await editUndoneConfirmation(
        bot,
        result.event,
        actorDisplayName,
        result.event.undoneAtMs ?? undoneAtMs,
        config.timeZone,
      );
    }

    await context.reply(
      formatUndoNotice(result.nextDueAtMs, config.timeZone),
    );
  });
}

function createPanelKeyboard(): InlineKeyboard {
  const water = getProcedure("water");
  const food = getProcedure("food");
  const tray = getProcedure("tray");

  return new InlineKeyboard()
    .text(water.buttonLabel, `${COMPLETE_CALLBACK_PREFIX}${water.code}`)
    .text(food.buttonLabel, `${COMPLETE_CALLBACK_PREFIX}${food.code}`)
    .row()
    .text(tray.buttonLabel, `${COMPLETE_CALLBACK_PREFIX}${tray.code}`)
    .row()
    .text("📋 Статус", "status");
}

async function removeEventKeyboard(
  bot: Bot<Context>,
  event: CareEvent,
): Promise<void> {
  if (event.confirmationMessageId === null) {
    return;
  }

  try {
    await bot.api.editMessageReplyMarkup(
      event.confirmationChatId,
      event.confirmationMessageId,
    );
  } catch (error) {
    console.warn(
      `Failed to remove keyboard from care event ${event.id}`,
      error,
    );
  }
}

async function editUndoneConfirmation(
  bot: Bot<Context>,
  event: CareEvent,
  actorDisplayName: string,
  undoneAtMs: number,
  timeZone: string,
): Promise<void> {
  if (event.confirmationMessageId === null) {
    return;
  }

  try {
    await bot.api.editMessageText(
      event.confirmationChatId,
      event.confirmationMessageId,
      formatUndoneConfirmation(
        event,
        actorDisplayName,
        undoneAtMs,
        timeZone,
      ),
      {
        reply_markup: { inline_keyboard: [] },
      },
    );
  } catch (error) {
    console.warn(`Failed to mark care event ${event.id} as undone`, error);
  }
}

function getActorDisplayName(user: Context["from"]): string {
  const firstName = user?.first_name.trim();

  if (firstName !== undefined && firstName !== "") {
    return firstName;
  }

  if (user?.username !== undefined && user.username !== "") {
    return `@${user.username}`;
  }

  return user === undefined ? "Пользователь" : `Пользователь ${user.id}`;
}

function parseEventId(value: string): number | null {
  const eventId = Number(value);

  return Number.isSafeInteger(eventId) && eventId > 0 ? eventId : null;
}

function getUndoErrorMessage(
  kind: "already_undone" | "forbidden" | "not_found" | "superseded",
): string {
  switch (kind) {
    case "already_undone":
      return "Эта отметка уже отменена";
    case "forbidden":
      return "Отменить может только создатель отметки";
    case "not_found":
      return "Отметка не найдена";
    case "superseded":
      return "Можно отменить только последнюю отметку процедуры";
  }
}
