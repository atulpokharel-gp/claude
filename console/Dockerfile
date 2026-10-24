# Zinloop Security console. Build: docker build -t zinloop-console .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
RUN addgroup -S zinloop && adduser -S zinloop -G zinloop
COPY --from=build --chown=zinloop:zinloop /app ./
USER zinloop
EXPOSE 3000
CMD ["npx", "next", "start"]
