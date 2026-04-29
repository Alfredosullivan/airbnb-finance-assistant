# Airbnb Finance Assistant

App web full stack para reconciliar automáticamente reportes de Airbnb contra estados de cuenta BBVA México. Soporta múltiples propiedades, genera reportes Excel y PDF, incluye dashboard con gráficas, análisis IA con Claude y frontend React con Vite.

🔗 **Demo en vivo:** https://airbnb-finance-assistant-production.up.railway.app
> Credenciales de demo: `demo@practice.com` / `Demo1234!`

---

## Stack

| Capa | Tecnología |
|------|------------|
| Runtime | Node.js 20 |
| Framework | Express 5 |
| Lenguaje | TypeScript (migración incremental — servicios core) |
| Base de datos | PostgreSQL (via `pg`) |
| Auth | JWT en httpOnly cookie |
| Archivos | Multer — PDF y CSV |
| Reportes | ExcelJS, PDFKit |
| Frontend | React 19 + Vite 8 + Context API |
| Gráficas | Chart.js |
| IA | Claude API — Anthropic |
| Tests | Jest + ts-jest — 69 tests |
| Deploy | Railway (backend + PostgreSQL) |

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

| Variable | Descripción | Requerida |
|----------|-------------|-----------|
| `PORT` | Puerto del servidor | No (default: `3000`) |
| `DATABASE_URL` | Connection string de PostgreSQL | **Sí** |
| `JWT_SECRET` | Clave para firmar tokens JWT | **Sí** |
| `POSTGRES_USER` | Usuario de PostgreSQL (Docker) | **Sí (Docker)** |
| `POSTGRES_PASSWORD` | Contraseña de PostgreSQL (Docker) | **Sí (Docker)** |
| `POSTGRES_DB` | Nombre de la base de datos (Docker) | **Sí (Docker)** |
| `ALLOWED_ORIGINS` | Orígenes CORS permitidos | No (default: `http://localhost:3000`) |
| `MAX_FILE_SIZE_MB` | Tamaño máximo de archivos en MB | No (default: `10`) |
| `ANTHROPIC_API_KEY` | API key de Claude para análisis IA | No |

> Si `ANTHROPIC_API_KEY` no está definida, la app funciona normalmente — los botones de análisis IA quedan deshabilitados.

---

## Tests

```bash
npm test
```

| Suite | Archivo | Tests |
|-------|---------|------:|
| Integration — Auth | `tests/integration/auth.test.js` | 17 |
| Integration — Properties | `tests/integration/properties.test.js` | 13 |
| Unit — Comparator | `tests/unit/comparator.test.js` | 22 |
| Unit — Formatter | `tests/unit/formatter.test.js` | 17 |
| **Total** | | **69** |

Los tests corren contra PostgreSQL en memoria (`pg-mem`) — no tocan la base de datos real. Los archivos `.ts` se compilan con `ts-jest`.

---

## Arquitectura

```
HTTP Request
    ↓
Routes (src/routes/)
    ↓
Middleware (src/middleware/)      — JWT auth, error handler centralizado
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
| Método | Endpoint | Auth | Descripción |
|--------|----------|:----:|-------------|
| POST | `/api/auth/register` | ✗ | Registro — devuelve httpOnly JWT cookie |
| POST | `/api/auth/login` | ✗ | Login — devuelve httpOnly JWT cookie |
| POST | `/api/auth/logout` | ✗ | Cerrar sesión |
| GET | `/api/auth/me` | ✓ | Perfil del usuario actual |

### Propiedades — `/api/properties`
| Método | Endpoint | Auth | Descripción |
|--------|----------|:----:|-------------|
| GET | `/api/properties` | ✓ | Listar propiedades del usuario |
| POST | `/api/properties` | ✓ | Crear propiedad |
| PUT | `/api/properties/:id` | ✓ | Renombrar propiedad |
| DELETE | `/api/properties/:id` | ✓ | Eliminar propiedad (requiere ≥ 2) |
| GET | `/api/properties/combined/:year` | ✓ | Reporte anual combinado |

### Reportes — `/api/reports`
| Método | Endpoint | Auth | Descripción |
|--------|----------|:----:|-------------|
| POST | `/api/reports/save` | ✓ | Guardar o sobreescribir reporte mensual |
| GET | `/api/reports/list` | ✓ | Listar reportes guardados |
| GET | `/api/reports/:month` | ✓ | Reporte completo de un mes (`2026-02`) |
| DELETE | `/api/reports/:month` | ✓ | Eliminar reporte de un mes |
| GET | `/api/reports/annual/:year` | ✓ | Descargar Excel anual |
| GET | `/api/reports/dashboard/:year` | ✓ | Métricas del dashboard |
| GET | `/api/reports/executive-pdf/:year` | ✓ | PDF ejecutivo anual |
| POST | `/api/reports/:month/analysis` | ✓ | Análisis IA del mes con Claude |

### Crawler — `/api/crawler`
| Método | Endpoint | Auth | Descripción |
|--------|----------|:----:|-------------|
| GET | `/api/crawler/listings` | ✓ | Scrapea Lamudi — listings actuales de Mérida |
| POST | `/api/crawler/analyze` | ✓ | Encola análisis de mercado con Claude (devuelve jobId) |

### Jobs — `/api/jobs`
| Método | Endpoint | Auth | Descripción |
|--------|----------|:----:|-------------|
| GET | `/api/jobs/:jobId` | ✓ | Estado del job asíncrono (polling) |

### Sistema
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/health` | Liveness probe — `{ status, uptime, timestamp }` |
| GET | `/api/docs` | Swagger UI — referencia interactiva |
