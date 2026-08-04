/**
 * Settings Panel: application settings organized in tabs.
 * Persists preferences via usePersistentState.
 */
import { useState } from 'react';
import {
  Settings,
  Palette,
  Terminal,
  Bell,
  Info,
} from 'lucide-react';
import { Dialog, Input, Checkbox, Select, cn } from '@space/ui';
import { usePersistentState } from './usePersistentState';
import type { Theme } from './ThemeToggle';

interface SettingsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly theme: Theme;
  readonly onThemeChange: (theme: Theme) => void;
}

type SettingsTab = 'general' | 'appearance' | 'terminal' | 'notifications' | 'about';

const TABS: { id: SettingsTab; label: string; icon: typeof Settings }[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'about', label: 'About', icon: Info },
];

function GeneralTab() {
  const [autoUpdate, setAutoUpdate] = usePersistentState('space:setting:autoUpdate', true);
  const [showDevTools, setShowDevTools] = usePersistentState('space:setting:showDevTools', false);
  const [confirmOnQuit, setConfirmOnQuit] = usePersistentState('space:setting:confirmOnQuit', true);

  return (
    <div className="space-y-4">
      <SettingRow
        label="Check for updates on launch"
        description="Automatically check for new versions when Space starts."
      >
        <Checkbox checked={autoUpdate} onCheckedChange={(v) => setAutoUpdate(!!v)} />
      </SettingRow>
      <SettingRow
        label="Show developer tools option"
        description="Adds a Developer menu item to the top bar."
      >
        <Checkbox checked={showDevTools} onCheckedChange={(v) => setShowDevTools(!!v)} />
      </SettingRow>
      <SettingRow
        label="Confirm before quitting"
        description="Show a confirmation dialog when you try to quit."
      >
        <Checkbox checked={confirmOnQuit} onCheckedChange={(v) => setConfirmOnQuit(!!v)} />
      </SettingRow>
    </div>
  );
}

function AppearanceTab({ theme, onThemeChange }: { theme: Theme; onThemeChange: (t: Theme) => void }) {
  const [fontSize, setFontSize] = usePersistentState('space:setting:fontSize', 13);
  const [sidebarWidth, setSidebarWidth] = usePersistentState('space:setting:sidebarWidth', 220);
  const [showAnimations, setShowAnimations] = usePersistentState('space:setting:showAnimations', true);

  return (
    <div className="space-y-4">
      <SettingRow label="Theme" description="Choose between dark and light mode.">
        <Select
          value={theme}
          onValueChange={(v) => onThemeChange(v as Theme)}
          ariaLabel="Theme"
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
          ]}
        />
      </SettingRow>
      <SettingRow label="UI font size" description="Base font size for the interface.">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={11}
            max={16}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-24"
          />
          <span className="w-8 text-center text-xs text-fg">{fontSize}px</span>
        </div>
      </SettingRow>
      <SettingRow label="Sidebar width" description="Width of the sidebar in pixels.">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={180}
            max={320}
            step={10}
            value={sidebarWidth}
            onChange={(e) => setSidebarWidth(Number(e.target.value))}
            className="w-24"
          />
          <span className="w-10 text-center text-xs text-fg">{sidebarWidth}px</span>
        </div>
      </SettingRow>
      <SettingRow label="Animations" description="Enable or disable UI transitions.">
        <Checkbox checked={showAnimations} onCheckedChange={(v) => setShowAnimations(!!v)} />
      </SettingRow>
    </div>
  );
}

function TerminalSettingsTab() {
  const [fontSize, setFontSize] = usePersistentState('space:setting:termFontSize', 13);
  const [fontFamily, setFontFamily] = usePersistentState('space:setting:termFontFamily', 'monospace');
  const [cursorStyle, setCursorStyle] = usePersistentState('space:setting:termCursorStyle', 'block');
  const [scrollback, setScrollback] = usePersistentState('space:setting:termScrollback', 5000);

  return (
    <div className="space-y-4">
      <SettingRow label="Font size" description="Terminal text size.">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={10}
            max={20}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="w-24"
          />
          <span className="w-8 text-center text-xs text-fg">{fontSize}px</span>
        </div>
      </SettingRow>
      <SettingRow label="Font family" description="Font used for terminal text.">
        <Input
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
          className="h-7 w-48 text-xs"
        />
      </SettingRow>
      <SettingRow label="Cursor style" description="Shape of the terminal cursor.">
        <Select
          value={cursorStyle}
          onValueChange={(v) => setCursorStyle(v)}
          ariaLabel="Cursor style"
          options={[
            { value: 'block', label: 'Block' },
            { value: 'underline', label: 'Underline' },
            { value: 'bar', label: 'Bar' },
          ]}
        />
      </SettingRow>
      <SettingRow label="Scrollback lines" description="Number of lines to keep in scroll history.">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1000}
            max={20000}
            step={500}
            value={scrollback}
            onChange={(e) => setScrollback(Number(e.target.value))}
            className="w-24"
          />
          <span className="w-12 text-center text-xs text-fg">{scrollback}</span>
        </div>
      </SettingRow>
    </div>
  );
}

function NotificationsTab() {
  const [gitNotifications, setGitNotifications] = usePersistentState('space:setting:notif:git', true);
  const [terminalNotifications, setTerminalNotifications] = usePersistentState('space:setting:notif:terminal', true);
  const [buildNotifications, setBuildNotifications] = usePersistentState('space:setting:notif:build', true);

  return (
    <div className="space-y-4">
      <SettingRow label="Git operations" description="Notifications for fetch, push, and commit.">
        <Checkbox checked={gitNotifications} onCheckedChange={(v) => setGitNotifications(!!v)} />
      </SettingRow>
      <SettingRow label="Terminal" description="Notifications for terminal process exits.">
        <Checkbox checked={terminalNotifications} onCheckedChange={(v) => setTerminalNotifications(!!v)} />
      </SettingRow>
      <SettingRow label="Build & Dev Server" description="Notifications for build status.">
        <Checkbox checked={buildNotifications} onCheckedChange={(v) => setBuildNotifications(!!v)} />
      </SettingRow>
    </div>
  );
}

function AboutSettingsTab() {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-purple-500 shadow-lg">
        <span className="text-lg font-bold text-white">S</span>
      </div>
      <h3 className="text-sm font-bold text-fg">Space</h3>
      <p className="text-[11px] text-fg-muted">Your AI-powered workspace</p>
      <a
        href="https://github.com/tuyoleni/space"
        target="_blank"
        rel="noreferrer"
        className="mt-2 text-[11px] text-accent hover:text-accent-hover"
      >
        github.com/tuyoleni/space
      </a>
    </div>
  );
}

function SettingRow({ label, description, children }: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface/50 p-3">
      <div>
        <p className="text-xs font-medium text-fg">{label}</p>
        <p className="mt-0.5 text-[10px] text-fg-faint">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function SettingsDialog({ open, onOpenChange, theme, onThemeChange }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Settings" size="lg">
      <div className="flex gap-4">
        {/* Tab sidebar */}
        <div className="w-36 shrink-0 space-y-0.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors',
                  activeTab === tab.id
                    ? 'bg-accent/10 text-accent'
                    : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                )}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="min-h-[300px] flex-1">
          {activeTab === 'general' && <GeneralTab />}
          {activeTab === 'appearance' && <AppearanceTab theme={theme} onThemeChange={onThemeChange} />}
          {activeTab === 'terminal' && <TerminalSettingsTab />}
          {activeTab === 'notifications' && <NotificationsTab />}
          {activeTab === 'about' && <AboutSettingsTab />}
        </div>
      </div>
    </Dialog>
  );
}
