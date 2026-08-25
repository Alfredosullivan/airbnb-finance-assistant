# Dockerfile — Imagen de producción para la app Node.js
#
# Usamos un build multi-stage para separar la etapa de compilación de la
# etapa de producción. El beneficio clave para seguridad: la imagen final
# NO contiene package.json ni package-lock.json, por lo que Trivy solo
# escanea lo que realmente está instalado en node_modules (solo producción),
# eliminando los falsos positivos de devDependencies.
#
# Construir: docker build -t airbnb-finance-assistant .
# Correr:    docker compose up -d  (recomendado, usa docker-compose.yml)

# ── Etapa 1: Build ──────────────────────────────────────────────────────
# Instala todo (incluyendo devDeps), compila TypeScript y el frontend React,
# luego re-instala solo las dependencias de producción.
FROM node:22-alpine AS builder

WORKDIR /app

# Copiar primero los manifests para aprovechar el cache de capas de Docker.
# Si package.json no cambió, npm ci reutiliza la capa cacheada.
COPY package*.json ./

# Instalar TODAS las dependencias (devDeps necesarias para tsc + vite build).
RUN npm ci

# Copiar el resto del código y compilar.
# tsc compila src/**/*.ts + index.js + config.js → dist/
# vite build compila client/src → client/dist/
COPY . .
RUN npm run build

# Re-instalar solo dependencias de producción para copiar a la etapa final.
# --ignore-scripts evita que husky falle (es devDep y .git no existe en Docker).
RUN npm ci --omit=dev --ignore-scripts

# ── Etapa 2: Producción ─────────────────────────────────────────────────
# Imagen limpia: solo copiamos los artefactos necesarios en runtime.
# Al no copiar package.json ni package-lock.json, Trivy solo escanea
# las devDependencies y solo reporta vulnerabilidades de lo que realmente corre.
FROM node:22-alpine

# Parchear paquetes del sistema operativo Alpine al último estado de seguridad.
# La imagen base node:20-alpine puede quedar desactualizada entre releases
# de Node. Este paso asegura que librerías del OS (OpenSSL, libcrypto, etc.)
# tengan los últimos parches sin esperar a que se publique una nueva imagen base.
RUN apk upgrade --no-cache

WORKDIR /app

# dist/       — código compilado por tsc (entry point: dist/index.js)
# node_modules/ — solo dependencias de producción
# public/     — frontend vanilla JS (landing + dashboard), servido por Express
# client/dist/ — build de React, servido como catch-all por Express
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 3000

# Exec form: Node es PID 1 y recibe señales del SO (SIGTERM para graceful shutdown).
CMD ["node", "dist/index.js"]
