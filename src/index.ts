import type { Server } from "node:http";

import { createApp, type ApplicationState } from "./app.js";
import { createBotRuntime } from "./bot.js";
import { loadConfig } from "./config.js";
import { ensureAppState } from "./database/app-state.js";
import { openDatabase } from "./database/sqlite.js";

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const database = openDatabase(config.databasePath);
  ensureAppState(database, config.timeZone);
  const state: ApplicationState = { ready: false };
  const botRuntime = createBotRuntime(config, database);
  const app = createApp({
    state,
    webhookHandler: botRuntime.webhookHandler,
    webhookPath: config.webhook.path,
  });

  const server = app.listen(config.port, () => {
    console.log(`HTTP server is listening on port ${config.port}`);
  });

  try {
    await botRuntime.initialize();
    state.ready = true;
  } catch (error) {
    console.error("Failed to initialize Telegram webhook", error);
    await closeServer(server);
    database.close();
    throw error;
  }

  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    state.ready = false;
    console.log(`Received ${signal}, shutting down`);

    try {
      await closeServer(server);
    } catch (error) {
      console.error("Failed to close HTTP server", error);
      process.exitCode = 1;
    }

    try {
      database.close();
    } catch (error) {
      console.error("Failed to close SQLite database", error);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch((error: unknown) => {
  console.error("Application failed to start", error);
  process.exitCode = 1;
});
