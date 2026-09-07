# hsrg.dev

Website of the Harvard Systems Reading Group, built with [Astro](https://astro.build) as a fully static site.

## Development

Requires Node.js 22.12+.

```
npm install
npm run dev        # dev server with hot reload
npm run typecheck  # astro check (TypeScript + .astro templates)
npm run build      # production build into dist/
npm run preview    # serve dist/ locally
```

## Layout

- `src/pages/index.astro` — the page; `src/layouts/Base.astro` — document shell (canvas + content column)
- `src/data/sessions.ts` — the session schedule and past-talk embeds (edit this to add a session)
- `src/main.ts` — entry point; boots the background and foreground
- `src/background.ts`, `src/logoSampler.ts` — three.js WebGL background (see `docs/background-spec.md`)
- `src/foreground.ts` — typewriter reveal and scroll blur (see `docs/foreground-spec.md`)
- `src/styles/style.css` — styles
- `public/assets/` — fonts and images, served as-is

Deterministic query parameters for screenshots: `?headless=1` (error banner on page),
`?t=<seconds>&pause=1` (background clock), `?fgDone=1` / `?fgFreeze=<unit>:<chars>` / `?fgSpeed=<mult>`
(typewriter), `?scroll=<px>`.
