import assert from "node:assert/strict";
import test from "node:test";

import { Hono } from "hono";

import { createLocalAuthMiddleware } from "./local-auth";

function createTestApp() {
  const app = new Hono();

  app.use(
    "/api/*",
    createLocalAuthMiddleware({
      allowedOrigins: ["null", "app://monet", "http://127.0.0.1:42832"],
      bearerToken: "test-token",
      port: 42831
    })
  );
  app.get("/api/health", (context) => context.text("ok"));

  return app;
}

async function request(init?: RequestInit) {
  return createTestApp().request("http://127.0.0.1:42831/api/health", init);
}

test("accepts valid localhost requests with a bearer token", async () => {
  const response = await request({
    headers: {
      Authorization: "Bearer test-token",
      Host: "127.0.0.1:42831",
      Origin: "http://127.0.0.1:42832"
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:42832");
});

test("applies CORS headers to downstream response objects", async () => {
  const app = new Hono();

  app.use(
    "/api/*",
    createLocalAuthMiddleware({
      allowedOrigins: ["http://127.0.0.1:42832"],
      bearerToken: "test-token",
      port: 42831
    })
  );
  app.get("/api/stream", () => new Response("ok", { headers: { "content-type": "text/event-stream" } }));

  const response = await app.request("http://127.0.0.1:42831/api/stream", {
    headers: {
      Authorization: "Bearer test-token",
      Host: "127.0.0.1:42831",
      Origin: "http://127.0.0.1:42832"
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:42832");
});

test("accepts default HTTP port loopback host headers without an explicit port", async () => {
  const app = new Hono();

  app.use(
    "/api/*",
    createLocalAuthMiddleware({
      allowedOrigins: ["http://127.0.0.1:42832"],
      bearerToken: "test-token",
      port: 80
    })
  );
  app.get("/api/health", (context) => context.text("ok"));

  const response = await app.request("http://127.0.0.1/api/health", {
    headers: {
      Authorization: "Bearer test-token",
      Host: "localhost",
      Origin: "http://127.0.0.1:42832"
    }
  });

  assert.equal(response.status, 200);
});

test("rejects missing bearer tokens", async () => {
  const response = await request({
    headers: {
      Host: "127.0.0.1:42831"
    }
  });

  assert.equal(response.status, 401);
});

test("rejects requests for unexpected hosts", async () => {
  const response = await request({
    headers: {
      Authorization: "Bearer test-token",
      Host: "example.com:42831"
    }
  });

  assert.equal(response.status, 403);
});

test("rejects requests from unexpected origins", async () => {
  const response = await request({
    headers: {
      Authorization: "Bearer test-token",
      Host: "127.0.0.1:42831",
      Origin: "https://example.com"
    }
  });

  assert.equal(response.status, 403);
});

test("rejects cookie-bearing requests", async () => {
  const response = await request({
    headers: {
      Authorization: "Bearer test-token",
      Cookie: "session=abc",
      Host: "127.0.0.1:42831"
    }
  });

  assert.equal(response.status, 400);
});

test("accepts CORS preflight requests from allowed origins", async () => {
  const response = await request({
    method: "OPTIONS",
    headers: {
      "Access-Control-Request-Headers": "authorization, content-type",
      "Access-Control-Request-Method": "POST",
      Host: "127.0.0.1:42831",
      Origin: "http://127.0.0.1:42832"
    }
  });

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:42832");
  assert.equal(response.headers.get("access-control-allow-methods"), "POST");
  assert.equal(response.headers.get("access-control-allow-headers"), "authorization, content-type");
});

test("allows null origins for packaged desktop renderers", async () => {
  const response = await request({
    headers: {
      Authorization: "Bearer test-token",
      Host: "127.0.0.1:42831",
      Origin: "null"
    }
  });

  assert.equal(response.status, 200);
});
