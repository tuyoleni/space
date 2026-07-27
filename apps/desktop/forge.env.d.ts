/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
// Types the renderer's asset imports (`import mark from './x.svg'` → its URL),
// used for the brand marks vendored under src/renderer/assets/brands.
/// <reference types="vite/client" />

import type { SpaceAPI } from '@space/contracts';

declare global {
  interface Window {
    readonly space: SpaceAPI;
  }
}
