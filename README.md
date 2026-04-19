# Airbnb Finance Assistant

App web full stack para reconciliar automáticamente reportes de Airbnb contra estados de cuenta BBVA México. Soporta múltiples propiedades, genera reportes Excel y PDF, y opcionalmente integra análisis IA con Claude (Anthropic).

🔗 **Demo en vivo:** https://airbnb-finance-assistant-production.up.railway.app
> Credenciales de demo: `demo@practice.com` / `Demo1234!`

---

## Stack

| Capa | Tecnología |
|------|------------|
| Runtime | Node.js 20 |
| Framework | Express 4 |
| Base de datos | PostgreSQL (via `pg`) |
| Auth | JWT en httpOnly cookie |
| Archivos | Multer — PDF y CSV |
| Reportes | ExcelJS, PDFKit |
| IA (opcional) | Claude API — Anthropic |
| Tests | Jest + Supertest — 69 tests |
| Deploy | Railway (backend + PostgreSQL) |

---

## Características

- **Reconciliación automática** de reportes Airbnb (CSV/PDF) contra estados de cuenta BBVA (PDF)
- **Soporte multi-propiedad** — gestiona varias propiedades por usuario
- **Historial mensual** de reportes guardados con filtros por tipo
- **Dashboard anual** con métricas agregadas (Chart.js)
- **Exportación** a Excel (.xlsx) y PDF ejecutivo
- **Análisis IA** con Claude — resumen financiero inteligente por mes (requiere `ANTHROPIC_API_KEY`)
- **Swagger UI** en `/api/docs` — documentación interactiva de todos los endpoints
- **69 tests** — unitarios y de integración con PostgreSQL en memoria (`pg-mem`)

---

## Instalación local

**Requisitos previos:**
- Node.js ≥ 18.x
- PostgreSQL 14+ (local o via Docker)

```bash
# 1. Clonar el repositorio
git clone https://github.com/Alfredosullivan/airbnb-finance-assistant.git
cd airbnb-finance-assistant

# 2. Instalar dependencias
npm install

# 3. Crear archivo de entorno
cp .env.example .env
# Edita .env con tus valores

# 4. Iniciar en desarrollo
npm run dev
```

Abre `http://localhost:3000` en el navegador.

---

## Instalación con Docker

El proyecto incluye `docker-compose.yml` que levanta la app y PostgreSQL con un solo comando:

```bash
cp .env.example .env
# En .env cambia el host de DATABASE_URL a "db":
# DATABASE_URL=postgresql://postgres:password@db:5432/finance_db

docker compose up -d
docker compose logs -f app
```

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
| `ALLOWED_ORIGINS` | Orígenes CORS permitidos (separados por coma) | No (default: `http://localhost:3000`) |
| `MAX_FILE_SIZE_MB` | Tamaño máximo de archivos subidos en MB | No (default: `10`) |
| `ANTHROPIC_API_KEY` | API key de Claude para análisis IA | No |

> Si `ANTHROPIC_API_KEY` no está definida, la app funciona normalmente — solo los botones de análisis IA quedan deshabilitados.

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

Los tests corren contra PostgreSQL en memoria (`pg-mem`) — no tocan la base de datos real.

---

## Arquitectura

El proyecto sigue **Clean Architecture** con separación estricta de capas:

```
HTTP Request
    ↓
Routes (src/routes/)
    ↓
Middleware (src/middleware/)      — JWT auth, rate limiting, error handler
    ↓
Controllers (src/controllers/)   — HTTP request/response, sin lógica de negocio
    ↓
Services (src/services/)         — Parseo CSV/PDF, comparación, Excel/PDF/IA
    ↓
Repositories (src/repositories/) — Queries PostgreSQL con pg pool
    ↓
Database (src/database/)         — Pool de conexiones + schema init async
```

| Capa | Ruta | Responsabilidad |
|------|------|-----------------|
| Routes | `src/routes/` | Definir URLs, aplicar middleware por ruta |
| Middleware | `src/middleware/` | `requireAuth` (JWT cookie), `errorHandler` centralizado |
| Controllers | `src/controllers/` | Parsear request, llamar services, enviar response |
| Services | `src/services/` | Parseo CSV/PDF, comparación, generación Excel/PDF/IA |
| Repositories | `src/repositories/` | CRUD async via `pg` pool para `users`, `properties`, `reports` |
| Database | `src/database/` | Pool `pg` (`client.js`) + `schema.js` crea tablas al arrancar |

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
| POST | `/api/reports/:month/analysis/pdf` | ✓ | Descargar análisis IA como PDF |

### Sistema
| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/health` | Liveness probe — `{ status, uptime, timestamp }` |
| GET | `/api/docs` | Swagger UI — referencia interactiva |
