# Dockerfile — Imagen de producción para la app Node.js
#
# Usamos node:20-alpine porque Alpine es una distribución Linux muy liviana
# (~5 MB vs ~900 MB de la imagen debian-based). Esto hace que la imagen final
# sea más pequeña, se descargue más rápido y tenga menos superficie de ataque.
#
# Construir: docker build -t airbnb-finance-assistant .
# Correr:    docker compose up -d  (recomendado, usa docker-compose.yml)

# ── Etapa única — imagen base con Node 20 LTS sobre Alpine ─────
FROM node:20-alpine

# Directorio de trabajo dentro del contenedor.
# Todo lo que copie o instale a partir de aquí vive en /app.
WORKDIR /app

# Copiamos PRIMERO solo los manifests de dependencias.
# Docker cachea cada instrucción como una capa. Si el código cambia pero
# package.json no, Docker reutiliza la capa de npm ci (mucho más rápido).
COPY package*.json ./

# 1. Instalar TODAS las dependencias, incluyendo devDependencies.
# ¿Por qué no --only=production aquí?
# typescript, ts-node y @vitejs/plugin-react son devDependencies que
# necesitamos para ejecutar `npm run build` (tsc + vite build).
# Las eliminaremos después del build en el paso 3.
RUN npm ci

# 2. Copiar el resto del código y ejecutar el build completo.
# tsc compila src/**/*.ts → dist/src/
# vite build compila client/src → client/dist/
COPY . .
RUN npm run build

# 3. Limpiar devDependencies para dejar la imagen lo más liviana posible.
# El build ya terminó — typescript y vite ya no son necesarios en runtime.
RUN npm ci --only=production

# Documentamos el puerto que usa la app.
# EXPOSE no publica el puerto — solo sirve de documentación para
# docker inspect y para docker-compose, que lo usa como referencia.
EXPOSE 3000

# Comando que ejecuta el contenedor cuando arranca.
# Usamos la forma array (exec form) para que Node sea PID 1 y reciba
# señales del sistema operativo correctamente (SIGTERM para graceful shutdown).
# Apunta a dist/index.js — el entry point compilado por tsc.
CMD ["node", "dist/index.js"]
