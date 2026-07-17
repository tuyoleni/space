import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config
//
// electron-forge's Vite config loader bundles this file to CommonJS
// before running it, and `@tailwindcss/vite` ships ESM-only (no `require`
// export condition) — a static top-level `import` becomes a `require()`
// after that bundling and fails ("resolved to an ESM file"). The config
// function form defers loading it to a real dynamic `import()`, which
// works from a CJS module.
export default defineConfig(async () => {
  // eslint-disable-next-line import/no-unresolved -- see note above; resolves fine at runtime.
  const { default: tailwindcss } = await import('@tailwindcss/vite');
  return {
    plugins: [react(), tailwindcss()],
    // The @space/* renderer packages are workspace source, not published
    // deps — pre-bundling them into .vite/deps caches a stale export list,
    // so adding a new export (e.g. CardFooter) breaks with "does not provide
    // an export named …" until the cache is cleared. Excluding them makes
    // Vite serve them straight from source, so new exports appear on save.
    optimizeDeps: {
      exclude: ['@space/ui', '@space/contracts', '@space/activity'],
    },
  };
});
