# hsrg.dev

Website of the Harvard Systems Reading Group.

## Development

Requires Node.js 22.12+.

```
npm install
npm run dev        # dev server with hot reload
npm run typecheck  # tsc --noEmit
npm run build      # production build into dist/
npm run preview    # serve dist/ locally
```

## Layout

- `index.html` — page content
- `src/main.ts` — entry point; boots the background and foreground
- `src/background.ts`, `src/logoSampler.ts` — three.js WebGL background (see `docs/background-spec.md`)
- `src/foreground.ts` — typewriter reveal and scroll blur (see `docs/foreground-spec.md`)
- `src/styles/style.css` — styles
- `public/assets/` — fonts and images, served as-is

Deterministic query parameters for screenshots: `?headless=1` (error banner on page),
`?t=<seconds>&pause=1` (background clock), `?fgDone=1` / `?fgFreeze=<unit>:<chars>` / `?fgSpeed=<mult>`
(typewriter), `?scroll=<px>`.
