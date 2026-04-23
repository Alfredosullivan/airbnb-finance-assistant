// analysisGenerator.js — Análisis financiero con IA usando la API de Anthropic
// Genera análisis en texto para el reporte mensual y el reporte anual.
// Si ANTHROPIC_API_KEY no está definida, las funciones lanzan un error con mensaje claro.

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-4-6';

const SYSTEM_PROMPT = `Eres un analista financiero especializado en rentas
vacacionales de corta estancia en México. Analizas conciliaciones financieras
de propiedades en Airbnb y generas reportes claros, profesionales y accionables.
Siempre respondes en español. No inventas datos — solo analizas lo que se te
proporciona. Cuando un dato no está disponible, lo indicas claramente.`;

/**
 * Formatea un número como moneda MXN.
 * @param {number} n
 * @returns {string}
 */
function mxn(n) {
  return (n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Obtiene un cliente Anthropic. Lanza un error claro si no hay API key.
 */
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no está configurada en el archivo .env');
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * generateMonthlyAnalysis — Genera el análisis del mes con Claude.
 *
 * @param {Object} data - Datos del reporte mensual
 * @param {string} data.reportLabel  - Etiqueta del mes (ej: "Febrero 2026")
 * @param {Object} data.summary      - Totales del mes
 * @param {Object} data.tables       - Tablas de transacciones (matched, onlyInAirbnb, onlyInBank)
 * @param {Object} data.excelData    - Datos adicionales (noches, comisión, IVA, ISR)
 * @returns {Promise<string>} Texto del análisis en Markdown
 */
async function generateMonthlyAnalysis(data) {
  const client = getClient();

  const { reportLabel, summary, tables, excelData } = data;

  const airbnbTotal   = summary?.airbnbTotal   || summary?.totalAirbnbPayouts || 0;
  const bankTotal     = summary?.bankTotal      || summary?.totalBankDeposits  || 0;
  const matchRate     = summary?.matchRate      || '0%';
  const netDifference = summary?.netDifference  || 0;
  const matchedCount  = tables?.matched?.length  || 0;
  const onlyAirbnb    = tables?.onlyInAirbnb?.length || 0;
  const onlyBank      = tables?.onlyInBank?.length    || 0;
  const noches        = excelData?.noches         || 0;
  const comision      = excelData?.comisionAirbnb || 0;
  const ivaRetenido   = excelData?.ivaRetenido    || 0;
  const isrRetenido   = excelData?.isrRetenido    || 0;

  // Detalle de reservaciones desde matched
  const reservaciones = [];
  (tables?.matched || []).forEach(m => {
    (m.reservations || []).forEach(r => {
      reservaciones.push({
        huesped:  r.guest,
        noches:   r.nights,
        checkIn:  r.checkIn,
        checkOut: r.checkOut,
        monto:    r.grossAmount,
        limpieza: r.cleaningFee,
        comision: r.serviceFee,
      });
    });
  });

  const userPrompt = `
Analiza la siguiente conciliación financiera de ${reportLabel}
y genera un reporte conciso enfocado en lo más útil para un
superhost de Airbnb en México.

DATOS FINANCIEROS:
- Total neto Airbnb: $${airbnbTotal.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN
- Total banco (depósitos): $${bankTotal.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN
- Diferencia neta: $${netDifference.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN
- Match rate: ${matchRate}
- Comisiones Airbnb: $${comision.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN
- IVA retenido (8%): $${ivaRetenido.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN
- ISR retenido (4%): $${isrRetenido.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN

OCUPACIÓN:
- Noches ocupadas: ${noches}
- Reservaciones: ${reservaciones.length}
- Días del mes: 31
${reservaciones.length > 0 ? `
DETALLE DE RESERVACIONES:
${reservaciones.map(r =>
  `- ${r.huesped}: ${r.noches} noches (${r.checkIn} al ${r.checkOut}), $${r.monto} MXN bruto`
).join('\n')}` : ''}

Genera ÚNICAMENTE estas 3 secciones, sin agregar más:

## RESUMEN EJECUTIVO
[2 párrafos máximo: cómo estuvo el mes, si la conciliación está sana,
conclusión general. Directo y profesional.]

## INDICADORES DE RENTABILIDAD
ADR (Average Daily Rate): $[valor] MXN — [1 línea de interpretación]
RevPAR (Revenue per Available Room): $[valor] MXN — [1 línea]
Tasa de ocupación: [%] — [1 línea: alta/media/baja para el mercado]
Ingreso promedio por reserva: $[valor] MXN — [1 línea]
Duración promedio de estancia: [X] noches — [1 línea]
[1 párrafo final comparando estos indicadores y qué significan
para la rentabilidad de la propiedad]

## ALERTAS Y RECOMENDACIONES
[Lista de 3 a 5 puntos concretos y accionables:
- Si hay algo a mejorar en precios, ocupación o conciliación
- Oportunidades detectadas en los datos
- Si todo está bien, indicarlo claramente
Cada punto en 1-2 líneas máximo. Sin texto de relleno.]
`;

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 1500,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userPrompt }],
  });

  return response.content[0].text;
}

/**
 * generateAnnualAnalysis — Genera el análisis del año completo con Claude.
 *
 * @param {Array}  monthlyData - Array de datos mensuales
 * @param {number} year        - Año analizado
 * @returns {Promise<string>} Texto del análisis en Markdown
 */
async function generateAnnualAnalysis(monthlyData, year) {
  const client = getClient();

  const totalAnual   = monthlyData.reduce((s, m) => s + m.airbnbTotal, 0);
  const totalNoches  = monthlyData.reduce((s, m) => s + (m.noches || 0), 0);
  const mesesActivos = monthlyData.filter(m => m.airbnbTotal > 0).length;

  const activos = monthlyData.filter(m => m.airbnbTotal > 0);
  const mejorMes = activos.length > 0
    ? activos.reduce((a, b) => b.airbnbTotal > a.airbnbTotal ? b : a)
    : null;
  const peorMes = activos.length > 0
    ? activos.reduce((a, b) => b.airbnbTotal < a.airbnbTotal ? b : a)
    : null;

  const userPrompt = `
Analiza el desempeño anual de ${year} de una propiedad en Airbnb en México.

RESUMEN ANUAL:
- Total ingresos netos: $${totalAnual.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN
- Total noches ocupadas: ${totalNoches}
- Meses con actividad: ${mesesActivos}/12
- Mejor mes: ${mejorMes ? `${mejorMes.label} ($${mejorMes.airbnbTotal.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN)` : 'N/A'}
- Mes más bajo: ${peorMes ? `${peorMes.label} ($${(peorMes.airbnbTotal || 0).toLocaleString('es-MX', {minimumFractionDigits:2})} MXN)` : 'N/A'}

DETALLE POR MES:
${monthlyData.map(m =>
  `- ${m.label}: $${m.airbnbTotal.toLocaleString('es-MX', {minimumFractionDigits:2})} MXN | ${m.noches || '—'} noches`
).join('\n')}

Genera ÚNICAMENTE estas 3 secciones:

## RESUMEN EJECUTIVO ANUAL
[2 párrafos: cómo fue el año en general, meses destacados,
salud financiera general. Directo y concreto.]

## INDICADORES ANUALES
ADR anual promedio: $[valor] MXN — [1 línea]
RevPAR anual: $[valor] MXN — [1 línea]
Ocupación promedio mensual: [%] — [1 línea]
Ingreso promedio mensual: $[valor] MXN — [1 línea]
Mejor trimestre: [Q1/Q2/Q3/Q4] con $[valor] MXN — [1 línea]
[1 párrafo final sobre tendencias del año y comparativa entre meses]

## ALERTAS Y RECOMENDACIONES PARA EL SIGUIENTE AÑO
[Lista de 3 a 5 puntos accionables basados en los datos:
- Meses con bajo desempeño a reforzar
- Temporadas altas a capitalizar
- Oportunidades de mejora en precios o disponibilidad
Cada punto en 1-2 líneas. Sin texto de relleno.]
`;

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 2000,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userPrompt }],
  });

  return response.content[0].text;
}

/**
 * generatePriceAnalysis — Genera un análisis de precios del mercado a partir de un prompt libre.
 * Usado por el crawler de precios para analizar datos de Inmuebles24 con Claude.
 *
 * ¿Por qué acepta un prompt crudo en lugar de un objeto estructurado?
 * El crawler necesita flexibilidad para describir el mercado de Mérida con sus propios
 * datos. A diferencia de generateMonthlyAnalysis (que tiene un formato fijo de conciliación),
 * cada análisis de mercado tiene un contexto diferente según la propiedad y la fecha.
 * Un prompt libre permite que crawlerService construya el contexto relevante.
 *
 * @param {string} prompt - Prompt completo para Claude (incluye datos del mercado)
 * @returns {Promise<string>} Texto del análisis generado por Claude
 */
async function generatePriceAnalysis(prompt) {
  // Llamamos getClient() aquí — igual que generateMonthlyAnalysis y generateAnnualAnalysis.
  // ¿Por qué no `client` a nivel de módulo?
  // Porque ANTHROPIC_API_KEY puede no estar disponible cuando el módulo se importa
  // (ej: en tests). getClient() valida la key solo cuando se llama la función,
  // no al cargar el archivo — permite importar el módulo sin la key configurada.
  const client = getClient();

  const response = await client.messages.create({
    model:      MODEL, // constante definida en este archivo: 'claude-opus-4-6'
    max_tokens: 1000,
    messages:   [{ role: 'user', content: prompt }],
  });

  return response.content[0]?.text || '';
}

module.exports = { generateMonthlyAnalysis, generateAnnualAnalysis, generatePriceAnalysis };
