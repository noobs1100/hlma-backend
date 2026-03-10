# Library Book Tracking API

Base URL: `http://localhost:3000`

## Public Endpoints (No Authentication Required)

These endpoints are designed for public QR code scanning - anyone can check a book's status.

### Public Book Status (QR Code Scan)
```http
GET /public/book/:copyId
```

**Response:**
```json
{
  "copyId": "9F3T8M",
  "book": {
    "title": "Clean Architecture",
    "author": "Robert C. Martin",
    "isbn": "978-0134494166",
    "description": "A guide to software architecture",
    "publishedYear": 2017
  },
  "status": {
    "state": "available",
    "message": "Available for borrowing",
    "isAvailable": true,
    "borrowedAt": null
  },
  "location": "Main Library → Section A → Rack R1"
}
```

**Status States:**
| State | Message | isAvailable |
|-------|---------|-------------|
| `available` | "Available for borrowing" | `true` |
| `borrowed` | "Currently borrowed" | `false` |
| `returned_pending` | "Being returned - check back soon" | `false` |
| `lost` | "Marked as lost" | `false` |

> **Privacy:** When a book is borrowed, only `borrowedAt` is shown - no user information is exposed.

### Public Health Check
```http
GET /public/health
```

---

## Protected Endpoints (Authentication Required)

All endpoints below require authentication via session cookie.

---

## Authentication

### Sign Up
```http
POST /api/auth/sign-up/email
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "securepassword"
}
```

### Sign In
```http
POST /api/auth/sign-in/email
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "securepassword"
}
```

### Sign Out
```http
POST /api/auth/sign-out
```

### Get Current Session
```http
GET /api/auth/session
```

**Response:**
```json
{
  "user": {
    "id": "abc123",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "session": {
    "id": "session-id",
    "expiresAt": "2026-03-17T00:00:00.000Z"
  }
}
```

---

## Books

### List Books
```http
GET /books?page=1&limit=20&search=javascript
```

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max 100) |
| `search` | string | - | Search by title, author, or ISBN |

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "title": "Clean Code",
      "author": "Robert C. Martin",
      "isbn": "978-0132350884",
      "publishedYear": 2008,
      "description": "A handbook of agile software craftsmanship",
      "createdAt": "2026-03-10T00:00:00.000Z",
      "updatedAt": "2026-03-10T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### Create Book
```http
POST /books
Content-Type: application/json

{
  "title": "Clean Code",
  "author": "Robert C. Martin",
  "isbn": "978-0132350884",
  "publishedYear": 2008,
  "description": "A handbook of agile software craftsmanship"
}
```

**Required:** `title`  
**Optional:** `author`, `isbn`, `publishedYear`, `description`

**Response:** `201 Created` with book object

### Get Book
```http
GET /books/:bookId
```

**Response:** Book object

### Update Book
```http
PATCH /books/:bookId
Content-Type: application/json

{
  "title": "Updated Title",
  "author": "Updated Author"
}
```

**Response:** Updated book object

### Delete Book
```http
DELETE /books/:bookId
```

**Response:** `204 No Content`

---

## Book Copies

Each physical book copy has a unique 6-character Base32 ID (e.g., `0A1K9X`).

### Register Copy (Lazy Registration)
```http
POST /copies/register
Content-Type: application/json

{
  "id": "0A1K9X",
  "bookId": "uuid",
  "rackId": "9F3T8M"
}
```

Used for QR labels printed before database entry. The ID comes from pre-printed QR code.

**Required:** `id`, `bookId`  
**Optional:** `rackId`

**Response:** `201 Created` with copy object

### List Copies of a Book
```http
GET /books/:bookId/copies
```

**Response:**
```json
[
  {
    "id": "0A1K9X",
    "bookId": "uuid",
    "rackId": "9F3T8M",
    "state": "available",
    "borrowedBy": null,
    "createdAt": "2026-03-10T00:00:00.000Z"
  }
]
```

### Create Copy
```http
POST /books/:bookId/copies
Content-Type: application/json

{
  "id": "0A1K9X",
  "rackId": "9F3T8M"
}
```

**Required:** `id` (6-char uppercase Base32: `0-9, A-H, J-K, M-N, P-T, V-Z`)  
**Optional:** `rackId`

**Response:** `201 Created` with copy object

### Get Copy
```http
GET /copies/:copyId
```

**Response:**
```json
{
  "id": "0A1K9X",
  "bookId": "uuid",
  "rackId": "9F3T8M",
  "state": "available",
  "borrowedBy": null,
  "book": {
    "id": "uuid",
    "title": "Clean Code",
    "author": "Robert C. Martin"
  }
}
```

### Update Copy
```http
PATCH /copies/:copyId
Content-Type: application/json

{
  "rackId": "9F3T8M"
}
```

**Response:** Updated copy object

### Update Copy State
```http
PATCH /copies/:copyId/state
Content-Type: application/json

{
  "state": "lost"
}
```

**Valid states:** `available`, `borrowed`, `lost`, `returned_pending`

**Response:** Updated copy object

### Delete Copy
```http
DELETE /copies/:copyId
```

**Note:** Cannot delete a currently borrowed copy.

**Response:** `204 No Content`

### Get Copy Borrow History
```http
GET /copies/:copyId/history?page=1&limit=20
```

**Response:**
```json
[
  {
    "borrow": {
      "id": "uuid",
      "copyId": "0A1K9X",
      "userId": "user-id",
      "borrowedAt": "2026-03-01T00:00:00.000Z",
      "returnedAt": "2026-03-10T00:00:00.000Z"
    },
    "userName": "John Doe",
    "userEmail": "john@example.com"
  }
]
```

---

## Borrow / Return / Transfer

### Borrow a Copy
```http
POST /copies/:copyId/borrow
Content-Type: application/json

{
  "userId": "user-id"
}
```

**Optional:** `userId` (defaults to current user)

**Response:** `201 Created`
```json
{
  "id": "borrow-uuid",
  "copyId": "0A1K9X",
  "userId": "user-id",
  "borrowedAt": "2026-03-10T00:00:00.000Z",
  "returnedAt": null
}
```

### Return a Copy
```http
POST /copies/:copyId/return
```

**Response:**
```json
{
  "id": "borrow-uuid",
  "copyId": "0A1K9X",
  "userId": "user-id",
  "borrowedAt": "2026-03-01T00:00:00.000Z",
  "returnedAt": "2026-03-10T00:00:00.000Z"
}
```

**Note:** Sets copy state to `returned_pending` until placed on a rack.

### Transfer a Copy
```http
POST /copies/:copyId/transfer
Content-Type: application/json

{
  "toUserId": "new-user-id"
}
```

**Response:** `201 Created` with new borrow record

---

## Borrow Records

### Get User's Active Borrows
```http
GET /users/:userId/borrows
```

**Response:**
```json
[
  {
    "id": "borrow-uuid",
    "copyId": "0A1K9X",
    "userId": "user-id",
    "borrowedAt": "2026-03-01T00:00:00.000Z",
    "returnedAt": null
  }
]
```

### Get User's Borrow History
```http
GET /users/:userId/history?page=1&limit=20
```

**Response:** Array of borrow records (including returned)

### Get Borrow Details
```http
GET /borrows/:borrowId
```

**Response:**
```json
{
  "borrow": {
    "id": "uuid",
    "copyId": "0A1K9X",
    "userId": "user-id",
    "borrowedAt": "2026-03-01T00:00:00.000Z",
    "returnedAt": null
  },
  "book": {
    "id": "uuid",
    "title": "Clean Code",
    "author": "Robert C. Martin"
  },
  "copy": { ... },
  "userName": "John Doe",
  "userEmail": "john@example.com"
}
```

---

## Current User (Me)

Convenience endpoints for the authenticated user.

### My Active Borrows
```http
GET /me/borrows
```

**Response:**
```json
[
  {
    "borrow": { ... },
    "copy": { ... },
    "book": { ... }
  }
]
```

### My Borrow History
```http
GET /me/history?page=1&limit=20
```

### Borrow for Myself
```http
POST /me/borrow/:copyId
```

### Return (for Myself)
```http
POST /me/return/:copyId
```

---

## Racks

Physical rack locations use 6-character Base32 IDs.

### List Racks
```http
GET /racks?page=1&limit=20
```

**Response:**
```json
{
  "data": [
    {
      "id": "9F3T8M",
      "room": "Room A",
      "cupboard": "Cupboard 1",
      "rackNumber": "R01",
      "description": "Fiction section",
      "createdAt": "2026-03-10T00:00:00.000Z"
    }
  ],
  "pagination": { ... }
}
```

### Create Rack
```http
POST /racks
Content-Type: application/json

{
  "id": "9F3T8M",
  "room": "Room A",
  "cupboard": "Cupboard 1",
  "rackNumber": "R01",
  "description": "Fiction section"
}
```

**Required:** `id`, `room`  
**Optional:** `cupboard`, `rackNumber`, `description`

**Response:** `201 Created` with rack object

### Get Rack
```http
GET /racks/:rackId
```

### Update Rack
```http
PATCH /racks/:rackId
Content-Type: application/json

{
  "room": "Room B",
  "description": "Updated description"
}
```

### Delete Rack
```http
DELETE /racks/:rackId
```

**Note:** Copies in this rack will have their `rackId` set to `null`.

### List Books in Rack
```http
GET /racks/:rackId/books
```

**Response:**
```json
[
  {
    "id": "0A1K9X",
    "state": "available",
    "book": {
      "id": "uuid",
      "title": "Clean Code",
      "author": "Robert C. Martin"
    }
  }
]
```

### Place Book in Rack
```http
POST /racks/:rackId/place
Content-Type: application/json

{
  "copyId": "0A1K9X"
}
```

**Note:** If copy state is `returned_pending`, it becomes `available`.

**Response:** Updated copy object

---

## Rack Audit

Audit a rack to find missing or misplaced books.

### Start Audit
```http
POST /racks/:rackId/audit/start
```

**Response:** `201 Created`
```json
{
  "message": "Audit started for rack 9F3T8M",
  "expectedCopies": 15
}
```

### Scan Book During Audit
```http
POST /racks/:rackId/audit/scan
Content-Type: application/json

{
  "copyId": "0A1K9X"
}
```

**Response:**
```json
{
  "scannedCount": 5,
  "copyId": "0A1K9X"
}
```

### Get Audit Result
```http
GET /racks/:rackId/audit/result
```

**Response:**
```json
{
  "rackId": "9F3T8M",
  "expected": 15,
  "scanned": 14,
  "found": 13,
  "missing": [
    {
      "copyId": "ABCD12",
      "bookTitle": "Missing Book"
    }
  ],
  "misplaced": ["XYZ789"]
}
```

---

## QR Code Generation

Generate printable QR code labels for books and racks.

### Generate Batch Labels
```http
POST /qr/:type/batch
Content-Type: application/json

{
  "count": 100
}
```

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `type` | string | `book` or `rack` |

**Response:** PDF binary with QR code labels

**Headers:**
- `X-Batch-Id`: Unique batch identifier
- `X-Labels-Count`: Total labels generated
- `X-Labels-Per-Page`: Labels per page
- `X-Pages-Count`: Total pages

### Get Label Layout Info
```http
GET /qr/:type/info?count=140
```

Get metadata about label layout for UI preview.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `count` | number | 140 | Number of labels |

**Response:**
```json
{
  "type": "book",
  "count": 140,
  "totalLabels": 140,
  "labelsPerPage": 20,
  "totalPages": 7
}
```

### Reprint Labels
```http
POST /qr/:type/reprint
Content-Type: application/json

{
  "ids": ["0A1K9X", "ABC123", "XYZ789"]
}
```

Reprint labels for known IDs (e.g., label got lost or damaged).

**Response:** PDF binary with reprinted labels

---

## QR Scan Endpoints

Quick lookup endpoints for scanning QR codes.

### Scan Book Copy QR
```http
GET /scan/book/:copyId
```

**Response:**
```json
{
  "copyId": "0A1K9X",
  "state": "available",
  "book": {
    "id": "uuid",
    "title": "Clean Code",
    "author": "Robert C. Martin",
    "isbn": "978-0132350884"
  },
  "rack": {
    "id": "9F3T8M",
    "room": "Room A",
    "cupboard": "Cupboard 1",
    "rackNumber": "R01"
  },
  "borrower": null
}
```

If borrowed:
```json
{
  "copyId": "0A1K9X",
  "state": "borrowed",
  "book": { ... },
  "rack": null,
  "borrower": {
    "userName": "John Doe",
    "userEmail": "john@example.com",
    "borrowedAt": "2026-03-01T00:00:00.000Z"
  }
}
```

### Scan Rack QR
```http
GET /scan/rack/:rackId
```

**Response:**
```json
{
  "rack": {
    "id": "9F3T8M",
    "room": "Room A",
    "cupboard": "Cupboard 1",
    "rackNumber": "R01"
  },
  "totalCopies": 15,
  "books": [
    {
      "copyId": "0A1K9X",
      "bookTitle": "Clean Code",
      "state": "available"
    }
  ]
}
```

---

## Statistics

### Library Overview
```http
GET /stats/library
```

**Response:**
```json
{
  "totalBooks": 500,
  "totalCopies": 1200,
  "totalRacks": 25,
  "activeBorrows": 150,
  "totalUsers": 300,
  "copyStateBreakdown": [
    { "state": "available", "count": 900 },
    { "state": "borrowed", "count": 150 },
    { "state": "lost", "count": 50 },
    { "state": "returned_pending", "count": 100 }
  ]
}
```

### Popular Books
```http
GET /stats/books/popular?limit=10
```

**Response:**
```json
[
  {
    "id": "uuid",
    "title": "Clean Code",
    "author": "Robert C. Martin",
    "borrowCount": 45
  }
]
```

### Never Borrowed Books
```http
GET /stats/books/never-borrowed?limit=20
```

**Response:** Array of book objects

### Overdue Borrows
```http
GET /stats/overdue
```

**Response:**
```json
[
  {
    "borrowId": "uuid",
    "copyId": "0A1K9X",
    "bookTitle": "Clean Code",
    "userName": "John Doe",
    "userEmail": "john@example.com",
    "borrowedAt": "2026-02-01T00:00:00.000Z",
    "daysOverdue": 23
  }
]
```

### Send Overdue Reminders (Job)
```http
POST /jobs/send-reminders
```

**Response:**
```json
{
  "reminders": [
    {
      "userId": "user-id",
      "userEmail": "john@example.com",
      "bookTitle": "Clean Code",
      "daysOverdue": 23
    }
  ]
}
```

---

## Error Responses

All errors return JSON:

```json
{
  "error": "Error message here"
}
```

### Validation Errors (400)
```json
{
  "error": "Validation Error",
  "details": [
    { "path": "title", "message": "Required" },
    { "path": "publishedYear", "message": "Number must be greater than 0" }
  ]
}
```

### Common Status Codes

| Code | Description |
|------|-------------|
| `200` | Success |
| `201` | Created |
| `204` | No Content (successful delete) |
| `400` | Bad Request / Validation Error |
| `401` | Unauthorized (not logged in) |
| `404` | Not Found |
| `409` | Conflict (e.g., copy already borrowed) |
| `500` | Internal Server Error |

---

## ID Formats

| Entity | Format | Example |
|--------|--------|---------|
| Book | UUID v4 | `550e8400-e29b-41d4-a716-446655440000` |
| Copy | 6-char Base32 | `0A1K9X` |
| Rack | 6-char Base32 | `9F3T8M` |
| User | Text (from better-auth) | `abc123` |
| Borrow | UUID v4 | `550e8400-e29b-41d4-a716-446655440000` |

**Base32 Alphabet (Crockford):** `0123456789ABCDEFGHJKMNPQRSTVWXYZ`  
(excludes I, L, O, U to avoid confusion)

---

## Quick Reference

### Public Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/public/book/:copyId` | Public book status |
| GET | `/public/health` | Health check |

### Books & Copies
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/books` | List books |
| POST | `/books` | Create book |
| GET | `/books/:bookId` | Get book |
| PATCH | `/books/:bookId` | Update book |
| DELETE | `/books/:bookId` | Delete book |
| GET | `/books/:bookId/copies` | List copies |
| POST | `/books/:bookId/copies` | Create copy |
| POST | `/copies/register` | Register copy (lazy) |
| GET | `/copies/:copyId` | Get copy |
| PATCH | `/copies/:copyId` | Update copy |
| DELETE | `/copies/:copyId` | Delete copy |
| PATCH | `/copies/:copyId/state` | Update state |
| GET | `/copies/:copyId/history` | Borrow history |

### Borrow Actions
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/copies/:copyId/borrow` | Borrow copy |
| POST | `/copies/:copyId/return` | Return copy |
| POST | `/copies/:copyId/transfer` | Transfer to user |
| GET | `/users/:userId/borrows` | User's active borrows |
| GET | `/users/:userId/history` | User's borrow history |
| GET | `/borrows/:borrowId` | Borrow details |

### Current User
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/me/borrows` | My active borrows |
| GET | `/me/history` | My borrow history |
| POST | `/me/borrow/:copyId` | Borrow for myself |
| POST | `/me/return/:copyId` | Return my borrow |

### Racks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/racks` | List racks |
| POST | `/racks` | Create rack |
| GET | `/racks/:rackId` | Get rack |
| PATCH | `/racks/:rackId` | Update rack |
| DELETE | `/racks/:rackId` | Delete rack |
| GET | `/racks/:rackId/books` | Books in rack |
| POST | `/racks/:rackId/place` | Place book |
| POST | `/racks/:rackId/audit/start` | Start audit |
| POST | `/racks/:rackId/audit/scan` | Scan during audit |
| GET | `/racks/:rackId/audit/result` | Audit result |

### QR Scan
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/scan/book/:copyId` | Scan book QR |
| GET | `/scan/rack/:rackId` | Scan rack QR |

### QR Code Generation
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/qr/:type/batch` | Generate batch labels |
| GET | `/qr/:type/info` | Get label layout info |
| POST | `/qr/:type/reprint` | Reprint labels |

### Statistics
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/stats/library` | Library overview |
| GET | `/stats/books/popular` | Popular books |
| GET | `/stats/books/never-borrowed` | Never borrowed |
| GET | `/stats/overdue` | Overdue borrows |
| POST | `/jobs/send-reminders` | Send reminders |
