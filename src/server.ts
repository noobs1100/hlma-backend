import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";

import { auth } from "./lib/auth";
import { authRoutes } from "./routes/auth";
import { publicRoutes } from "./routes/public";
import { bookRoutes } from "./routes/books";
import { copyRoutes } from "./routes/copies";
import { borrowRoutes } from "./routes/borrows";
import { rackRoutes } from "./routes/racks";
import { scanRoutes } from "./routes/scan";
import { statsRoutes } from "./routes/stats";
import { meRoutes } from "./routes/me";
import { qrRoutes } from "./routes/qr";
import { AppError } from "./services/borrowService";

// Augment Fastify request
import "./types";

export async function buildServer() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  /* -------------------------------------------------------
     CORS
  ------------------------------------------------------- */
  await app.register(cors, {
    origin: (process.env.CORS_ORIGIN ?? "http://localhost:8081").split(","),
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  /* -------------------------------------------------------
     Global error handler — MUST be set BEFORE routes so
     encapsulated plugins inherit it
  ------------------------------------------------------- */
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    // Zod validation errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "Validation Error",
        details: error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      });
    }

    // Application errors
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.message,
      });
    }

    // Fastify errors (e.g. 404, content type parsing)
    if (error.statusCode) {
      return reply.status(error.statusCode).send({
        error: error.message,
      });
    }

    // Unknown errors
    app.log.error(error);
    return reply.status(500).send({
      error: "Internal Server Error",
    });
  });

  /* -------------------------------------------------------
     Auth routes (public — registered BEFORE the auth hook)
  ------------------------------------------------------- */
  await app.register(authRoutes);

  /* -------------------------------------------------------
     Public routes (no auth required — for QR code scanning)
  ------------------------------------------------------- */
  await app.register(publicRoutes);

  /* -------------------------------------------------------
     Authentication middleware — all routes after this require auth
  ------------------------------------------------------- */
  app.addHook("onRequest", async (req, reply) => {
    // Skip auth endpoints
    if (req.url.startsWith("/api/auth")) return;

    const session = await auth.api.getSession({
      headers: req.headers as any,
    });

    if (!session) {
      throw new AppError(401, "Unauthorized");
    }

    req.user = session.user;
    req.session = session.session;
  });

  /* -------------------------------------------------------
     Protected routes
  ------------------------------------------------------- */
  await app.register(bookRoutes);
  await app.register(copyRoutes);
  await app.register(borrowRoutes);
  await app.register(rackRoutes);
  await app.register(scanRoutes);
  await app.register(statsRoutes);
  await app.register(meRoutes);
  await app.register(qrRoutes);

  return app;
}
