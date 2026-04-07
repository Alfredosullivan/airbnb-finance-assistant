# Airbnb Finance Assistant

A Node.js + Express API that reconciles Airbnb payout exports (CSV/PDF) against
BBVA bank statements (PDF), cross-matches transactions by amount and date,
generates Excel and PDF reports, and maintains a per-user, per-property monthly
history with AI-powered analysis via Claude (Anthropic).

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | ≥ 18.x |
| npm | ≥ 9.x |
| SQLite | Built-in — no separate install needed (`better-sqlite3`) |

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-org/airbnb-finance-assistant.git
cd airbnb-finance-assistant

# 2. Install dependencies
npm install

# 3. Create your local environment file
cp .env.example .env

# 4. Edit .env and set your values (see Environment Variables below)
```

---

## Environment Variables

| Variable | Description | Required |
|----------|-------------|:--------:|
| `PORT` | HTTP port the server listens on | No (default: `3000`) |
| `JWT_SECRET` | Secret key used to sign JWT session tokens. Use a long random string in production. | **Yes** |
| `ALLOWED_ORIGINS` | Comma-separated list of allowed CORS origins | No (default: `http://localhost:3000`) |
| `ANTHROPIC_API_KEY` | API key for Claude AI (monthly analysis feature). If omitted, AI analysis endpoints return an error but all other endpoints work normally. | No |

> **Security note:** Never commit `.env` to version control. The `.gitignore` already excludes it.

---

## Running the Project

```bash
# Development — auto-restarts on file changes (nodemon)
npm run dev

# Production
npm start

# Run all tests (Jest + Supertest, in-memory SQLite)
npm test
```

Open the browser at `http://localhost:3000`

---

## API Documentation

Interactive Swagger UI is available at:

```
http://localhost:3000/api/docs
```

All endpoints, request schemas, response schemas, and authentication requirements
are documented there. The spec is generated from `@swagger` JSDoc blocks in
`src/routes/*.js` via `swagger-jsdoc`.

---

## Architecture

The application follows **Clean Architecture** with strict layer separation:

```
HTTP Request
    ↓
Routes (src/routes/)
    ↓
Middleware (src/middleware/)   — JWT auth, rate limiting, error handler
    ↓
Controllers (src/controllers/) — HTTP request/response only, no business logic
    ↓
Services (src/services/)       — Business logic: parsing, comparison, Excel/PDF generation, AI analysis
    ↓
Repositories (src/repositories/) — All SQLite queries, no business logic
    ↓
Database (src/database/)       — better-sqlite3 connection + schema init
```

### Layer responsibilities

| Layer | Path | Responsibility |
|-------|------|----------------|
| **Routes** | `src/routes/` | Define URL patterns, apply middleware per route |
| **Middleware** | `src/middleware/` | `requireAuth` (JWT cookie), `errorHandler` (centralized) |
| **Controllers** | `src/controllers/` | Parse request, call services, send response |
| **Services** | `src/services/` | CSV/PDF parsing, transaction comparison, Excel/PDF/AI generation |
| **Repositories** | `src/repositories/` | Prepared-statement CRUD for `users`, `properties`, `reports` |
| **Database** | `src/database/` | Single `better-sqlite3` connection; `schema.js` runs migrations on startup |
| **Config** | `src/config/`, `config.js` | Port, paths, Swagger spec |
| **Utils** | `src/utils/` | `formatter.js` (report shaping), `validator.js` (input validation) |

---

## API Overview

### Auth — `/api/auth`

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| `POST` | `/api/auth/register` | ✗ | Create account; returns httpOnly JWT cookie |
| `POST` | `/api/auth/login` | ✗ | Sign in; returns httpOnly JWT cookie |
| `POST` | `/api/auth/logout` | ✗ | Clear session cookie |
| `GET` | `/api/auth/me` | ✓ | Return current user + `needsPropertyName` flag |

### Properties — `/api/properties`

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| `GET` | `/api/properties` | ✓ | List user's properties |
| `POST` | `/api/properties` | ✓ | Create a new property |
| `PUT` | `/api/properties/:id` | ✓ | Rename a property |
| `DELETE` | `/api/properties/:id` | ✓ | Delete a property (requires ≥ 2 properties) |
| `GET` | `/api/properties/combined/:year` | ✓ | Annual combined report across all properties |

### Reports — `/api/reports`

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| `POST` | `/api/reports/save` | ✓ | Save or overwrite a monthly reconciliation report |
| `GET` | `/api/reports/list` | ✓ | List saved reports (metadata + totals) |
| `GET` | `/api/reports/:month` | ✓ | Full JSON for a given month (`2026-02`) |
| `DELETE` | `/api/reports/:month` | ✓ | Delete a month's report |
| `GET` | `/api/reports/annual/:year` | ✓ | Download annual Excel workbook |
| `GET` | `/api/reports/dashboard/:year` | ✓ | Annual dashboard metrics |
| `GET` | `/api/reports/executive-pdf/:year` | ✓ | Download executive PDF summary |
| `POST` | `/api/reports/:month/analysis` | ✓ | Generate Claude AI analysis for a saved month |
| `POST` | `/api/reports/:month/analysis/pdf` | ✓ | Download AI analysis as PDF |
| `POST` | `/api/reports/update-prev-year-ref` | ✓ | Inject prior-year data into a report |

### Finance (upload + compare) — `/api`

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| `POST` | `/api/upload/airbnb` | ✗ | Upload Airbnb CSV or PDF (`field: pdf`) |
| `POST` | `/api/upload/bank` | ✗ | Upload 1–2 BBVA bank PDFs (`field: bankPdf`) |
| `GET` | `/api/report` | ✗ | Get the current in-memory reconciliation report |
| `GET` | `/api/report/excel` | ✓ | Download the current report as `.xlsx` |
| `POST` | `/api/analysis/monthly` | ✓ | AI analysis of the current in-memory report |
| `POST` | `/api/analysis/monthly/pdf` | ✓ | Download AI analysis of current report as PDF |
| `POST` | `/api/reset` | ✗ | Clear the in-memory report state |

### System

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| `GET` | `/health` | ✗ | Liveness probe — returns `{ status, uptime, timestamp }` |
| `GET` | `/api/docs` | ✗ | Swagger UI — interactive API reference |

---

## Project Structure

```
airbnb-finance-assistant/
├── index.js                    # Entry point — Express setup, route mounting
├── config.js                   # Port, upload limits, allowed MIME types
├── .env.example                # Environment variable template
├── public/                     # Static frontend (HTML / CSS / JS)
├── uploads/                    # Temporary PDF/CSV uploads (gitignored)
├── data/                       # SQLite database file (gitignored)
├── src/
│   ├── config/
│   │   └── swagger.js          # OpenAPI 3.0 spec (swagger-jsdoc)
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── properties.controller.js
│   │   ├── report.controller.js    # In-memory report (upload flow)
│   │   ├── reports.controller.js   # Saved report history
│   │   └── upload.controller.js
│   ├── database/
│   │   ├── db.js               # better-sqlite3 connection (supports DB_PATH env override)
│   │   └── schema.js           # CREATE TABLE / migration logic (idempotent)
│   ├── middleware/
│   │   ├── auth.middleware.js  # requireAuth — validates JWT cookie
│   │   └── errorHandler.js     # Centralized error handler
│   ├── repositories/
│   │   ├── UserRepository.js
│   │   ├── PropertyRepository.js
│   │   └── ReportRepository.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── finance.routes.js
│   │   ├── properties.routes.js
│   │   └── reports.routes.js
│   ├── services/
│   │   ├── analysisGenerator.js    # Claude AI prompt + response handling
│   │   ├── annualExcelGenerator.js # Multi-sheet annual Excel workbook
│   │   ├── comparator.js           # Core matching algorithm (Airbnb ↔ bank)
│   │   ├── csvParser.js            # Parse Airbnb CSV export
│   │   ├── excelGenerator.js       # Monthly Excel report
│   │   └── pdfParser.js            # Parse Airbnb PDF and BBVA PDF exports
│   └── utils/
│       ├── formatter.js            # Shape compareTransactions() output into API JSON
│       └── validator.js            # Input validation helpers
└── tests/
    ├── helpers/
    │   ├── setup.js               # Jest setupFile — sets DB_PATH=:memory:
    │   └── testApp.js             # Express app for integration tests (no listen)
    ├── integration/
    │   ├── auth.test.js           # 17 integration tests — auth endpoints
    │   └── properties.test.js     # 13 integration tests — properties endpoints
    ├── unit/
    │   ├── comparator.test.js     # 22 unit tests — compareTransactions()
    │   └── formatter.test.js      # 17 unit tests — formatReport()
    └── integration.test.js        # Original 39 node-based tests (run with: node tests/integration.test.js)
```

---

## Testing

```bash
npm test
```

| Suite | File | Tests |
|-------|------|------:|
| Integration — Auth | `tests/integration/auth.test.js` | 17 |
| Integration — Properties | `tests/integration/properties.test.js` | 13 |
| Unit — Comparator | `tests/unit/comparator.test.js` | 22 |
| Unit — Formatter | `tests/unit/formatter.test.js` | 17 |
| **Total** | | **69** |

All tests run against an in-memory SQLite database (`DB_PATH=:memory:`) injected
via `tests/helpers/setup.js`. The real `data/finance.db` is never touched during
test runs.

The original pipeline smoke-test (no external framework) is still available:

```bash
node tests/integration.test.js   # 39/39 assertions
```
