import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://hsrg.dev',
  output: 'static',
  build: {
    // Keep the built HTML readable; the page is small and the scripts are hashed anyway.
    inlineStylesheets: 'never',
  },
  vite: {
    build: { target: 'es2022' },
  },
});
