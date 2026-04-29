// index.js — Entry point de la aplicación
// Inicializa Express, la base de datos y monta todas las rutas de la API

require('dotenv').config();

const express        = require('express');
const helmet         = require('helmet');
const cors           = require('cors');
const cookieParser   = require('cookie-parser');
const path           = require('path');
const swaggerUi      = require('swagger-ui-express');
const { PORT }       = require('./config');
const { initSchema } = require('./src/database/schema');
const swaggerSpec       = require('./src/config/swagger');
const financeRoutes     = require('./src/routes/finance.routes');
const authRoutes        = require('./src/routes/auth.routes');
const reportsRoutes     = require('./src/routes/reports.routes');
const propertiesRoutes  = require('./src/routes/properties.routes');
const { errorHandler }  = require('./src/middleware/errorHandler');
const { initScheduler } = require('./src/scheduler');
const { initQueue }     = require('./src/queue');
const jobsRoutes        = require('./src/routes/jobs.routes');
const crawlerRoutes     = require('./src/routes/crawler.routes');

const app = express();

// Avisar si falta la API key de Anthropic (análisis IA no disponible)
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[config] ANTHROPIC_API_KEY no definida — análisis IA no disponible (ver .env.example)');
}

// Cabeceras de seguridad HTTP (XSS, clickjacking, MIME sniffing, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "https://cdnjs.cloudflare.com"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],  // ← agrega esta línea
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com"
      ],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  }
}));

// Habilitar CORS solo para el origen del frontend (no wildcard en producción)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

// Parsear cookies (necesario para leer el JWT de sesión)
app.use(cookieParser());

// Parsear cuerpos JSON
app.use(express.json());

// Servir archivos estáticos del frontend (HTML, CSS, JS del cliente)
app.use(express.static(path.join(__dirname, '..', 'client', 'dist')));

// ── Rutas de la API ────────────────────────────────────────────

// Rutas de finanzas (upload + reporte comparativo)
app.use('/api', financeRoutes);

// Rutas de autenticación de usuarios
app.use('/api/auth', authRoutes);

// Rutas del historial de reportes guardados
app.use('/api/reports', reportsRoutes);

// Rutas de consulta y descarga de jobs en background
app.use('/api/jobs', jobsRoutes);

// Rutas de gestión de propiedades
app.use('/api/properties', propertiesRoutes);

// Rutas del crawler de precios de rentas en Mérida
app.use('/api/crawler', crawlerRoutes);

// GET /api/docs — Swagger UI (interactive API reference, no auth required)
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Airbnb Finance Assistant — API Docs',
}));

// GET /health — Liveness / readiness probe (no auth, no API prefix)
app.get('/health', (_req, res) => {
  res.json({
    status:    'ok',
    uptime:    process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// Manejo de rutas no encontradas en la API
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Catch-all para React Router — sirve index.html para cualquier ruta no-API
// Si se agrega React Router en el futuro, las rutas del cliente funcionarán sin 404
app.get('/{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'dist', 'index.html'));
});

// Middleware centralizado de errores — debe ir DESPUÉS de todas las rutas
app.use(errorHandler);

// Inicializar esquema y arrancar el servidor.
// initSchema() es async (usa PostgreSQL) — esperamos a que las tablas existan
// antes de aceptar conexiones para evitar errores de "tabla no encontrada" en el arranque.
initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor corriendo en http://localhost:${PORT}`);
      // Iniciamos scheduler y queue después de que el servidor esté listo y la
      // base de datos inicializada — así los jobs tienen pool disponible
      // desde el primer disparo.
      initScheduler();
      initQueue();
    });
  })
  .catch(err => {
    console.error('[DB] Error al inicializar el esquema:', err.message);
    process.exit(1);
  });
