import type { User, Session } from "./lib/auth";

declare module "fastify" {
  interface FastifyRequest {
    user: User;
    session: Session;
  }
}
