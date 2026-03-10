import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { borrows, bookCopies, books, user } from "../db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { borrowIdParam, userIdParam, paginationQuery } from "../schemas/validators";
import { AppError } from "../services/borrowService";

export async function borrowRoutes(app: FastifyInstance) {
  /* -------------------------------------------------------
     GET /users/:userId/borrows — currently borrowed by user
  ------------------------------------------------------- */
  app.get("/users/:userId/borrows", async (req, reply) => {
    const { userId } = userIdParam.parse(req.params);

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
     GET /users/:userId/history — full borrow history of user
  ------------------------------------------------------- */
  app.get("/users/:userId/history", async (req, reply) => {
    const { userId } = userIdParam.parse(req.params);
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
     GET /borrows/:borrowId — get a specific borrow record
  ------------------------------------------------------- */
  app.get("/borrows/:borrowId", async (req, reply) => {
    const { borrowId } = borrowIdParam.parse(req.params);

    const result = await db
      .select({
        borrow: borrows,
        copy: bookCopies,
        book: books,
        userName: user.name,
        userEmail: user.email,
      })
      .from(borrows)
      .innerJoin(bookCopies, eq(bookCopies.id, borrows.copyId))
      .innerJoin(books, eq(books.id, bookCopies.bookId))
      .innerJoin(user, eq(user.id, borrows.userId))
      .where(eq(borrows.id, borrowId));

    if (!result.length) throw new AppError(404, "Borrow record not found");
    return reply.send(result[0]);
  });
}
