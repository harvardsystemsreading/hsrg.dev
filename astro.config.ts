import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://hsrg.dev',
  output: 'static',
  build: {
    // One small stylesheet: inline it and save a request.
    inlineStylesheets: 'always',
  },
  markdown: {
    // Emit the punctuation exactly as written in the .md files (no curly-quote / dash substitution).
    smartypants: false,
  },
  vite: {
    build: { target: 'es2022' },
  },
});
