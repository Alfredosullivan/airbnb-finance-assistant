# RULES — Guardrails de DEV-008 (Paridad + retiro del frontend Vanilla)

> Reglas **acotadas a este task**. Complementan (no reemplazan) la constitución del proyecto
> en `CLAUDE.md`. Aplican mientras se implementa [`task.md`](./task.md).
>
> **Orden de precedencia:** `CLAUDE.md` (constitución) → este `rules.md` (task) → `task.md` (pasos).

---

## 🚦 Regla de oro de este task: NO invertir el orden de las fases

Este task tiene **dos fases secuenciales y dependientes**:

- **Fase A (paridad)** debe completarse y verificarse **antes** de tocar un solo archivo de
  la Fase B (retiro). Retirar el Vanilla sin paridad = pérdida real de funcionalidad para
  cualquier usuario que use `/app`.
- Si en algún momento no está claro si la Fase A está realmente completa, **detenerse y
  preguntar** antes de avanzar a la Fase B. No asumir.

---

## 🎯 Alcance permitido

### Fase A (solo frontend):

- `client/src/components/ReportResults.jsx`
- `client/src/components/HistoryDrawer.jsx`
- Un componente nuevo si se elige la Opción A del Paso A1 (ej.
  `client/src/components/LiveAnalysisModal.jsx`) — **solo** si Carlos elige esa opción.

### Fase B:

- `index.js` (solo para quitar la ruta `GET /app`)
- Eliminar: `public/app.html`, `public/app.js`, `public/style.css`
- `Dockerfile` (solo el comentario sobre `public/`)
- `serve-preview.js` (solo el caso especial de `/app`)
- `README.md` (solo si se confirma que menciona el dashboard Vanilla)

> Cualquier archivo fuera de esta lista requiere **preguntar primero** y explicar por qué.

---

## 🚫 Prohibido (no tocar)

- **No** tocar `public/index.html` ni `public/favicon.svg` bajo ninguna circunstancia en este
  task. Es la landing de marketing — decisión de producto ya tomada: se conserva intacta.
- **No** tocar ningún archivo de `src/` (controllers, routes, services, repositories). Los 3
  endpoints de la Fase A **ya existen y funcionan** — este task es de frontend + limpieza de
  Express routing, no de backend.
- **No** empezar la Fase B si la Fase A no pasó su Checkpoint (tests en verde + verificación
  manual de las 3 funciones portadas).
- **No** tocar `client/src/legacy.css` ni intentar "arreglar" la duplicación de estilos —
  está fuera de alcance (ver sección correspondiente en `task.md`).
- **No** extraer `markdownToHtml`/`formatInline` a un util compartido en este task, aunque se
  note la duplicación — es un refactor transversal fuera de alcance.
- **No** renombrar archivos, funciones ni variables existentes "de paso".

---

## 🧭 Cómo trabajar

- **Regla 1 (Carlos primero):** antes de generar cualquier bloque de código, Carlos propone
  su enfoque. Esto aplica **especialmente** a la decisión de diseño del Paso A1 (Opción A vs
  B para el modal de análisis en vivo) — no se decide unilateralmente.
- **Regla 3 (Interrogatorio):** al cerrar cada paso, Carlos debe poder responder el 🧠
  Interrogatorio de ese paso en `task.md`.
- **Un paso a la vez**, en el orden del `task.md` (A1 → A2 → A3 → Checkpoint → B1 → B2 → B3 → B4).
- **Ante ambigüedad → preguntar, no asumir.** Esto incluye: si no está claro si el README
  menciona el Vanilla (Paso B3), leerlo primero y confirmar antes de editar.

---

## 🔧 Restricciones técnicas

- **No** instalar dependencias nuevas.
- **No** cambiar versiones de paquetes ni tocar `package.json` / `package-lock.json`.
- **No** modificar los 3 endpoints backend (`/api/analysis/monthly`,
  `/api/reports/update-prev-year-ref`, `/api/properties/combined/:year`) — solo consumirlos
  desde el frontend tal como están.
- Reutilizar helpers existentes cuando aplique (ej. `downloadBlob` de `HistoryDrawer.jsx` para
  el Paso A3) en vez de duplicar lógica.
- El botón del Paso A1 debe respetar el feature flag `aiEnabled` (DEV-007) — mismo patrón que
  `MarketSection.jsx` y `HistoryDrawer.jsx`.
- Comentarios en **español** (constitución).

---

## ✅ Definition of Done

**Por paso:**

- [ ] El cambio está **solo** en los archivos permitidos de esa fase.
- [ ] Commit atómico, conventional commits.
- [ ] Carlos puede responder el 🧠 Interrogatorio del paso.

**Checkpoint de Fase A (obligatorio antes de Fase B):**

- [ ] Las 3 funciones portadas funcionan probadas manualmente en `/dashboard` (React).
- [ ] `npm test` en verde.

**Global (fin del task):**

- [ ] `npm test` en verde · `npm run lint` limpio.
- [ ] QA manual del Paso B4 completo (checklist en `task.md`).
- [ ] `public/index.html` sin modificar (verificar con `git diff`).
- [ ] **Nunca** hacer handoff con tests rojos ni con la Fase B a medias.

---

## 🧾 Fuera de alcance (para otro task)

- Unificar el parser Markdown duplicado (`MarketSection`, `AnalysisModal`, y posible tercero).
- Migrar `public/index.html` a un componente React real.
- Unificar `client/src/legacy.css` con el sistema de diseño nativo.
- Limpiar `eslint.config.mjs` / `tsconfig.json` de las exclusiones de `public/**` (inofensivas
  tras el retiro, pero no es parte de este task).
