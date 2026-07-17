import { defineConfig } from 'vite';

// https://vitejs.dev/config
// Native-module packages ship compiled .node binaries loaded via dynamic
// require() paths that Rollup cannot bundle; they must stay external and
// be resolved from node_modules at runtime (proven by the P0-A spike,
// spec section 36.1.1).
//
// `bufferutil`/`utf-8-validate` (optional native perf deps of `ws`, a
// transitive dep of @google/genai) belong in the same bucket: `ws` wraps
// `require('bufferutil')`/`require('utf-8-validate')` in try/catch since
// they're optional, but that guard is invisible to Rollup's static
// resolution, which fails the build outright when those packages aren't
// installed. Externalizing just the two optional packages — not `ws`
// itself — leaves Node to resolve (or catch the failure of) those requires
// at runtime, while `ws` still gets bundled normally. Tried externalizing
// `ws` directly first: that avoids the build failure but trades it for a
// runtime crash (`_interopNamespace`/`_interopNamespaceDefault`: "Cannot
// read properties of undefined (reading 'get')") — Rollup's namespace-
// interop helper for `import * as NodeWs from 'ws'` does `for...in` over
// the external CJS export combined with `getOwnPropertyDescriptor`, and
// disagrees with itself on `ws`'s class-based export shape. Bundling `ws`
// normally sidesteps that helper entirely.
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'node-pty', 'bufferutil', 'utf-8-validate'],
    },
  },
});
