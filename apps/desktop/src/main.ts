import { app, BrowserWindow, session, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { runP0ASpike } from './spikes/p0a-runner';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

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

function applyStrictContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
            "script-src 'self'; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; " +
            "connect-src 'self'; " +
            "object-src 'none'; " +
            "base-uri 'none'; " +
            "frame-src 'none';",
        ],
      },
    });
  });
}

app.on('ready', () => {
  if (process.env.SPACE_RUN_P0A_SPIKE === '1') {
    void runP0ASpike();
    return;
  }
  applyStrictContentSecurityPolicy();
  createWindow();
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
