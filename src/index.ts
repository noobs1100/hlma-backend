import Fastify from "fastify";
import cors from "@fastify/cors";
import { authRoutes } from "./routes/auth";
import { auth } from "./lib/auth"; // Adjust the path based on your project structure

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: ["http://localhost:8081"], // Expo dev
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
});

await app.register(authRoutes);

// Protected route example — verify session via better-auth
app.get("/me", async (req, reply) => {
  const session = await auth.api.getSession({
    headers: req.headers as any,
  });

  if (!session) return reply.status(401).send({ error: "Unauthorized" });
  return reply.send({ user: session.user });
});

app.listen({ port: 3000, host: "0.0.0.0" }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  console.log("🚀 Server running at http://localhost:3000");
});