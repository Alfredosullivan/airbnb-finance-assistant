# RULES — Guardrails de DEV-007 (Feature flag "Análisis con IA")

> Reglas **acotadas a este task**. Complementan (no reemplazan) la constitución del proyecto
> en `CLAUDE.md`. Aplican mientras se implementa [`task.md`](./task.md). Su objetivo es evitar
> _scope creep_: que la implementación toque solo lo necesario y nada más.
>
> **Orden de precedencia:** `CLAUDE.md` (constitución) → este `rules.md` (task) → `task.md` (pasos).
> Si algo aquí contradice a `CLAUDE.md`, gana `CLAUDE.md`.

---

## 🎯 Alcance permitido

Solo se pueden **crear o modificar** estos archivos (los del Alcance de `task.md`):

**Crear:**

- `src/controllers/config.controller.js`
- `src/routes/config.routes.js`
- `tests/integration/config.test.js`

**Modificar:**

- `index.js` (solo para montar la ruta `/api/config`)
- `src/queue/workers/analysisWorker.js` (solo el Paso 2: cerrar el hueco)
- `client/src/context/AppContext.jsx`
- `client/src/components/MarketSection.jsx`
- `client/src/components/HistoryDrawer.jsx`
- `client/src/components/AppShell.jsx`
- `tests/helpers/testApp.js` (montar `/api/config` en el app de test espejo)
- `README.md`

> Cualquier archivo fuera de esta lista requiere **preguntar primero** y explicar por qué.

---

## 🚫 Prohibido (no tocar)

- **No** modificar `src/services/analysisGenerator.js` ni la función `getClient()`. Es el
  interruptor base de la feature y ya funciona.
- **No** cambiar la lógica de negocio de los controllers de análisis (`report.controller.js`,
  `reports.controller.js`). Sus respuestas 503 ya son correctas; el frontend simplemente dejará
  de llamarlos.
- **No** eliminar el `if (process.env.ANTHROPIC_API_KEY)` + try/catch que se agrega en el worker
  (Paso 2). Es la corrección de un bug, **no** es parte del flag: debe quedarse para siempre.
- **No** tocar el scheduler, la autenticación, el crawler de listings, ni el parseo de archivos.
- **No** renombrar archivos, funciones ni variables existentes "de paso".

---

## 🧭 Cómo trabajar

- **Regla 1 (Carlos primero):** antes de generar cualquier bloque de código, Carlos propone su
  enfoque. La IA no escribe el código de un paso hasta que Carlos lo pide explícitamente.
- **Regla 3 (Interrogatorio):** al cerrar cada paso, Carlos debe poder responder el 🧠
  Interrogatorio de ese paso en `task.md`. Si no puede, se explica antes de avanzar.
- **Un paso a la vez:** terminar y verificar un paso (y su archivo) antes de empezar el siguiente.
  Nada de implementar los 6 pasos de golpe.
- **Ante ambigüedad → preguntar, no asumir.** Si un detalle no está en `task.md`, se pregunta.

---

## 🔧 Restricciones técnicas

- **No** instalar dependencias nuevas. Este task no las necesita (usa `express`, `supertest`,
  `fetch` nativo, React). Si algo pareciera requerir una dependencia, **detenerse y preguntar**.
- **No** cambiar versiones de paquetes ni tocar `package.json` / `package-lock.json`.
- **No** exponer secretos: `/api/config` devuelve **solo** el booleano `aiEnabled`, nunca el valor
  de `ANTHROPIC_API_KEY`.
- **No** refactorizar código no relacionado, aunque "se vea mejorable". Eso va en otro task.
- Comentarios en **español** (constitución).
- Respetar Clean Architecture: el controller de config no lleva lógica de negocio.

---

## ✅ Definition of Done (por paso y global)

Cada paso no está "hecho" hasta que:

- [ ] El cambio está **solo** en los archivos permitidos.
- [ ] Hay un **commit atómico** con mensaje en formato conventional commits (ver `task.md`).
- [ ] Carlos puede responder el 🧠 Interrogatorio del paso.

El task completo no está "hecho" hasta que:

- [ ] `npm test` en **verde** (incluye `config.test.js`).
- [ ] `npm run lint` **limpio** (Husky lo bloqueará si no).
- [ ] Probado el flujo local **sin** `ANTHROPIC_API_KEY`: cero botones de IA, app 100% funcional.
- [ ] `README.md` actualizado y veraz.
- [ ] **Nunca** hacer handoff con tests rojos.

---

## 🧾 Fuera de alcance (para otro task)

Anotar, pero **no** hacer aquí:

- Rate limiting en los endpoints de IA y límite de gasto en Anthropic → van en el ticket de
  reactivación (ver `REVERT.md`, Caso 1).
- Migrar `MemoryQueue` a Redis/BullMQ.
- Extraer `buildAnalysisData` a un util compartido (TODO ya anotado en `analysisWorker.js`).
