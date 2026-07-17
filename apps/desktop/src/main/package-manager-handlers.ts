/**
 * Unified package manager surface (spec: one real search/install/update/
 * remove flow over every package source the machine actually has, not a
 * fixed "toolchain vs services" list). Every `PackageEntry` this module
 * returns is built from a real command or a real network read — nothing is
 * invented, and a source that isn't actually present on this machine (e.g.
 * Homebrew on a machine without it, WinGet on macOS) contributes nothing
 * rather than a fabricated "not connected" placeholder. That distinction is
 * exactly the bug this file replaces: Docker used to be shown as a
 * connectable service even when its CLI didn't exist on disk.
 *
 * Three real sources feed `listInstalled`/`search`:
 *  - Homebrew formulae + casks, via one `brew info --json=v2 --installed`
 *    call (installed) or `brew search` + a batched `brew info --json=v2`
 *    (search) — macOS only.
 *  - Global npm packages, via `npm list -g --depth=0 --json` (installed)
 *    and the public npm registry search API (search) — any platform with npm.
 *  - WinGet is contract-modeled (`PackageSource: 'winget'`) but its listing
 *    has no scriptable JSON output (`winget list` has no `--json` flag) and
 *    its search isn't reliably scriptable either, so win32 here only ever
 *    returns npm-global entries, never a guessed WinGet inventory.
 *
 * Icons are real too: an installed Homebrew cask's own `.app` icon via
 * Electron's `app.getFileIcon` (same technique as system-handlers.ts), or a
 * fetched favicon for anything with a real homepage URL — `null` otherwise,
 * left for the renderer's own generic fallback glyph.
 */
import https from 'node:https';
import { app } from 'electron';
import { nodeRunCommand, compareVersions } from '@space/environment';
import type {
  PackageActionInput,
  PackageActionResult,
  PackageEntry,
  PackageListInstalledResult,
  PackageSearchInput,
  PackageSearchResult,
  PackageSource,
} from '@space/contracts';

const BREW_INFO_TIMEOUT_MS = 15_000;
const BREW_SEARCH_TIMEOUT_MS = 10_000;
const NPM_LIST_TIMEOUT_MS = 15_000;
const HTTPS_TIMEOUT_MS = 8_000;
const PACKAGE_ACTION_TIMEOUT_MS = 300_000;
const SEARCH_RESULT_CAP = 12;
const ACTION_MESSAGE_TAIL_CHARS = 500;

// ---------------------------------------------------------------------------
// Small HTTPS helpers (no new dependency — Node's built-in `https` module).
// Both resolve to a safe fallback (null / rejects) instead of throwing
// uncaught, matching this codebase's "never crash the IPC handler" convention.
// ---------------------------------------------------------------------------

function httpsGetJson(url: string): Promise<unknown> {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        } catch {
          resolve(null);
        }
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(HTTPS_TIMEOUT_MS, () => {
      req.destroy();
      resolve(null);
    });
  });
}

const MAX_REDIRECTS = 3;

/**
 * Fetches a binary resource (e.g. a favicon PNG) as a base64 data URL — null
 * on any failure. Follows a bounded chain of redirects: Google's favicon
 * endpoint (`www.google.com/s2/favicons`) real-world 301s to a `gstatic.com`
 * host, so a redirect-blind fetch would silently return null for every icon.
 */
function httpsGetDataUrl(url: string, contentType: string, redirectsLeft = MAX_REDIRECTS): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(url, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        resolve(httpsGetDataUrl(nextUrl, contentType, redirectsLeft - 1));
        return;
      }
      if (status !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (buffer.length === 0) {
          resolve(null);
          return;
        }
        resolve(`data:${contentType};base64,${buffer.toString('base64')}`);
      });
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(HTTPS_TIMEOUT_MS, () => {
      req.destroy();
      resolve(null);
    });
  });
}

// ---------------------------------------------------------------------------
// Homebrew: installed inventory (`brew info --json=v2 --installed`)
// ---------------------------------------------------------------------------

interface BrewFormulaJson {
  readonly name: string;
  readonly full_name?: string;
  readonly desc?: string | null;
  readonly homepage?: string | null;
  readonly versions?: { readonly stable?: string | null };
  readonly installed?: ReadonlyArray<{ readonly version?: string }>;
}

interface BrewCaskArtifact {
  readonly app?: readonly string[];
  readonly target?: string;
}

interface BrewCaskJson {
  readonly token: string;
  readonly name?: readonly string[];
  readonly desc?: string | null;
  readonly homepage?: string | null;
  readonly version?: string | null;
  readonly installed?: string | null;
  readonly artifacts?: readonly BrewCaskArtifact[];
}

interface BrewInfoJson {
  readonly formulae?: readonly BrewFormulaJson[];
  readonly casks?: readonly BrewCaskJson[];
}

/** Real `.app` target for an installed cask, when Homebrew's own artifact list has one. */
function caskAppTarget(cask: BrewCaskJson): string | null {
  for (const artifact of cask.artifacts ?? []) {
    if (artifact.app && artifact.app.length > 0 && artifact.target) {
      return artifact.target;
    }
  }
  return null;
}

function safeCompare(a: string | null, b: string | null): boolean | null {
  if (a === null || b === null) {
    return null;
  }
  try {
    return compareVersions(a, b) > 0;
  } catch {
    return null;
  }
}

function formulaToEntry(formula: BrewFormulaJson): PackageEntry {
  const installedVersion = formula.installed?.[0]?.version ?? null;
  const latestVersion = formula.versions?.stable ?? null;
  return {
    id: `homebrew-formula:${formula.name}`,
    source: 'homebrew-formula',
    name: formula.name,
    displayName: formula.name,
    description: formula.desc ?? null,
    homepage: formula.homepage ?? null,
    installedVersion,
    latestVersion,
    updateAvailable: safeCompare(latestVersion, installedVersion),
    iconDataUrl: null,
  };
}

function caskToEntry(cask: BrewCaskJson): PackageEntry {
  const installedVersion = cask.installed ?? null;
  const latestVersion = cask.version ?? null;
  return {
    id: `homebrew-cask:${cask.token}`,
    source: 'homebrew-cask',
    name: cask.token,
    displayName: cask.name?.[0] ?? cask.token,
    description: cask.desc ?? null,
    homepage: cask.homepage ?? null,
    installedVersion,
    latestVersion,
    updateAvailable: safeCompare(latestVersion, installedVersion),
    iconDataUrl: null,
  };
}

/** Real installed Homebrew inventory in one call — empty on any failure (non-darwin, Homebrew absent, parse error), never thrown. */
async function readInstalledHomebrew(): Promise<{ formulae: BrewFormulaJson[]; casks: BrewCaskJson[] }> {
  if (process.platform !== 'darwin') {
    // Homebrew is a macOS/Linux tool; on win32 this source contributes nothing.
    return { formulae: [], casks: [] };
  }
  const result = await nodeRunCommand('brew', ['info', '--json=v2', '--installed'], { timeoutMs: BREW_INFO_TIMEOUT_MS }).catch(
    () => null,
  );
  if (!result || result.exitCode !== 0) {
    return { formulae: [], casks: [] };
  }
  try {
    const parsed = JSON.parse(result.stdout) as BrewInfoJson;
    return { formulae: [...(parsed.formulae ?? [])], casks: [...(parsed.casks ?? [])] };
  } catch {
    return { formulae: [], casks: [] };
  }
}

/** Batched `brew info --json=v2 <names...>` for formulae — empty on any failure (including one bad name failing the whole batch; see search()'s handling). */
async function lookupBrewFormulae(names: readonly string[]): Promise<BrewFormulaJson[]> {
  if (names.length === 0) {
    return [];
  }
  const result = await nodeRunCommand('brew', ['info', '--json=v2', ...names], { timeoutMs: BREW_INFO_TIMEOUT_MS }).catch(() => null);
  if (!result || result.exitCode !== 0) {
    return [];
  }
  try {
    return [...((JSON.parse(result.stdout) as BrewInfoJson).formulae ?? [])];
  } catch {
    return [];
  }
}

/** Batched `brew info --json=v2 --cask <tokens...>` — same failure handling as lookupBrewFormulae. */
async function lookupBrewCasks(tokens: readonly string[]): Promise<BrewCaskJson[]> {
  if (tokens.length === 0) {
    return [];
  }
  const result = await nodeRunCommand('brew', ['info', '--json=v2', '--cask', ...tokens], { timeoutMs: BREW_INFO_TIMEOUT_MS }).catch(
    () => null,
  );
  if (!result || result.exitCode !== 0) {
    return [];
  }
  try {
    return [...((JSON.parse(result.stdout) as BrewInfoJson).casks ?? [])];
  } catch {
    return [];
  }
}

/** `brew search --formula <query>` / `--cask <query>` — a plain newline-separated name list, capped and empty on failure. */
async function searchBrewNames(kind: 'formula' | 'cask', query: string): Promise<string[]> {
  if (process.platform !== 'darwin') {
    return [];
  }
  const result = await nodeRunCommand('brew', ['search', `--${kind}`, query], { timeoutMs: BREW_SEARCH_TIMEOUT_MS }).catch(() => null);
  if (!result || result.exitCode !== 0) {
    return [];
  }
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('==>'))
    .slice(0, SEARCH_RESULT_CAP);
}

// ---------------------------------------------------------------------------
// npm-global
// ---------------------------------------------------------------------------

interface NpmListJson {
  readonly dependencies?: Readonly<Record<string, { readonly version?: string }>>;
}

/** Real global npm packages via `npm list -g --depth=0 --json` — empty on any failure, never thrown. */
async function readInstalledNpmGlobal(): Promise<Map<string, string>> {
  const result = await nodeRunCommand('npm', ['list', '-g', '--depth=0', '--json'], { timeoutMs: NPM_LIST_TIMEOUT_MS }).catch(() => null);
  if (!result || !result.stdout) {
    return new Map();
  }
  try {
    const parsed = JSON.parse(result.stdout) as NpmListJson;
    const entries = Object.entries(parsed.dependencies ?? {});
    return new Map(entries.filter(([, info]) => typeof info.version === 'string').map(([name, info]) => [name, info.version as string]));
  } catch {
    return new Map();
  }
}

interface NpmRegistrySearchHit {
  readonly package: {
    readonly name: string;
    readonly version?: string;
    readonly description?: string | null;
    readonly links?: { readonly homepage?: string | null };
  };
}

/** Real public npm registry search — empty on any failure (offline, timeout, non-200), never thrown. */
async function searchNpmRegistry(query: string): Promise<NpmRegistrySearchHit[]> {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${SEARCH_RESULT_CAP}`;
  const parsed = (await httpsGetJson(url)) as { objects?: NpmRegistrySearchHit[] } | null;
  return parsed?.objects ? [...parsed.objects] : [];
}

// ---------------------------------------------------------------------------
// Icon resolution: real `.app` icon for installed casks (Electron's
// getFileIcon, same technique as system-handlers.ts), else a real fetched
// favicon for anything with a homepage — never a placeholder.
// ---------------------------------------------------------------------------

function hostnameOf(homepage: string): string | null {
  try {
    return new URL(homepage).hostname;
  } catch {
    return null;
  }
}

function createIconResolver() {
  // Cached by the key actually used to resolve it (app bundle path, or
  // favicon hostname) — repeated lookups for the same package are free.
  const appIconCache = new Map<string, string | null>();
  const faviconCache = new Map<string, string | null>();

  async function appIconFor(target: string): Promise<string | null> {
    const cached = appIconCache.get(target);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const image = await app.getFileIcon(target, { size: 'small' });
      const dataUrl = image.isEmpty() ? null : image.toDataURL();
      appIconCache.set(target, dataUrl);
      return dataUrl;
    } catch {
      appIconCache.set(target, null);
      return null;
    }
  }

  async function faviconFor(homepage: string): Promise<string | null> {
    const hostname = hostnameOf(homepage);
    if (hostname === null) {
      return null;
    }
    const cached = faviconCache.get(hostname);
    if (cached !== undefined) {
      return cached;
    }
    const dataUrl = await httpsGetDataUrl(`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname)}`, 'image/png');
    faviconCache.set(hostname, dataUrl);
    return dataUrl;
  }

  /** entry.homepage/appTarget already resolved by the caller; this is the shared fallback chain. */
  async function resolve(entry: PackageEntry, appTarget: string | null): Promise<string | null> {
    if (appTarget !== null) {
      const appIcon = await appIconFor(appTarget);
      if (appIcon !== null) {
        return appIcon;
      }
    }
    if (entry.homepage !== null) {
      return faviconFor(entry.homepage);
    }
    return null;
  }

  return { resolve };
}

// ---------------------------------------------------------------------------
// listInstalled / search
// ---------------------------------------------------------------------------

export interface PackageManagerHandlers {
  listInstalled(): Promise<PackageListInstalledResult>;
  search(input: PackageSearchInput): Promise<PackageSearchResult>;
  install(input: PackageActionInput): Promise<PackageActionResult>;
  update(input: PackageActionInput): Promise<PackageActionResult>;
  uninstall(input: PackageActionInput): Promise<PackageActionResult>;
}

export function createPackageManagerHandlers(): PackageManagerHandlers {
  const icons = createIconResolver();

  async function listInstalled(): Promise<PackageListInstalledResult> {
    const [{ formulae, casks }, npmGlobal] = await Promise.all([readInstalledHomebrew(), readInstalledNpmGlobal()]);

    const formulaEntries = formulae.map(formulaToEntry);
    const caskEntriesRaw = casks.map((cask) => ({ cask, entry: caskToEntry(cask) }));
    const npmEntries: PackageEntry[] = [...npmGlobal.entries()].map(([name, version]) => ({
      id: `npm-global:${name}`,
      source: 'npm-global',
      name,
      displayName: name,
      // Description/homepage aren't looked up for every installed npm package
      // (that would be N network calls just to list what's already there) —
      // null is honest; search() resolves these for real when it matters.
      description: null,
      homepage: null,
      installedVersion: version,
      latestVersion: null,
      updateAvailable: null,
      iconDataUrl: null,
    }));

    // Icon resolution does real network/getFileIcon I/O — only for entries
    // that don't already have a cheaper resolvable source, run in parallel
    // as a manual "Rescan"-triggered action, not a hot path.
    const [formulaWithIcons, caskWithIcons, npmWithIcons] = await Promise.all([
      Promise.all(formulaEntries.map(async (entry) => ({ ...entry, iconDataUrl: await icons.resolve(entry, null) }))),
      Promise.all(
        caskEntriesRaw.map(async ({ cask, entry }) => ({ ...entry, iconDataUrl: await icons.resolve(entry, caskAppTarget(cask)) })),
      ),
      Promise.all(npmEntries.map(async (entry) => ({ ...entry, iconDataUrl: await icons.resolve(entry, null) }))),
    ]);

    return {
      scannedAt: new Date().toISOString(),
      packages: [...formulaWithIcons, ...caskWithIcons, ...npmWithIcons],
    };
  }

  async function search(input: PackageSearchInput): Promise<PackageSearchResult> {
    const [formulaNames, caskNames, npmHits, installedHomebrew, installedNpm] = await Promise.all([
      searchBrewNames('formula', input.query),
      searchBrewNames('cask', input.query),
      searchNpmRegistry(input.query),
      readInstalledHomebrew(),
      readInstalledNpmGlobal(),
    ]);

    const [formulaInfos, caskInfos] = await Promise.all([lookupBrewFormulae(formulaNames), lookupBrewCasks(caskNames)]);

    const installedFormulaVersions = new Map(
      installedHomebrew.formulae.map((formula) => [formula.name, formula.installed?.[0]?.version ?? null]),
    );
    const installedCaskVersions = new Map(installedHomebrew.casks.map((cask) => [cask.token, cask.installed ?? null]));

    const formulaEntries: PackageEntry[] = formulaInfos.map((formula) => {
      const installedVersion = installedFormulaVersions.get(formula.name) ?? null;
      const latestVersion = formula.versions?.stable ?? null;
      return {
        id: `homebrew-formula:${formula.name}`,
        source: 'homebrew-formula',
        name: formula.name,
        displayName: formula.name,
        description: formula.desc ?? null,
        homepage: formula.homepage ?? null,
        installedVersion,
        latestVersion,
        updateAvailable: safeCompare(latestVersion, installedVersion),
        iconDataUrl: null,
      };
    });

    const caskEntries: Array<{ cask: BrewCaskJson; entry: PackageEntry }> = caskInfos.map((cask) => {
      const installedVersion = installedCaskVersions.get(cask.token) ?? null;
      const latestVersion = cask.version ?? null;
      return {
        cask,
        entry: {
          id: `homebrew-cask:${cask.token}`,
          source: 'homebrew-cask',
          name: cask.token,
          displayName: cask.name?.[0] ?? cask.token,
          description: cask.desc ?? null,
          homepage: cask.homepage ?? null,
          installedVersion,
          latestVersion,
          updateAvailable: safeCompare(latestVersion, installedVersion),
          iconDataUrl: null,
        },
      };
    });

    const npmEntries: PackageEntry[] = npmHits.map((hit) => {
      const name = hit.package.name;
      const installedVersion = installedNpm.get(name) ?? null;
      const latestVersion = hit.package.version ?? null;
      return {
        id: `npm-global:${name}`,
        source: 'npm-global',
        name,
        displayName: name,
        description: hit.package.description ?? null,
        homepage: hit.package.links?.homepage ?? null,
        installedVersion,
        latestVersion,
        updateAvailable: safeCompare(latestVersion, installedVersion),
        iconDataUrl: null,
      };
    });

    const [formulaWithIcons, caskWithIcons, npmWithIcons] = await Promise.all([
      Promise.all(formulaEntries.map(async (entry) => ({ ...entry, iconDataUrl: await icons.resolve(entry, null) }))),
      Promise.all(
        caskEntries.map(async ({ cask, entry }) => ({ ...entry, iconDataUrl: await icons.resolve(entry, caskAppTarget(cask)) })),
      ),
      Promise.all(npmEntries.map(async (entry) => ({ ...entry, iconDataUrl: await icons.resolve(entry, null) }))),
    ]);

    return {
      query: input.query,
      packages: [...formulaWithIcons, ...caskWithIcons, ...npmWithIcons],
    };
  }

  // -------------------------------------------------------------------------
  // install / update / uninstall
  // -------------------------------------------------------------------------

  function buildActionCommand(input: PackageActionInput, action: 'install' | 'update' | 'uninstall'): { executable: string; args: readonly string[] } | null {
    switch (input.source) {
      case 'homebrew-formula': {
        const verb = action === 'update' ? 'upgrade' : action;
        return { executable: 'brew', args: [verb, input.name] };
      }
      case 'homebrew-cask': {
        const verb = action === 'update' ? 'upgrade' : action;
        return { executable: 'brew', args: [verb, '--cask', input.name] };
      }
      case 'npm-global': {
        if (action === 'install') {
          return { executable: 'npm', args: ['install', '-g', input.name] };
        }
        if (action === 'update') {
          return { executable: 'npm', args: ['update', '-g', input.name] };
        }
        return { executable: 'npm', args: ['uninstall', '-g', input.name] };
      }
      case 'winget': {
        // Mirrors the exact flag conventions windows-plan.ts/environment-handlers.ts
        // already use for WinGet install/upgrade.
        if (action === 'install') {
          return {
            executable: 'winget',
            args: ['install', '--id', input.name, '-e', '--accept-package-agreements', '--accept-source-agreements'],
          };
        }
        if (action === 'update') {
          return {
            executable: 'winget',
            args: ['upgrade', '--id', input.name, '-e', '--accept-package-agreements', '--accept-source-agreements'],
          };
        }
        return { executable: 'winget', args: ['uninstall', '--id', input.name, '-e'] };
      }
      default:
        return null;
    }
  }

  async function runAction(input: PackageActionInput, action: 'install' | 'update' | 'uninstall'): Promise<PackageActionResult> {
    const command = buildActionCommand(input, action);
    if (!command) {
      return { source: input.source, name: input.name, succeeded: false, exitCode: null, message: `Unknown package source "${input.source}".` };
    }

    const result = await nodeRunCommand(command.executable, command.args, { timeoutMs: PACKAGE_ACTION_TIMEOUT_MS }).catch(
      (error: unknown) => ({
        exitCode: null as number | null,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      }),
    );

    const succeeded = result.exitCode === 0;
    if (succeeded) {
      return { source: input.source, name: input.name, succeeded: true, exitCode: result.exitCode, message: null };
    }
    const tail = (result.stderr || result.stdout).trim().slice(-ACTION_MESSAGE_TAIL_CHARS);
    return {
      source: input.source,
      name: input.name,
      succeeded: false,
      exitCode: result.exitCode,
      message: tail.length > 0 ? tail : `${action} failed for "${input.name}".`,
    };
  }

  async function install(input: PackageActionInput): Promise<PackageActionResult> {
    return runAction(input, 'install');
  }

  async function update(input: PackageActionInput): Promise<PackageActionResult> {
    return runAction(input, 'update');
  }

  async function uninstall(input: PackageActionInput): Promise<PackageActionResult> {
    return runAction(input, 'uninstall');
  }

  return { listInstalled, search, install, update, uninstall };
}

// Exported for exhaustiveness checks / potential reuse by tests; not part of the public handler surface.
export type { PackageSource };
