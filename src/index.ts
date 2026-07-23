import { createApp } from "./app.js";
import { resolvePort } from "./config.js";

const port = resolvePort();
const app = createApp();

const server = app.listen(port, () => {
  console.log(`HTTP server is listening on port ${port}`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`Received ${signal}, shutting down`);

  server.close((error) => {
    if (error) {
      console.error("Failed to close HTTP server", error);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => {
  shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  shutdown("SIGTERM");
});
