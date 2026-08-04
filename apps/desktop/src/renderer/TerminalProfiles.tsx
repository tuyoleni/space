/**
 * Terminal Profiles: manage shell profiles (bash, zsh, fish, etc.)
 * with visual configuration. Allows selecting the default shell,
 * setting custom shell paths, and configuring environment variables.
 */
import { useState, useCallback } from 'react';
import {
  Terminal,
  Plus,
  Trash2,
  Check,
  Settings,
  FolderOpen,
} from 'lucide-react';
import { Button, Dialog, Input } from '@space/ui';
import { cn } from '@space/ui';
import { usePersistentState } from './usePersistentState';

export interface TerminalProfile {
  readonly id: string;
  readonly name: string;
  readonly shell: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly icon?: string;
}

const DEFAULT_PROFILES: readonly TerminalProfile[] = [
  { id: 'system-zsh', name: 'Zsh', shell: '/bin/zsh', args: ['-l'], icon: '🐚' },
  { id: 'system-bash', name: 'Bash', shell: '/bin/bash', args: ['-l'], icon: '🅱️' },
  { id: 'system-sh', name: 'Sh', shell: '/bin/sh', args: ['-l'], icon: '📄' },
];

interface TerminalProfileManagerProps {
  readonly onProfileSelect?: (profile: TerminalProfile) => void;
}

export function TerminalProfileManager({ onProfileSelect }: TerminalProfileManagerProps) {
  const [profiles, setProfiles] = usePersistentState<readonly TerminalProfile[]>(
    'space:terminal-profiles',
    DEFAULT_PROFILES,
  );
  const [activeProfileId, setActiveProfileId] = usePersistentState<string>(
    'space:active-terminal-profile',
    'system-zsh',
  );
  const [editOpen, setEditOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Partial<TerminalProfile> | null>(null);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  const handleSelect = useCallback((profile: TerminalProfile) => {
    setActiveProfileId(profile.id);
    onProfileSelect?.(profile);
  }, [setActiveProfileId, onProfileSelect]);

  const handleSave = useCallback(() => {
    if (!editingProfile?.name || !editingProfile?.shell) return;
    const id = editingProfile.id ?? `custom-${Date.now()}`;
    const profile: TerminalProfile = {
      id,
      name: editingProfile.name,
      shell: editingProfile.shell,
      args: editingProfile.args ?? ['-l'],
      ...(editingProfile.cwd ? { cwd: editingProfile.cwd } : {}),
      ...(editingProfile.env ? { env: editingProfile.env } : {}),
    };
    setProfiles((prev) => {
      const existing = prev.findIndex((p) => p.id === id);
      if (existing >= 0) {
        return prev.map((p) => (p.id === id ? profile : p));
      }
      return [...prev, profile];
    });
    setEditOpen(false);
    setEditingProfile(null);
  }, [editingProfile, setProfiles]);

  const handleDelete = useCallback((id: string) => {
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    if (activeProfileId === id) {
      setActiveProfileId('system-zsh');
    }
  }, [setProfiles, activeProfileId, setActiveProfileId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-fg">Shell Profiles</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditingProfile({ name: '', shell: '/bin/zsh', args: ['-l'] });
            setEditOpen(true);
          }}
        >
          <Plus size={12} className="mr-1" />
          Add
        </Button>
      </div>

      <div className="space-y-1">
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className={cn(
              'group flex items-center gap-2 rounded-md px-2.5 py-2 transition-colors cursor-pointer',
              profile.id === activeProfileId
                ? 'bg-accent/10 border border-accent/20'
                : 'hover:bg-surface-hover border border-transparent',
            )}
            onClick={() => handleSelect(profile)}
          >
            <span className="text-sm">{profile.icon ?? '📄'}</span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-fg">{profile.name}</p>
              <p className="truncate text-[10px] text-fg-faint font-mono">{profile.shell}</p>
            </div>
            {profile.id === activeProfileId && (
              <Check size={12} className="shrink-0 text-accent" />
            )}
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingProfile({ ...profile });
                  setEditOpen(true);
                }}
                className="rounded p-0.5 text-fg-faint hover:text-fg"
              >
                <Settings size={11} />
              </button>
              {!profile.id.startsWith('system-') && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(profile.id);
                  }}
                  className="rounded p-0.5 text-fg-faint hover:text-danger"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Edit Dialog */}
      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditingProfile(null);
        }}
        title={editingProfile?.id ? 'Edit Profile' : 'New Profile'}
        size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSave}>Save</Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
            Profile name
            <Input
              value={editingProfile?.name ?? ''}
              onChange={(e) => setEditingProfile((prev) => prev ? { ...prev, name: e.target.value } : prev)}
              placeholder="e.g. My Zsh"
              className="h-7 text-xs"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
            Shell path
            <Input
              value={editingProfile?.shell ?? ''}
              onChange={(e) => setEditingProfile((prev) => prev ? { ...prev, shell: e.target.value } : prev)}
              placeholder="/bin/zsh"
              className="h-7 text-xs font-mono"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
            Arguments (comma-separated)
            <Input
              value={(editingProfile?.args ?? []).join(', ')}
              onChange={(e) => setEditingProfile((prev) => prev ? {
                ...prev,
                args: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              } : prev)}
              placeholder="-l"
              className="h-7 text-xs font-mono"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
            Working directory (optional)
            <Input
              value={editingProfile?.cwd ?? ''}
              onChange={(e) => setEditingProfile((prev) => prev ? { ...prev, cwd: e.target.value || undefined } as Partial<TerminalProfile> : prev)}
              placeholder="~/projects"
              className="h-7 text-xs font-mono"
            />
          </label>
        </div>
      </Dialog>
    </div>
  );
}
