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
const BUNDLE_ID = 'com.tuyoleni.space';
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
  // The Dock's crash reports and per-app system settings key off the bundle
  // id; leaving Electron's own made dev builds indistinguishable from any
  // other Electron app on the machine.
  setPlistValue(mainPlist, 'CFBundleIdentifier', BUNDLE_ID);
}

/**
 * Renames a bundle's executable file and repoints CFBundleExecutable at it.
 *
 * This is the part `CFBundleName` cannot do: the Dock's tooltip, the app
 * switcher, and every row in Activity Monitor show the *executable's file
 * name*, so a bundle called "Space" whose binary is still `MacOS/Electron`
 * reads as "Electron" everywhere it actually matters. Returns the new
 * executable name so callers can keep other references in sync.
 */
function renameExecutable(bundlePath, desiredName) {
  const plist = path.join(bundlePath, 'Contents', 'Info.plist');
  const macOsDir = path.join(bundlePath, 'Contents', 'MacOS');
  if (!fs.existsSync(plist) || !fs.existsSync(macOsDir)) {
    return null;
  }
  const existing = fs.readdirSync(macOsDir);
  if (existing.includes(desiredName)) {
    setPlistValue(plist, 'CFBundleExecutable', desiredName);
    return desiredName;
  }
  const current = existing[0];
  if (current === undefined) {
    return null;
  }
  fs.renameSync(path.join(macOsDir, current), path.join(macOsDir, desiredName));
  setPlistValue(plist, 'CFBundleExecutable', desiredName);
  return desiredName;
}

const mainExecutable = renameExecutable(appPath, APP_NAME);
if (mainExecutable) {
  // `require('electron')` reads this file to find the binary to spawn, so it
  // has to follow the rename or `electron-forge start` launches nothing.
  const pathTxt = path.join(process.cwd(), 'node_modules', 'electron', 'path.txt');
  if (fs.existsSync(pathTxt)) {
    fs.writeFileSync(pathTxt, `${path.basename(appPath)}/Contents/MacOS/${mainExecutable}`);
  }
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

// Helper bundles (GPU/Renderer/Plugin). These are the extra "Electron" rows
// in Activity Monitor — one per helper — so they need the same executable
// rename as the main bundle, not just a display name. Electron locates them
// by bundle name derived from the main app, which is how a packaged build
// ships "<Product> Helper.app"; renaming here matches that layout.
const frameworksDir = path.join(appPath, 'Contents', 'Frameworks');
try {
  for (const entry of fs.readdirSync(frameworksDir)) {
    if (!entry.endsWith('.app') || !entry.startsWith('Electron')) {
      continue;
    }
    const renamedEntry = entry.replace(/^Electron/, APP_NAME);
    const from = path.join(frameworksDir, entry);
    const to = path.join(frameworksDir, renamedEntry);
    if (from !== to) {
      fs.rmSync(to, { recursive: true, force: true });
      fs.renameSync(from, to);
    }
    const helperName = renamedEntry.replace(/\.app$/, '');
    renameExecutable(to, helperName);
    const helperPlist = path.join(to, 'Contents', 'Info.plist');
    if (fs.existsSync(helperPlist)) {
      setPlistValue(helperPlist, 'CFBundleName', helperName);
      setPlistValue(helperPlist, 'CFBundleDisplayName', helperName);
      setPlistValue(helperPlist, 'CFBundleIdentifier', `${BUNDLE_ID}.helper`);
    }
  }
} catch {
  /* no Frameworks dir — nothing to do */
}

// macOS caches bundle metadata, so a patched bundle keeps showing the old
// name and icon until something invalidates it. Touching the bundle and
// re-registering it makes the Dock and Finder pick the change up on the next
// launch instead of the next login.
try {
  const now = new Date();
  fs.utimesSync(appPath, now, now);
  execFileSync(
    '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
    ['-f', appPath],
    { stdio: 'ignore' },
  );
} catch {
  /* best effort — the rename above is what actually matters */
}

// eslint-disable-next-line no-console
console.log(`[patch-dev-app-name] prepared macOS development bundle for "${APP_NAME}"`);
