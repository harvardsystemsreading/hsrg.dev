FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY astro.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginx:1.28-alpine
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
