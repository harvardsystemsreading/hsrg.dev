import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://hsrg.dev',
  output: 'static',
  build: {
    // Keep the built HTML readable; the page is small and the scripts are hashed anyway.
    inlineStylesheets: 'never',
  },
  markdown: {
    // Emit the punctuation exactly as written in the .md files (no curly-quote / dash substitution).
    smartypants: false,
  },
  vite: {
    build: { target: 'es2022' },
  },
});
