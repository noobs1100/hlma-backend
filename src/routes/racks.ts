import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { racks, bookCopies, books } from "../db/schema";
import { eq, desc, sql } from "drizzle-orm";
import {
  createRackBody,
  updateRackBody,
  rackIdParam,
  paginationQuery,
  placeBookBody,
  auditScanBody,
} from "../schemas/validators";
import { AppError } from "../services/borrowService";
import {
  placeBookInRack,
  startAudit,
  recordAuditScan,
  getAuditResult,
} from "../services/rackService";

export async function rackRoutes(app: FastifyInstance) {
  /* -------------------------------------------------------
     GET /racks — list racks
  ------------------------------------------------------- */
  app.get("/racks", async (req, reply) => {
    const query = paginationQuery.parse(req.query);
    const offset = (query.page - 1) * query.limit;

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(racks)
        .orderBy(desc(racks.createdAt))
        .limit(query.limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(racks),
    ]);

    const count = countResult[0]!.count;

    return reply.send({
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: count,
        totalPages: Math.ceil(count / query.limit),
      },
    });
  });

  /* -------------------------------------------------------
     POST /racks — create rack
  ------------------------------------------------------- */
  app.post("/racks", async (req, reply) => {
    const body = createRackBody.parse(req.body);
    const [rack] = await db.insert(racks).values(body).returning();
    return reply.status(201).send(rack);
  });

  /* -------------------------------------------------------
     GET /racks/:rackId — get rack details
  ------------------------------------------------------- */
  app.get("/racks/:rackId", async (req, reply) => {
    const { rackId } = rackIdParam.parse(req.params);
    const [rack] = await db.select().from(racks).where(eq(racks.id, rackId));
    if (!rack) throw new AppError(404, "Rack not found");
    return reply.send(rack);
  });

  /* -------------------------------------------------------
     PATCH /racks/:rackId — update rack metadata
  ------------------------------------------------------- */
  app.patch("/racks/:rackId", async (req, reply) => {
    const { rackId } = rackIdParam.parse(req.params);
    const body = updateRackBody.parse(req.body);

    const [rack] = await db
      .update(racks)
      .set(body)
      .where(eq(racks.id, rackId))
      .returning();

    if (!rack) throw new AppError(404, "Rack not found");
    return reply.send(rack);
  });

  /* -------------------------------------------------------
     DELETE /racks/:rackId — delete rack
  ------------------------------------------------------- */
  app.delete("/racks/:rackId", async (req, reply) => {
    const { rackId } = rackIdParam.parse(req.params);

    // Nullify rack references on copies first
    await db
      .update(bookCopies)
      .set({ rackId: null })
      .where(eq(bookCopies.rackId, rackId));

    const [rack] = await db.delete(racks).where(eq(racks.id, rackId)).returning();
    if (!rack) throw new AppError(404, "Rack not found");
    return reply.status(204).send();
  });

  /* -------------------------------------------------------
     GET /racks/:rackId/books — copies expected in rack
  ------------------------------------------------------- */
  app.get("/racks/:rackId/books", async (req, reply) => {
    const { rackId } = rackIdParam.parse(req.params);

    const [rack] = await db.select().from(racks).where(eq(racks.id, rackId));
    if (!rack) throw new AppError(404, "Rack not found");

    const copies = await db
      .select({
        copy: bookCopies,
        book: books,
      })
      .from(bookCopies)
      .innerJoin(books, eq(books.id, bookCopies.bookId))
      .where(eq(bookCopies.rackId, rackId));

    return reply.send(copies);
  });

  /* -------------------------------------------------------
     POST /racks/:rackId/place — place returned book into rack
  ------------------------------------------------------- */
  app.post("/racks/:rackId/place", async (req, reply) => {
    const { rackId } = rackIdParam.parse(req.params);
    const { copyId } = placeBookBody.parse(req.body);
    const result = await placeBookInRack(rackId, copyId);
    return reply.send(result);
  });

  /* -------------------------------------------------------
     POST /racks/:rackId/audit/start — start audit session
  ------------------------------------------------------- */
  app.post("/racks/:rackId/audit/start", async (req, reply) => {
    const { rackId } = rackIdParam.parse(req.params);

    // Verify rack exists
    const [rack] = await db.select().from(racks).where(eq(racks.id, rackId));
    if (!rack) throw new AppError(404, "Rack not found");

    const result = startAudit(rackId);
    return reply.status(201).send(result);
  });

  /* -------------------------------------------------------
     POST /racks/:rackId/audit/scan — record scanned book
  ------------------------------------------------------- */
  app.post("/racks/:rackId/audit/scan", async (req, reply) => {
    const { rackId } = rackIdParam.parse(req.params);
    const { copyId } = auditScanBody.parse(req.body);
    const result = recordAuditScan(rackId, copyId);
    return reply.send(result);
  });

  /* -------------------------------------------------------
     GET /racks/:rackId/audit/result — get audit result
  ------------------------------------------------------- */
  app.get("/racks/:rackId/audit/result", async (req, reply) => {
    const { rackId } = rackIdParam.parse(req.params);
    const result = await getAuditResult(rackId);
    return reply.send(result);
  });
}
