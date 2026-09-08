FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY astro.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
RUN pnpm run build

FROM nginx:1.28-alpine
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
