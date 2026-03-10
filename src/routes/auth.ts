import type { FastifyInstance } from "fastify";
import { auth } from "../lib/auth";

/**
 * Converts a Fastify request into a Web API Request for better-auth.
 */
function toWebRequest(req: import("fastify").FastifyRequest): Request {
  const url = `${req.protocol}://${req.hostname}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  const body =
    req.method !== "GET" && req.method !== "HEAD"
      ? JSON.stringify(req.body)
      : undefined;
  return new Request(url, { method: req.method, headers, body });
}

export async function authRoutes(app: FastifyInstance) {
  app.all("/api/auth/*", async (req, reply) => {
    const webRequest = toWebRequest(req);
    const response = await auth.handler(webRequest);

    reply.status(response.status);
    response.headers.forEach((value, key) => reply.header(key, value));

    const text = await response.text();
    return reply.send(text);
  });
}