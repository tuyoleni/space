import { defineConfig } from 'vite';

// https://vitejs.dev/config
// Native-module packages ship compiled .node binaries loaded via dynamic
// require() paths that Rollup cannot bundle; they must stay external and
// be resolved from node_modules at runtime (proven by the P0-A spike,
// spec section 36.1.1).
export default defineConfig({
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'node-pty'],
    },
  },
});
