# TASK — DEV-008: Paridad de features y retiro del frontend Vanilla JS

> **Objetivo:** Terminar la migración incremental Vanilla → React. Se hace en **dos fases**:
> primero se portan a React las 3 funciones que solo existen en el Vanilla (paridad), y
> **solo después** se retira el Vanilla. Nunca al revés — retirar antes de tener paridad
> perdería funcionalidad real para el usuario.
>
> **Decisiones de producto ya tomadas (2026-09-20):**
>
> 1. Portar primero, retirar después (no se acepta perder features).
> 2. `public/index.html` (landing de marketing en `/`) se **conserva tal cual** — no tiene
>    equivalente en React y no se toca en este task. Solo se retira el **dashboard** Vanilla
>    (`app.html` + `app.js` + `style.css`), montado en `/app`.

---

## Contexto (qué encontramos)

`public/` contiene **dos cosas distintas**, no una:

1. **`public/index.html`** (landing de marketing/portfolio en `/`) — autocontenido (su propio
   `<style>` embebido, no depende de `style.css`), con 3 botones "Ver App →" que apuntan a
   `/app`. **Fuera de alcance de este task — no se toca.**
2. **`public/app.html` + `public/app.js`** (dashboard Vanilla en `/app`) — esto sí se solapa con
   el dashboard de React (`client/`) y es lo que vamos a retirar, en la Fase B.

Comparando los endpoints que llama cada dashboard, el Vanilla usa **3 endpoints que el frontend
React nunca llama** — es decir, 3 funciones que hoy solo existen en `/app` (Vanilla):

| #   | Función                                                        | Endpoint                                 | Dónde vive en Vanilla                         |
| --- | -------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| 1   | Análisis IA del reporte **recién generado** (antes de guardar) | `POST /api/analysis/monthly` (+ `/pdf`)  | `public/app.js` — botón en el reporte en vivo |
| 2   | Auto-actualización del año siguiente al guardar                | `POST /api/reports/update-prev-year-ref` | `public/app.js:319` — modal tras `saveReport` |
| 3   | Reporte anual combinado (todas las propiedades)                | `GET /api/properties/combined/:year`     | `public/app.js:782`                           |

> 💼 **Punto de entrevista:** _"¿Cómo verificas que una migración incremental no pierde
> funcionalidad?"_ → _"Comparo, endpoint por endpoint, qué llama la versión vieja contra qué
> llama la nueva. La diferencia es exactamente el trabajo pendiente — no lo asumo, lo mido."_

**Buena noticia:** los 3 endpoints **ya existen y funcionan** en el backend (los usa el
Vanilla hoy). La Fase A es **100% frontend** — no se toca ni un archivo de `src/`.

---

## Alcance

### Fase A — Se toca (solo frontend, sin cambios de backend):

- `client/src/components/ReportResults.jsx` (features 1 y 2)
- `client/src/components/HistoryDrawer.jsx` (feature 3 — botón de descarga)
- Posible componente nuevo para el modal de análisis en vivo (se decide en el Paso A1)

### Fase B — Se toca:

- `index.js` (quitar la ruta explícita `GET /app`)
- Eliminar: `public/app.html`, `public/app.js`, `public/style.css`
- `Dockerfile` (comentario desactualizado)
- `serve-preview.js` (quitar el caso especial de `/app`)
- `README.md` (revisar menciones del dashboard Vanilla, si las hay)

### NO se toca (en ningún momento de este task):

- `public/index.html`, `public/favicon.svg` — landing de marketing, se conserva intacta.
- Ningún archivo de `src/` (controllers, routes, services) — los 3 endpoints ya existen.
- `client/src/legacy.css` — es una copia de los tokens de diseño que React ya usa; tocarla es
  un refactor de estilos, no de features. Fuera de alcance.
- `bin/airbnb-cli.js`, `scripts/seed.json` — verificado, sin relación con `public/`.
- El pipeline CI (`.github/workflows/ci.yml`) — no referencia `public/`, no requiere cambios.

---

# FASE A — Paridad de features (portar antes de retirar)

## PASO A1 — Feature 1: Análisis IA del reporte en vivo

**Qué:** Agregar un botón "✦ Analizar con IA" en `ReportResults.jsx` (el reporte recién
generado, antes de guardarlo), que llame a `POST /api/analysis/monthly` — el mismo endpoint
que ya usa el Vanilla. Debe respetar el feature flag `aiEnabled` (DEV-007) — si `!aiEnabled`,
el botón no aparece, igual que en `MarketSection`/`HistoryDrawer`.

**Por qué:** Es la única función de IA no disponible en React (Carlos lo descubrió manualmente
al grabar el video de demo — tuvo que guardar el reporte y abrirlo desde Historial).

**🎯 Decisión de diseño (proponla tú primero — Regla 1):**
`AnalysisModal.jsx` ya existe, pero está atado a reportes **guardados** (llama
`POST /api/reports/:month/analysis`, requiere un `month`). El análisis en vivo usa un endpoint
**distinto** (`POST /api/analysis/monthly`, sin `month`, lee de la sesión activa vía
`X-Session-Id`). Dos caminos:

- **Opción A — Nuevo componente** (ej. `LiveAnalysisModal.jsx`): copia la lógica de
  renderizado Markdown→HTML de `AnalysisModal` pero llama al endpoint de sesión. Más simple,
  pero duplica el parser Markdown (ya duplicado 2 veces en el proyecto — ver
  `MarketSection.jsx` y `AnalysisModal.jsx`).
- **Opción B — Generalizar `AnalysisModal`**: agregarle una prop `mode="live" | "saved"` que
  decida qué endpoint llamar. Evita triplicar el parser Markdown, pero complica un componente
  que hoy es simple.

> Mi recomendación: **Opción B** si quieres pagar la deuda técnica del parser duplicado de una
> vez; **Opción A** si prefieres avanzar rápido y dejar la unificación como ticket futuro.
> Decide tú antes de que se escriba el código (Regla 1).

**Alternativa descartada:** extraer `markdownToHtml`/`formatInline` a un util compartido
(`client/src/utils/markdown.js`) ahora mismo. Sería lo más limpio a largo plazo, pero es un
refactor transversal que no pidió este task — anotado en "Fuera de alcance" más abajo.

**Implementación (independiente de A vs B):**

- Botón en `ReportResults.jsx`, junto a "Guardar Reporte"/"Descargar Excel" — visible solo si
  `aiEnabled` (léelo del Context, igual que `MarketSection`).
- Al hacer clic: `POST /api/analysis/monthly` con header `X-Session-Id` si existe
  `sessionId` (mismo patrón que `handleSave`, línea 40).
- Mostrar el resultado en un modal (nuevo o generalizado, según tu decisión).
- Opcional: botón de descarga en PDF vía `POST /api/analysis/monthly/pdf` (mismo patrón que
  `AnalysisModal` no tiene descarga PDF hoy — revisar si Vanilla sí la ofrece antes de portarla).

**🧠 Interrogatorio (Regla 3):**

- ¿Por qué este endpoint usa `X-Session-Id` y el de reportes guardados usa `:month` en la URL?
- ¿Por qué el botón debe respetar `aiEnabled` igual que los otros dos?

**Commit sugerido:** `feat: agregar análisis IA del reporte en vivo en ReportResults`

---

## PASO A2 — Feature 2: Auto-actualización del año siguiente

**Qué:** Cuando se guarda un reporte de un mes/año, y ya existe guardado el mismo mes del año
**siguiente**, ofrecer actualizar ese reporte futuro con los datos de este como referencia
(`prevYearData`, usado en la Hoja 3 del Excel anual).

**Por qué:** `saveReport` (backend) ya devuelve `{ canUpdateNextYear, nextYearMonth,
nextYearLabel }` en su respuesta — el dato **ya viaja al frontend**, pero `ReportResults.jsx`
lo ignora por completo (`handleSave`, líneas 34–63, nunca lee el body de una respuesta exitosa).

**Implementación:**

- En `handleSave` (`ReportResults.jsx:34`), tras `if (!res.ok) {...}`, agregar
  `const data = await res.json();` y leer `data.canUpdateNextYear`.
- Si es `true`: mostrar una confirmación simple (ej. `window.confirm` — mismo patrón ya usado
  en `HistoryDrawer.jsx:118` para eliminar reportes — o un modal si prefieres consistencia
  visual con el resto de la app).
- Si el usuario confirma: `POST /api/reports/update-prev-year-ref` con
  `{ targetMonth: data.nextYearMonth, propertyId: currentProperty?.id }`.

**Alternativa descartada:** hacerlo automático sin preguntar. Se descarta porque sobrescribe
datos de otro reporte ya guardado — debe ser una acción explícita del usuario, igual que en
Vanilla (que sí muestra un modal de confirmación).

**🧠 Interrogatorio (Regla 3):**

- ¿Por qué `handleSave` nunca leía `data` en el camino exitoso? (pista: mira la línea 57)
- ¿Por qué esta acción requiere confirmación explícita del usuario?

**Commit sugerido:** `feat: agregar auto-actualización del año siguiente tras guardar reporte`

---

## PASO A3 — Feature 3: Reporte anual combinado (todas las propiedades)

**Qué:** Agregar un botón de descarga del reporte Excel combinado (`GET
/api/properties/combined/:year`), que suma los datos de **todas** las propiedades del usuario
para un año — a diferencia de `annual/:year`, que es por una sola propiedad.

**Por qué:** Endpoint ya existe (`properties.controller.js:112`, `getCombinedReport`) y
devuelve un buffer Excel binario (mismo patrón que `annual/:year` — headers
`Content-Type`/`Content-Disposition` + `res.send(buffer)`). Nadie en React lo llama hoy.

**Implementación:**

- Ubicación sugerida: `HistoryDrawer.jsx`, junto a los botones "↓ Excel 2026" / "↓ PDF 2026"
  (línea ~206-224) — mismo lugar donde vive la descarga anual por propiedad.
- Reutilizar el helper `downloadBlob(url, filename)` que ya existe en `HistoryDrawer.jsx:36`
  (ya maneja 404, errores, y la descarga del blob) — solo cambia la URL:
  `` `/api/properties/combined/${year}` `` (sin `propertyId`, es multi-propiedad).

**🧠 Interrogatorio (Regla 3):**

- ¿Por qué se puede reutilizar `downloadBlob` sin modificarlo?
- ¿Qué diferencia de negocio hay entre "reporte anual" (`annual/:year`) y "reporte combinado"
  (`combined/:year`)?

**Commit sugerido:** `feat: agregar descarga de reporte anual combinado multi-propiedad`

---

## Checkpoint de Fase A (antes de pasar a Fase B)

- [ ] Los 3 endpoints (`/api/analysis/monthly`, `/api/reports/update-prev-year-ref`,
      `/api/properties/combined/:year`) tienen ya un punto de entrada real en React.
- [ ] `npm test` en verde.
- [ ] Probado manualmente en local: las 3 funciones nuevas funcionan en `/dashboard` (React).
- [ ] **Solo si todo lo anterior está en verde**, se avanza a la Fase B.

---

# FASE B — Retirar el dashboard Vanilla

> ⚠️ No empezar esta fase hasta cerrar el Checkpoint de Fase A. Retirar el Vanilla antes de
> tener paridad real dejaría a cualquier usuario de `/app` sin esas 3 funciones.

## PASO B1 — Backend: `/app` deja de servir el Vanilla

**Qué:** Quitar la ruta explícita en `index.js`:

```js
app.get('/app', (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'public', 'app.html'));
});
```

**Por qué:** Al eliminarla, `/app` cae naturalmente en el catch-all ya existente
(`app.get('/{*path}', ...)` → sirve `client/dist/index.html`, el shell de React) — el mismo
comportamiento que ya tiene `/dashboard` o cualquier otra ruta no reservada. Cero código nuevo.

**Alternativa descartada:** dejar la ruta explícita pero apuntándola a
`client/dist/index.html` en vez de borrarla. Se descarta por ser código redundante — el
catch-al ya hace exactamente eso.

> ⚠️ **No tocar** la ruta `GET /` (sirve `public/index.html`, la landing) — debe seguir igual.

**🧠 Interrogatorio (Regla 3):**

- ¿Por qué basta con borrar la ruta en vez de reapuntarla?
- ¿Por qué `GET /` no se ve afectado por este cambio?

**Commit sugerido:** `feat: retirar la ruta /app del dashboard Vanilla (cae al catch-all React)`

---

## PASO B2 — Eliminar los archivos del dashboard Vanilla

**Qué:** Borrar:

- `public/app.html`
- `public/app.js`
- `public/style.css`

**Por qué se puede borrar `style.css` también:** solo `app.html` lo enlaza
(`<link rel="stylesheet" href="style.css" />`). `public/index.html` tiene su **propio**
`<style>` embebido (verificado — no hay `<link ... style.css>` en `index.html`). Al borrar
`app.html`, `style.css` queda huérfano.

**No borrar:** `public/index.html`, `public/favicon.svg` (los usa la landing).

**🧠 Interrogatorio (Regla 3):**

- ¿Cómo verificaste que `style.css` no lo usa nadie más antes de borrarlo?
- ¿Por qué `favicon.svg` se conserva?

**Commit sugerido:** `chore: eliminar public/app.html, app.js y style.css (dashboard Vanilla retirado)`

---

## PASO B3 — Limpiar referencias huérfanas

**Qué:** Tres ajustes menores de higiene, en un solo commit:

1. **`Dockerfile`** (línea ~56) — el comentario dice *"public/ — frontend vanilla JS (landing
   - dashboard)"*. Ahora es solo landing: actualizar el comentario. El `COPY --from=builder
/app/public ./public` se queda igual (sigue copiando `index.html` + `favicon.svg`).
2. **`serve-preview.js`** — tiene un caso especial `req.url === '/app' ? '/app.html' : ...`
   que ya no aplica (el archivo no existe). Quitar esa rama del ternario, dejar que sirva
   directo por `req.url` (solo se usará para previsualizar la landing).
3. **`README.md`** — verificado: la única mención es la línea 163, _"Frontend React —
   migración incremental desde Vanilla JS..."_ (sección Características). Es una descripción
   de la historia de ingeniería del proyecto, sigue siendo cierta tras el retiro — no requiere
   cambio obligatorio. Opcional: agregar "(completada)" al final si se quiere reflejar que la
   migración ya terminó. Sin menciones a `/app` como ruta en ningún otro lugar del README.

**Commit sugerido:** `chore: limpiar referencias al dashboard Vanilla retirado (Dockerfile, serve-preview, README)`

---

## PASO B4 — QA manual (obligatorio antes del handoff)

Sin esto, no se puede dar el task por terminado — es la única fase de este proyecto sin
cobertura de tests automatizados para las rutas HTML servidas por Express.

- [ ] `GET /` → sigue mostrando la landing de marketing (sin cambios visuales).
- [ ] Los 3 botones "Ver App →" de la landing llevan a `/app` y cargan el **React** (antes
      Vanilla) sin errores en consola.
- [ ] `GET /app` directo (bookmark viejo) → carga React correctamente.
- [ ] Login, subida de archivos, conciliación, guardado, historial — todo el flujo funciona
      igual que antes en `/app`.
- [ ] Las 3 funciones portadas en la Fase A están presentes y funcionan en `/app`.
- [ ] No quedan referencias rotas a `/app.js`, `/app.html` o `/style.css` en la consola del
      navegador (Network tab, sin 404s).

---

## Checklist final (handoff de DEV-008)

- [ ] Fase A completa y verificada antes de iniciar Fase B (no saltarse el orden).
- [ ] `npm test` en verde.
- [ ] `npm run lint` limpio.
- [ ] QA manual del Paso B4 completo.
- [ ] `public/index.html` intacto — verificar con `git diff` que no se tocó.
- [ ] Documentar en memoria: DEV-008 completado, feature parity + retiro Vanilla.

---

## Fuera de alcance (para otro ticket)

- Extraer `markdownToHtml`/`formatInline` (duplicado en `MarketSection.jsx` y
  `AnalysisModal.jsx`, y potencialmente un tercer lugar si se elige la Opción A del Paso A1) a
  un util compartido `client/src/utils/markdown.js`.
- Migrar el contenido de `public/index.html` a un componente React real (decisión ya tomada:
  se conserva estático por ahora).
- Unificar `client/src/legacy.css` con el sistema de diseño nativo de React (hoy son tokens
  copiados, no importados de una fuente única).
- Limpiar `eslint.config.mjs` / `tsconfig.json` de la exclusión de `public/**` (ya no hay
  `.js` bajo `public/` tras este task, pero la regla es inofensiva si se deja).

---

## Orden recomendado de ejecución

**Fase A completa (A1 → A2 → A3) → Checkpoint → Fase B completa (B1 → B2 → B3 → B4).**
Commit atómico por paso, igual que en DEV-007. Nunca empezar la Fase B con la Fase A a medias.

> **Recuerda (Regla 1):** en el Paso A1 hay una decisión de diseño real (Opción A vs B) —
> Carlos decide antes de que se escriba el código.
