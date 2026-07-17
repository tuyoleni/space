/**
 * Resolves a real icon asset for a project by reading its own files — the
 * favicon a web app ships, the app icon a native/Expo/Tauri/Electron project
 * ships, or any icon/logo lying at a conventional path. It first probes a
 * prioritized candidate list (covers the common frameworks), then falls back
 * to a shallow scan of the root and the usual asset dirs, so it finds
 * something "no matter how bad the codebase is" without ever walking a huge
 * tree. Everything is read-only; a missing/oversized/unknown file is simply
 * skipped and the caller shows a generated fallback tile.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectIconInput, ProjectIconResult } from '@space/contracts';

const MAX_ICON_BYTES = 1024 * 1024; // 1 MB — skip anything larger than a real icon.

const MIME_BY_EXT: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// Favicons only (per request — not logo/app-icon files). Highest-signal
// first: the conventional favicon locations across web frameworks.
const CANDIDATE_PATHS: readonly string[] = [
  'public/favicon.svg',
  'public/favicon.ico',
  'public/favicon.png',
  'public/favicon-32x32.png',
  'public/apple-touch-icon.png',
  'app/favicon.ico', // Next.js app router
  'app/icon.svg', // Next.js app router favicon convention
  'app/icon.png',
  'static/favicon.svg', // SvelteKit / Astro
  'static/favicon.ico',
  'static/favicon.png',
  'src/favicon.ico',
  'src/app/favicon.ico',
  'favicon.svg',
  'favicon.ico',
  'favicon.png',
  'apple-touch-icon.png',
];

// Dirs to shallow-scan (one level) when no candidate matched — favicon names only.
const SCAN_DIRS: readonly string[] = ['', 'public', 'static', 'app', 'src', 'src/app'];
const SCAN_NAME_RE = /^(favicon|apple-touch-icon)[\w-]*\.(svg|png|ico)$/i;

async function readAsDataUrl(absPath: string): Promise<ProjectIconResult | null> {
  try {
    const stat = await fs.stat(absPath);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_ICON_BYTES) {
      return null;
    }
    const mime = MIME_BY_EXT[path.extname(absPath).toLowerCase()];
    if (!mime) {
      return null;
    }
    const buffer = await fs.readFile(absPath);
    return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
  } catch {
    return null;
  }
}

export interface AssetHandlers {
  projectIcon(input: ProjectIconInput): Promise<ProjectIconResult | null>;
}

export function createAssetHandlers(): AssetHandlers {
  // Cache by project path — a project's icon rarely changes within a session.
  const cache = new Map<string, ProjectIconResult | null>();

  async function projectIcon(input: ProjectIconInput): Promise<ProjectIconResult | null> {
    const root = input.canonicalPath;
    const cached = cache.get(root);
    if (cached !== undefined) {
      return cached;
    }

    for (const candidate of CANDIDATE_PATHS) {
      const found = await readAsDataUrl(path.join(root, candidate));
      if (found) {
        cache.set(root, found);
        return found;
      }
    }

    for (const dir of SCAN_DIRS) {
      let entries: string[];
      try {
        entries = await fs.readdir(path.join(root, dir));
      } catch {
        continue;
      }
      const match = entries.find((name) => SCAN_NAME_RE.test(name));
      if (match) {
        const found = await readAsDataUrl(path.join(root, dir, match));
        if (found) {
          cache.set(root, found);
          return found;
        }
      }
    }

    cache.set(root, null);
    return null;
  }

  return { projectIcon };
}
