# hsrg.dev

Website of the Harvard Systems Reading Group, built with [Astro](https://astro.build) as a fully static site.

## Development

Requires Node.js 22.12+ and pnpm (`corepack enable` installs the pinned version).

```
pnpm install
pnpm run dev        # dev server with hot reload
pnpm run typecheck  # astro check (TypeScript + .astro templates)
pnpm run build      # production build into dist/
pnpm run preview    # serve dist/ locally
```

## Docker

```
docker build -t hsrg.dev .
docker run --rm -p 8080:80 hsrg.dev     # http://localhost:8080
```

The image is a multi-stage build: Node builds `dist/`, the stock `nginx:alpine` serves it on port 80
(HTTP only; TLS is the reverse proxy's job).
