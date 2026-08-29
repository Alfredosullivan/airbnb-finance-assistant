# Legacy Codebase Assessment

**Proyecto:** airbnb-finance-assistant  
**Fecha de auditoría:** 2026-08-28  
**Auditor:** Senior Software Engineer / Tech Lead (Claude Code)  
**Rama:** refactor/sdd-migration  
**Objetivo:** Inventario técnico completo previo a migración SDD  
**Alcance:** Solo lectura — ningún archivo de aplicación fue modificado

---

## 1. Executive Summary

El proyecto `airbnb-finance-assistant` es una aplicación web full-stack que permite a propietarios de Airbnb reconciliar sus transacciones de Airbnb con estados de cuenta bancarios, generar reportes financieros y obtener análisis de IA. Fue construido originalmente con asistencia de IA (vibe coding), lo cual se refleja en el código: la arquitectura general es sólida para el MVP, pero existen violaciones de separación de responsabilidades, estado global compartido y cobertura de tests insuficiente.

**El sistema funciona y está en producción (Railway + Docker).** Su CI/CD pipeline es maduro: lint, tests, secret scanning y container scanning. Su mayor deuda técnica es estructural (god files, shared mutable state) y de testing (11-15% thresholds). No existen vulnerabilidades críticas en el repositorio git en sí.

**Veredicto general:**

- La arquitectura de capas (routes → controllers → services → repositories) es correcta y debe preservarse.
- El pipeline CI/CD está bien diseñado y debe preservarse intacto.
- Los god files y el estado global compartido son el riesgo técnico más alto para mantenibilidad.
- La cobertura de tests debe incrementarse antes de refactorizar.

---

## 2. Current Architecture

```
Browser / Client
     │
     ▼
React 19 + Vite (client/)
     │ Fetch API (same-origin proxy en dev)
     ▼
Express 5 (index.js)
     │
     ├── Middleware Stack
     │     ├── Helmet (security headers)
     │     ├── CORS (configurable origins)
     │     ├── Cookie-Parser
     │     ├── express.json()
     │     ├── Rate Limiter (auth routes)
     │     ├── requireAuth (protected routes)
     │     └── Zod Validate (structured inputs)
     │
     ├── Routes → Controllers → Services → Repositories
     │     ├── /api/auth         → auth.controller.js
     │     ├── /api/upload       → upload.controller.js → csvParser / pdfParser
     │     ├── /api/report       → report.controller.js → comparator / analysisGenerator
     │     ├── /api/reports      → reports.controller.js (1305 líneas) → ReportRepository
     │     ├── /api/properties   → properties.controller.js → PropertyRepository
     │     ├── /api/jobs         → jobs.controller.js → MemoryQueue
     │     └── /api/crawler      → crawler.controller.js → crawlerService
     │
     ├── Background / Async
     │     ├── MemoryQueue (singleton FIFO, in-memory)
     │     └── analysisWorker.js (procesa Excel/Analysis jobs)
     │
     ├── Scheduler (node-cron)
     │     ├── monthlyReport.job.js   (TODO: incompleto)
     │     ├── weeklyOccupancy.job.js (TODO: incompleto)
     │     └── annualSummary.job.js   (TODO: incompleto)
     │
     └── Database: PostgreSQL 18-alpine
           ├── UserRepository.js
           ├── PropertyRepository.js
           └── ReportRepository.js
```

**Patrón de comunicación:** REST sin estado (no WebSockets). Las operaciones largas usan un patrón de polling: `POST /api/excel/queue` → responde 202 + jobId → cliente hace polling con `GET /api/jobs/:jobId`.

---

## 3. Repository Structure

```
airbnb-finance-assistant/
├── .github/workflows/ci.yml      # CI/CD: lint, test, secrets, trivy
├── bin/                          # CLI entry point (scripts auxiliares)
├── client/                       # React 19 + Vite frontend
│   ├── src/
│   │   ├── App.jsx               # Root (55 líneas, bien acotado)
│   │   ├── context/AppContext.jsx # Estado global (Context API)
│   │   └── components/           # 9 componentes
│   ├── vite.config.js
│   └── package.json              # Dependencias frontend independientes
├── docs/                         # (Creado en esta auditoría)
├── public/                       # Landing page estática (Vanilla JS)
├── scripts/                      # migrate.js, seed.js (utilidades)
├── src/                          # Backend Node.js/Express
│   ├── config/                   # logger.js, swagger.js
│   ├── controllers/              # 7 controllers
│   ├── database/                 # client.js (pg pool), db.js (SQLite, MUERTO), schema.js
│   ├── middleware/               # auth, errorHandler, validate
│   ├── models/                   # (si existen, sin lógica de negocio)
│   ├── queue/                    # MemoryQueue.js + analysisWorker.js
│   ├── repositories/             # 3 repositories (SQL parametrizado)
│   ├── routes/                   # 6 route files
│   ├── scheduler/                # node-cron + 3 jobs (incompletos)
│   ├── schemas/                  # Zod schemas (auth, property)
│   ├── services/                 # Business logic + parsers
│   └── utils/                   # formatter.js, validator.js
├── tests/
│   ├── helpers/setup.js          # pg-mem initialization
│   ├── helpers/testApp.js        # Express test instance
│   ├── integration/              # auth.test.js, properties.test.js
│   └── unit/                    # comparator.test.js, formatter.test.js
├── config.js                     # Constantes globales
├── index.js                      # Entry point (158 líneas)
├── Dockerfile                    # Multi-stage: builder → production
├── docker-compose.yml            # Local dev: app + db
├── .env.example                  # Template de variables (seguro)
├── .env                          # Secretos locales (en .gitignore ✓)
├── eslint.config.mjs             # ESLint flat config v9
├── .prettierrc                   # Prettier config
├── tsconfig.json                 # TypeScript config (barely used)
├── package.json                  # Dependencias backend
└── README.md                     # Documentación del proyecto
```

**Observación:** No existe carpeta `docs/` en el proyecto original. Se creó en esta auditoría para alojar este reporte.

---

## 4. Frontend Assessment

### Stack

- **Framework:** React 19.2.5 (última versión estable)
- **Build tool:** Vite 8.0.10
- **Styling:** Tailwind CSS 4.2.4 via @tailwindcss/vite
- **HTTP:** Fetch API nativa (no Axios)
- **Gráficos:** Chart.js 4.5.1 con refs de React
- **Estado global:** Context API (AppContext.jsx)

### Componentes

| Componente        | Líneas | Propósito                                |
| ----------------- | ------ | ---------------------------------------- |
| App.jsx           | ~55    | Root, modal de auth, shell               |
| AppContext.jsx    | ~70    | Estado global: user, properties, reports |
| AppShell.jsx      | N/A    | Layout principal (AppBar, drawer)        |
| Dashboard.jsx     | ~80+   | Métricas anuales + Chart.js              |
| AuthModal.jsx     | N/A    | Login/Register modal                     |
| PropertyBar.jsx   | N/A    | Selector de propiedades                  |
| PropertyModal.jsx | N/A    | CRUD de propiedades                      |
| UploadSection.jsx | N/A    | Carga de archivos                        |
| MarketSection.jsx | N/A    | Análisis de mercado                      |
| AnalysisModal.jsx | N/A    | Viewer de análisis IA                    |
| ReportResults.jsx | N/A    | Display de reporte                       |
| HistoryDrawer.jsx | N/A    | Historial de reportes                    |

### Problemas identificados

| ID    | Severidad | Archivo(s)                           | Descripción                                                      | Impacto                                                                                           | Recomendación                                                               |
| ----- | --------- | ------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| FE-01 | Medium    | AnalysisModal.jsx, MarketSection.jsx | `dangerouslySetInnerHTML` con HTML generado por markdownToHtml() | XSS si la librería de markdown tiene vulnerabilidades; el HTML viene de Claude (fuente confiable) | Verificar que markdownToHtml() sanitiza correctamente; considerar DOMPurify |
| FE-02 | Medium    | AppContext.jsx                       | Propiedades cargadas sin paginación; todas en memoria al login   | Lentitud con 100+ propiedades; más con muchos reportes                                            | Agregar paginación en fases futuras                                         |
| FE-03 | Low       | Dashboard.jsx                        | console.error en línea 53                                        | Información de debug en producción                                                                | Reemplazar con logger o manejo silencioso                                   |
| FE-04 | Low       | client/                              | Sin validación en el lado del cliente (solo Zod server-side)     | UX: el usuario no recibe feedback inmediato antes del request                                     | Agregar validación básica en formularios                                    |
| FE-05 | Low       | App.jsx                              | Props drilling de auth state hacia componentes hijos             | Aumenta acoplamiento; Context ya existe                                                           | Mover auth state completamente a AppContext                                 |

### Qué funciona bien

- Context API bien implementado para la escala del proyecto
- Componentes pequeños y acotados (menos AppShell)
- Chart.js con `chartInstance.destroy()` antes de recrear (sin memory leak)
- Dev proxy en Vite correctamente configurado

---

## 5. Backend Assessment

### Stack

- **Framework:** Express 5.2.1 (última versión estable)
- **Lenguaje:** JavaScript (Node.js); TypeScript configurado pero apenas usado
- **ORM:** Ninguno — SQL parametrizado directo con `pg`
- **Auth:** JWT HS256 + bcrypt 12 rounds
- **Logging:** Winston (JSON en prod, colorized en dev)
- **Validación:** Zod 3.x
- **Docs:** Swagger/OpenAPI 3.0

### Capas detectadas

```
Routes → Controllers → (Services) → Repositories → Database
                 ↑
            Middleware (auth, validate, errorHandler)
```

La separación de capas es correcta en la mayoría de los módulos. Las violaciones más graves se concentran en `reports.controller.js`.

### Problemas identificados

| ID    | Severidad | Archivo(s)                            | Descripción                                                                                                             | Impacto                                                                   | Recomendación                                                |
| ----- | --------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| BE-01 | High      | src/controllers/reports.controller.js | God file de 1305 líneas. Mezcla lógica de negocio, acceso a DB, generación de Excel, generación de PDF y respuesta HTTP | Difícil de leer, testear y mantener                                       | Extraer: ReportService, ExcelService, PDFService             |
| BE-02 | High      | src/controllers/upload.controller.js  | Estado global mutable (`const store = {airbnbPath, bankPaths, reportData}`) compartido entre todos los requests         | Incorrecto en multi-process (PM2, K8s, Railway con ≥2 instancias)         | Mover a sesión o request context                             |
| BE-03 | Medium    | src/controllers/report.controller.js  | `buildAnalysisData` duplicado también en `analysisWorker.js` (TODO documenta esto)                                      | Inconsistencias si se actualiza en un lugar y no el otro                  | Extraer a `src/utils/analysisDataBuilder.js`                 |
| BE-04 | Medium    | Múltiples controllers                 | Inconsistencia en la forma de los errores: algunos usan `{ error: 'msg' }`, otros `{ status, message, code }`           | El cliente debe manejar dos formatos distintos                            | Centralizar en el errorHandler global                        |
| BE-05 | Medium    | src/queue/MemoryQueue.js              | Singleton en memoria, sin límite de jobs                                                                                | Con carga alta, la memoria crece sin límite hasta el cleanup de 1h        | Documentar como limitación; planear migración a Redis/BullMQ |
| BE-06 | Medium    | src/scheduler/                        | Los 3 scheduled jobs son esqueletos con TODOs: sin lógica real implementada                                             | Funcionalidad prometida no entregada                                      | Definir specs y completar o eliminar                         |
| BE-07 | Low       | src/database/db.js                    | Archivo de conexión SQLite, nunca importado                                                                             | Dead code que confunde                                                    | Eliminar en la siguiente fase                                |
| BE-08 | Low       | config.js                             | Constantes de configuración paralelas a `.env.example`; no queda claro cuál es la fuente de verdad                      | Puede causar valores inconsistentes                                       | Unificar en un solo módulo de config                         |
| BE-09 | Low       | Múltiples archivos                    | Timezone del scheduler comentada (`America/Mexico_City`); los cron jobs corren en la zona del servidor                  | Si Railway usa UTC, las horas de los jobs son incorrectas para el usuario | Descomentar o hacer configurable via env                     |
| BE-10 | Low       | src/controllers/*.js                  | `const userId = req.user.userId` en lugar de `const { userId } = req.user` (destructuring inconsistente)                | Legibilidad menor                                                         | Normalizar en refactoring                                    |

### Qué funciona bien

- Arquitectura de capas clara y consistente (salvo BE-01)
- Middleware stack bien ordenado en index.js
- Validación con Zod aplicada en todas las entradas estructuradas
- Winston configurado correctamente (JSON en prod)
- Rate limiting en endpoints de auth
- Health check endpoint para probes de K8s

---

## 6. Database Assessment

### Stack

- **Motor:** PostgreSQL 18-alpine (producción/desarrollo)
- **Testing:** pg-mem (PostgreSQL en memoria para Jest)
- **Driver:** pg (sin ORM)
- **Schema:** Creado on-startup via `CREATE TABLE IF NOT EXISTS`

### Schema actual

```sql
-- Usuarios del sistema
users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
)

-- Propiedades por usuario (Airbnb listings)
properties (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
)

-- Reportes mensuales por propiedad
reports (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  month       TEXT NOT NULL,   -- Formato: YYYY-MM
  year        INTEGER NOT NULL,
  label       TEXT NOT NULL,
  summary     TEXT NOT NULL,   -- JSON serializado
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, property_id, month)
)

-- Índice existente
CREATE INDEX idx_reports_user_property_month ON reports(user_id, property_id, month);
```

### Problemas identificados

| ID    | Severidad | Archivo(s)                           | Descripción                                                                                                                | Impacto                                                                                        | Recomendación                                                |
| ----- | --------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| DB-01 | High      | src/database/schema.js               | Sin framework de migraciones (Flyway, golang-migrate, db-migrate). El schema se aplica con `IF NOT EXISTS` en cada startup | No hay historial de cambios; imposible hacer rollback; modificar columnas existentes es manual | Adoptar un framework de migraciones (ej: node-pg-migrate)    |
| DB-02 | Medium    | src/repositories/ReportRepository.js | 366 líneas, 20+ métodos. Métodos similares: `findByMonth` vs `findByMonthAny`, `listByProperty` vs `listByUser`            | Difícil de mantener; duplicación de lógica SQL                                                 | Refactorizar con métodos parametrizados opcionales           |
| DB-03 | Medium    | reports.summary                      | El campo `summary` almacena JSON serializado como TEXT                                                                     | No se puede hacer queries sobre el contenido del JSON; pérdida de integridad                   | Migrar a columna `JSONB` (PostgreSQL nativo)                 |
| DB-04 | Low       | src/database/schema.js               | Sin índices en `users.email` ni `properties.user_id`                                                                       | Queries de login y listado de propiedades hacen full scan                                      | Agregar índices: `idx_users_email`, `idx_properties_user_id` |
| DB-05 | Low       | src/repositories/ReportRepository.js | `countByUser`, `countByProperty` sin caching                                                                               | Queries adicionales en operaciones frecuentes                                                  | Evaluar si se usan realmente; si no, eliminar                |

### Qué funciona bien

- Todas las queries usan placeholders parametrizados (`$1, $2`) — sin riesgo de SQL injection
- Foreign keys con `ON DELETE CASCADE` correctamente definidas
- Único índice compuesto en la columna más consultada
- pg-mem para tests de integración sin necesidad de DB real

---

## 7. API Assessment

### Inventario completo de endpoints

#### Auth (`/api/auth`)

| Método | Ruta               | Auth requerida       | Rate limit    | Handler                 |
| ------ | ------------------ | -------------------- | ------------- | ----------------------- |
| POST   | /api/auth/register | No                   | Sí (20/15min) | authController.register |
| POST   | /api/auth/login    | No                   | Sí (20/15min) | authController.login    |
| POST   | /api/auth/logout   | No                   | No            | authController.logout   |
| GET    | /api/auth/me       | No (verifica cookie) | No            | authController.me       |
| GET    | /api/auth/me/token | Sí                   | No            | authController.getToken |

#### Finance (`/api`)

| Método | Ruta                      | Auth requerida | Handler                                |
| ------ | ------------------------- | -------------- | -------------------------------------- |
| POST   | /api/upload/airbnb        | No             | uploadController.uploadAirbnb          |
| POST   | /api/upload/bank          | No             | uploadController.uploadBank            |
| GET    | /api/report               | No             | reportController.getReport             |
| GET    | /api/report/excel         | Sí             | reportController.generateExcel         |
| POST   | /api/reset                | No             | reportController.resetReport           |
| POST   | /api/analysis/monthly     | Sí             | reportController.getMonthlyAnalysis    |
| POST   | /api/analysis/monthly/pdf | Sí             | reportController.getMonthlyAnalysisPDF |
| POST   | /api/excel/queue          | Sí             | reportController.queueExcelGeneration  |

#### Properties (`/api/properties`)

| Método | Ruta                           | Auth requerida | Handler                                |
| ------ | ------------------------------ | -------------- | -------------------------------------- |
| GET    | /api/properties                | Sí             | propertiesController.listProperties    |
| POST   | /api/properties                | Sí             | propertiesController.createProperty    |
| PUT    | /api/properties/:id            | Sí             | propertiesController.renameProperty    |
| DELETE | /api/properties/:id            | Sí             | propertiesController.deleteProperty    |
| GET    | /api/properties/combined/:year | Sí             | propertiesController.getCombinedReport |

#### Reports (`/api/reports`)

| Método | Ruta                              | Auth requerida | Handler                                   |
| ------ | --------------------------------- | -------------- | ----------------------------------------- |
| POST   | /api/reports/save                 | Sí             | reportsController.saveReport              |
| POST   | /api/reports/update-prev-year-ref | Sí             | reportsController.updatePrevYearRef       |
| GET    | /api/reports/list                 | Sí             | reportsController.listReports             |
| GET    | /api/reports/annual/:year         | Sí             | reportsController.generateAnnualReport    |
| GET    | /api/reports/dashboard/:year      | Sí             | reportsController.getDashboard            |
| GET    | /api/reports/executive-pdf/:year  | Sí             | reportsController.getExecutivePDF         |
| POST   | /api/reports/:month/analysis      | Sí             | reportsController.getAnalysisFromSaved    |
| POST   | /api/reports/:month/analysis/pdf  | Sí             | reportsController.getAnalysisPDFFromSaved |
| GET    | /api/reports/:month               | Sí             | reportsController.getReport               |
| DELETE | /api/reports/:month               | Sí             | reportsController.deleteReport            |

#### Jobs (`/api/jobs`)

| Método | Ruta                      | Auth requerida | Handler                          |
| ------ | ------------------------- | -------------- | -------------------------------- |
| GET    | /api/jobs/:jobId          | Sí             | jobsController.getJobStatus      |
| GET    | /api/jobs/:jobId/download | Sí             | jobsController.downloadJobResult |

#### Crawler (`/api/crawler`)

| Método | Ruta                  | Auth requerida | Handler                         |
| ------ | --------------------- | -------------- | ------------------------------- |
| GET    | /api/crawler/listings | Sí             | crawlerController.getListings   |
| POST   | /api/crawler/analyze  | Sí             | crawlerController.analyzeMarket |

#### Infraestructura

| Método | Ruta      | Auth requerida | Propósito                           |
| ------ | --------- | -------------- | ----------------------------------- |
| GET    | /health   | No             | Kubernetes liveness/readiness probe |
| GET    | /api/docs | No             | Swagger UI interactivo              |
| GET    | /         | No             | Landing page estática               |
| GET    | /app      | No             | SPA React shell                     |

### Problemas identificados

| ID     | Severidad | Archivo(s)        | Descripción                                                                                             | Impacto                                                                      | Recomendación                                                  |
| ------ | --------- | ----------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| API-01 | High      | finance.routes.js | `/api/upload/airbnb`, `/api/upload/bank`, `/api/report`, `/api/reset` no requieren autenticación        | Cualquier usuario anónimo puede subir archivos o acceder al store compartido | Agregar `requireAuth` a todos los endpoints de upload y report |
| API-02 | Medium    | reports.routes.js | `GET /api/reports/list` no tiene paginación                                                             | Con muchos reportes, la respuesta puede ser muy grande                       | Agregar query params `?page=&limit=`                           |
| API-03 | Medium    | finance.routes.js | Algunos endpoints retornan `{ error: 'msg' }` en lugar del formato estándar `{ status, message, code }` | Cliente debe manejar dos formatos distintos                                  | Unificar en errorHandler global                                |
| API-04 | Low       | routes/ general   | Sin versionado de API (`/api/v1/`)                                                                      | Imposible hacer cambios breaking sin afectar clientes existentes             | Planear migración a `/api/v1/` en la siguiente fase            |
| API-05 | Low       | routes/ general   | `month` y `year` en query params y rutas no tienen validación de formato                                | Un valor como `month=abc` puede causar errores 500 en lugar de 400           | Agregar validación Zod en rutas parametrizadas                 |

---

## 8. Authentication & Authorization

### Implementación actual

**Estrategia:** JWT HS256  
**Almacenamiento:** Cookie httpOnly `token` (protección XSS)  
**Fallback:** Bearer token en header `Authorization` (para CLI/scripts)  
**Duración:** 7 días  
**Hash de contraseña:** bcrypt, 12 rounds

**Flujo de autenticación:**

```
POST /api/auth/login
  → Valida email/password con Zod
  → Compara password con bcrypt
  → Genera JWT: { userId, username, expiresIn: '7d' }
  → Set-Cookie: token=<jwt>; httpOnly; SameSite=lax; MaxAge=7d

requireAuth middleware:
  1. Lee req.cookies.token
  2. Fallback: Authorization: Bearer <token>
  3. jwt.verify() con JWT_SECRET
  4. req.user = { userId, username }
  5. 401 si ausente o inválido
```

**Autorización:**  
Modelo simple: autenticación = autorización. Todos los usuarios autenticados acceden solo a sus propios datos, verificado via `userId` en cada query del repository.

### Problemas identificados

| ID      | Severidad | Archivo(s)         | Descripción                                                                             | Impacto                                                                                                             | Recomendación                                                       |
| ------- | --------- | ------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| AUTH-01 | High      | auth.controller.js | `secure: false` en la cookie de producción; solo correcto en desarrollo                 | Si el deploy usa HTTPS (Railway usa HTTPS), la cookie no se enviará correctamente en producción en algunos browsers | Condicionar `secure` a `NODE_ENV === 'production'`                  |
| AUTH-02 | Medium    | auth.controller.js | Sin refresh token; el access token dura 7 días sin posibilidad de revocar               | Una vez comprometido, el token es válido 7 días. Logout solo borra la cookie local                                  | Implementar: access token (15min) + refresh token (7d) con rotación |
| AUTH-03 | Medium    | auth.controller.js | JWT Secret tiene fallback hardcodeado: `process.env.JWT_SECRET \|\| 'dev_secret_local'` | Si JWT_SECRET no está configurado en producción, el sistema usa el secreto inseguro                                 | Lanzar error en startup si JWT_SECRET no está definido              |
| AUTH-04 | Low       | —                  | Sin RBAC (Role-Based Access Control); no existe distinción entre admin y usuario normal | Si se necesita panel admin en el futuro, habrá que refactorizar todas las verificaciones                            | Documentar como limitación; planear si se requiere                  |

### Qué funciona bien

- Error genérico en login ("Credenciales incorrectas") — sin enumeración de usuarios
- bcrypt con 12 rounds (alto)
- httpOnly cookie (resistente a XSS)
- SameSite: lax (protección parcial CSRF)
- Rate limiting en auth (20 intentos / 15 min)

---

## 9. Testing Assessment

### Framework y herramientas

- **Test runner:** Jest 30.3.0
- **HTTP testing:** Supertest 7.2.2
- **DB en tests:** pg-mem 3.0.14 (PostgreSQL en memoria)
- **Mocking:** Jest mocks (rate limiting mockeado en auth.test.js)

### Archivos de test existentes

| Archivo                              | Tipo        | Descripción                                  |
| ------------------------------------ | ----------- | -------------------------------------------- |
| tests/integration/auth.test.js       | Integration | Register, login, logout, duplicate detection |
| tests/integration/properties.test.js | Integration | CRUD de propiedades                          |
| tests/unit/comparator.test.js        | Unit        | Algoritmo de matching de transacciones       |
| tests/unit/formatter.test.js         | Unit        | Formateo de reportes                         |
| tests/integration.test.js            | Integration | Flujo completo de API                        |

### Coverage thresholds (package.json)

```json
"coverageThreshold": {
  "global": {
    "statements": 11,
    "branches": 9,
    "functions": 15,
    "lines": 11
  }
}
```

> **Interpretación:** Umbrales configurados en el mínimo para que el pipeline pase. El proyecto tiene tests, pero no son suficientes para refactorizar con confianza.

### Módulos sin tests

- `src/controllers/report.controller.js`
- `src/controllers/reports.controller.js`
- `src/controllers/upload.controller.js`
- `src/middleware/errorHandler.js`
- `src/services/csvParser.js`
- `src/services/pdfParser.js`
- `src/services/analysisGenerator.js`
- `src/queue/MemoryQueue.js`
- `src/queue/workers/analysisWorker.js`
- `src/scheduler/` (todos los jobs)
- `src/utils/validator.js`

### Problemas identificados

| ID      | Severidad | Archivo(s)   | Descripción                                                          | Impacto                                                               | Recomendación                                               |
| ------- | --------- | ------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| TEST-01 | High      | package.json | Umbrales de coverage en 11-15% — mínimo para pasar el CI             | Se puede refactorizar código de producción sin que ningún test falle  | Elevar a 60% gradualmente; priorizar controllers y services |
| TEST-02 | High      | —            | Sin tests para reportController, reportsController, uploadController | Los módulos más complejos y con más lógica no tienen tests            | Agregar tests de integración y unit antes de refactorizar   |
| TEST-03 | Medium    | —            | Sin tests para errorHandler                                          | No se puede verificar que los errores se formatean correctamente      | Agregar suite de tests para errorHandler                    |
| TEST-04 | Medium    | —            | Sin tests para csvParser y pdfParser                                 | Parsers son frágiles por naturaleza (dependientes de formato externo) | Agregar tests con fixtures de archivos reales               |
| TEST-05 | Low       | —            | Sin tests E2E (Playwright/Cypress)                                   | No hay verificación del flujo completo frontend → backend             | Planear para fases futuras post-estabilización              |

### Qué funciona bien

- pg-mem para tests de integración sin dependencia de DB real
- Mocking de rate limiter en tests de auth (correcto)
- Tests de auth cubren casos de error (duplicados, credenciales inválidas)

---

## 10. Security Assessment

### Prácticas positivas

- Helmet con CSP restrictivo (solo self + CDN)
- Contraseñas con bcrypt 12 rounds
- Cookie httpOnly (resistente a XSS)
- Queries SQL 100% parametrizadas (sin SQL injection posible)
- Rate limiting en auth (20/15min)
- CORS configurable (no wildcard por defecto)
- Gitleaks en CI (secret scanning)
- Trivy en CI (CVE scanning en imagen Docker)
- Ningún `eval()` ni código dinámico en el repositorio
- Sin credenciales hardcodeadas en código

### Problemas identificados

| ID     | Severidad | Archivo(s)                           | Descripción                                                                                                                                | Impacto                                                                       | Recomendación                                                                              |
| ------ | --------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| SEC-01 | High      | .env                                 | Archivo `.env` con credenciales reales (ANTHROPIC_API_KEY, JWT_SECRET, POSTGRES_PASSWORD) existe localmente; en `.gitignore` pero en disco | Riesgo si el disco es accesible o si se comparte por error                    | Rotar todas las credenciales; verificar que nunca fue commiteado (`git log --all -- .env`) |
| SEC-02 | High      | API-01                               | Endpoints de upload y report sin autenticación (ver API-01)                                                                                | Cualquier usuario anónimo puede interactuar con el store compartido           | Agregar requireAuth                                                                        |
| SEC-03 | Medium    | auth.controller.js                   | Cookie `secure: false` en todos los entornos; en producción HTTPS, algunos browsers pueden bloquear cookies no-secure                      | Logout/login puede fallar silenciosamente en producción                       | Condicionar `secure` al entorno (ya documentado en AUTH-01)                                |
| SEC-04 | Medium    | AnalysisModal.jsx, MarketSection.jsx | `dangerouslySetInnerHTML` con HTML de markdownToHtml()                                                                                     | XSS si la librería tiene vulnerabilidades o si el input de Claude se manipula | Validar que markdownToHtml sanitiza; considerar DOMPurify                                  |
| SEC-05 | Medium    | auth.controller.js                   | Sin blacklist de tokens JWT tras logout                                                                                                    | Token válido 7 días incluso después de logout                                 | Implementar con refresh tokens o short-lived access tokens                                 |
| SEC-06 | Low       | index.js Helmet config               | `scriptSrcAttr: ["'unsafe-inline'"]` en CSP                                                                                                | Permite inline event handlers (riesgo menor)                                  | Eliminar 'unsafe-inline' si no hay handlers inline reales                                  |
| SEC-07 | Low       | —                                    | Sin audit logging de operaciones sensibles (login, delete report, delete property)                                                         | No hay trazabilidad de quién hizo qué y cuándo                                | Agregar log estructurado de eventos de seguridad                                           |

---

## 11. Infrastructure & Deployment

### Docker

**Dockerfile:** Multi-stage build (node:22-alpine)

```
Stage 1 (builder): npm ci → tsc + vite build → npm ci --omit=dev
Stage 2 (production): apk upgrade → copy artifacts → node dist/index.js
```

**docker-compose.yml:** Desarrollo local

- `db`: PostgreSQL 18-alpine con named volume y healthcheck
- `app`: Depende de `db` (healthcheck condition)
- Red aislada `finance_net`
- Puerto app: `127.0.0.1:3000:3000` (solo localhost, no expuesto públicamente)

### CI/CD (GitHub Actions)

**Trigger:** Push y PR a `main`

**Jobs:**

1. **lint-and-format:** ESLint + Prettier + npm audit (audit-level: high)
2. **test:** 69 tests con coverage → artifact lcov.info (30 días)
3. **secrets-scan:** Gitleaks (full history, fetch-depth: 0)
4. **docker-trivy:** Build imagen → Trivy (critical/high CVEs) → SARIF a GitHub Security

**Dependencias entre jobs:** docker-trivy requiere que lint, test y secrets pasen.

### Railway (Producción)

```json
{
  "build": { "buildCommand": "npm install && npm run build" },
  "deploy": { "startCommand": "node dist/index.js", "restartPolicyType": "ON_FAILURE" }
}
```

### Problemas identificados

| ID     | Severidad | Archivo(s)               | Descripción                                                   | Impacto                                                               | Recomendación                                    |
| ------ | --------- | ------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| INF-01 | Medium    | .github/workflows/ci.yml | Sin deploy automático a staging; el CI solo hace build y scan | No hay verificación en ambiente real antes de producción              | Agregar job de deploy a staging post-Docker      |
| INF-02 | Medium    | docker-compose.yml       | Puerto de PostgreSQL comentado (`# "127.0.0.1:5432:5432"`)    | No se puede acceder directamente a la DB desde el host para debugging | Documentar cómo conectarse para debugging        |
| INF-03 | Low       | railway.json             | `npm install` en el build de Railway (en lugar de `npm ci`)   | Puede instalar versiones diferentes a las del lock file               | Cambiar a `npm ci` para reproducibilidad         |
| INF-04 | Low       | Dockerfile               | `EXPOSE 3000` pero no se documenta el puerto en railway.json  | Depende de que Railway detecte el puerto automáticamente              | Agregar `PORT` env var explícita en railway.json |

### Qué funciona bien

- Multi-stage Dockerfile correcto (prod sin devDeps)
- OS patching en imagen de producción (`apk upgrade`)
- Pipeline de CI completo: lint, test, secrets, CVEs
- Health check endpoint para probes
- Docker Compose con healthcheck para evitar race conditions de DB

---

## 12. Technical Debt

### Deuda alta (bloquea escalabilidad)

| ID    | Archivo(s)             | Deuda                                                                      |
| ----- | ---------------------- | -------------------------------------------------------------------------- |
| TD-01 | upload.controller.js   | Estado global `store` compartido — diseño single-user, no escala           |
| TD-02 | reports.controller.js  | God file 1305 líneas mezclando múltiples responsabilidades                 |
| TD-03 | src/database/schema.js | Sin framework de migraciones — cambios de schema son manuales y peligrosos |

### Deuda media (aumenta el costo de mantenimiento)

| ID    | Archivo(s)          | Deuda                                                                        |
| ----- | ------------------- | ---------------------------------------------------------------------------- |
| TD-04 | package.json        | Coverage thresholds demasiado bajos — dificulta refactorizar con confianza   |
| TD-05 | src/scheduler/      | 3 scheduled jobs con TODO — funcionalidad prometida no entregada             |
| TD-06 | ReportRepository.js | 366 líneas — muchos métodos similares sin abstracción                        |
| TD-07 | src/schemas/        | Solo 2 schemas Zod — la mayoría de endpoints no tienen validación de entrada |
| TD-08 | —                   | Sin paginación en listados (properties, reports)                             |

### Deuda baja (costo de mantenimiento menor)

| ID    | Archivo(s)             | Deuda                                                                           |
| ----- | ---------------------- | ------------------------------------------------------------------------------- |
| TD-09 | src/database/db.js     | Dead code (SQLite, nunca importado)                                             |
| TD-10 | package.json           | `better-sqlite3` en dependencies — no se usa en ningún import                   |
| TD-11 | src/scheduler/index.js | Timezone comentada — jobs corren en timezone del servidor, no del usuario       |
| TD-12 | tsconfig.json          | TypeScript configurado pero `strict: false`; apenas 1-2 archivos .ts            |
| TD-13 | —                      | Constantes mágicas hardcodeadas (JWT expiry, rate limit window, file max count) |

---

## 13. Code Quality Issues

### God Files

| ID    | Severidad | Archivo                               | Líneas | Problema                                                                             |
| ----- | --------- | ------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| CQ-01 | High      | src/controllers/reports.controller.js | ~1305  | Mezcla: queries DB, lógica negocio, generación Excel, generación PDF, respuesta HTTP |
| CQ-02 | Medium    | src/repositories/ReportRepository.js  | ~366   | 20+ métodos; duplicación entre findByMonth/findByMonthAny, listByProperty/listByUser |

### Magic Numbers y Valores Hardcodeados

| ID    | Severidad | Archivo                    | Valor                                      | Descripción                                              |
| ----- | --------- | -------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| CQ-03 | Medium    | src/services/comparator.js | `AMOUNT_TOLERANCE = 1.0`                   | Tolerancia en MXN para matching; no documentada su razón |
| CQ-04 | Low       | src/queue/MemoryQueue.js   | `60 * 60 * 1000`                           | TTL de 1h para cleanup; no configurable                  |
| CQ-05 | Low       | auth.controller.js         | `expiresIn: '7d'`                          | Expiración JWT; debería ser env var                      |
| CQ-06 | Low       | finance.routes.js          | `uploadBankMiddleware.array('bankPdf', 2)` | Máximo 2 PDFs bancarios; no configurable                 |
| CQ-07 | Low       | auth.routes.js             | `windowMs: 15 * 60 * 1000, max: 20`        | Rate limit window y max; no configurables                |

### Código Duplicado

| ID    | Severidad | Archivos                                           | Descripción                                                        |
| ----- | --------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| CQ-08 | Medium    | report.controller.js, analysisWorker.js            | `buildAnalysisData` duplicado (TODO en analysisWorker lo reconoce) |
| CQ-09 | Low       | csvParser.js, comparator.js, reports.controller.js | Month key parsing (YYYY-MM) repetido                               |
| CQ-10 | Low       | pdfParser.js, csvParser.js                         | Amount parsing (eliminar comas/decimales) en distintos formatos    |

### TODOs sin resolver

| ID    | Archivo                                   | TODO                                                             |
| ----- | ----------------------------------------- | ---------------------------------------------------------------- |
| CQ-11 | src/scheduler/jobs/annualSummary.job.js   | Conectar con servicio de exportación Excel                       |
| CQ-12 | src/scheduler/jobs/monthlyReport.job.js   | Conectar con servicio de notificaciones                          |
| CQ-13 | src/scheduler/jobs/weeklyOccupancy.job.js | Conectar con servicio de notificaciones                          |
| CQ-14 | src/queue/workers/analysisWorker.js       | Mover buildAnalysisData a src/utils/                             |
| CQ-15 | src/services/pdfParser.js                 | Implementar parser de PDF de Airbnb cuando haya formato estándar |

### Inconsistencias de estilo

| ID    | Severidad | Archivo(s)                   | Descripción                                                       |
| ----- | --------- | ---------------------------- | ----------------------------------------------------------------- |
| CQ-16 | Low       | Múltiples controllers        | `const userId = req.user.userId` vs `const { userId } = req.user` |
| CQ-17 | Low       | Múltiples routes/controllers | Error response shape inconsistente (ver API-03)                   |

---

## 14. Performance Concerns

| ID      | Severidad | Archivo(s)                            | Descripción                                                                             | Impacto                                                | Recomendación                                                                   |
| ------- | --------- | ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| PERF-01 | Medium    | src/controllers/reports.controller.js | `GET /api/reports/list` carga todos los reportes sin paginación                         | Lento para usuarios con muchos reportes                | Implementar paginación cursor-based o limit/offset                              |
| PERF-02 | Medium    | AppContext.jsx                        | Frontend carga todas las propiedades al login sin paginación                            | Lento para usuarios con 100+ propiedades               | Lazy loading o paginación                                                       |
| PERF-03 | Low       | src/database/schema.js                | Sin índice en `users.email` (usado en login) ni `properties.user_id` (usado en listado) | Full table scan en cada login y listado de propiedades | Agregar índices faltantes                                                       |
| PERF-04 | Low       | src/queue/MemoryQueue.js              | Sin límite de jobs en cola; cleanup cada hora                                           | Consumo de memoria sin límite en alta carga            | Agregar max job count; considerar BullMQ                                        |
| PERF-05 | Low       | src/controllers/report.controller.js  | Generación de PDF/Excel potencialmente sincrónica puede bloquear el event loop          | Lentitud bajo carga concurrente                        | Asegurar que todas las generaciones sean async (ya están en queue parcialmente) |

---

## 15. Scalability Concerns

| ID       | Severidad | Archivo(s)                           | Descripción                                                        | Impacto                                                                  | Recomendación                                                |
| -------- | --------- | ------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------ |
| SCALE-01 | Critical  | src/controllers/upload.controller.js | `store` global compartido entre requests en el mismo proceso       | Con 2 usuarios simultáneos, el estado de uno sobrescribe al otro         | Reescribir con estado por sesión o request                   |
| SCALE-02 | High      | src/queue/MemoryQueue.js             | Queue en memoria; no persiste entre reinicios del servidor         | Jobs pendientes se pierden si el servidor se reinicia                    | Planear migración a Redis + BullMQ                           |
| SCALE-03 | Medium    | —                                    | Sin soporte para múltiples instancias (Railway horizontal scaling) | Si Railway escala a 2+ instancias, el state y el queue no se sincronizan | Documentar limitación; SCALE-01 y SCALE-02 son prerequisitos |
| SCALE-04 | Low       | —                                    | Sin caching de datos frecuentes (propiedades, configuración)       | Queries repetidas por cada request                                       | Redis como capa de cache opcional en el futuro               |

---

## 16. Current Functionalities

El sistema implementa las siguientes funcionalidades verificadas en el código:

### Autenticación

- Registro de usuarios (username, email, password)
- Login con email/password (JWT 7d)
- Logout (borra cookie)
- Verificación de sesión activa

### Gestión de Propiedades

- Listar propiedades del usuario autenticado
- Crear nueva propiedad (nombre)
- Renombrar propiedad existente
- Eliminar propiedad (si no tiene reportes asociados — ambigüedad: no se confirmó la restricción en el código)

### Reconciliación Financiera (flujo principal)

- Cargar CSV/PDF de Airbnb con transacciones
- Cargar 1-2 PDFs de estado de cuenta bancario (formato BBVA México)
- Parsear y cruzar transacciones: match por monto (±1 MXN) y mes
- Mostrar resultado: transacciones matched, solo en Airbnb, solo en banco

### Reportes

- Generar reporte mensual a partir de la reconciliación
- Exportar reporte como Excel (.xlsx) con tablas detalladas
- Guardar reporte en DB (por propiedad y mes)
- Listar reportes históricos
- Recuperar reporte guardado
- Eliminar reporte
- Reporte anual: agrega todos los meses de un año
- Excel anual combinado

### Análisis de IA (Claude Anthropic)

- Generar análisis escrito del reporte mensual (Claude API)
- Exportar análisis como PDF
- Análisis de mercado inmobiliario (datos del crawler + Claude)

### Dashboard

- Vista anual con métricas mes a mes
- Gráfico de barras con Chart.js

### Procesamiento en Background

- Cola de jobs en memoria (FIFO)
- Worker para generación de Excel pesado
- Polling de status via `/api/jobs/:jobId`
- Descarga del resultado cuando está listo

### Crawler de Mercado

- Scraping de listados de propiedades en Mérida
- Análisis de mercado con Claude

### Scheduler (incompleto)

- Infraestructura de cron jobs presente (node-cron)
- 3 jobs registrados pero sin lógica real (solo logs y TODOs)

### API & Documentación

- Swagger UI en `/api/docs`
- Health check en `/health`

---

## 17. Risks

| ID      | Severidad | Descripción                                                                                                                          | Probabilidad                                    | Impacto                                                  |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------------------------------------------------- |
| RISK-01 | Critical  | Estado global `store` en upload.controller.js — en producción con 2 usuarios simultáneos, los datos de uno sobrescriben los del otro | Alta (cualquier uso concurrente)                | Datos incorrectos en reportes financieros                |
| RISK-02 | High      | Sin tests para los controllers más complejos (reports, upload, report) — un refactor puede romper funcionalidad silenciosamente      | Alta durante refactoring                        | Regresiones no detectadas                                |
| RISK-03 | High      | Sin migraciones de DB — cualquier cambio de schema requiere intervención manual en producción                                        | Media (con el tiempo)                           | Downtime o pérdida de datos en cambios de schema         |
| RISK-04 | Medium    | Parsers de CSV/PDF son frágiles: dependientes de formatos externos de Airbnb y BBVA México                                           | Media (Airbnb/BBVA pueden cambiar sus formatos) | La funcionalidad principal deja de funcionar sin warning |
| RISK-05 | Medium    | MemoryQueue pierde jobs en reinicio del servidor                                                                                     | Media (deploys, crashes)                        | Jobs de Excel/Analysis pendientes se pierden             |
| RISK-06 | Medium    | JWT_SECRET con fallback hardcodeado — si no está en env en producción, usa 'dev_secret_local'                                        | Baja (depende de config de Railway)             | Tokens inseguros en producción                           |
| RISK-07 | Low       | Coverage 11-15% — el pipeline pasa con código incorrecto si los tests existentes no cubren el área modificada                        | Alta durante desarrollo                         | Bugs llegan a producción sin ser detectados              |
| RISK-08 | Low       | TypeScript configurado pero no usado efectivamente (`strict: false`, sin checkJs)                                                    | Baja (nunca fue un objetivo real)               | Sin beneficio de type safety                             |

---

## 18. Recommended Migration Strategy

> **IMPORTANTE:** Esta sección presenta opciones. No se recomienda ejecutar ninguna acción sin decisión explícita del desarrollador. El objetivo de este documento es informar, no prescribir.

### Fase 0 — Fundación SDD (antes de cualquier cambio de código)

1. Escribir specs para todos los endpoints existentes (OpenAPI ya existe → convertirlo en specs ejecutables)
2. Elevar coverage thresholds a 40% como prerequisito para cualquier refactor
3. Agregar tests para: reportController, reportsController, uploadController

### Fase 1 — Correcciones críticas de seguridad y estabilidad

1. **SCALE-01 / RISK-01:** Eliminar `store` global en upload.controller.js — máxima prioridad
2. **AUTH-01 / SEC-03:** Condicionar `cookie.secure` al entorno
3. **AUTH-03:** Lanzar error en startup si JWT_SECRET no está definido
4. **API-01 / SEC-02:** Agregar `requireAuth` a endpoints de upload y report

### Fase 2 — Deuda estructural

1. **TD-01 / BE-01:** Split de reports.controller.js en ReportService, ExcelService, PDFService
2. **DB-01 / TD-03:** Adoptar framework de migraciones (node-pg-migrate)
3. **DB-03:** Migrar `reports.summary` de TEXT a JSONB

### Fase 3 — Calidad y mantenibilidad

1. **TD-05 / CQ-11-13:** Completar o eliminar scheduled jobs
2. **CQ-08:** Extraer buildAnalysisData a utils compartido
3. **API-04:** Versionar la API: `/api/v1/`
4. **PERF-01 / API-02:** Agregar paginación a listados

### Fase 4 — Infraestructura y escalabilidad

1. **SCALE-02 / RISK-05:** Migrar MemoryQueue a BullMQ + Redis
2. **PERF-03:** Agregar índices faltantes en DB
3. **INF-01:** Agregar deploy automático a staging en CI

### Qué NO debe tocarse todavía

- El algoritmo de comparación en `src/services/comparator.js` (funciona bien, tiene tests)
- El Dockerfile y docker-compose (correctos y funcionando)
- El pipeline de CI/CD (completo y correcto)
- La estructura de capas routes → controllers → services → repositories (correcta)
- El módulo de logging Winston (bien configurado)

### Qué debería preservarse

- Arquitectura clean (separación de capas)
- Validación con Zod
- Queries SQL parametrizadas
- Pipeline CI/CD con security scanning
- Docker multi-stage build

---

## 19. Questions / Unknowns

Las siguientes preguntas no pudieron responderse solo con el código y requieren confirmación del desarrollador:

| ID   | Pregunta                                                                                                                                           | Por qué importa                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Q-01 | ¿El endpoint DELETE `/api/properties/:id` realmente bloquea el delete si hay reportes asociados? El cascade delete en DB lo permitiría a nivel SQL | Determinar si hay lógica de protección en el controller o si se pierden reportes al borrar propiedad |
| Q-02 | ¿El campo `secure: false` en la cookie fue intencional para producción o es un olvido del desarrollo?                                              | Impacta si el login funciona en producción con HTTPS de Railway                                      |
| Q-03 | ¿Los scheduled jobs (monthly, weekly, annual) alguna vez funcionaron con lógica real, o fueron siempre solo esqueletos?                            | Determina si son deuda activa o funcionalidad futura planificada                                     |
| Q-04 | ¿El parser de PDF de BBVA cubre solo ese banco o existe lógica para otros bancos que no se detectó?                                                | Impacta el roadmap de soporte multi-banco                                                            |
| Q-05 | ¿`config.js` en la raíz es la fuente de verdad para constantes, o es redundante con `.env`?                                                        | Evitar duplicación o conflicto entre las dos fuentes                                                 |
| Q-06 | ¿`bin/` contiene scripts CLI usados activamente o es código legado?                                                                                | Determinar si debe estar en el scope del SDD                                                         |
| Q-07 | ¿Se planea soporte para múltiples usuarios concurrentes en producción?                                                                             | Cambia radicalmente la urgencia de SCALE-01                                                          |
| Q-08 | ¿La Anthropic API Key del `.env` local está siendo usada activamente en producción o es una copia del ambiente de desarrollo?                      | Determinar si hay riesgo de exposición de créditos de la API                                         |
| Q-09 | ¿Existe documentación de los formatos de CSV/PDF esperados por los parsers (Airbnb, BBVA)?                                                         | Crítico para escribir tests y specs de los parsers                                                   |
| Q-10 | ¿El `public/` con la landing page estática es parte del producto o es un placeholder?                                                              | Determina si debe ser parte del scope de SDD                                                         |

---

_Documento generado automáticamente en la rama `refactor/sdd-migration` como primer artefacto del proceso SDD._  
_Ningún archivo de aplicación fue modificado durante esta auditoría._
