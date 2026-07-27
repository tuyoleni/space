/**
 * Dev-only: prepare the development bundle so macOS presents it as Space.
 *
 * On macOS the bold app-menu title (and the "About X / Hide X / Quit X"
 * items) come from the running bundle's Info.plist `CFBundleName` —
 * `app.setName()` and menu templates cannot override it. In production the
 * packaged app already has the right name; in `electron-forge start` the
 * binary is `node_modules/electron/dist/Electron.app`, so we patch its
 * Info.plist (and the helper bundles, for Activity Monitor) here. A fresh
 * `npm install` reverts it — this runs on predev/prestart so it re-applies.
 * No-op on non-macOS.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const APP_NAME = 'Space';
const SPACE_ICON_PATH = path.join(process.cwd(), 'apps', 'desktop', 'assets', 'icons', 'icon.icns');

if (process.platform !== 'darwin') {
  process.exit(0);
}

const require = createRequire(import.meta.url);

/** `require('electron')` returns the executable path string; walk up to the .app. */
function electronAppPath() {
  const binary = require('electron'); // e.g. …/dist/Electron.app/Contents/MacOS/Electron
  if (typeof binary !== 'string') {
    return null;
  }
  const marker = binary.indexOf('.app/');
  return marker === -1 ? null : binary.slice(0, marker + '.app'.length);
}

function setPlistValue(plistPath, key, value) {
  // Set if present, otherwise add — PlistBuddy errors on Set for a missing key.
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plistPath], { stdio: 'ignore' });
  } catch {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plistPath], { stdio: 'ignore' });
    } catch {
      /* leave it — worst case the menu still says Electron in dev */
    }
  }
}

const appPath = electronAppPath();
if (!appPath) {
  process.exit(0);
}

const mainPlist = path.join(appPath, 'Contents', 'Info.plist');
if (fs.existsSync(mainPlist)) {
  setPlistValue(mainPlist, 'CFBundleName', APP_NAME);
  setPlistValue(mainPlist, 'CFBundleDisplayName', APP_NAME);
  setPlistValue(mainPlist, 'CFBundleIconFile', 'icon.icns');
}

// Replace the framework icon before launch so the Dock, About panel, app
// switcher, and Finder all resolve the same Space artwork in development.
const resourcesDir = path.join(appPath, 'Contents', 'Resources');
if (fs.existsSync(SPACE_ICON_PATH) && fs.existsSync(resourcesDir)) {
  for (const iconFile of ['Electron.icns', 'icon.icns']) {
    fs.copyFileSync(SPACE_ICON_PATH, path.join(resourcesDir, iconFile));
  }
  // CFBundleIconFile now points to icon.icns, so the old framework-branded
  // resource is not needed in a Space development bundle.
  fs.rmSync(path.join(resourcesDir, 'electron.icns'), { force: true });
}

// Helper bundles (GPU/Renderer/Plugin) — cosmetic, for Activity Monitor.
const frameworksDir = path.join(appPath, 'Contents', 'Frameworks');
try {
  for (const entry of fs.readdirSync(frameworksDir)) {
    if (!entry.endsWith('.app')) {
      continue;
    }
    const helperPlist = path.join(frameworksDir, entry, 'Contents', 'Info.plist');
    if (fs.existsSync(helperPlist)) {
      const helperName = entry.replace(/^Electron/, APP_NAME).replace(/\.app$/, '');
      setPlistValue(helperPlist, 'CFBundleName', helperName);
    }
  }
} catch {
  /* no Frameworks dir — nothing to do */
}

// eslint-disable-next-line no-console
console.log(`[patch-dev-app-name] prepared macOS development bundle for "${APP_NAME}"`);
