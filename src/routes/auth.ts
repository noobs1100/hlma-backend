import type { FastifyInstance } from "fastify";
import { auth } from "../lib/auth";

export async function authRoutes(app: FastifyInstance) {
  app.all("/api/auth/*", async (req, reply) => {
    // Convert Fastify request to a Web API Request that better-auth expects
    const url = `http://${req.hostname}:3000${req.url}`;

    const headers = new Headers();
    Object.entries(req.headers).forEach(([key, value]) => {
      if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    });

    const body = req.method !== "GET" && req.method !== "HEAD"
      ? JSON.stringify(req.body)
      : undefined;

    const webRequest = new Request(url, {
      method: req.method,
      headers,
      body,
    });

    const response = await auth.handler(webRequest);

    reply.status(response.status);
    response.headers.forEach((value, key) => reply.header(key, value));

    const text = await response.text();
    return reply.send(text);
  });
}