/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import type { SpaceAPI } from '@space/contracts';

declare global {
  interface Window {
    readonly space: SpaceAPI;
  }
}
