import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";

export interface ApplicationState {
  ready: boolean;
}

export interface CreateAppOptions {
  state: ApplicationState;
  webhookHandler: RequestHandler;
  webhookPath: string;
}

export function createApp(options: CreateAppOptions): Express {
  const app = express();

  app.disable("x-powered-by");

  app.get("/healthz", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/readyz", (_request, response) => {
    if (!options.state.ready) {
      response.status(503).json({ status: "not_ready" });
      return;
    }

    response.status(200).json({ status: "ready" });
  });

  app.post(
    options.webhookPath,
    express.json({ limit: "1mb", type: "application/json" }),
    options.webhookHandler,
  );

  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    console.error("HTTP request failed", error);

    if (response.headersSent) {
      next(error);
      return;
    }

    response.status(500).json({ status: "error" });
  };

  app.use(errorHandler);

  return app;
}
