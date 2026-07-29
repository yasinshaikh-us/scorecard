import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler from "./query.js";

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

describe("handler", () => {
  const realFetch = global.fetch;
  const realEnv = { ...process.env };

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...realEnv };
  });

  it("rejects non-POST methods", async () => {
    const res = fakeRes();
    await handler({ method: "GET" }, res);
    expect(res.statusCode).toBe(405);
  });

  it("500s when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = fakeRes();
    await handler({ method: "POST", body: { system: "s", messages: [] } }, res);
    expect(res.statusCode).toBe(500);
  });

  it("400s when system or messages is missing from the body", async () => {
    const res = fakeRes();
    await handler({ method: "POST", body: { system: "s" } }, res);
    expect(res.statusCode).toBe(400);
  });

  it("400s when there's no body at all", async () => {
    const res = fakeRes();
    await handler({ method: "POST" }, res);
    expect(res.statusCode).toBe(400);
  });

  it("forwards a successful Anthropic response as-is", async () => {
    const fakeAnthropicBody = { content: [{ type: "text", text: '{"foo":"bar"}' }] };
    global.fetch = vi.fn(async (url, opts) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(opts.headers["x-api-key"]).toBe("test-key");
      const sentBody = JSON.parse(opts.body);
      expect(sentBody.model).toBe("claude-sonnet-5");
      expect(sentBody.system).toBe("sys prompt");
      return { ok: true, status: 200, json: async () => fakeAnthropicBody };
    });
    const res = fakeRes();
    await handler({ method: "POST", body: { system: "sys prompt", messages: [{ role: "user", content: "hi" }] } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(fakeAnthropicBody);
  });

  it("passes through the upstream status and error body on failure", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      json: async () => ({ type: "error", error: { message: "rate limited" } }),
    }));
    const res = fakeRes();
    await handler({ method: "POST", body: { system: "s", messages: [] } }, res);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({ error: { type: "error", error: { message: "rate limited" } } });
  });
});
