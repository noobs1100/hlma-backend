# Library Book Tracking API

A Fastify-based REST API for managing a library's book inventory, borrowing system, and QR code scanning.

## Features

- **Book Management** - Create, read, update, delete books and physical copies
- **Borrowing System** - Borrow, return, and transfer books between users
- **Rack Management** - Organize books by physical location (room, cupboard, rack)
- **QR Code System** - Generate printable QR labels for books and racks, reprint damaged labels
- **QR Scanning** - Quick lookup endpoints for scanning book/rack QR codes
- **Statistics** - Library overview, popular books, overdue tracking
- **User Authentication** - Session-based auth via [better-auth](https://www.better-auth.com/)
- **Audit System** - Track rack inventory with scan-based auditing

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Framework**: [Fastify](https://fastify.dev)
- **Database**: PostgreSQL with [Drizzle ORM](https://orm.drizzle.team)
- **Auth**: [better-auth](https://www.better-auth.com/)
- **Validation**: [Zod](https://zod.dev)
- **PDF Generation**: [PDFKit](https://pdfkit.org/)
- **QR Codes**: [qrcode](https://www.npmjs.com/package/qrcode)

## Prerequisites

- Bun runtime
- PostgreSQL database

## Setup

1. **Install dependencies**
   ```bash
   bun install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   
   Required environment variables:
   ```env
   DATABASE_URL=postgres://user:pass@localhost:5432/library
   BETTER_AUTH_SECRET=your-secret-key
   CORS_ORIGIN=http://localhost:8081
   ```

3. **Database setup**
   ```bash
   # Generate migration files
   bun run db:generate
   
   # Run migrations
   bun run db:migrate
   
   # Or push schema directly (development)
   bun run db:push
   ```

4. **Run the server**
   ```bash
   # Development (with hot reload)
   bun run dev
   
   # Production
   bun run start
   ```

The server runs on `http://localhost:3000` by default.

## Project Structure

```
src/
├── db/
│   ├── index.ts      # Database connection
│   └── schema definitions
├── lib/
│   └── auth.ts       # better-auth configuration
├── routes/
│.ts     # Table   ├── auth.ts       # Authentication endpoints
│   ├── books.ts      # Book CRUD
│   ├── borrows.ts    # Borrow records
│   ├── copies.ts     # Book copy management
│   ├── me.ts         # Current user endpoints
│   ├── public.ts     # Public (no-auth) endpoints
│   ├── qr.ts         # QR code generation
│   ├── racks.ts      # Rack management
│   ├── scan.ts       # QR scan endpoints
│   └── stats.ts      # Statistics
├── schemas/
│   └── validators.ts # Zod validation schemas
├── services/
│   ├── borrowService.ts  # Borrow logic
│   ├── qrService.ts      # QR generation
│   └── rackService.ts    # Rack operations
├── index.ts          # Entry point
├── server.ts         # Fastify setup
└── types.ts          # TypeScript types
```

## API Documentation

See [API.md](./API.md) for complete endpoint documentation.

### Quick Overview

| Category | Endpoints |
|----------|-----------|
| Auth | `/api/auth/*` (sign-up, sign-in, sign-out, session) |
| Books | `/books` - CRUD operations |
| Copies | `/copies/*` - Physical copy management |
| Borrows | `/users/:userId/borrows`, `/borrows/:id` |
| Racks | `/racks` - Location management + audit |
| Scan | `/scan/book/:copyId`, `/scan/rack/:rackId` |
| QR | `/qr/:type/batch`, `/qr/:type/reprint` |
| Stats | `/stats/library`, `/stats/books/popular` |

### ID Formats

| Entity | Format | Example |
|--------|--------|---------|
| Book | UUID v4 | `550e8400-e29b-41d4-a716-446655440000` |
| Copy | 6-char Base32 | `0A1K9X` |
| Rack | 6-char Base32 | `9F3T8M` |
| User | Text (better-auth) | `abc123` |

Base32 uses Crockford encoding: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (excludes I, L, O, U)

## Scripts

| Command | Description |
|---------|-------------|
| `bun run dev` | Start development server |
| `bun run start` | Start production server |
| `bun run db:generate` | Generate Drizzle migrations |
| `bun run db:migrate` | Run migrations |
| `bun run db:push` | Push schema to database |
| `bun run db:studio` | Open Drizzle Studio |

## License

MIT
