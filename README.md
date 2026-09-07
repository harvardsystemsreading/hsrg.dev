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

## Layout

- `src/pages/index.md` — the page content, in markdown (the schedule is a table; edit it to add a session)
- `src/layouts/Base.astro` — document shell (canvas + content column), used as the markdown `layout:`
- `src/main.ts` — entry point; boots the background and foreground
- `src/background.ts`, `src/logoSampler.ts` — three.js WebGL background (see `docs/background-spec.md`)
- `src/foreground.ts` — typewriter reveal and scroll blur (see `docs/foreground-spec.md`)
- `src/styles/style.css` — styles
- `public/assets/` — fonts and images, served as-is

Deterministic query parameters for screenshots: `?headless=1` (error banner on page),
`?t=<seconds>&pause=1` (background clock), `?fgDone=1` / `?fgFreeze=<unit>:<chars>` / `?fgSpeed=<mult>`
(typewriter), `?scroll=<px>`.
