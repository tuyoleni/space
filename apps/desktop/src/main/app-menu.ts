/**
 * The native application menu, built from Electron's standard menu roles so
 * it's fully macOS-compliant (Services, Speech, Emoji & Symbols, standard
 * Window items, etc. all come for free and behave correctly), with Space's
 * own actions layered in. App-specific items send a `menu:command` string to
 * the focused renderer, which maps it to the same handler the in-app buttons
 * use — one source of truth per action.
 *
 * The bold app-menu title ("Space", the About/Hide/Quit item names) comes
 * from the bundle's CFBundleName, not from here — see
 * scripts/patch-dev-app-name.mjs for how that's set in development.
 */
import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

export type MenuCommand =
  | 'new-project'
  | 'add-folder'
  | 'clone'
  | 'new-terminal'
  | 'go-home'
  | 'go-changes'
  | 'go-history'
  | 'go-terminal'
  | 'go-environment'
  | 'git-fetch'
  | 'git-push';

const DOCS_URL = 'https://github.com/tuyoleni/space';

export function buildAppMenu(getWindow: () => BrowserWindow | null, isPackaged: boolean): Menu {
  const isMac = process.platform === 'darwin';

  function send(command: MenuCommand): void {
    getWindow()?.webContents.send('menu:command', command);
  }

  const template: MenuItemConstructorOptions[] = [
    // App menu (macOS) — standard compliant items, built by hand rather
    // than `role: 'appMenu'` only so app-specific commands can be layered
    // in the same way the other menus below do; every other item uses
    // its native role.
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project…', accelerator: 'CmdOrCtrl+N', click: () => send('new-project') },
        { label: 'Add Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('add-folder') },
        { label: 'Clone Repository…', click: () => send('clone') },
        { type: 'separator' },
        { label: 'New Terminal', accelerator: 'CmdOrCtrl+Alt+T', click: () => send('new-terminal') },
        { type: 'separator' },
        ...(isMac ? ([{ role: 'close' }] satisfies MenuItemConstructorOptions[]) : ([{ role: 'quit' }] satisfies MenuItemConstructorOptions[])),
      ],
    },
    // The full editMenu role adds the Speech + Emoji/Symbols submenus and
    // the correct macOS accelerators — proper compliance, not a hand-rolled
    // subset.
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Home', accelerator: 'CmdOrCtrl+1', click: () => send('go-home') },
        { label: 'Changes', accelerator: 'CmdOrCtrl+2', click: () => send('go-changes') },
        { label: 'Terminal', accelerator: 'CmdOrCtrl+3', click: () => send('go-terminal') },
        { label: 'Environment', accelerator: 'CmdOrCtrl+4', click: () => send('go-environment') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        ...(!isPackaged ? ([{ role: 'toggleDevTools' }] satisfies MenuItemConstructorOptions[]) : []),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Git',
      submenu: [
        { label: 'Fetch', click: () => send('git-fetch') },
        { label: 'Push Current Branch', accelerator: 'CmdOrCtrl+Shift+K', click: () => send('git-push') },
        { type: 'separator' },
        { label: 'Open Changes', accelerator: 'CmdOrCtrl+Shift+G', click: () => send('go-changes') },
      ],
    },
    // The full windowMenu role gives the compliant Minimize/Zoom/Front (mac)
    // and the window list.
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Space Documentation', click: () => void shell.openExternal(DOCS_URL) }],
    },
  ];

  return Menu.buildFromTemplate(template);
}
