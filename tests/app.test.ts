import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp, type ApplicationState } from "../src/app.js";

const webhookHandler: RequestHandler = (incomingRequest, response) => {
  response.status(200).json({ updateId: incomingRequest.body.update_id });
};

function setup(state: ApplicationState = { ready: false }) {
  return createApp({
    state,
    webhookHandler,
    webhookPath: "/telegram/webhook",
  });
}

describe("HTTP application", () => {
  it("reports that the process is healthy", async () => {
    const response = await request(setup()).get("/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("reports that the application is not ready before initialization", async () => {
    const response = await request(setup()).get("/readyz");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: "not_ready" });
  });

  it("reports that the application is ready after initialization", async () => {
    const response = await request(setup({ ready: true })).get("/readyz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
  });

  it("forwards JSON updates to the configured webhook handler", async () => {
    const response = await request(setup())
      .post("/telegram/webhook")
      .send({ update_id: 42 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updateId: 42 });
  });

  it("rejects invalid JSON without invoking the webhook handler", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(setup())
      .post("/telegram/webhook")
      .set("Content-Type", "application/json")
      .send("{");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ status: "error" });

    consoleError.mockRestore();
  });
});
