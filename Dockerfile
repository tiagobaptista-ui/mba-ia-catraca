# Imagem única com dois alvos: `runtime` (produto) e `test` (gates: lint + testes).
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS deps
RUN npm ci --omit=dev --no-audit --no-fund

FROM base AS test
RUN npm ci --no-audit --no-fund
COPY . .
CMD ["sh", "-c", "npm run lint && npm test"]

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
