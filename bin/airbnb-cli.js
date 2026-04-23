#!/usr/bin/env node
// airbnb-cli.js — CLI multipropósito para Airbnb Finance Assistant
// Consume la API REST del backend con Bearer token (Authorization: Bearer <token>)
//
// Flujo de uso:
//   1. airbnb-cli login   → configura la URL del servidor
//   2. airbnb-cli set-token <token>  → guarda el JWT para requests autenticados
//      (obten el token en el browser via GET /api/auth/me/token o en Swagger)
//   3. airbnb-cli stats --month=2026-01  → consulta un mes
//   4. airbnb-cli stats --year=2025      → resumen anual

'use strict';

const https    = require('https');
const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');
const os       = require('os');

// ── Config local ────────────────────────────────────────────────
// Guarda el token y la baseUrl entre sesiones en el home dir del usuario.
// ¿Por qué home dir y no el directorio del proyecto?
// Porque el token es una credencial del usuario, no del proyecto.
// Si pusiéramos el config en el proyecto, podría accidentalmente commitearse a git.
const CONFIG_PATH = path.join(os.homedir(), '.airbnb-cli.json');

const loadConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    // Si el archivo no existe todavía, devolvemos config vacío
    return {};
  }
};

const saveConfig = (data) => {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
};

// ── Helper de requests HTTP ─────────────────────────────────────
// ¿Por qué no usamos axios o node-fetch?
// El CLI no tiene dependencias extra — usa solo los módulos nativos de Node.js
// (http/https). Así el CLI funciona en cualquier entorno sin npm install.

/**
 * apiRequest — Hace un HTTP/HTTPS request a la API del backend
 * @param {string} method  - Método HTTP (GET, POST, etc.)
 * @param {string} urlPath - Path de la API (ej: /api/reports/2026-01)
 * @param {Object|null} body   - Cuerpo del request (para POST)
 * @param {string|null} token  - Bearer token (opcional, sobreescribe el guardado en config)
 * @returns {Promise<{ status: number, body: any }>}
 */
const apiRequest = (method, urlPath, body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const config    = loadConfig();
    const authToken = token || config.token;
    const baseUrl   = config.baseUrl || 'http://localhost:3000';

    const url      = new URL(urlPath, baseUrl);
    const isHttps  = url.protocol === 'https:';
    const lib      = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      // Si la URL tiene puerto explícito lo usamos; si no, el puerto por defecto del protocolo
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        // Solo agregamos el header si tenemos token — no enviamos "Bearer undefined"
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          // Intentamos parsear JSON; si la respuesta no es JSON, devolvemos el texto crudo
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);

    // Solo escribimos el body si hay contenido que enviar
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

// ── Colores ANSI para la terminal ───────────────────────────────
// Códigos ANSI: \x1b[<código>m abre el estilo, \x1b[0m lo cierra.
// Funcionan en la mayoría de terminales modernas (Git Bash, PowerShell, iTerm2, etc.)
const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

// ── Prompt interactivo ─────────────────────────────────────────
// readline.createInterface abre un canal de lectura desde stdin.
// Lo cerramos inmediatamente después de la respuesta para no dejar el proceso
// "colgado" esperando input.
const ask = (question) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => {
    rl.close();
    resolve(ans);
  }));
};

// ─── COMANDOS ────────────────────────────────────────────────────

/**
 * cmdLogin — Configura la URL del servidor y guía al usuario para obtener el token
 *
 * ¿Por qué no hacemos login directo desde el CLI?
 * El endpoint POST /api/auth/login devuelve el token como cookie httpOnly.
 * Las cookies httpOnly no son accesibles desde JavaScript (ni desde Node.js).
 * Son enviadas y leídas solo por el browser en requests futuros automáticamente.
 * El CLI no tiene este mecanismo — por eso el flujo es:
 *   1. Iniciar sesión en el browser
 *   2. Visitar GET /api/auth/me/token para obtener el JWT en el body
 *   3. Copiar ese token y correr: airbnb-cli set-token <token>
 */
const cmdLogin = async () => {
  console.log(c.bold('\n🏠 Airbnb Finance Assistant — Configuración del CLI\n'));

  const rawUrl   = await ask(`URL del servidor (Enter para http://localhost:3000): `);
  const baseUrl  = rawUrl.trim() || 'http://localhost:3000';

  // Verificar que el servidor responde antes de guardar
  try {
    const res = await apiRequest('GET', '/health');
    if (res.status !== 200) {
      console.log(c.red(`\n❌ El servidor en ${baseUrl} respondió ${res.status}`));
      process.exit(1);
    }
    console.log(c.green(`\n✅ Servidor conectado: ${baseUrl}`));
  } catch (err) {
    console.log(c.red(`\n❌ No se pudo conectar a ${baseUrl}: ${err.message}`));
    process.exit(1);
  }

  saveConfig({ baseUrl });

  // Instrucciones para obtener el Bearer token
  console.log(c.bold('\n📋 Pasos para completar la configuración:\n'));
  console.log(`  1. Abre el browser y ve a ${c.cyan(baseUrl)}`);
  console.log(`  2. Inicia sesión con tus credenciales`);
  console.log(`  3. Visita: ${c.cyan(baseUrl + '/api/auth/me/token')}`);
  console.log(`     (o usa Swagger en ${c.cyan(baseUrl + '/api/docs')})`);
  console.log(`  4. Copia el valor del campo ${c.yellow('"token"')}`);
  console.log(`  5. Corre: ${c.bold('airbnb-cli set-token <token-copiado>')}\n`);
};

/**
 * cmdSetToken — Guarda el Bearer token en el archivo de configuración local
 * Uso: airbnb-cli set-token eyJhbGciOiJIUzI1NiJ9...
 */
const cmdSetToken = (args) => {
  const token = args[0];
  if (!token) {
    console.log(c.red('❌ Uso: airbnb-cli set-token <token>'));
    process.exit(1);
  }
  const config = loadConfig();
  saveConfig({ ...config, token });
  console.log(c.green(`✅ Token guardado en ${CONFIG_PATH}`));
  console.log(c.dim('   El token se usará automáticamente en todos los comandos.\n'));
};

/**
 * cmdStats — Muestra estadísticas financieras de un mes o un año completo
 *
 * --month=YYYY-MM  → llama GET /api/reports/:month (reporte completo guardado)
 * --year=YYYY      → llama GET /api/reports/list y filtra por año
 *
 * ¿Por qué dos endpoints diferentes?
 * - /api/reports/:month devuelve el JSON completo del reporte (con todas las métricas)
 * - /api/reports/list devuelve solo metadatos (id, month, label, airbnbTotal, matchRate)
 *   No hay un endpoint /api/reports/list?year=N — el filtro se hace en el cliente.
 */
const cmdStats = async (args) => {
  const monthArg = args.find(a => a.startsWith('--month='));
  const yearArg  = args.find(a => a.startsWith('--year='));

  if (!monthArg && !yearArg) {
    console.log(c.red('❌ Uso: airbnb-cli stats --month=2026-01 | airbnb-cli stats --year=2026'));
    process.exit(1);
  }

  // ── Reporte de un mes específico ─────────────────────────────
  if (monthArg) {
    const month = monthArg.split('=')[1];

    // Validar formato básico antes de hacer el request
    if (!/^\d{4}-\d{2}$/.test(month)) {
      console.log(c.red(`❌ Formato de mes inválido: "${month}". Use YYYY-MM (ej: 2026-01)`));
      process.exit(1);
    }

    // GET /api/reports/:month — devuelve el JSON completo del reporte guardado
    // (el resultado de formatReport() que el usuario guardó desde el browser)
    const res = await apiRequest('GET', `/api/reports/${month}`);

    if (res.status === 401) {
      console.log(c.red('❌ No autenticado. Corre: airbnb-cli set-token <token>'));
      process.exit(1);
    }

    if (res.status === 404) {
      console.log(c.yellow(`⚠️  No hay reporte guardado para ${month}`));
      console.log(c.dim('   Genera y guarda un reporte desde el browser primero.\n'));
      return;
    }

    if (res.status !== 200 || !res.body || typeof res.body !== 'object') {
      console.log(c.yellow(`⚠️  Error al obtener datos para ${month}: ${res.body?.error || 'respuesta inesperada'}`));
      return;
    }

    // res.body es directamente el objeto del reporte (formatReport() output)
    // Estructura: { reportMonth, reportLabel, summary: { totalAirbnbPayouts, ... }, excelData: {...}, ... }
    const report = res.body;

    // summary contiene los totales financieros del mes
    const fin = report.summary;
    if (!fin) {
      console.log(c.yellow(`⚠️  El reporte de ${month} no contiene datos de resumen`));
      return;
    }

    console.log(c.bold(`\n📊 Reporte: ${report.reportLabel || month}`));
    console.log(c.dim('─'.repeat(40)));
    console.log(`  Ingresos Airbnb:    ${c.green('$' + (fin.totalAirbnbPayouts || 0))}`);
    console.log(`  Depósitos banco:    ${c.cyan('$' + (fin.totalBankDeposits || 0))}`);
    console.log(`  Match rate:         ${c.yellow(fin.matchRate || 'N/A')}`);
    console.log(`  Diferencia neta:    $${fin.netDifference || 0}`);

    // excelData es opcional — solo existe si el reporte fue guardado después de generar el Excel
    if (report.excelData) {
      console.log(`  Noches ocupadas:    ${c.cyan(report.excelData.noches || 0)}`);
      console.log(`  Comisión Airbnb:    $${report.excelData.comisionAirbnb || 0}`);
      console.log(`  IVA retenido:       $${report.excelData.ivaRetenido || 0}`);
      console.log(`  ISR retenido:       $${report.excelData.isrRetenido || 0}`);
    }

    console.log();
  }

  // ── Resumen anual ─────────────────────────────────────────────
  if (yearArg) {
    const year = yearArg.split('=')[1];

    // Validar año
    if (!/^\d{4}$/.test(year)) {
      console.log(c.red(`❌ Formato de año inválido: "${year}". Use YYYY (ej: 2025)`));
      process.exit(1);
    }

    // GET /api/reports/list — devuelve { reports: [{ id, month, year, label, airbnbTotal, matchRate }] }
    // No hay endpoint con filtro por año — filtramos en el cliente
    const res = await apiRequest('GET', '/api/reports/list');

    if (res.status === 401) {
      console.log(c.red('❌ No autenticado. Corre: airbnb-cli set-token <token>'));
      process.exit(1);
    }

    if (res.status !== 200 || !res.body?.reports) {
      console.log(c.yellow(`⚠️  Error al obtener la lista de reportes`));
      return;
    }

    // Filtrar solo los reportes del año solicitado
    const allReports = res.body.reports;
    const reports    = allReports.filter(r => String(r.year) === year);

    if (!reports.length) {
      console.log(c.yellow(`⚠️  Sin reportes guardados para ${year}`));
      console.log(c.dim(`   (Total en la DB: ${allReports.length} reporte(s))\n`));
      return;
    }

    // Ordenar por mes ascendente para mostrar cronológicamente
    reports.sort((a, b) => a.month.localeCompare(b.month));

    let totalIngresos = 0;

    console.log(c.bold(`\n📅 Resumen anual ${year} — ${reports.length} mes(es) con datos`));
    console.log(c.dim('─'.repeat(50)));

    for (const report of reports) {
      // airbnbTotal y matchRate vienen directamente del objeto de lista (sin anidación)
      const ingresos = Number(report.airbnbTotal || 0);
      totalIngresos += ingresos;
      console.log(
        `  ${c.cyan(report.label || report.month)}: ` +
        `${c.green('$' + ingresos.toFixed(2))} ` +
        `| match: ${c.yellow(report.matchRate || 'N/A')}`
      );
    }

    console.log(c.dim('─'.repeat(50)));
    console.log(`  ${c.bold('TOTAL ' + year)}: ${c.green('$' + totalIngresos.toFixed(2))}`);
    console.log();
  }
};

/**
 * cmdProperties — Lista las propiedades registradas del usuario autenticado
 * GET /api/properties — requiere Bearer token
 */
const cmdProperties = async () => {
  const res = await apiRequest('GET', '/api/properties');

  if (res.status === 401) {
    console.log(c.red('❌ No autenticado. Corre: airbnb-cli set-token <token>'));
    process.exit(1);
  }

  if (res.status !== 200) {
    console.log(c.red(`❌ Error al obtener propiedades: ${res.body?.error || res.status}`));
    process.exit(1);
  }

  const props = Array.isArray(res.body) ? res.body : [];
  if (!props.length) {
    console.log(c.yellow('\n⚠️  Sin propiedades registradas'));
    console.log(c.dim('   Agrega una propiedad desde el browser.\n'));
    return;
  }

  console.log(c.bold(`\n🏠 Propiedades (${props.length})\n`));
  for (const p of props) {
    console.log(`  ${c.cyan('ID ' + p.id)} — ${c.bold(p.name || 'Sin nombre')}`);
    if (p.address) console.log(c.dim(`           ${p.address}`));
  }
  console.log();
};

/**
 * cmdJobs — Información sobre jobs en background
 * Los jobs viven en memoria — no tienen endpoint de listado, solo consulta por ID
 */
const cmdJobs = () => {
  console.log(c.bold('\n⚙️  Jobs en background\n'));
  console.log(`  Los jobs viven en memoria del servidor — no hay endpoint de listado.`);
  console.log(`  Para consultar un job específico usa su ID (obtenido al encolar el Excel):`);
  console.log();
  console.log(`  ${c.dim('Consultar estado:')} GET /api/jobs/:jobId`);
  console.log(`  ${c.dim('Descargar Excel:')}  GET /api/jobs/:jobId/download`);
  console.log();
  console.log(c.dim('  Encola un Excel desde el browser y copia el jobId del response.\n'));
};

/**
 * cmdHelp — Muestra la ayuda de uso
 */
const cmdHelp = () => {
  console.log(`
${c.bold('🏠 Airbnb Finance Assistant CLI')}

${c.bold('Uso:')}
  airbnb-cli <comando> [opciones]

${c.bold('Comandos:')}
  ${c.cyan('login')}                     Configurar la URL del servidor y obtener instrucciones
  ${c.cyan('set-token')} <token>         Guardar el Bearer token para autenticación
  ${c.cyan('stats')} --month=YYYY-MM    Estadísticas de un mes específico
  ${c.cyan('stats')} --year=YYYY        Resumen financiero de un año completo
  ${c.cyan('properties')}               Listar propiedades del usuario
  ${c.cyan('jobs')}                     Información sobre jobs en background
  ${c.cyan('help')}                     Mostrar esta ayuda

${c.bold('Ejemplos:')}
  ${c.dim('# Primer uso:')}
  airbnb-cli login
  airbnb-cli set-token eyJhbGciOiJIUzI1NiJ9...

  ${c.dim('# Consultar datos:')}
  airbnb-cli stats --month=2026-01
  airbnb-cli stats --year=2025
  airbnb-cli properties

${c.bold('Config guardada en:')} ${path.join(os.homedir(), '.airbnb-cli.json')}
`);
};

// ─── ROUTER PRINCIPAL ──────────────────────────────────────────
// process.argv tiene: [node, script, comando, ...args]
// Desestructuramos para ignorar los dos primeros y quedarnos con el comando y sus args.
const [,, cmd, ...args] = process.argv;

/**
 * run — Envuelve comandos async para capturar errores de red de forma amigable
 *
 * ¿Por qué no un try/catch en cada comando?
 * El error más común (ECONNREFUSED) puede ocurrir en cualquier apiRequest()
 * de cualquier comando. En lugar de repetir el mismo catch en cada función,
 * lo centralizamos aquí — DRY aplicado al manejo de errores del CLI.
 *
 * @param {Function} fn   - Función async del comando (cmdStats, cmdProperties, etc.)
 * @param {Array}    fnArgs - Argumentos a pasar al comando
 */
const run = (fn, fnArgs = []) => {
  fn(fnArgs).catch(err => {
    // ECONNREFUSED = el servidor no está corriendo en la URL configurada
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      const config = loadConfig();
      const url    = config.baseUrl || 'http://localhost:3000';
      console.log(c.red(`\n❌ No se pudo conectar al servidor en ${url}`));
      console.log(c.dim('   Verifica que el servidor esté corriendo.'));
      console.log(c.dim('   Si la URL cambió, corre: airbnb-cli login\n'));
    } else {
      console.log(c.red(`\n❌ Error inesperado: ${err.message}\n`));
    }
    process.exit(1);
  });
};

// ¿Por qué switch en lugar de un objeto de comandos?
// Switch es más legible para un número pequeño de casos y permite el fallthrough
// para aliases (help / --help / -h). Para un CLI más grande usaríamos un framework
// como commander.js, pero para este caso KISS (Keep It Simple) es suficiente.
switch (cmd) {
  case 'login':      run(cmdLogin);              break;
  case 'set-token':  cmdSetToken(args);          break;  // síncrono — no necesita run()
  case 'stats':      run(cmdStats, args);        break;
  case 'properties': run(cmdProperties);         break;
  case 'jobs':       cmdJobs();                  break;  // síncrono — no necesita run()
  case 'help':
  case '--help':
  case '-h':         cmdHelp();                  break;  // síncrono — no necesita run()
  default:
    console.log(c.red(`\n❌ Comando desconocido: "${cmd || '(ninguno)'}".\n`));
    cmdHelp();
    process.exit(1);
}
