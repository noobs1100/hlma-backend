import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { borrows, bookCopies, books } from "../db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { copyIdParam, paginationQuery } from "../schemas/validators";
import { borrowCopy, returnCopy } from "../services/borrowService";

export async function meRoutes(app: FastifyInstance) {
  /* -------------------------------------------------------
     GET /me/borrows — books currently borrowed by logged-in user
  ------------------------------------------------------- */
  app.get("/me/borrows", async (req, reply) => {
    const userId = req.user.id;

    const active = await db
      .select({
        borrow: borrows,
        copy: bookCopies,
        book: books,
      })
      .from(borrows)
      .innerJoin(bookCopies, eq(bookCopies.id, borrows.copyId))
      .innerJoin(books, eq(books.id, bookCopies.bookId))
      .where(and(eq(borrows.userId, userId), isNull(borrows.returnedAt)))
      .orderBy(desc(borrows.borrowedAt));

    return reply.send(active);
  });

  /* -------------------------------------------------------
     GET /me/history — borrow history for logged-in user
  ------------------------------------------------------- */
  app.get("/me/history", async (req, reply) => {
    const userId = req.user.id;
    const query = paginationQuery.parse(req.query);
    const offset = (query.page - 1) * query.limit;

    const history = await db
      .select({
        borrow: borrows,
        copy: bookCopies,
        book: books,
      })
      .from(borrows)
      .innerJoin(bookCopies, eq(bookCopies.id, borrows.copyId))
      .innerJoin(books, eq(books.id, bookCopies.bookId))
      .where(eq(borrows.userId, userId))
      .orderBy(desc(borrows.borrowedAt))
      .limit(query.limit)
      .offset(offset);

    return reply.send(history);
  });

  /* -------------------------------------------------------
     POST /me/borrow/:copyId — borrow book for current user
  ------------------------------------------------------- */
  app.post("/me/borrow/:copyId", async (req, reply) => {
    const { copyId } = copyIdParam.parse(req.params);
    const borrow = await borrowCopy(copyId, req.user.id);
    return reply.status(201).send(borrow);
  });

  /* -------------------------------------------------------
     POST /me/return/:copyId — return book for current user
  ------------------------------------------------------- */
  app.post("/me/return/:copyId", async (req, reply) => {
    const { copyId } = copyIdParam.parse(req.params);
    const borrow = await returnCopy(copyId);
    return reply.send(borrow);
  });
}
