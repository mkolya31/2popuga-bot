import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

describe("HTTP application", () => {
  it("reports that the process is healthy", async () => {
    const response = await request(createApp()).get("/healthz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("reports that the application is ready", async () => {
    const response = await request(createApp()).get("/readyz");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
  });
});
