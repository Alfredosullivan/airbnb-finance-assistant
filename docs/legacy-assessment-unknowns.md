# Unknowns Resolution

**Proyecto:** airbnb-finance-assistant  
**Fecha:** 2026-08-28  
**Rama:** refactor/sdd-migration  
**Objetivo:** Resolver mediante evidencia directa del código las preguntas abiertas del Legacy Assessment  
**Alcance:** Solo lectura — ningún archivo de aplicación fue modificado

---

## Q-01

**¿DELETE `/api/properties/:id` realmente bloquea el delete si existen reportes asociados?**

### Archivos inspeccionados

- `src/controllers/properties.controller.js` (líneas 77–106)
- `src/repositories/ReportRepository.js` (método `countByProperty`)

### Evidence

`deleteProperty` en `properties.controller.js` ejecuta dos verificaciones explícitas antes de permitir el delete:

**Verificación 1 — propiedad única:**

```javascript
// líneas 86-88
if ((await PropRepo.countByUser(userId)) <= 1) {
  return res.status(400).json({ error: 'No puedes eliminar la única propiedad' });
}
```

**Verificación 2 — reportes asociados:**

```javascript
// líneas 91-96
const reportes = await ReportRepo.countByProperty(id);
if (reportes > 0) {
  return res.status(400).json({
    error: `No se puede eliminar "${prop.name}": tiene ${reportes} reporte${reportes !== 1 ? 's' : ''} guardado${reportes !== 1 ? 's' : ''}. Elimina primero todos sus reportes.`,
  });
}
```

El `ON DELETE CASCADE` del schema de PostgreSQL **nunca se alcanza** para el caso de propiedad con reportes, porque el controller lo intercepta primero con un 400.

### Conclusion

**RESUELTO.** El endpoint SÍ bloquea el delete cuando existen reportes. Devuelve HTTP 400 con mensaje explícito indicando cuántos reportes hay. El usuario debe eliminar manualmente todos los reportes antes de poder eliminar la propiedad. La ambigüedad original estaba causada por el CASCADE DELETE en la DB, que existe pero nunca se activa por esta ruta.

### Confidence

**HIGH**

---

## Q-02

**¿`secure: false` en la cookie fue intencional para producción o es un comportamiento heredado del desarrollo?**

### Archivos inspeccionados

- `src/controllers/auth.controller.js` (líneas 12–17)

### Evidence

```javascript
// líneas 12-17
const COOKIE_OPTS = {
  httpOnly: true, // No accesible desde JS del cliente (protección XSS)
  secure: false, // false en desarrollo (sin HTTPS)
  sameSite: 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días en milisegundos
};
```

Observaciones clave:

1. El comentario `// false en desarrollo (sin HTTPS)` **documenta que es una decisión de dev**, no un olvido.
2. No existe ninguna lógica condicional que cambie `secure` según `NODE_ENV`:
   ```javascript
   // Esto NO existe en el código:
   secure: process.env.NODE_ENV === 'production';
   ```
3. `COOKIE_OPTS` es un objeto estático definido a nivel de módulo. El mismo objeto se usa en `register()`, `login()` y es referenciado por `getToken()`.

### Conclusion

**RESUELTO PARCIALMENTE.** El valor `secure: false` está documentado en el código como una decisión de desarrollo. Sin embargo, **no existe ningún mecanismo que lo cambie a `true` en producción**. El código llega a Railway con `secure: false` hardcodeado. En la práctica, Railway sirve la app sobre HTTPS, y la mayoría de los browsers modernos (Chrome, Safari) con `SameSite: lax` y HTTPS **aún envían cookies con `secure: false`**, por lo que el login puede funcionar en producción. Sin embargo, es técnicamente incorrecto para un entorno HTTPS. La clasificación precisa es: **decisión documentada de desarrollo, nunca actualizada para producción.**

### Confidence

**HIGH**

---

## Q-03

**¿Los scheduled jobs alguna vez tuvieron lógica real o son actualmente solamente esqueletos?**

### Archivos inspeccionados

- `src/scheduler/jobs/monthlyReport.job.js`
- `src/scheduler/jobs/weeklyOccupancy.job.js`
- `src/scheduler/jobs/annualSummary.job.js`
- `src/scheduler/index.js`

### Evidence

Los tres jobs ejecutan **queries reales a PostgreSQL**. No son esqueletos vacíos.

**monthlyReport.job.js** (corre el día 1 de cada mes a las 09:00):

```javascript
const { rows } = await pool.query(
  `SELECT user_id, COUNT(*) AS total
     FROM reports
    WHERE month LIKE $1
    GROUP BY user_id`,
  [`${prevMonth}%`]
);
// → itera rows y hace log de actividad por usuario
```

**weeklyOccupancy.job.js** (corre cada lunes a las 08:00):

```javascript
const { rows } = await pool.query(
  `SELECT property_id, COUNT(*) AS total_reportes, MAX(month) AS mes_mas_reciente
     FROM reports WHERE created_at >= $1
    GROUP BY property_id ORDER BY total_reportes DESC`,
  [cutoffDate]
);
// → itera rows y hace log de actividad por propiedad
```

**annualSummary.job.js** (corre el 1 de enero a las 07:00):

```javascript
// Query 1: total de reportes por usuario en el año anterior
const { rows: byUser } = await pool.query(
  `SELECT u.email, COUNT(r.id) AS total_reportes FROM reports r
   JOIN users u ON u.id = r.user_id WHERE r.month LIKE $1
   GROUP BY u.email ORDER BY total_reportes DESC`,
  [`${previousYear}-%`]
);
// Query 2: total de reportes por propiedad
const { rows: byProp } = await pool.query(
  `SELECT p.name, COUNT(r.id), u.email FROM reports r
   JOIN properties p ON p.id = r.property_id
   JOIN users u ON u.id = r.user_id WHERE r.month LIKE $1
   GROUP BY p.name, u.email ORDER BY total_reportes DESC`,
  [`${previousYear}-%`]
);
```

Los TODOs (`// TODO: Conectar con servicio de notificaciones`) documentan funcionalidad **futura**, no ausente. La funcionalidad **presente** es: consultar la DB, procesar resultados y hacer log estructurado.

### Conclusion

**RESUELTO.** Los jobs tienen lógica real desde su implementación inicial. Ejecutan queries SQL reales contra PostgreSQL y procesan resultados. La auditoría original los describió como "esqueletos con TODOs" — esto es incorrecto. Son jobs **funcionales pero incompletos**: tienen la fase de observabilidad (query + log) pero les falta la fase de acción (enviar notificaciones, generar Excel automáticamente). Los TODOs marcan la segunda fase, que nunca fue implementada.

### Confidence

**HIGH**

---

## Q-04

**¿El PDF parser soporta solamente BBVA México o existe soporte para otros bancos?**

### Archivos inspeccionados

- `src/services/pdfParser.js` (completo)
- `src/routes/finance.routes.js`

### Evidence

El archivo `pdfParser.js` expone exactamente dos funciones: `parseBankPDF` y `parseAirbnbPDF`.

**`parseBankPDF` — codificada específicamente para BBVA México:**

```javascript
// Regex hardcodeados para el formato BBVA:
const periodoMatch = text.match(/PeriodoDEL\s+(\d{2}\/\d{2}\/\d{4})\s+AL\s+(\d{2}\/\d{2}\/\d{4})/);
const cuentaMatch = text.match(/No\.\s*de\s*Cuenta\s*(\d+)/);

// Mapa de meses en español (BBVA usa estas abreviaturas exactas):
const MES_MAP = { ENE: '01', FEB: '02', MAR: '03', ABR: '04', ... };

// Filtros de Airbnb hardcodeados para canales conocidos de BBVA:
const DESCRIPCIONES_AIRBNB = ['SPEI RECIBIDO', 'DEPOSITO DE TERCERO API'];

// El resultado incluye:
return { ..., source: 'bbva_pdf' };
```

No existe ningún selector de banco, ningún `if/else` por tipo de banco, ningún módulo `parsers/` con parsers alternativos.

**`parseAirbnbPDF` — stub con datos de ejemplo hardcodeados:**

```javascript
// TODO: Airbnb no tiene un formato PDF estándar. Implementar cuando
// se identifique la estructura exacta del PDF de reporte de Airbnb.
// Por ahora usar el CSV que es más confiable y estructurado.
async function parseAirbnbPDF(_filePath) {
  // Retorna datos de ejemplo (HMX12345, HMX12346) — NO parsea el archivo real
  return { ..., source: 'airbnb_pdf_stub' };
}
```

### Conclusion

**RESUELTO.** El sistema soporta **exactamente un banco: BBVA México**, con el formato específico detectado hasta noviembre 2025. No existen parsers para ningún otro banco. Adicionalmente, el parser de PDF de Airbnb es un **stub** que devuelve datos ficticios de ejemplo — nunca parsea el archivo real. Para datos reales de Airbnb, el sistema requiere el CSV.

### Confidence

**HIGH**

---

## Q-05

**¿`config.js` es realmente utilizado como fuente de configuración o existe una fuente diferente?**

### Archivos inspeccionados

- `config.js` (raíz del proyecto)
- `src/routes/finance.routes.js` (línea 8)
- `src/controllers/auth.controller.js`
- `src/services/analysisGenerator.js`
- `index.js`

### Evidence

**`config.js` es importado en exactamente un lugar:**

```javascript
// finance.routes.js — línea 8
const { UPLOADS_DIR, MAX_FILE_SIZE_BYTES } = require('../../config');
```

Exporta 5 valores: `PORT`, `UPLOADS_DIR`, `MAX_FILE_SIZE_MB`, `MAX_FILE_SIZE_BYTES` (getter), `ALLOWED_MIME_TYPES`.

**El resto de la configuración se lee directamente de `process.env`** en los archivos que la necesitan:

```javascript
// auth.controller.js
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_local';

// report.controller.js
if (process.env.ANTHROPIC_API_KEY) { ... }

// index.js
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS;
```

**Valores en `config.js` que duplican lo que lee `index.js` directamente:**

- `config.PORT` = `process.env.PORT || 3000` → `index.js` lee `process.env.PORT` por separado sin importar `config.js`
- `config.ALLOWED_MIME_TYPES` → nunca importado fuera de `config.js` (definido pero no usado en la validación real, que está en `finance.routes.js`)

### Conclusion

**RESUELTO.** `config.js` es una fuente de configuración **parcial y no centralizada**. Solo es importado activamente para `UPLOADS_DIR` y `MAX_FILE_SIZE_BYTES` en `finance.routes.js`. Las variables más críticas (`JWT_SECRET`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `ALLOWED_ORIGINS`) se leen directamente de `process.env` en los archivos que las usan, sin pasar por `config.js`. Existen **dos fuentes de verdad en paralelo**: `config.js` y `process.env` directo.

### Confidence

**HIGH**

---

## Q-06

**¿Los scripts dentro de `bin/` son utilizados activamente?**

### Archivos inspeccionados

- `bin/airbnb-cli.js` (completo, 539 líneas)
- `public/index.html` (menciona Swagger como fuente del token)

### Evidence

`bin/airbnb-cli.js` es un CLI completo con 7 comandos implementados:

| Comando          | Funcionalidad                      | Endpoint consumido                               |
| ---------------- | ---------------------------------- | ------------------------------------------------ |
| `login`          | Configura baseUrl                  | —                                                |
| `set-token`      | Guarda JWT en `~/.airbnb-cli.json` | —                                                |
| `stats --month=` | Reporte de un mes                  | GET /api/reports/:month                          |
| `stats --year=`  | Resumen anual                      | GET /api/reports/list                            |
| `properties`     | Lista propiedades                  | GET /api/properties                              |
| `market`         | Análisis de mercado con polling    | POST /api/crawler/analyze + GET /api/jobs/:jobId |
| `jobs`           | Información sobre background jobs  | — (solo info)                                    |

El CLI usa **únicamente módulos nativos de Node.js** (`http`, `https`, `fs`, `path`, `readline`, `os`) — sin dependencias extra. Guarda config en `~/.airbnb-cli.json`.

**Evidencia de diseño activo**: el CLI implementa polling (3s interval) para el comando `market`, manejo de errores `ECONNREFUSED`/`ENOTFOUND`, validación de formato `YYYY-MM` para `--month`, y colores ANSI para output. Esto indica que fue construido y probado, no abandonado.

**Lo que NO se puede determinar**: si Carlos lo usa regularmente en su flujo de trabajo actual, o si quedó como una herramienta construida pero no adoptada.

### Conclusion

**RESUELTO PARCIALMENTE.** El CLI está completamente implementado y funcional. Consume endpoints reales de la API con Bearer token. **Si fue usado activamente en el pasado no puede determinarse solo con el código**. Lo que sí es observable: el CLI está correctamente integrado con la API del sistema (los endpoints que consume existen y están documentados). No aparece en el `.gitignore`, `package.json` `scripts`, ni en ningún README como flujo primario — sugiere que es una herramienta auxiliar, no el flujo principal del producto.

### Confidence

**MEDIUM** (sobre la implementación: HIGH; sobre uso activo: UNKNOWN)

---

## Q-07

**¿El sistema actual fue diseñado para soportar múltiples usuarios concurrentes?**

### Archivos inspeccionados

- `src/controllers/upload.controller.js` (líneas 17–24, 143)
- `src/controllers/report.controller.js` (líneas 5–6, 74–80)
- `src/repositories/UserRepository.js`, `PropertyRepository.js`, `ReportRepository.js`

### Evidence

**La DB y los repositories SÍ son multi-usuario por diseño:**

- Todas las queries de `PropertyRepository` y `ReportRepository` filtran por `userId`
- El schema tiene `user_id` como FK en todas las tablas relacionadas
- `requireAuth` middleware asegura que `req.user.userId` esté disponible en endpoints protegidos

**El módulo de upload EXPLÍCITAMENTE NO soporta múltiples usuarios concurrentes:**

```javascript
// upload.controller.js — líneas 17-24
// El propio código documenta la limitación:
const store = {
  airbnbPath: null,
  airbnbFileType: null,
  bankPaths: [],
  reportData: null,
};
// ...
// Exportar también el store para que el report controller pueda leer las rutas
module.exports = { uploadAirbnb, uploadBank, resetReport, store };
```

El comentario en el código original dice:

```javascript
// Almacén en memoria de las rutas de los PDFs y el último reporte generado.
// En una versión con múltiples usuarios se reemplazaría por sesiones o una BD.
```

Este `store` es un **singleton de módulo**: una sola instancia compartida por todos los workers del proceso Node.js. Cualquier request que modifique `store.airbnbPath` afecta inmediatamente a todos los requests concurrentes que lean `store.airbnbPath`.

`report.controller.js` importa directamente el mismo objeto:

```javascript
// línea 5-6
const { store } = require('./upload.controller');
```

### Conclusion

**RESUELTO.** El sistema fue diseñado con **arquitectura mixta**:

- La capa de **persistencia (DB)** soporta múltiples usuarios correctamente.
- La capa de **procesamiento de archivos (upload + report)** fue diseñada explícitamente para un solo usuario a la vez. El código mismo lo documenta como limitación conocida.

**Técnicamente: el sistema NO soporta múltiples usuarios concurrentes** en el flujo de upload → reporte. Con dos usuarios simultáneos en ese flujo, los datos se mezclan.

### Confidence

**HIGH**

---

## Q-08

**¿La Anthropic API key almacenada en `.env` local aparece en algún lugar del repositorio, historial git o configuración de deployment?**

> IMPORTANTE: No se muestran secretos, keys, passwords ni credentials en esta respuesta.

### Archivos inspeccionados

- `.gitignore`
- Historial de git: `git log --all --oneline -- ".env"`
- `.env.example`
- `src/config/swagger.js`, `index.js`
- `.github/workflows/ci.yml`

### Evidence

**`.gitignore` incluye `.env`:**

```
.env
```

**Historial de git — sin evidencia de commit:**
El comando `git log --all --oneline -- ".env"` retornó **vacío** — el archivo `.env` nunca fue commiteado al repositorio.

**`.env.example` NO contiene el valor real:**
Contiene solo el nombre de la variable con valor vacío o de placeholder. No hay keys reales.

**El workflow de CI (`.github/workflows/ci.yml`) no contiene referencias a la API key real.** Usa `${{ secrets.X }}` o simplemente no usa la variable — el análisis de IA no se ejecuta en CI.

**El código fuente referencia `process.env.ANTHROPIC_API_KEY` sin hardcodear el valor:**

```javascript
// report.controller.js
if (process.env.ANTHROPIC_API_KEY) { ... }
```

### Conclusion

**RESUELTO.** No existe evidencia de exposición de la API key en el repositorio git, en el historial de commits, ni en los archivos de configuración de deployment. El archivo `.env` local existe en disco pero está correctamente excluido de git. El riesgo documentado en el Legacy Assessment era un **riesgo local** (acceso físico al disco), no de exposición pública.

### Confidence

**HIGH**

---

## Q-09

**¿Existe documentación, fixtures, tests o ejemplos que permitan determinar los formatos esperados de CSV/PDF de Airbnb y BBVA?**

### Archivos inspeccionados

- `src/services/csvParser.js` (líneas 9–52)
- `src/services/pdfParser.js` (líneas 24–43, 109–147)
- `tests/` (todos los archivos)
- `uploads/` (22 archivos CSV reales detectados)

### Evidence

**Para el CSV de Airbnb — documentación en el código:**

`csvParser.js` define el mapa exacto de columnas en un objeto constante:

```javascript
const COL = {
  FECHA: 'Fecha',
  TIPO: 'Tipo',
  COD_CONFIRMACION: 'Código de confirmación',
  COD_REFERENCIA: 'Código de referencia',
  FECHA_INICIO: 'Fecha de inicio',
  FECHA_FIN: 'Fecha de finalización',
  NOCHES: 'Noches',
  HUESPED: 'Huésped',
  ESPACIO: 'Espacio',
  MONEDA: 'Moneda',
  MONTO: 'Monto',
  INGRESOS_REC: 'Ingresos recibidos',
  TARIFA_SERVICIO: 'Tarifa de servicio',
  TARIFA_LIMPIEZA: 'Tarifa de limpieza',
  INGRESOS_BRUTOS: 'Ingresos brutos',
  ANNO_INGRESOS: 'Año de ingresos',
};
```

Y los tipos de fila esperados:

```javascript
const TIPO_PAYOUT = 'Payout';
const TIPO_RESERVACION = 'Reservación';
const TIPO_ISR = 'Retención del impuesto sobre la renta';
const TIPO_IVA = 'Retención del IVA en México';
```

**Para el PDF de BBVA — documentación en comentarios del código:**

`pdfParser.js` incluye un ejemplo de formato real con anotaciones:

```
// Formato REAL del texto extraído por pdf-parse de BBVA México:
//   Línea 1: DD/MESDD/MES        ← dos fechas PEGADAS sin espacio
//   Línea 2: DESCRIPCION         ← texto libre
//   Línea 3: MONTO[SALDO][SALDO] ← números concatenados sin espacio
//   Línea 4: REF Referencia ID
//
// Ejemplo real:
//   13/ENE13/ENE
//   SPEI RECIBIDOARCUS FI
//   2,089.45
//   6586510576586510 Referencia 0167769794 706
//   Dlocal MX
```

**Archivos reales en `uploads/`:**  
Existen 22 archivos CSV reales (nombrados con timestamp). Estos son datos reales del usuario, no fixtures de test.

**Tests — NO contienen fixtures de formato:**  
Los tests de `tests/integration/` y `tests/unit/` no incluyen archivos CSV/PDF de ejemplo. No existe un directorio `tests/fixtures/` con datos de muestra.

### Conclusion

**RESUELTO PARCIALMENTE.** El formato de ambos archivos está documentado, pero de formas diferentes:

- **CSV de Airbnb:** completamente determinable mediante las constantes `COL` en `csvParser.js` — se puede escribir un fixture de test perfectamente con ese mapa.
- **BBVA PDF:** el patrón real está documentado en comentarios de código con un ejemplo real — se puede crear un fixture sintético.
- **No existen fixtures formales de test** para ninguno de los dos formatos.
- **Los archivos reales en `uploads/` son datos de producción del usuario**, no fixtures de test — no deben usarse como fixtures sin anonimización.

### Confidence

**HIGH** (sobre qué se puede determinar del código); **LOW** (sobre si los formatos son estables — pueden cambiar si Airbnb/BBVA actualizan sus exports)

---

## Q-10

**¿`public/` y la landing page estática forman parte del flujo real del producto o parecen código separado/legacy?**

### Archivos inspeccionados

- `public/index.html` (1599 líneas)
- `public/style.css`
- `public/app.html`
- `public/app.js`
- `index.js` (cómo se sirven los archivos estáticos)

### Evidence

`public/index.html` es una **página portfolio** del proyecto, no la UI del producto:

- Título: "Airbnb Finance Assistant — Portfolio"
- Contiene stats del proyecto: "69 Tests", "Claude AI", "4 Jobs CI/CD"
- CTA primario: `<a href="/app">Ver Demo</a>` → apunta a la React app
- CTA secundario: enlace al repositorio en GitHub
- Footer: "Alfredo Sullivan — Full Stack Developer — Mérida, Yucatán"

La landing page está activa en producción: `index.js` sirve `public/` como archivos estáticos y Express enruta `GET /` a esta página.

`public/app.html` + `public/app.js` + `public/style.css` — son la **versión anterior Vanilla JS** de la aplicación. Estos archivos existían antes de la migración a React + Vite. El route `/app` en `index.js` sirve `client/dist/index.html` (la React app), pero `public/app.html` sigue existiendo en disco.

**Discrepancias encontradas en `public/index.html`** que sugieren que esta página no es actualizada sincronizada con el código real:

- Menciona "Prisma ORM" en los stack tags → el proyecto usa SQL directo con `pg`, no Prisma
- Menciona "Puppeteer" → no existe en `package.json`
- Menciona "Vercel" → no hay configuración de Vercel en el repo; el deploy es en Railway
- Describe "access tokens de 15 min y refresh tokens de 7 días" → el código solo implementa un token de 7 días

### Conclusion

**RESUELTO.** `public/index.html` es una **página portfolio/landing** activa en producción, integrada al producto como punto de entrada (`GET /`). Es parte del flujo del producto pero con contenido desactualizado respecto al stack real. `public/app.html` y `public/app.js` son la versión Vanilla JS legacy del frontend, desplazada por la app React en `client/` pero aún presente en disco.

### Confidence

**HIGH**

---

## Q-11

**¿Los endpoints identificados como públicos realmente pueden acceder a datos pertenecientes a otro usuario?**

### Archivos inspeccionados

- `src/routes/finance.routes.js`
- `src/controllers/upload.controller.js`
- `src/controllers/report.controller.js`

### Evidence

Los endpoints sin `requireAuth` son:

```
POST /api/upload/airbnb
POST /api/upload/bank
GET  /api/report
POST /api/reset
```

**Estos endpoints NO acceden a la base de datos de usuarios.** No hay `SELECT` de la tabla `users`, `properties`, ni `reports` en el flujo de upload → report. La única "base de datos" que usan es el `store` en memoria.

**Sin embargo, el `store` es compartido entre TODOS los usuarios del sistema:**

```javascript
// upload.controller.js — exportado y compartido
const store = {
  airbnbPath: null,
  bankPaths: [],
  reportData: null,
};

module.exports = { uploadAirbnb, uploadBank, resetReport, store };
```

**Escenario de contaminación real:**

| Tiempo | Usuario A               | Usuario B             | Estado del store                                    |
| ------ | ----------------------- | --------------------- | --------------------------------------------------- |
| t=0    | POST /api/upload/airbnb | —                     | `airbnbPath = 'uploads/A-airbnb.csv'`               |
| t=1    | —                       | POST /api/upload/bank | `bankPaths = ['uploads/B-bank.pdf']`                |
| t=2    | GET /api/report         | —                     | Usa A-airbnb.csv + B-bank.pdf → **datos mezclados** |
| t=3    | —                       | GET /api/report       | Ve el mismo resultado contaminado                   |

**Un usuario anónimo puede ver el reporte más reciente de otro usuario** simplemente haciendo `GET /api/report` sin autenticarse.

### Conclusion

**RESUELTO.** Los endpoints públicos no acceden a datos propietarios **de la DB**, pero **sí comparten un store en memoria global**. Técnicamente, un usuario puede ver el reporte que otro usuario generó. No hay datos históricos de la DB expuestos, pero los datos temporales en proceso SÍ pueden ser vistos o contaminados por cualquier petición concurrente anónima. Esto es un **riesgo de privacidad real** en el flujo principal del producto.

### Confidence

**HIGH**

---

## Q-12

**¿El global store de `upload.controller.js` puede provocar contaminación de datos entre usuarios concurrentes?**

### Archivos inspeccionados

- `src/controllers/upload.controller.js` (completo)
- `src/controllers/report.controller.js` (líneas 1–6, 72–133)

### Evidence

**El store es un objeto de módulo — singleton por proceso:**

```javascript
// upload.controller.js
const store = {
  airbnbPath: null,
  airbnbFileType: null,
  bankPaths: [],
  reportData: null,
};
```

Node.js cachea módulos en `require.cache` — el mismo objeto `store` es la misma referencia en memoria para **cualquier módulo que haga `require('./upload.controller')`**.

**`report.controller.js` lee directamente del mismo objeto:**

```javascript
const { store } = require('./upload.controller');
// ...
const { airbnbData, compareResult } = store; // lee el store global
```

**El código mismo documenta esta limitación:**

```javascript
// Almacén en memoria de las rutas de los PDFs y el último reporte generado.
// En una versión con múltiples usuarios se reemplazaría por sesiones o una BD.
```

**Análisis de caso real de contaminación:**

```
Usuario A: uploadAirbnb → store.airbnbPath = '/uploads/A.csv'
Usuario B: uploadBank   → store.bankPaths  = ['/uploads/B.pdf']
Usuario A: getReport    → parsea A.csv + B.pdf → resultado incorrecto para A
           store.reportData = resultado_contaminado
Usuario B: getReport    → recibe el mismo resultado_contaminado
```

Además:

- `resetReport` limpia el store de TODOS los usuarios simultáneamente
- `queueExcelGeneration` hace una snapshot del store al momento de encolar — pero si el store ya fue contaminado, la snapshot hereda los datos incorrectos

### Conclusion

**RESUELTO.** Sí, el store **puede y provoca** contaminación de datos entre usuarios concurrentes. No es un riesgo teórico: con dos usuarios en el flujo simultáneamente, **los archivos de un usuario se mezclan con los archivos del otro**. El propio código documenta esto. Para el caso de uso actual (un solo usuario activo a la vez) no se manifiesta, pero no es seguro en producción con más de un usuario.

### Confidence

**HIGH**

---

## Q-13

**¿Existe alguna protección contra un usuario accediendo directamente a un reporte/property/job perteneciente a otro usuario?**

### Archivos inspeccionados

- `src/controllers/properties.controller.js`
- `src/controllers/reports.controller.js` (primeras 100 líneas)
- `src/controllers/jobs.controller.js`
- `src/repositories/PropertyRepository.js`
- `src/repositories/ReportRepository.js`

### Evidence

**Properties — PROTEGIDO:**

Todas las operaciones en `properties.controller.js` usan:

```javascript
const prop = await PropRepo.findByIdAndUser(id, userId);
if (!prop) return res.status(404).json({ error: 'Propiedad no encontrada' });
```

`findByIdAndUser` ejecuta `WHERE id = $1 AND user_id = $2` — si la propiedad no pertenece al usuario, retorna null y el controller devuelve 404.

**Reports — PROTEGIDO a nivel de DB:**

Los métodos de `ReportRepository` usan `user_id` en todas las queries:

```javascript
findByMonth(userId, propertyId, month);
findByYear(userId, year);
listByUser(userId);
// etc.
```

No existe ningún método que busque por `id` numérico sin `user_id`.

**Jobs — NO PROTEGIDO:**

```javascript
// jobs.controller.js
const getJobStatus = (req, res) => {
  const { jobId } = req.params;
  const job = queue.getJob(jobId);  // ← sin verificación de userId
  if (!job) { return res.status(404).json(...); }
  res.json({ id: job.id, type: job.type, status: job.status, ... });
};
```

No hay verificación de si `job.payload.userId === req.user.userId`. **Cualquier usuario autenticado que conozca el `jobId` de otro usuario puede consultar el estado de su job y descargar su Excel.**

Los jobIds son generados con `uuid`:

```javascript
// MemoryQueue.js
this.id = uuid();
```

UUIDs v4 son de 128 bits, criptográficamente aleatorios — en la práctica es difícil adivinar un jobId ajeno, pero técnicamente no hay autorización.

### Conclusion

**RESUELTO.** La protección varía por recurso:

| Recurso      | Protección        | Mecanismo                                                            |
| ------------ | ----------------- | -------------------------------------------------------------------- |
| Properties   | ✅ PROTEGIDO      | `findByIdAndUser(id, userId)` — verificación explícita en controller |
| Reports (DB) | ✅ PROTEGIDO      | `userId` en todas las queries del repository                         |
| Jobs (queue) | ❌ SIN PROTECCIÓN | `getJob(jobId)` sin verificación de userId                           |

El riesgo de jobs es bajo en la práctica (IDs son UUIDs v4 difíciles de adivinar), pero existe como vulnerabilidad técnica.

### Confidence

**HIGH**

---

## Q-14

**¿Cuál es exactamente el flujo completo desde upload hasta generación y almacenamiento del reporte?**

### Archivos inspeccionados

- `src/routes/finance.routes.js`
- `src/controllers/upload.controller.js`
- `src/controllers/report.controller.js`
- `src/controllers/reports.controller.js`
- `src/services/csvParser.js`, `pdfParser.js`, `comparator.js`
- `src/queue/MemoryQueue.js`, `src/queue/workers/analysisWorker.js`

### Evidence

El flujo completo, con archivos y funciones exactas:

```
┌─────────────────────────────────────────────────────────────────┐
│  PASO 1 — UPLOAD AIRBNB                                         │
│  POST /api/upload/airbnb (SIN autenticación)                    │
│  finance.routes.js → uploadAirbnbMiddleware → uploadAirbnb()    │
│                                                                  │
│  multer.diskStorage → guarda archivo en uploads/                │
│  detectFileType() → 'csv' | 'pdf'                               │
│  validatePDF() si es PDF                                         │
│  tryUnlink(store.airbnbPath) → borra el anterior                │
│  store.airbnbPath = req.file.path                               │
│  store.airbnbFileType = 'csv' | 'pdf'                           │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  PASO 2 — UPLOAD BANCO                                          │
│  POST /api/upload/bank (SIN autenticación)                      │
│  finance.routes.js → uploadBankMiddleware → uploadBank()        │
│                                                                  │
│  multer → guarda hasta 2 PDFs en uploads/                       │
│  validatePDF() cada archivo                                      │
│  slot = req.body.slot (1 o 2, default 1)                        │
│  store.bankPaths[slot-1] = files[0].path                        │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  PASO 3 — GENERAR REPORTE COMPARATIVO                           │
│  GET /api/report (SIN autenticación)                            │
│  finance.routes.js → getReport()                                │
│                                                                  │
│  Lee: store.airbnbPath + store.bankPaths                        │
│  parseAirbnbCSV(path) o parseAirbnbPDF(path) → airbnbData      │
│  parseBankPDF(path) × N → bankParsedResults[]                   │
│  compareTransactions(airbnbData, bankData, month) → result      │
│  formatReport(result) → report JSON                              │
│  store.reportData = report                                       │
│  store.airbnbData = airbnbData                                  │
│  store.compareResult = compareResult                             │
│  → responde con el JSON del reporte                             │
└─────────────────────────────────────────────────────────────────┘
            │
            ├──────────────────────────────────────────────┐
            ▼                                              ▼
┌─────────────────────────┐             ┌──────────────────────────────────┐
│  PASO 4A — EXCEL SYNC   │             │  PASO 4B — EXCEL ASYNC (COLA)    │
│  GET /api/report/excel  │             │  POST /api/excel/queue           │
│  (requiere auth)        │             │  (requiere auth)                  │
│                         │             │                                    │
│  Lee store.airbnbData   │             │  Snapshot: { airbnbData,          │
│  + store.compareResult  │             │    compareResult } del store       │
│  Busca prev year en DB  │             │  queue.addJob('excel_generation') │
│  Claude API (opcional)  │             │  → responde 202 + jobId           │
│  generateMonthlyReport()│             │                                    │
│  → descarga xlsx        │             │  analysisWorker.js procesa:       │
└─────────────────────────┘             │  Claude API + generateMonthly     │
                                        │  job.result = { buffer, filename }│
                                        │  → disponible para download       │
                                        └──────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│  PASO 5 — GUARDAR REPORTE (MANUAL, OPCIONAL)                    │
│  POST /api/reports/save (requiere auth)                         │
│  reports.controller.js → saveReport()                           │
│                                                                  │
│  Body: JSON completo del reporte (lo envía el frontend)         │
│  extraerMonthKey(report) → { monthKey, year, label }           │
│  Resolver propertyId (del body, o primera prop del usuario)     │
│  Verificar que la propiedad pertenece al usuario                │
│  ReportRepo.upsert(userId, propertyId, month, year, label,      │
│    JSON.stringify(report))                                       │
│  → persistido en PostgreSQL                                      │
└─────────────────────────────────────────────────────────────────┘
```

**Punto crítico del flujo:** El Paso 5 es **manual y opcional**. Si el usuario cierra el browser sin hacer `POST /api/reports/save`, el reporte solo existe en `store.reportData` en memoria y se pierde al reiniciar el servidor.

### Conclusion

**RESUELTO.** El flujo completo es: upload × 2 → GET /api/report → (opcional) export Excel → (opcional explícito) POST /api/reports/save. Los primeros tres pasos son sin autenticación. La persistencia es una acción deliberada del usuario, no automática.

### Confidence

**HIGH**

---

## Q-15

**¿Qué datos son temporales y cuáles son persistidos permanentemente?**

### Archivos inspeccionados

- `src/controllers/upload.controller.js`
- `src/queue/MemoryQueue.js`
- `src/database/schema.js`
- `src/controllers/reports.controller.js`

### Evidence

**DATOS TEMPORALES — se pierden:**

| Dato                      | Ubicación                | Se pierde cuando                                                          |
| ------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| `store.airbnbPath`        | Memoria (path al disco)  | Servidor reinicia, o POST /api/reset, o nuevo upload Airbnb               |
| `store.bankPaths[]`       | Memoria (paths al disco) | Servidor reinicia, o POST /api/reset, o nuevo upload banco                |
| `store.airbnbData`        | Memoria (objeto JS)      | Servidor reinicia, o POST /api/reset                                      |
| `store.compareResult`     | Memoria (objeto JS)      | Servidor reinicia, o POST /api/reset                                      |
| `store.reportData`        | Memoria (objeto JS)      | Servidor reinicia, o POST /api/reset                                      |
| Archivos en `uploads/`    | Disco                    | POST /api/reset los elimina; nuevo upload del mismo slot los sobreescribe |
| Jobs en MemoryQueue       | Memoria (objeto JS)      | Servidor reinicia, o limpieza automática a 1h (`cleanup()`)               |
| Job result (Excel buffer) | Memoria en base64        | Misma que el job                                                          |

**DATOS PERMANENTES — persisten en PostgreSQL:**

| Dato             | Tabla        | Condición para persistir                           |
| ---------------- | ------------ | -------------------------------------------------- |
| Datos de usuario | `users`      | POST /api/auth/register                            |
| Propiedades      | `properties` | POST /api/properties                               |
| Reportes         | `reports`    | POST /api/reports/save (acción manual del usuario) |

**El campo `reports.summary`** almacena el JSON completo del reporte serializado como `TEXT`:

```sql
summary TEXT NOT NULL -- JSON serializado: formatReport() output completo
```

**Aclaración importante sobre el Excel:** El archivo Excel `.xlsx` **nunca se persiste en disco ni en DB**. Se genera en memoria, se descarga inmediatamente (o se guarda en base64 en el job), y desaparece. Cada descarga de Excel requiere regenerarlo.

### Conclusion

**RESUELTO.** El sistema tiene una línea clara entre temporal y permanente. **Solo se persiste lo que el usuario guarda explícitamente** (`POST /api/reports/save`). Todo el procesamiento intermedio (archivos de upload, parse results, Excel buffers, jobs) es efímero. El Excel no tiene persistencia propia — se regenera cada vez.

### Confidence

**HIGH**

---

## Resumen de Resoluciones

| ID   | Pregunta                                  | Estado                                                                                      | Confidence |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------------------------- | ---------- |
| Q-01 | DELETE bloquea si hay reportes            | RESUELTO — SÍ bloquea (400)                                                                 | HIGH       |
| Q-02 | secure: false intencional vs heredado     | RESUELTO PARCIALMENTE — documentado como dev, no cambiado en prod                           | HIGH       |
| Q-03 | Scheduled jobs — lógica real o esqueletos | RESUELTO — tienen lógica real (queries SQL + logging); fase de notificación no implementada | HIGH       |
| Q-04 | Parser soporta otros bancos               | RESUELTO — solo BBVA México; PDF Airbnb es stub                                             | HIGH       |
| Q-05 | config.js es la fuente de verdad          | RESUELTO — fuente parcial; config crítica lee process.env directamente                      | HIGH       |
| Q-06 | bin/ es usado activamente                 | RESUELTO PARCIALMENTE — CLI completamente implementado; uso activo UNKNOWN                  | MEDIUM     |
| Q-07 | Sistema soporta usuarios concurrentes     | RESUELTO — DB sí, flujo de upload+report NO                                                 | HIGH       |
| Q-08 | API key en repositorio o historial        | RESUELTO — no hay evidencia de exposición en git                                            | HIGH       |
| Q-09 | Documentación de formatos CSV/PDF         | RESUELTO PARCIALMENTE — formatos documentados en código; sin fixtures formales              | HIGH       |
| Q-10 | public/ es producto real o legacy         | RESUELTO — landing portfolio activa + Vanilla JS legacy obsoleto                            | HIGH       |
| Q-11 | Endpoints públicos acceden datos de otros | RESUELTO — store compartido permite ver datos de otra sesión                                | HIGH       |
| Q-12 | Store causa contaminación de datos        | RESUELTO — sí, demostrado con análisis de concurrencia                                      | HIGH       |
| Q-13 | Protección de acceso cross-user           | RESUELTO — Properties/Reports protegidos; Jobs sin verificación de owner                    | HIGH       |
| Q-14 | Flujo completo upload → persistencia      | RESUELTO — 5 pasos documentados; Paso 5 es manual y opcional                                | HIGH       |
| Q-15 | Datos temporales vs permanentes           | RESUELTO — línea clara: solo reports.save persiste; Excel nunca persiste                    | HIGH       |

---

_Documento generado en la rama `refactor/sdd-migration` como continuación del proceso de auditoría legacy._  
_Ningún archivo de aplicación fue modificado._
