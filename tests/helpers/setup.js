// tests/helpers/setup.js — Jest setupFile
// Loaded by Jest BEFORE any test module is required (configured via "setupFiles" in package.json).
// Sets NODE_ENV=test so that src/database/client.js uses pg-mem (in-memory PostgreSQL)
// instead of a real database connection. Each Jest worker (separate Node.js process)
// gets its own isolated pg-mem instance — no shared state between test files.

'use strict';

process.env.JWT_SECRET  = 'test_secret_jest_not_for_production';
process.env.NODE_ENV    = 'test';
