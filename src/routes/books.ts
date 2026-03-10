import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { books, bookCopies } from "../db/schema";
import { eq, ilike, or, sql, desc } from "drizzle-orm";
import {
  createBookBody,
  updateBookBody,
  bookIdParam,
  paginationQuery,
  createCopyBody,
} from "../schemas/validators";
import { AppError } from "../services/borrowService";

export async function bookRoutes(app: FastifyInstance) {
  /* -------------------------------------------------------
     GET /books — list with pagination/search
  ------------------------------------------------------- */
  app.get("/books", async (req, reply) => {
    const query = paginationQuery.parse(req.query);
    const offset = (query.page - 1) * query.limit;

    const conditions = query.search
      ? or(
          ilike(books.title, `%${query.search}%`),
          ilike(books.author, `%${query.search}%`),
          ilike(books.isbn, `%${query.search}%`)
        )
      : undefined;

    const [data, countResult] = await Promise.all([
      db
        .select()
        .from(books)
        .where(conditions)
        .orderBy(desc(books.createdAt))
        .limit(query.limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(books)
        .where(conditions),
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
     POST /books — create new book metadata
  ------------------------------------------------------- */
  app.post("/books", async (req, reply) => {
    const body = createBookBody.parse(req.body);
    const [book] = await db.insert(books).values(body).returning();
    return reply.status(201).send(book);
  });

  /* -------------------------------------------------------
     GET /books/:bookId — get book details
  ------------------------------------------------------- */
  app.get("/books/:bookId", async (req, reply) => {
    const { bookId } = bookIdParam.parse(req.params);
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) throw new AppError(404, "Book not found");
    return reply.send(book);
  });

  /* -------------------------------------------------------
     PATCH /books/:bookId — update book metadata
  ------------------------------------------------------- */
  app.patch("/books/:bookId", async (req, reply) => {
    const { bookId } = bookIdParam.parse(req.params);
    const body = updateBookBody.parse(req.body);

    const [book] = await db
      .update(books)
      .set(body)
      .where(eq(books.id, bookId))
      .returning();

    if (!book) throw new AppError(404, "Book not found");
    return reply.send(book);
  });

  /* -------------------------------------------------------
     DELETE /books/:bookId — delete book metadata
  ------------------------------------------------------- */
  app.delete("/books/:bookId", async (req, reply) => {
    const { bookId } = bookIdParam.parse(req.params);
    const [book] = await db.delete(books).where(eq(books.id, bookId)).returning();
    if (!book) throw new AppError(404, "Book not found");
    return reply.status(204).send();
  });

  /* -------------------------------------------------------
     GET /books/:bookId/copies — list physical copies of a book
  ------------------------------------------------------- */
  app.get("/books/:bookId/copies", async (req, reply) => {
    const { bookId } = bookIdParam.parse(req.params);

    // Verify book exists
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) throw new AppError(404, "Book not found");

    const copies = await db
      .select()
      .from(bookCopies)
      .where(eq(bookCopies.bookId, bookId));

    return reply.send(copies);
  });

  /* -------------------------------------------------------
     POST /books/:bookId/copies — create new physical copy
  ------------------------------------------------------- */
  app.post("/books/:bookId/copies", async (req, reply) => {
    const { bookId } = bookIdParam.parse(req.params);
    const body = createCopyBody.parse(req.body);

    // Verify book exists
    const [book] = await db.select().from(books).where(eq(books.id, bookId));
    if (!book) throw new AppError(404, "Book not found");

    const [copy] = await db
      .insert(bookCopies)
      .values({
        id: body.id,
        bookId,
        rackId: body.rackId,
        state: "available",
      })
      .returning();

    return reply.status(201).send(copy);
  });
}
