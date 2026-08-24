# Airbnb Finance Assistant

App web full stack para reconciliar automáticamente reportes de Airbnb contra estados de cuenta BBVA México. Soporta múltiples propiedades, genera reportes Excel y PDF, incluye dashboard con gráficas, análisis IA con Claude y frontend React con Vite.

🔗 **Demo en vivo:** https://airbnb-finance-assistant-production.up.railway.app

> Credenciales de demo: `demo@practice.com` / `Demo1234!`

---

## Stack

| Capa          | Tecnología                                            |
| ------------- | ----------------------------------------------------- |
| Runtime       | Node.js 20                                            |
| Framework     | Express 5                                             |
| Lenguaje      | TypeScript (migración incremental — servicios core)   |
| Base de datos | PostgreSQL (via `pg`)                                 |
| Auth          | JWT en httpOnly cookie + bcrypt (12 salt rounds)      |
| Validación    | Zod v3 — schemas por endpoint                         |
| Logging       | Winston — JSON en producción, colorized en dev        |
| Archivos      | Multer — PDF y CSV                                    |
| Reportes      | ExcelJS, PDFKit                                       |
| Frontend      | React 19 + Vite 8 + Context API                       |
| Gráficas      | Chart.js                                              |
| IA            | Claude API — Anthropic                                |
| Tests         | Jest + ts-jest — 69 tests                             |
| Linting       | ESLint 9 Flat Config + Prettier + Husky + lint-staged |
| CI/CD         | GitHub Actions (4 jobs) → Railway (auto-deploy)       |
| Contenedores  | Docker multi-stage build                              |
| Seguridad     | Trivy (CVE scan) + Gitleaks (secret scan)             |

---

## Stack por Capa

### Frontend

| Tecnología      | Rol                                            |
| --------------- | ---------------------------------------------- |
| JavaScript ES6+ | Lenguaje principal                             |
| React 19        | Framework UI                                   |
| Context API     | Estado global (propiedades, reporte activo)    |
| Vite 8          | Build tool y dev server con proxy a la API     |
| Chart.js        | Gráficas del dashboard (comparativo año a año) |
| CSS3            | Estilos propios (sin framework CSS)            |

### Backend — Core

| Tecnología | Rol                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Node.js 20 | Runtime                                                                                            |
| Express 5  | Framework HTTP                                                                                     |
| TypeScript | Migración incremental — `csvParser.ts`, `pdfParser.ts`, `comparator.ts` + 10 interfaces de dominio |

### Backend — Autenticación y Seguridad

| Tecnología         | Rol                                                            |
| ------------------ | -------------------------------------------------------------- |
| jsonwebtoken       | Generación y verificación de JWT en httpOnly cookie            |
| bcryptjs           | Hashing de contraseñas (12 salt rounds)                        |
| cookie-parser      | Lectura de cookies httpOnly en cada request                    |
| helmet             | Cabeceras HTTP de seguridad (XSS, clickjacking, MIME sniffing) |
| cors               | Control de orígenes permitidos (lista blanca por env)          |
| express-rate-limit | Protección anti-fuerza-bruta en endpoints de auth              |

### Backend — Validación y Logging

| Tecnología | Rol                                                                 |
| ---------- | ------------------------------------------------------------------- |
| Zod v3     | Validación y transformación de inputs por schema (`src/schemas/`)   |
| Winston    | Logging estructurado — JSON en producción, colorizado en desarrollo |

### Backend — Procesamiento de Archivos

| Tecnología | Rol                                                  |
| ---------- | ---------------------------------------------------- |
| Multer 2.x | Upload de archivos PDF y CSV                         |
| csv-parse  | Parseo de reportes Airbnb en CSV                     |
| pdf-parse  | Extracción de texto de estados de cuenta BBVA en PDF |
| ExcelJS    | Generación de reportes `.xlsx` con fórmulas reales   |
| PDFKit     | Generación de reportes ejecutivos en PDF             |

### Backend — Jobs y Scheduler

| Tecnología  | Rol                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------- |
| node-cron   | Tareas programadas (resúmenes mensuales, reportes anuales, ocupación semanal)            |
| MemoryQueue | Cola de jobs en memoria propia — patrón POST 202 + polling para operaciones lentas de IA |

### Backend — IA y Crawler

| Tecnología        | Rol                                                                  |
| ----------------- | -------------------------------------------------------------------- |
| @anthropic-ai/sdk | Análisis financiero mensual y de mercado con Claude                  |
| node-fetch        | Cliente HTTP para el crawler de precios de renta                     |
| cheerio           | Parsing de HTML de Lamudi (scraping de precios de mercado en Mérida) |

### Backend — Documentación y Utilidades

| Tecnología                         | Rol                                                |
| ---------------------------------- | -------------------------------------------------- |
| swagger-jsdoc + swagger-ui-express | Documentación interactiva de la API en `/api/docs` |
| dotenv                             | Carga de variables de entorno desde `.env`         |
| uuid                               | Generación de IDs únicos para jobs asíncronos      |

### Base de Datos

| Tecnología       | Rol                                                              |
| ---------------- | ---------------------------------------------------------------- |
| PostgreSQL       | Base de datos relacional principal                               |
| pg               | Cliente PostgreSQL para Node.js (pool de conexiones)             |
| Schema auto-init | Las tablas se crean automáticamente al arrancar (`initSchema()`) |

### Testing

| Tecnología | Rol                                                            |
| ---------- | -------------------------------------------------------------- |
| Jest       | Framework de tests                                             |
| ts-jest    | Compilación de TypeScript dentro de Jest                       |
| Supertest  | Tests de integración HTTP contra la app Express real           |
| pg-mem     | PostgreSQL en memoria — los tests no tocan la DB de desarrollo |

### Calidad de Código

| Tecnología  | Rol                                               |
| ----------- | ------------------------------------------------- |
| ESLint 9    | Linting con Flat Config (`eslint.config.mjs`)     |
| Prettier    | Formateo consistente de código                    |
| Husky       | Git hooks — bloquea commits con errores de lint   |
| lint-staged | Ejecuta ESLint y Prettier solo en archivos staged |

### DevSecOps — Seguridad en CI

| Tecnología     | Rol                                                           |
| -------------- | ------------------------------------------------------------- |
| Gitleaks       | Escaneo de secretos expuestos en el historial completo de git |
| Trivy          | Escaneo de CVEs (vulnerabilidades) en la imagen Docker        |
| .gitleaks.toml | Allowlist documentada para falsos positivos conocidos         |
| .trivyignore   | Supresión documentada de CVEs de dependencias internas de npm |

### Contenedores

| Tecnología         | Rol                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Docker multi-stage | Stage 1: compila TypeScript + React. Stage 2: imagen limpia sin devDeps ni package-lock.json |
| Docker Compose     | Orquestación local — servicio `app` + servicio `db` (PostgreSQL)                             |
| Alpine Linux       | Base de la imagen de producción (ligera, parcheada con `apk upgrade`)                        |

### CI/CD y Deploy

| Tecnología     | Rol                                                                                 |
| -------------- | ----------------------------------------------------------------------------------- |
| GitHub Actions | Pipeline de 4 jobs: `lint` + `test` + `secrets` (paralelos) → `docker` (secuencial) |
| Railway        | Hosting del backend Node.js + PostgreSQL en producción                              |
| Auto-deploy    | Railway despliega automáticamente solo cuando los 4 jobs del CI pasan               |

---

## Características

- **Reconciliación automática** de reportes Airbnb (CSV/PDF) contra estados de cuenta BBVA (PDF)
- **Frontend React** — migración incremental desde Vanilla JS con Context API, useRef, useCallback
- **Soporte multi-propiedad** — gestiona varias propiedades por usuario
- **Dashboard anual** con métricas KPI y gráfica comparativa año a año (Chart.js)
- **Historial mensual** con drawer lateral animado y análisis IA por mes
- **Exportación** a Excel (.xlsx) con fórmulas reales y PDF ejecutivo multi-propiedad
- **Análisis IA** con Claude — resumen financiero inteligente (caché en DB para control de costos)
- **Crawler de mercado** — scrapea Lamudi en tiempo real con análisis de precios vía Claude
- **TypeScript incremental** — `csvParser.ts`, `pdfParser.ts`, `comparator.ts` + 10 interfaces de dominio
- **Job queue asíncrono** — patrón POST 202 + polling para operaciones lentas de IA
- **Swagger UI** en `/api/docs` — documentación interactiva de todos los endpoints
- **69 tests** — unitarios e integración con PostgreSQL en memoria (`pg-mem`)
- **Validación de inputs con Zod** — schemas declarativos en `src/schemas/`, middleware `validate()` reutilizable
- **Logging estructurado con Winston** — JSON en producción, texto colorizado en desarrollo, nivel configurable vía `LOG_LEVEL`
- **Pipeline CI/CD completo** — lint, tests, secret scanning y vulnerability scanning en paralelo antes de cada deploy
- **Docker multi-stage** — imagen de producción sin devDependencies ni archivos de configuración sensibles

---

## Instalación local (Vite dev server)

**Requisitos previos:**

- Node.js ≥ 20.x
- PostgreSQL 14+ (local o via Docker)

```bash
# 1. Clonar el repositorio
git clone https://github.com/Alfredosullivan/airbnb-finance-assistant.git
cd airbnb-finance-assistant

# 2. Instalar dependencias del backend
npm install

# 3. Instalar dependencias del frontend
cd client && npm install && cd ..

# 4. Crear archivo de entorno
cp .env.example .env
# Edita .env con tus valores

# 5. Iniciar backend en desarrollo
npm run dev

# 6. En otra terminal, iniciar el frontend con Vite
cd client && npm run dev
```

- Backend: `http://localhost:3000`
- Frontend (Vite): `http://localhost:5173` — el proxy redirige `/api/*` al backend automáticamente

---

## Instalación con Docker

El proyecto incluye `docker-compose.yml` con build completo (TypeScript + React):

```bash
cp .env.example .env
# En .env usa host "db" para PostgreSQL:
# DATABASE_URL=postgresql://postgres:password@db:5432/finance_db

docker compose up -d --build
docker compose logs -f app
```

El build dentro del contenedor ejecuta:

1. `tsc` — compila TypeScript a `dist/`
2. `vite build` — genera `client/dist/` con el frontend React optimizado
3. Express sirve `client/dist/` en producción

Para detener:

```bash
docker compose down      # detiene contenedores, conserva datos
docker compose down -v   # detiene Y borra el volumen de PostgreSQL
```

---

## Variables de entorno

| Variable            | Descripción                         | Requerida                             |
| ------------------- | ----------------------------------- | ------------------------------------- |
| `PORT`              | Puerto del servidor                 | No (default: `3000`)                  |
| `DATABASE_URL`      | Connection string de PostgreSQL     | **Sí**                                |
| `JWT_SECRET`        | Clave para firmar tokens JWT        | **Sí**                                |
| `LOG_LEVEL`         | Nivel de log de Winston             | No (default: `info`)                  |
| `POSTGRES_USER`     | Usuario de PostgreSQL (Docker)      | **Sí (Docker)**                       |
| `POSTGRES_PASSWORD` | Contraseña de PostgreSQL (Docker)   | **Sí (Docker)**                       |
| `POSTGRES_DB`       | Nombre de la base de datos (Docker) | **Sí (Docker)**                       |
| `ALLOWED_ORIGINS`   | Orígenes CORS permitidos            | No (default: `http://localhost:3000`) |
| `MAX_FILE_SIZE_MB`  | Tamaño máximo de archivos en MB     | No (default: `10`)                    |
| `ANTHROPIC_API_KEY` | API key de Claude para análisis IA  | No                                    |

> Si `ANTHROPIC_API_KEY` no está definida, la app funciona normalmente — los botones de análisis IA quedan deshabilitados.

---

## Tests

```bash
npm test
npm run test:coverage
```

| Suite                    | Archivo                                |  Tests |
| ------------------------ | -------------------------------------- | -----: |
| Integration — Auth       | `tests/integration/auth.test.js`       |     17 |
| Integration — Properties | `tests/integration/properties.test.js` |     13 |
| Unit — Comparator        | `tests/unit/comparator.test.js`        |     22 |
| Unit — Formatter         | `tests/unit/formatter.test.js`         |     17 |
| **Total**                |                                        | **69** |

Los tests corren contra PostgreSQL en memoria (`pg-mem`) — no tocan la base de datos real. Los archivos `.ts` se compilan con `ts-jest`.

---

## Pipeline CI/CD

Cada push a `main` dispara el pipeline en GitHub Actions:

```
┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐
│    lint      │  │    test     │  │  secrets (Gitleaks)     │
│  ESLint +   │  │  Jest 69   │  │  Escanea historial git  │
│  Prettier   │  │  tests +   │  │  en busca de secretos   │
│             │  │  coverage  │  │  expuestos              │
└──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘
       │                │                      │
       └────────────────┴──────────────────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │       docker        │
                   │  Build imagen +    │
                   │  Trivy CVE scan    │
                   │  (HIGH/CRITICAL)   │
                   └──────────┬──────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │      Railway        │
                   │  Auto-deploy solo  │
                   │  si los 4 jobs     │
                   │  pasan ✅          │
                   └─────────────────────┘
```

- **lint** y **test** y **secrets** corren en paralelo
- **docker** solo corre si los tres anteriores pasan
- Railway despliega automáticamente al detectar el CI verde

---

## Arquitectura

```
HTTP Request
    ↓
Routes (src/routes/)
    ↓
Middleware (src/middleware/)      — JWT auth, Zod validation, error handler centralizado
    ↓
Controllers (src/controllers/)   — HTTP request/response, sin lógica de negocio
    ↓
Services (src/services/)         — Parseo CSV/PDF (TypeScript), comparación, Excel/PDF/IA
    ↓
Repositories (src/repositories/) — Queries PostgreSQL con pg pool
    ↓
Database (src/database/)         — Pool de conexiones + schema init
```

**Frontend React (client/):**

```
App.jsx (auth state)
    ↓
AppProvider (Context API — properties, currentReport)
    ↓
AppShell (consume Context — no puede estar en App.jsx)
    ├── Navbar
    ├── PropertyBar
    ├── Dashboard (Chart.js via useRef)
    ├── main
    │   ├── UploadSection
    │   ├── ReportResults
    │   └── MarketSection
    ├── HistoryDrawer
    └── AnalysisModal
```

---

## API

Documentación interactiva completa en `/api/docs` (Swagger UI).

### Auth — `/api/auth`

| Método | Endpoint             | Auth | Descripción                             |
| ------ | -------------------- | :--: | --------------------------------------- |
| POST   | `/api/auth/register` |  ✗   | Registro — devuelve httpOnly JWT cookie |
| POST   | `/api/auth/login`    |  ✗   | Login — devuelve httpOnly JWT cookie    |
| POST   | `/api/auth/logout`   |  ✗   | Cerrar sesión                           |
| GET    | `/api/auth/me`       |  ✓   | Perfil del usuario actual               |

### Propiedades — `/api/properties`

| Método | Endpoint                         | Auth | Descripción                       |
| ------ | -------------------------------- | :--: | --------------------------------- |
| GET    | `/api/properties`                |  ✓   | Listar propiedades del usuario    |
| POST   | `/api/properties`                |  ✓   | Crear propiedad                   |
| PUT    | `/api/properties/:id`            |  ✓   | Renombrar propiedad               |
| DELETE | `/api/properties/:id`            |  ✓   | Eliminar propiedad (requiere ≥ 2) |
| GET    | `/api/properties/combined/:year` |  ✓   | Reporte anual combinado           |

### Reportes — `/api/reports`

| Método | Endpoint                           | Auth | Descripción                             |
| ------ | ---------------------------------- | :--: | --------------------------------------- |
| POST   | `/api/reports/save`                |  ✓   | Guardar o sobreescribir reporte mensual |
| GET    | `/api/reports/list`                |  ✓   | Listar reportes guardados               |
| GET    | `/api/reports/:month`              |  ✓   | Reporte completo de un mes (`2026-02`)  |
| DELETE | `/api/reports/:month`              |  ✓   | Eliminar reporte de un mes              |
| GET    | `/api/reports/annual/:year`        |  ✓   | Descargar Excel anual                   |
| GET    | `/api/reports/dashboard/:year`     |  ✓   | Métricas del dashboard                  |
| GET    | `/api/reports/executive-pdf/:year` |  ✓   | PDF ejecutivo anual                     |
| POST   | `/api/reports/:month/analysis`     |  ✓   | Análisis IA del mes con Claude          |

### Crawler — `/api/crawler`

| Método | Endpoint                | Auth | Descripción                                            |
| ------ | ----------------------- | :--: | ------------------------------------------------------ |
| GET    | `/api/crawler/listings` |  ✓   | Scrapea Lamudi — listings actuales de Mérida           |
| POST   | `/api/crawler/analyze`  |  ✓   | Encola análisis de mercado con Claude (devuelve jobId) |

### Jobs — `/api/jobs`

| Método | Endpoint           | Auth | Descripción                        |
| ------ | ------------------ | :--: | ---------------------------------- |
| GET    | `/api/jobs/:jobId` |  ✓   | Estado del job asíncrono (polling) |

### Sistema

| Método | Endpoint    | Descripción                                      |
| ------ | ----------- | ------------------------------------------------ |
| GET    | `/health`   | Liveness probe — `{ status, uptime, timestamp }` |
| GET    | `/api/docs` | Swagger UI — referencia interactiva              |
