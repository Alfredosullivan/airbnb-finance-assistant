# REVERT — Quitar la encapsulación de la feature "Análisis con IA"

> Documento complementario de [`task.md`](./task.md). Aquí se explica cómo **revertir** la
> encapsulación (feature flag) que apaga la IA en producción. Léelo completo **antes** de tocar
> nada: primero elige entre los dos casos, y solo entonces ejecuta.

---

## ⚠️ Antes de empezar: elige UNA de las dos opciones

No ejecutes ningún paso hasta decidir qué quieres realmente. Son cosas distintas:

|                     | **Caso 1 — Reactivar la feature**     | **Caso 2 — Eliminar el flag**            |
| ------------------- | ------------------------------------- | ---------------------------------------- |
| **Qué hace**        | Vuelve a encender la IA en producción | Borra todo el andamiaje del feature flag |
| **Toca código**     | ❌ No                                 | ✅ Sí (8 archivos)                       |
| **Requiere deploy** | ❌ No (solo reiniciar)                | ✅ Sí                                    |
| **Reversible**      | ✅ Instantáneo                        | ⚠️ Requiere otro deploy                  |
| **Cuándo usarlo**   | Casi siempre                          | Casi nunca (ver advertencia)             |

> **Regla de decisión:** si tu objetivo es _"que la IA vuelva a funcionar"_ → **Caso 1**.
> Solo ve al **Caso 2** si la IA va a estar **siempre encendida para siempre** y quieres
> limpiar el código del flag. En caso de duda, elige el **Caso 1**.

---

## CASO 1 — Reactivar la feature (recomendado)

**No se toca ni una línea de código.** El feature flag ya hace todo el trabajo.

### Pasos

1. En **Railway** → tu servicio → pestaña **Variables**, agrega:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
2. Reinicia / redeploy el servicio para que tome la variable.
3. Verifica que el flag se encendió:
   ```bash
   curl https://<tu-app>.up.railway.app/api/config
   # Esperado: { "aiEnabled": true }
   ```

### Qué pasa automáticamente

- `GET /api/config` devuelve `aiEnabled: true`.
- El frontend vuelve a mostrar los botones ✦ ("Analizar con IA" y el `btn--ia` del historial).
- El worker vuelve a generar la Hoja 4 (análisis) en el Excel.

### ⚠️ Antes de reactivar en un demo público — protege el costo

Si reactivas en el demo con usuario compartido, pon primero estos candados (ver `task.md` y el
análisis previo):

- [ ] **Límite de gasto mensual** en la consola de Anthropic (ej. $5 USD).
- [ ] **Rate limiting** en los endpoints de IA (`/api/reports/:month/analysis`, `/api/crawler/analyze`).
- [ ] Confirmar que el **caché en DB** funciona (evita re-facturar el mismo análisis).

> **💼 Punto de entrevista:** prender/apagar una feature es una decisión de **configuración**,
> no de **código**. Con un feature flag por variable de entorno lo haces en segundos, sin deploy,
> y hasta distinto por entorno (apagada en el demo, encendida en local o en un entorno privado).

---

## CASO 2 — Eliminar el flag por completo (rara vez conviene)

Solo si la IA va a estar **siempre disponible** y quieres retirar el andamiaje. Es el refactor
inverso al `task.md`. Hazlo **paso a paso** y en este orden (frontend → backend → tests):

### 2.1 — Frontend: quitar las condiciones `aiEnabled`

- `client/src/components/MarketSection.jsx` → quitar `aiEnabled &&` del bloque del botón
  "✦ Analizar con IA" y quitar `aiEnabled` del `useAppContext()`.
- `client/src/components/HistoryDrawer.jsx` → quitar el `{aiEnabled && (...)}` que envuelve
  el `btn--ia` y quitar el prop `aiEnabled` de la firma del componente.
- `client/src/components/AppShell.jsx` → dejar de pasar el prop `aiEnabled` a `HistoryDrawer`
  y quitar `aiEnabled` del `useAppContext()`.

### 2.2 — Frontend: limpiar el Context

- `client/src/context/AppContext.jsx` → borrar el `useState(false)` de `aiEnabled`, el
  `useEffect` que hace `fetch('/api/config')`, y la propiedad `aiEnabled` del objeto `value`.

### 2.3 — Backend: borrar el endpoint

- Borrar `src/controllers/config.controller.js`.
- Borrar `src/routes/config.routes.js`.
- En `index.js`, quitar el `require` de `config.routes` y la línea `app.use('/api/config', ...)`.

### 2.4 — Tests

- Borrar `tests/integration/config.test.js`.

### 2.5 — Docs

- `README.md` → revertir la nota que menciona `GET /api/config` y `aiEnabled`.

### 🚫 Lo que NO debes borrar (importante)

- **El `if (process.env.ANTHROPIC_API_KEY)` + try/catch del worker** (`analysisWorker.js`,
  Paso 2 del `task.md`). **NO es parte del flag** — es la degradación con gracia que evita que
  el Excel encolado falle por completo. Borrarlo reintroduce el bug que arreglamos.
- El `getClient()` de `analysisGenerator.js`. Es el interruptor base de la feature.

### Checklist de handoff (Caso 2)

- [ ] Frontend compila sin referencias a `aiEnabled` (`npm run build` en `client/`)
- [ ] Backend arranca sin la ruta `/api/config`
- [ ] `npm test` en verde (sin `config.test.js`)
- [ ] `npm run lint` limpio
- [ ] El `if` de degradación del worker **sigue ahí**
- [ ] README revertido

---

## ⚠️ Recomendación final (mentor)

Casi nunca hagas el **Caso 2**. Un flag que ya funciona no estorba y te da flexibilidad gratis:
apagado en el demo público, encendido en local o en un entorno privado. La práctica de la
industria es _"retirar flags que ya no cambian de valor"_ — y este **sí** cambia de valor según
el entorno, así que vale la pena conservarlo.

**Para volver a usar la IA, el Caso 1 (poner la env var) es todo lo que necesitas.**
