# TASK — Nivel 2: Encapsular la feature "Análisis con IA" con Feature Flag

> **Objetivo:** Que la feature de IA (Claude) se apague/encienda de forma limpia según la
> variable de entorno `ANTHROPIC_API_KEY`, **sin romper el resto de la app** y **sin mostrar
> errores feos** al usuario. Hoy los botones de IA quedan visibles y, al pulsarlos, muestran
> un error 503 o un job fallido. Vamos a resolver eso de raíz.

---

## Contexto (por qué hacemos esto)

El "interruptor" de toda la feature ya existe: es la función `getClient()` en
`src/services/analysisGenerator.js`, que lanza error si no hay `ANTHROPIC_API_KEY`.
El problema no es el backend — es que:

1. **El frontend no sabe** si la IA está disponible → muestra botones que fallan.
2. **Un hueco en el worker** (`analysisWorker.js`) no protege la generación de Excel encolada.

La solución profesional es un **feature flag**: el backend expone si la IA está activa, y el
frontend oculta los botones cuando no lo está. Esto es un patrón muy común en producción
(degradación controlada de features de pago).

> **💼 Punto de entrevista:** _"¿Cómo desactivas una feature de pago en un entorno sin
> tocar el código de negocio?"_ → _"Con un feature flag derivado de una variable de entorno,
> expuesto al frontend por un endpoint de configuración. El backend degrada con gracia y el
> frontend oculta la UI. Cero hardcode, cero deploy nuevo para prender/apagar."_

---

## Alcance (qué se toca y qué NO)

**Se toca:**

- `src/controllers/config.controller.js` (nuevo)
- `src/routes/config.routes.js` (nuevo)
- `index.js` (montar la ruta)
- `src/queue/workers/analysisWorker.js` (cerrar el hueco)
- `client/src/context/AppContext.jsx` (exponer `aiEnabled`)
- `client/src/components/MarketSection.jsx` (ocultar botón)
- `client/src/components/HistoryDrawer.jsx` (ocultar botón `btn--ia`)
- `tests/helpers/testApp.js` (montar la ruta `/api/config` en el app de test espejo)
- `tests/integration/config.test.js` (nuevo)
- `README.md` (corregir la afirmación sobre los botones)

**NO se toca:**

- `analysisGenerator.js` — el interruptor `getClient()` ya está bien.
- Los controllers de análisis (`report.controller.js`, `reports.controller.js`) — ya devuelven
  503 correctamente; el frontend simplemente dejará de llamarlos cuando no haya IA.
- El scheduler — verificado: no consume la API de Claude.

---

## PASO 1 — Backend: endpoint `GET /api/config`

**Qué:** Un endpoint público que devuelve qué features están activas.
**Por qué público (sin `requireAuth`):** el flag no es información sensible y el frontend lo
necesita al cargar, antes incluso de decidir qué botones renderizar. Mismo criterio que `/health`.
**Alternativa descartada:** inyectar el flag en el HTML del build. Se descarta porque el build
de React es estático y el flag debe poder cambiar solo reiniciando el servidor con/sin la key,
sin rebuild.

### 1.1 — Crear `src/controllers/config.controller.js`

```js
'use strict';

// config.controller.js — Expone la configuración pública de features al frontend.
// No devuelve secretos: solo BANDERAS booleanas de qué está disponible.

/**
 * getPublicConfig — Devuelve las feature flags que el frontend necesita para
 * decidir qué UI mostrar. Público (sin auth) porque no expone datos sensibles.
 * GET /api/config
 */
function getPublicConfig(_req, res) {
  res.json({
    // Doble negación (!!) convierte el string de la env var (o undefined) en booleano.
    // Nunca devolvemos la key en sí — solo si existe.
    aiEnabled: !!process.env.ANTHROPIC_API_KEY,
  });
}

module.exports = { getPublicConfig };
```

### 1.2 — Crear `src/routes/config.routes.js`

```js
'use strict';

// config.routes.js — Ruta de configuración pública. Montada bajo /api/config.
// Sin requireAuth: el frontend la consulta al arrancar, antes del login.

const express = require('express');
const router = express.Router();
const { getPublicConfig } = require('../controllers/config.controller');

// GET /api/config — Feature flags públicas (ej: { aiEnabled: true })
router.get('/', getPublicConfig);

module.exports = router;
```

### 1.3 — Montar la ruta en `index.js`

Junto a las otras rutas (después de la línea `app.use('/api/crawler', crawlerRoutes);`):

```js
const configRoutes = require('./src/routes/config.routes'); // ← arriba, con los otros require

// ...

// Rutas de configuración pública (feature flags para el frontend)
app.use('/api/config', configRoutes);
```

> ⚠️ **Importante:** móntala **antes** del manejador 404 `app.use('/api', ...)`, o siempre
> devolverá "Ruta no encontrada".

**🧠 Interrogatorio (Regla 3):**

- ¿Por qué `!!process.env.ANTHROPIC_API_KEY` y no devolver la key directamente?
- ¿Por qué este endpoint NO lleva `requireAuth` cuando casi todos los demás sí?
- ¿Qué pasaría si montas la ruta después del handler 404?

**Commit sugerido:** `feat: agregar endpoint /api/config con feature flag aiEnabled`

---

## PASO 2 — Backend: cerrar el hueco del worker

**Qué:** Proteger la llamada a Claude en la generación de Excel **encolada**.
**Por qué:** En `analysisWorker.js`, el path `excel_generation` llama a `generateMonthlyAnalysis()`
sin verificar la key ni capturar el error (a diferencia del path síncrono en `report.controller.js`
que sí lo hace). Si no hay key, el job entero falla en vez de generar el Excel sin la Hoja 4.
**Alternativa descartada:** dejarlo así "porque el frontend React no usa esa ruta". Se descarta:
es deuda técnica y el endpoint `POST /api/excel/queue` existe y es público a cualquier cliente.

### 2.1 — Editar `src/queue/workers/analysisWorker.js`

Busca en `processJob` (path `excel_generation`) esta línea:

```js
// ── Paso 3: llamar a Claude API — la operación lenta (5–25 s) ────────────
const analysisText = await generateMonthlyAnalysis(analysisData);
```

Reemplázala por la versión protegida (mismo patrón que `report.controller.js:216`):

```js
// ── Paso 3: análisis IA opcional — solo si la key está configurada ──────
// Si no hay ANTHROPIC_API_KEY, el Excel se genera igual pero sin la Hoja 4.
// Mismo criterio de degradación con gracia que la ruta síncrona generateExcel().
let analysisText = null;
if (process.env.ANTHROPIC_API_KEY) {
  try {
    analysisText = await generateMonthlyAnalysis(analysisData);
  } catch (analysisErr) {
    logger.warn('[QUEUE] Análisis IA no disponible para el Excel:', analysisErr.message);
  }
}
```

> Nota: el `Paso 4: cachear el análisis` que viene después ya está dentro de un `if (currentRow?.id)`
> con su propio try/catch. Aun así, conviene que solo intente cachear si `analysisText` no es null
> (si es null, no hay nada que guardar). Revísalo y añade la condición si hace falta.

**🧠 Interrogatorio (Regla 3):**

- ¿Por qué el Excel debe generarse igual aunque la IA falle?
- ¿Qué diferencia hay entre este path (worker) y el síncrono (`generateExcel`)?
- ¿Por qué usamos `logger.warn` y no `logger.error` aquí?

**Commit sugerido:** `fix: degradar con gracia el análisis IA en el worker de Excel encolado`

---

## PASO 3 — Frontend: exponer `aiEnabled` en el Context

**Qué:** Que toda la app conozca si la IA está disponible, en un solo lugar.
**Por qué en el Context:** varios componentes lo necesitan (MarketSection, HistoryDrawer).
Ponerlo en el Context evita duplicar el `fetch('/api/config')` en cada uno (DRY).
**Alternativa descartada:** que cada componente haga su propio fetch. Se descarta por duplicación
y por N llamadas innecesarias al mismo endpoint.

### 3.1 — Editar `client/src/context/AppContext.jsx`

Agrega el estado y su carga. Fíjate que la config se carga **una vez al montar**, no depende
de `user` (a diferencia de las propiedades):

```jsx
const [aiEnabled, setAiEnabled] = useState(false);

// Cargar feature flags públicas una sola vez al montar la app.
// No depende de `user`: el flag es el mismo con o sin sesión.
useEffect(() => {
  const loadConfig = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setAiEnabled(!!data.aiEnabled);
    } catch (err) {
      // Si falla, asumimos IA apagada (fail-safe: mejor ocultar que mostrar un botón roto)
      console.error('Error cargando config:', err);
      setAiEnabled(false);
    }
  };
  loadConfig();
}, []);
```

Y añádelo al objeto `value` que provee el Context:

```jsx
const value = {
  // ...lo que ya existe...
  aiEnabled,
};
```

**🧠 Interrogatorio (Regla 3):**

- ¿Por qué el array de dependencias del `useEffect` está vacío `[]`?
- ¿Por qué en el `catch` ponemos `aiEnabled = false` y no `true`? (pista: fail-safe)
- ¿Por qué este flag va en el Context y no como prop desde App.jsx?

**Commit sugerido:** `feat: exponer feature flag aiEnabled en AppContext`

---

## PASO 4 — Frontend: ocultar los botones de IA

Hay **dos** botones que disparan la IA. Ambos se ocultan cuando `!aiEnabled`.

### 4.1 — `client/src/components/MarketSection.jsx` (botón "✦ Analizar con IA")

1. Lee el flag del Context (ya lees `user`):
   ```jsx
   const { user, aiEnabled } = useAppContext();
   ```
2. Envuelve el bloque del botón (hoy en `~línea 371`) para que solo se muestre si hay IA:
   ```jsx
   {
     listings.length > 0 && aiEnabled && (
       <div className="market-analyze-row">{/* ...botón Analizar con IA... */}</div>
     );
   }
   ```
   > Nota: el crawler de listings (`Actualizar`) **NO** usa IA — ese botón se queda siempre.
   > Solo se oculta el de "Analizar con IA".

### 4.2 — `client/src/components/HistoryDrawer.jsx` (botón `btn--ia`, el ✦ por mes)

El botón está en `~línea 256`. Necesitas el flag del Context. Dos opciones:

- **Opción A (recomendada):** pasar `aiEnabled` como prop desde `AppShell` → `HistoryDrawer`
  (coherente con cómo `HistoryDrawer` ya recibe `onViewAnalysis` como prop).
- **Opción B:** llamar `useAppContext()` dentro de `HistoryDrawer`.

Con la Opción A, en `AppShell.jsx` lees el flag y lo pasas:

```jsx
const { currentProperty, setCurrentReport, aiEnabled } = useAppContext();
// ...
<HistoryDrawer
  isOpen={historyOpen}
  onClose={() => setHistoryOpen(false)}
  onViewReport={handleViewReport}
  onViewAnalysis={onViewAnalysis}
  aiEnabled={aiEnabled} // ← nuevo
/>;
```

Y en `HistoryDrawer.jsx` recibes el prop y condicionas el botón:

```jsx
export default function HistoryDrawer({ isOpen, onClose, onViewReport, onViewAnalysis, aiEnabled }) {
```

```jsx
{
  aiEnabled && (
    <button
      className="btn--ia"
      onClick={() => onViewAnalysis(r.month, r.label)}
      title={`Análisis IA de ${r.label}`}
    >
      ✦
    </button>
  );
}
```

**🧠 Interrogatorio (Regla 3):**

- ¿Por qué ocultamos el botón en vez de solo deshabilitarlo (`disabled`)?
  (Ambas son válidas — ten tu argumento listo: ocultar = demo más limpio; deshabilitar +
  tooltip = comunica que la feature existe.)
- ¿Por qué el botón "Actualizar" del mercado NO se oculta?

**Commit sugerido:** `feat: ocultar botones de IA en el frontend cuando aiEnabled es false`

---

## PASO 5 — Tests

**Qué:** Un test de integración para el nuevo endpoint. Es el más fácil de tu suite y protege
el contrato con el frontend.

### 5.1 — Montar la ruta en el app de test (`tests/helpers/testApp.js`)

⚠️ **Clave:** la suite **NO** usa `index.js`. Usa un app espejo `tests/helpers/testApp.js` que
monta las rutas a mano (hoy solo `auth` y `properties`) y **NO** llama a `app.listen()`. Hay que
registrar ahí la ruta nueva, o el test daría **404** aunque la ruta exista en `index.js`.

Agrega (antes del handler 404 `app.use('/api', ...)`, igual que en `index.js`):

```js
const configRoutes = require('../../src/routes/config.routes'); // con los otros require

// ...

app.use('/api/config', configRoutes); // ← antes del handler 404
```

### 5.2 — Crear `tests/integration/config.test.js`

Estructura AAA. Se consume el app espejo con `await require('../helpers/testApp')` — el mismo
patrón que `auth.test.js` / `properties.test.js` (NO `require('../../index')`, que arrancaría el
servidor real):

```js
const request = require('supertest');

describe('GET /api/config', () => {
  let app;
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    // testApp exporta una Promise que resuelve al app una vez lista la DB
    app = await require('../helpers/testApp');
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey; // Restaurar tras cada test
  });

  it('devuelve aiEnabled: true cuando la key está configurada', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-fake';
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.aiEnabled).toBe(true);
  });

  it('devuelve aiEnabled: false cuando la key NO está configurada', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.aiEnabled).toBe(false);
  });

  it('nunca expone el valor de la API key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-super-secreta';
    const res = await request(app).get('/api/config');
    expect(JSON.stringify(res.body)).not.toContain('sk-super-secreta');
  });
});
```

> Funciona porque `getPublicConfig` lee `process.env.ANTHROPIC_API_KEY` **en tiempo de request**
> (no al montar), así que cambiar la env var por test surte efecto sin recrear la app.
>
> 🔎 **Deuda técnica revelada:** hay **dos definiciones del app** (`index.js` y `testApp.js`) que
> deben mantenerse sincronizadas. Un `src/app.js` con `createApp()` compartido lo eliminaría —
> ticket futuro, **fuera de alcance** de DEV-007.

**Commit sugerido:** `test: agregar tests de integración para GET /api/config`

---

## PASO 6 — Docs

### 6.1 — Corregir `README.md`

La línea actual (≈256) dice:

> _"Si `ANTHROPIC_API_KEY` no está definida, la app funciona normalmente — los botones de
> análisis IA quedan deshabilitados."_

Ahora por fin **es cierta**. Puedes reforzarla mencionando el mecanismo:

> _"Si `ANTHROPIC_API_KEY` no está definida, la app funciona normalmente. El endpoint
> `GET /api/config` expone `aiEnabled: false` y el frontend oculta los botones de análisis IA.
> Los reportes Excel/PDF se generan sin la hoja de análisis."_

**Commit sugerido:** `docs: documentar feature flag aiEnabled en README`

---

## Checklist final (handoff)

- [ ] `GET /api/config` responde `{ aiEnabled: boolean }` (probado con y sin la env var)
- [ ] Ruta `/api/config` montada **también** en `tests/helpers/testApp.js` (si no, el test da 404)
- [ ] Worker de Excel encolado genera el archivo aunque no haya key (sin fallar el job)
- [ ] `aiEnabled` disponible en `AppContext`
- [ ] Botón "✦ Analizar con IA" (MarketSection) oculto cuando `!aiEnabled`
- [ ] Botón `btn--ia` ✦ (HistoryDrawer) oculto cuando `!aiEnabled`
- [ ] Botón "Actualizar" del mercado **sigue visible** (no usa IA)
- [ ] Tests nuevos pasan (`npm test`) — nunca hacer handoff con tests rojos
- [ ] Lint limpio (`npm run lint`) — Husky lo bloqueará si no
- [ ] README actualizado
- [ ] Probado el flujo completo local: SIN key → cero botones de IA, app 100% funcional

---

## Orden recomendado de ejecución

Sigue el orden del **Protocolo de Ejecución**: backend → worker → context → componentes → tests → docs.
Haz commit **por paso** (atómico), y corre `npm test` antes del handoff.

> **Recuerda (Regla 1):** antes de que Claude genere cualquier bloque, propón tú tu enfoque.
> Y antes de dar por terminado cada paso, asegúrate de poder responder el 🧠 Interrogatorio.
