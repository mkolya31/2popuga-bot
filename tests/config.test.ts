import { describe, expect, it } from "vitest";

import { resolvePort } from "../src/config.js";

describe("resolvePort", () => {
  it("uses port 3000 by default", () => {
    expect(resolvePort(undefined)).toBe(3000);
    expect(resolvePort("")).toBe(3000);
  });

  it("accepts a valid port", () => {
    expect(resolvePort("8080")).toBe(8080);
  });

  it.each(["0", "65536", "not-a-number", "1.5"])("rejects invalid port %s", (value) => {
    expect(() => resolvePort(value)).toThrow("PORT must be an integer between 1 and 65535");
  });
});
