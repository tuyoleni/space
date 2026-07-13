import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import type { Logger } from '@space/logging';
import { createNodeOsCredentialExecutor, NodeKeychainCredentialStore, type CredentialStorePort, type TrustedSender } from '@space/security';
import { runP0ASpike } from './spikes/p0a-runner';
import { createAgentHandlers, type AgentHandlers } from './main/agent-handlers';
import { createAutomationHandlers, type AutomationHandlers } from './main/automation-handlers';
import { createGitHandlers, type GitHandlers } from './main/git-handlers';
import { createGithubHandlers, type GithubHandlers } from './main/github-handlers';
import { fireAutomationTrigger, registerIpcHandlers } from './main/ipc';
import { createAppLogger } from './main/logging';
import { createProjectHandlers, type ProjectHandlers } from './main/project-handlers';
import { StorageClient } from './main/storage-client';
import { TerminalClient } from './main/terminal-client';

/**
 * The real OS credential store (spec 5.6, 24.1, ADR-002) — macOS via the
 * `security` CLI, Windows via DPAPI (see keychain-credential-store.ts for
 * why). Space targets only macOS and Windows (README); any other
 * platform fails loudly here rather than silently falling back to an
 * insecure store.
 */
function createRealCredentialStore(): CredentialStorePort {
  const executor = createNodeOsCredentialExecutor();
  if (process.platform === 'darwin') {
    return new NodeKeychainCredentialStore({ platform: 'darwin', executor });
  }
  if (process.platform === 'win32') {
    return new NodeKeychainCredentialStore({
      platform: 'win32',
      executor,
      windowsCredentialsDir: path.join(app.getPath('userData'), 'credentials'),
    });
  }
  throw new Error(`Space supports macOS and Windows only; unsupported platform for credential storage: ${process.platform}`);
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

// Single trusted application window (spec sections 20.3, 22.1, 25.3.1).
// webContentsId is filled in once the window exists; every IPC handler
// checks against this before doing anything else.
const trustedSender: { webContentsId: number; allowedOriginPrefixes: readonly string[] } = {
  webContentsId: -1,
  allowedOriginPrefixes:
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' ? [MAIN_WINDOW_VITE_DEV_SERVER_URL] : ['file://'],
};

let storageClient: StorageClient | null = null;
let terminalClient: TerminalClient | null = null;
let projectHandlers: ProjectHandlers | null = null;
let gitHandlers: GitHandlers | null = null;
let githubHandlers: GithubHandlers | null = null;
let agentHandlers: AgentHandlers | null = null;
let automationHandlers: AutomationHandlers | null = null;
let handlersRegistered = false;
let scheduledAutomationTimer: ReturnType<typeof setInterval> | null = null;

/**
 * M8: how often the `scheduled` automation trigger (spec 18.2) is checked
 * while the app is running — there is no OS-level scheduler (spec 18.5),
 * so this is the only clock driving it. One minute gives the model's
 * minimum `intervalMinutes` (1, see `@space/automation`'s
 * `AutomationTriggerSchema`) a real chance to fire close to on time
 * without polling every workspace's automations excessively.
 */
const SCHEDULED_AUTOMATION_TICK_MS = 60_000;

/**
 * M8: fires the `dev-process-exited` automation trigger (spec 18.2) from
 * project-handlers.ts's dev-process exit callback. A plain mutable
 * function reference rather than a constructor dependency, because
 * `createAutomationHandlers` itself depends on the already-constructed
 * `projectHandlers` (it calls `projectHandlers.detectPackageManager`) —
 * this is set once `automationHandlers` exists, a few lines after
 * `projectHandlers` is created.
 */
let fireDevProcessExitedTrigger: ((event: {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly devProcessId: string;
  readonly exitCode: number | null;
  readonly state: 'stopped' | 'crashed';
}) => void) | null = null;

function startStorageWorker(): StorageClient {
  const dbPath = path.join(app.getPath('userData'), 'space.sqlite');
  const workerPath = path.join(__dirname, 'storage-worker.js');
  const client = new StorageClient(workerPath, dbPath);
  client.start();
  return client;
}

function startTerminalWorker(): TerminalClient {
  const workerPath = path.join(__dirname, 'terminal-worker.js');
  const client = new TerminalClient(workerPath);
  client.start();
  return client;
}

/**
 * Every production window must use these defaults (spec section 20.3).
 * The renderer never receives Node integration, unrestricted filesystem
 * access, or a generic execute/command channel.
 */
const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  trustedSender.webContentsId = mainWindow.webContents.id;

  // Deny all permission requests by default; specific approved flows will
  // request narrowly-scoped permissions explicitly as features land.
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(false);
    },
  );

  // Restrict navigation to the app's own dev server / packaged origin.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDevServer =
      typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' &&
      url.startsWith(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    const isPackagedAppLoad = url.startsWith('file://');
    if (!isDevServer && !isPackagedAppLoad) {
      event.preventDefault();
    }
  });

  // Never open renderer-requested windows directly; validate and hand off
  // to the OS browser instead (spec section 15.6 / 20.3).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalIfSafe(url);
    return { action: 'deny' };
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
};

async function openExternalIfSafe(url: string): Promise<void> {
  try {
    const parsed = new URL(url);
    if (ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      await shell.openExternal(url);
    }
  } catch {
    // Malformed URL: ignore rather than risk executing it.
  }
}

/**
 * The packaged app always gets the fully strict policy (spec section 20.3).
 * The Vite dev server needs a relaxation of `script-src`/`connect-src` for
 * its inline react-refresh preamble and HMR websocket — without it, React
 * throws "@vitejs/plugin-react can't detect preamble" on every dev launch.
 * That relaxation never ships: MAIN_WINDOW_VITE_DEV_SERVER_URL is only
 * defined by the dev server, never in a packaged build.
 */
function contentSecurityPolicy(): string {
  const devServerUrl =
    typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string' ? MAIN_WINDOW_VITE_DEV_SERVER_URL : null;
  if (!devServerUrl) {
    return (
      "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; " +
      "connect-src 'self'; " +
      "object-src 'none'; " +
      "base-uri 'none'; " +
      "frame-src 'none';"
    );
  }
  const wsUrl = devServerUrl.replace(/^http/, 'ws');
  return (
    `default-src 'self' ${devServerUrl}; ` +
    `script-src 'self' 'unsafe-inline' ${devServerUrl}; ` +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    `connect-src 'self' ${devServerUrl} ${wsUrl}; ` +
    "object-src 'none'; " +
    "base-uri 'none'; " +
    "frame-src 'none';"
  );
}

function applyContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [contentSecurityPolicy()],
      },
    });
  });
}

app.on('ready', () => {
  if (process.env.SPACE_RUN_P0A_SPIKE === '1') {
    void runP0ASpike();
    return;
  }
  applyContentSecurityPolicy();

  // spec 29.3: real, local-only, rotating/redacted logging — replaces the
  // ad hoc console.error this file and ipc.ts used before M8.
  const logger: Logger = createAppLogger(path.join(app.getPath('userData'), 'logs'), app.isPackaged);
  logger.info('Space starting', { packaged: app.isPackaged, platform: process.platform });

  const storage = startStorageWorker();
  const terminal = startTerminalWorker();
  storageClient = storage;
  terminalClient = terminal;
  projectHandlers = createProjectHandlers(storage, {
    onDevProcessExited: (event) => fireDevProcessExitedTrigger?.(event),
  });
  gitHandlers = createGitHandlers(storage, {
    historyCacheDir: path.join(app.getPath('userData'), 'cache', 'git-history'),
  });
  githubHandlers = createGithubHandlers(storage, {
    credentialStore: createRealCredentialStore(),
    terminal,
    ghConfigDirFor: (workspaceId) => path.join(app.getPath('userData'), 'workspaces', workspaceId, 'gh-config'),
  });
  // M7: no ModelProvider is passed — rule-based grouping is the real,
  // always-available default (spec 13.3, ADR-008); a remote/local model
  // provider is an architecturally-supported but not-yet-connected seam.
  agentHandlers = createAgentHandlers(storage, { gitHandlers, projectHandlers, githubHandlers });
  // M8: every action handler dispatches into the same already-existing
  // gitHandlers/githubHandlers/projectHandlers this app already built for
  // M4-M6 — no parallel capability implementation (spec 18.3).
  automationHandlers = createAutomationHandlers(storage, { gitHandlers, githubHandlers, projectHandlers });
  fireDevProcessExitedTrigger = (event) =>
    fireAutomationTrigger(
      automationHandlers as AutomationHandlers,
      {
        type: 'dev-process-exited',
        workspaceId: event.workspaceId,
        projectId: event.projectId,
        occurredAt: new Date().toISOString(),
        context: { devProcessId: event.devProcessId, exitCode: event.exitCode, state: event.state },
      },
      logger,
    );

  // M8: the one clock driving the `scheduled` trigger (spec 18.2) — see
  // `SCHEDULED_AUTOMATION_TICK_MS`'s comment. Failures here must never
  // crash the app; each tick has its own error boundary.
  scheduledAutomationTimer = setInterval(() => {
    automationHandlers?.runDueScheduledAutomations().catch((error) => {
      logger.error('Scheduled automation tick failed', { errorMessage: error instanceof Error ? error.message : String(error) });
    });
  }, SCHEDULED_AUTOMATION_TICK_MS);

  // TERM-004/PRJ-006: live PTY/dev processes from a previous run cannot be
  // assumed recoverable — represent them honestly as history before the
  // renderer ever asks.
  void storage.call('system.reconcileOrphans', undefined);

  if (!handlersRegistered) {
    registerIpcHandlers(
      trustedSender as TrustedSender,
      storage,
      terminal,
      projectHandlers,
      gitHandlers,
      githubHandlers,
      agentHandlers,
      automationHandlers,
      logger,
    );
    handlersRegistered = true;
  }

  createWindow();
});

app.on('before-quit', () => {
  if (scheduledAutomationTimer) {
    clearInterval(scheduledAutomationTimer);
    scheduledAutomationTimer = null;
  }
  fireDevProcessExitedTrigger = null;
  projectHandlers?.stopAllDevServers();
  terminalClient?.stop();
  storageClient?.stop();
  projectHandlers = null;
  gitHandlers = null;
  githubHandlers = null;
  agentHandlers = null;
  automationHandlers = null;
  terminalClient = null;
  storageClient = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('web-contents-created', (_event, contents) => {
  // Defence in depth against a compromised/renderer-injected page trying to
  // attach a preload or open a devtools-based bypass (section 25.3.1).
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
});
