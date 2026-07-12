import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import type { TrustedSender } from '@space/security';
import { runP0ASpike } from './spikes/p0a-runner';
import { registerIpcHandlers } from './main/ipc';
import { createProjectHandlers, type ProjectHandlers } from './main/project-handlers';
import { StorageClient } from './main/storage-client';
import { TerminalClient } from './main/terminal-client';

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
let handlersRegistered = false;

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

  const storage = startStorageWorker();
  const terminal = startTerminalWorker();
  storageClient = storage;
  terminalClient = terminal;
  projectHandlers = createProjectHandlers(storage);

  // TERM-004/PRJ-006: live PTY/dev processes from a previous run cannot be
  // assumed recoverable — represent them honestly as history before the
  // renderer ever asks.
  void storage.call('system.reconcileOrphans', undefined);

  if (!handlersRegistered) {
    registerIpcHandlers(trustedSender as TrustedSender, storage, terminal, projectHandlers);
    handlersRegistered = true;
  }

  createWindow();
});

app.on('before-quit', () => {
  projectHandlers?.stopAllDevServers();
  terminalClient?.stop();
  storageClient?.stop();
  projectHandlers = null;
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
