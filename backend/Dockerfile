# Gateway backend de OfirOne — Node 20 HTTP nativo.
# El contexto de build debe ser la RAÍZ del repositorio (el código importa
# módulos de shared/ por ruta relativa: ../../../shared/...).
# Build:  docker build -f backend/Dockerfile -t ofirone-backend-gateway .
# Run:    docker run --rm -p 8787:8787 --env-file .env ofirone-backend-gateway

FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8787

WORKDIR /app

# Dependencias (backend solo depende de xlsx en runtime).
COPY backend/package.json backend/package-lock.json backend/
RUN cd backend && npm ci --omit=dev

# Código del gateway y núcleo compartido.
COPY backend/src backend/src
COPY shared shared

WORKDIR /app/backend

EXPOSE 8787

# Servidor HTTP del gateway.
CMD ["node", "src/server.js"]
