import type { FastifyInstance } from "fastify";
import { db } from "../db";
import { books, bookCopies, borrows, racks, user } from "../db/schema";
import { eq, sql, isNull, desc, and, count as drizzleCount } from "drizzle-orm";

export async function statsRoutes(app: FastifyInstance) {
  /* -------------------------------------------------------
     GET /stats/library — overall library statistics
  ------------------------------------------------------- */
  app.get("/stats/library", async (_req, reply) => {
    const [[bookCount], [copyCount], [rackCount], [activeBorrowCount], [userCount]] =
      await Promise.all([
        db.select({ count: sql<number>`count(*)::int` }).from(books),
        db.select({ count: sql<number>`count(*)::int` }).from(bookCopies),
        db.select({ count: sql<number>`count(*)::int` }).from(racks),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(borrows)
          .where(isNull(borrows.returnedAt)),
        db.select({ count: sql<number>`count(*)::int` }).from(user),
      ]);

    const [stateBreakdown] = await Promise.all([
      db
        .select({
          state: bookCopies.state,
          count: sql<number>`count(*)::int`,
        })
        .from(bookCopies)
        .groupBy(bookCopies.state),
    ]);

    return reply.send({
      totalBooks: bookCount!.count,
      totalCopies: copyCount!.count,
      totalRacks: rackCount!.count,
      activeBorrows: activeBorrowCount!.count,
      totalUsers: userCount!.count,
      copyStateBreakdown: stateBreakdown,
    });
  });

  /* -------------------------------------------------------
     GET /stats/books/popular — most borrowed books
  ------------------------------------------------------- */
  app.get("/stats/books/popular", async (req, reply) => {
    const limit = Number((req.query as any)?.limit) || 10;

    const popular = await db
      .select({
        bookId: books.id,
        title: books.title,
        author: books.author,
        borrowCount: sql<number>`count(${borrows.id})::int`,
      })
      .from(borrows)
      .innerJoin(bookCopies, eq(bookCopies.id, borrows.copyId))
      .innerJoin(books, eq(books.id, bookCopies.bookId))
      .groupBy(books.id, books.title, books.author)
      .orderBy(desc(sql`count(${borrows.id})`))
      .limit(limit);

    return reply.send(popular);
  });

  /* -------------------------------------------------------
     GET /stats/books/never-borrowed — books never borrowed
  ------------------------------------------------------- */
  app.get("/stats/books/never-borrowed", async (_req, reply) => {
    const result = await db
      .select({
        bookId: books.id,
        title: books.title,
        author: books.author,
        isbn: books.isbn,
      })
      .from(books)
      .leftJoin(bookCopies, eq(bookCopies.bookId, books.id))
      .leftJoin(borrows, eq(borrows.copyId, bookCopies.id))
      .groupBy(books.id, books.title, books.author, books.isbn)
      .having(sql`count(${borrows.id}) = 0`);

    return reply.send(result);
  });

  /* -------------------------------------------------------
     GET /stats/overdue — overdue borrowed books
     (considers books borrowed > 14 days as overdue)
  ------------------------------------------------------- */
  app.get("/stats/overdue", async (_req, reply) => {
    const overdueDays = 14;

    const overdue = await db
      .select({
        borrowId: borrows.id,
        borrowedAt: borrows.borrowedAt,
        copyId: bookCopies.id,
        bookTitle: books.title,
        bookAuthor: books.author,
        userName: user.name,
        userEmail: user.email,
        userId: user.id,
        daysOverdue: sql<number>`EXTRACT(DAY FROM NOW() - ${borrows.borrowedAt})::int - ${overdueDays}`,
      })
      .from(borrows)
      .innerJoin(bookCopies, eq(bookCopies.id, borrows.copyId))
      .innerJoin(books, eq(books.id, bookCopies.bookId))
      .innerJoin(user, eq(user.id, borrows.userId))
      .where(
        and(
          isNull(borrows.returnedAt),
          sql`${borrows.borrowedAt} < NOW() - INTERVAL '${sql.raw(String(overdueDays))} days'`
        )
      )
      .orderBy(borrows.borrowedAt);

    return reply.send(overdue);
  });

  /* -------------------------------------------------------
     POST /jobs/send-reminders — trigger overdue reminders
  ------------------------------------------------------- */
  app.post("/jobs/send-reminders", async (_req, reply) => {
    const overdueDays = 14;

    const overdue = await db
      .select({
        borrowId: borrows.id,
        copyId: borrows.copyId,
        userId: borrows.userId,
        borrowedAt: borrows.borrowedAt,
        userName: user.name,
        userEmail: user.email,
        bookTitle: books.title,
      })
      .from(borrows)
      .innerJoin(bookCopies, eq(bookCopies.id, borrows.copyId))
      .innerJoin(books, eq(books.id, bookCopies.bookId))
      .innerJoin(user, eq(user.id, borrows.userId))
      .where(
        and(
          isNull(borrows.returnedAt),
          sql`${borrows.borrowedAt} < NOW() - INTERVAL '${sql.raw(String(overdueDays))} days'`
        )
      );

    // In production, this would send actual emails/notifications.
    // For now, return the list of users who would be notified.
    return reply.send({
      message: `Found ${overdue.length} overdue borrow(s)`,
      reminders: overdue.map((r) => ({
        userId: r.userId,
        userName: r.userName,
        userEmail: r.userEmail,
        bookTitle: r.bookTitle,
        copyId: r.copyId,
        borrowedAt: r.borrowedAt,
      })),
    });
  });
}
