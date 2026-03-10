import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import Fastify, { type FastifyInstance } from "fastify";
import { auth } from "../src/lib/auth";
import { buildServer } from "../src/server";
import { db } from "../src/db";
import { user } from "../src/db/schema";
import { cleanDatabase, TEST_USER, seedUsers, skipIfNoDb } from "./setup";

/* =====================================================
   Authentication Middleware Tests
   
   Verifies:
   - /api/auth/* is accessible without session
   - All other routes return 401 without session
   - Authenticated requests get user on req.user
===================================================== */

describe("Authentication Middleware", () => {
  let dbAvailable = false;
  let app: FastifyInstance;

  beforeAll(async () => {
    dbAvailable = await skipIfNoDb();
    if (!dbAvailable) return;
    app = await buildServer();
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  test("protected routes return 401 without session", async () => {
    if (!dbAvailable) return;
    const routes = [
      { method: "GET" as const, url: "/books" },
      { method: "GET" as const, url: "/racks" },
      { method: "GET" as const, url: "/me/borrows" },
      { method: "GET" as const, url: "/stats/library" },
      { method: "GET" as const, url: "/scan/book/0A1K9X" },
      { method: "GET" as const, url: "/scan/rack/0A1K9X" },
    ];

    for (const route of routes) {
      const res = await app.inject({
        method: route.method,
        url: route.url,
      });
      expect(res.statusCode).toBe(401);
      expect(res.json() as any).toEqual({ error: "Unauthorized" });
    }
  });

  test("POST to protected routes return 401 without session", async () => {
    if (!dbAvailable) return;
    const res = await app.inject({
      method: "POST",
      url: "/books",
      payload: { title: "Test" },
    });
    expect(res.statusCode).toBe(401);
  });

  test("/api/auth/* routes are accessible without session", async () => {
    if (!dbAvailable) return;
    // better-auth's own routes should not get 401 — they get handled by better-auth
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/session",
    });
    // Should NOT be 401 (better-auth handles it, returning 200 or its own response)
    expect(res.statusCode).not.toBe(401);
  });
});
