import { defineConfig, type Plugin } from 'vite';

/**
 * Electron Forge's Vite integration rebuilds main-process code, but its
 * bundled restart hook is intentionally disabled upstream. That left a
 * running Space process on old IPC/window code until someone quit it by
 * hand. Forge already listens for `rs` on stdin, so send its documented
 * restart command after each development rebuild. The initial build happens
 * before Electron is launched and is harmless; subsequent saves relaunch
 * the app with the newly-built main process.
 */
function restartElectronAfterMainBuild(): Plugin {
  return {
    name: 'space:restart-electron-on-main-change',
    apply: 'serve',
    closeBundle() {
      process.stdin.emit('data', Buffer.from('rs\n'));
    },
  };
}

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
export default defineConfig((forgeEnv) => ({
  // This config is shared by utility-process entries. Only the Electron
  // main entry is allowed to request a relaunch; otherwise one source save
  // could queue several restarts as every worker bundle finishes.
  plugins: (forgeEnv as { forgeConfigSelf?: { entry?: string } }).forgeConfigSelf?.entry === 'src/main.ts' ? [restartElectronAfterMainBuild()] : [],
  build: {
    rollupOptions: {
      external: ['better-sqlite3', 'node-pty', 'bufferutil', 'utf-8-validate'],
    },
  },
}));
