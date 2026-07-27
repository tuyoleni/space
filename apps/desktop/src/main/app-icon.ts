/**
 * Real application icons for macOS `.app` bundles.
 *
 * Electron's `app.getFileIcon` goes through Launch Services' icon services,
 * and for most third-party bundles that hands back the generic application
 * placeholder rather than the app's own artwork — Arc, Claude and Dropover
 * all come back as the same byte-identical grey tile, which is the blank
 * square the process list, package inventory and AI-tools rows were showing.
 * Apple's own bundles happen to resolve, which is why the failure looked
 * intermittent.
 *
 * A bundle's real icon is a file inside it: `Contents/Resources/<icon>.icns`,
 * named by `CFBundleIconFile`/`CFBundleIconName` in its `Info.plist`. That is
 * the authoritative source, so it is read first. `nativeImage` cannot decode
 * `.icns`, so `sips` (a macOS built-in) converts it to PNG. Launch Services
 * remains the fallback for bundles that ship no `.icns` (icon in `Assets.car`
 * only — VS Code is one) and is the only path on Windows, where `.exe` icons
 * resolve correctly; its placeholder is recognised and reported as "no icon"
 * rather than passed off as artwork (see `genericApplicationIcon`).
 *
 * Everything is cached per path for the process's lifetime: icons don't change
 * while an app is running, and the process list re-polls the same bundles.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { nodeRunCommand } from '@space/environment';

const PLUTIL_TIMEOUT_MS = 3_000;
const SIPS_TIMEOUT_MS = 5_000;

/** Rendered at 2× the largest on-screen use (32px in the packages list) so icons stay sharp on Retina. */
const ICON_PIXELS = 64;

export interface AppIconPorts {
  readonly platform: NodeJS.Platform;
  /** Resolves to `{ exitCode, stdout }`; must not throw for a non-zero exit. */
  runCommand(command: string, args: readonly string[], options: { timeoutMs: number }): Promise<{ exitCode: number | null; stdout: string }>;
  readFile(filePath: string): Promise<Buffer>;
  fileExists(filePath: string): Promise<boolean>;
  removeFile(filePath: string): Promise<void>;
  temporaryDirectory(): string;
  /** Launch Services / Windows shell icon for any path, or null when it has none. */
  systemIconDataUrl(target: string): Promise<string | null>;
}

export interface AppIconResolver {
  /** The real icon for an app bundle or executable as a PNG data URL, or null when it has none. */
  iconFor(target: string): Promise<string | null>;
}

/**
 * Icon file names to look for in `Contents/Resources`, most authoritative
 * first. `CFBundleIconFile` may or may not carry the `.icns` extension (both
 * spellings are legal), and `AppIcon.icns` is the Xcode default that bundles
 * declaring only an asset-catalog name still tend to ship.
 */
export function icnsCandidateNames(info: Record<string, unknown>): readonly string[] {
  const names: string[] = [];
  const declared = [info['CFBundleIconFile'], info['CFBundleIconName']];
  for (const value of declared) {
    if (typeof value !== 'string' || value.trim() === '') {
      continue;
    }
    names.push(value.endsWith('.icns') ? value : `${value}.icns`);
  }
  names.push('AppIcon.icns');
  return [...new Set(names)];
}

function dataUrlFromPng(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

export function createAppIconResolver(ports: AppIconPorts = nodeAppIconPorts()): AppIconResolver {
  const cache = new Map<string, string | null>();

  async function readBundleInfo(bundlePath: string): Promise<Record<string, unknown> | null> {
    const plist = path.join(bundlePath, 'Contents', 'Info.plist');
    if (!(await ports.fileExists(plist))) {
      return null;
    }
    // Info.plist is often the binary plist format, so it is converted rather
    // than parsed directly. `plutil` is a macOS built-in.
    const result = await ports.runCommand('plutil', ['-convert', 'json', '-o', '-', plist], { timeoutMs: PLUTIL_TIMEOUT_MS }).catch(() => null);
    if (!result || result.exitCode !== 0) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  async function icnsPathFor(bundlePath: string): Promise<string | null> {
    const info = await readBundleInfo(bundlePath);
    for (const name of icnsCandidateNames(info ?? {})) {
      const candidate = path.join(bundlePath, 'Contents', 'Resources', name);
      if (await ports.fileExists(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  async function renderIcns(icnsPath: string): Promise<string | null> {
    const outputPath = path.join(ports.temporaryDirectory(), `space-app-icon-${randomUUID()}.png`);
    try {
      const result = await ports
        .runCommand('sips', ['-s', 'format', 'png', '-Z', String(ICON_PIXELS), icnsPath, '--out', outputPath], { timeoutMs: SIPS_TIMEOUT_MS })
        .catch(() => null);
      if (!result || result.exitCode !== 0) {
        return null;
      }
      const png = await ports.readFile(outputPath).catch(() => null);
      return png && png.byteLength > 0 ? dataUrlFromPng(png) : null;
    } finally {
      await ports.removeFile(outputPath).catch(() => undefined);
    }
  }

  async function resolve(target: string): Promise<string | null> {
    if (ports.platform === 'darwin' && target.endsWith('.app')) {
      const icnsPath = await icnsPathFor(target);
      if (icnsPath) {
        const rendered = await renderIcns(icnsPath);
        if (rendered) {
          return rendered;
        }
      }
    }
    return ports.systemIconDataUrl(target);
  }

  return {
    async iconFor(target: string): Promise<string | null> {
      const cached = cache.get(target);
      if (cached !== undefined) {
        return cached;
      }
      const resolved = await resolve(target).catch(() => null);
      cache.set(target, resolved);
      return resolved;
    },
  };
}

const PROBE_INFO_PLIST =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
  '<plist version="1.0"><dict>' +
  '<key>CFBundlePackageType</key><string>APPL</string>' +
  '<key>CFBundleName</key><string>Space icon probe</string>' +
  '</dict></plist>\n';

let genericIconPromise: Promise<string | null> | null = null;

/**
 * The placeholder Launch Services hands back for a bundle whose real icon it
 * can't resolve. It is byte-identical for every such bundle, so it can be
 * recognised exactly — by asking for the icon of a throwaway bundle that
 * provably has no artwork of its own. Recognising it matters: without this,
 * a daemon with no icon looks like an app with a blank tile, and a product
 * whose brand mark Space already ships (VS Code, say) would be drawn as that
 * blank tile instead of its logo.
 *
 * Resolved once per process; null when the probe can't be written, in which
 * case nothing is filtered and Launch Services is trusted as before.
 */
async function genericApplicationIcon(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null;
  }
  const probePath = path.join(os.tmpdir(), `space-icon-probe-${randomUUID()}.app`);
  try {
    await fs.mkdir(path.join(probePath, 'Contents'), { recursive: true });
    await fs.writeFile(path.join(probePath, 'Contents', 'Info.plist'), PROBE_INFO_PLIST, 'utf-8');
    const image = await app.getFileIcon(probePath, { size: 'normal' });
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null;
  } finally {
    await fs.rm(probePath, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Real Node/Electron implementations of the ports above. */
export function nodeAppIconPorts(): AppIconPorts {
  return {
    platform: process.platform,
    async runCommand(command, args, options) {
      const result = await nodeRunCommand(command, [...args], { timeoutMs: options.timeoutMs });
      return { exitCode: result.exitCode, stdout: result.stdout };
    },
    readFile: (filePath) => fs.readFile(filePath),
    fileExists: (filePath) => fs.access(filePath).then(() => true, () => false),
    removeFile: (filePath) => fs.rm(filePath, { force: true }),
    temporaryDirectory: () => os.tmpdir(),
    async systemIconDataUrl(target) {
      try {
        const image = await app.getFileIcon(target, { size: 'normal' });
        if (image.isEmpty()) {
          return null;
        }
        const dataUrl = image.toDataURL();
        genericIconPromise ??= genericApplicationIcon();
        // The placeholder is not an icon: report "none" so the caller can show
        // the product's own brand mark, or leave the row out entirely.
        return dataUrl === (await genericIconPromise) ? null : dataUrl;
      } catch {
        return null;
      }
    },
  };
}
