import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AiToolId, PackageActionInput } from '@space/contracts';
import { createAppIconResolver } from '../app-icon';

export interface AiToolDesktopInfo {
  readonly appPath: string;
  readonly iconDataUrl: string | null;
}

export interface AiToolDesktopAdapter {
  describe(tool: AiToolId): Promise<AiToolDesktopInfo | null>;
  openProject(tool: AiToolId, projectPath: string): Promise<void>;
  installPackage(tool: AiToolId): PackageActionInput | null;
}

interface DesktopCandidate {
  readonly appPath: string;
  readonly executable?: string;
  readonly args?: (projectPath: string) => readonly string[];
}

function macCandidates(home: string, tool: AiToolId): readonly DesktopCandidate[] {
  const bundles: Record<AiToolId, readonly [string, string][]> = {
    codex: [['ChatGPT.app', 'Contents/Resources/codex'], ['Codex.app', 'Contents/MacOS/Codex']],
    'claude-code': [['Claude.app', 'Contents/MacOS/Claude']],
    cursor: [['Cursor.app', 'Contents/MacOS/Cursor']],
    vscode: [['Visual Studio Code.app', 'Contents/MacOS/Electron']],
  };
  return bundles[tool].flatMap(([bundle, executable]) =>
    ['/Applications', path.join(home, 'Applications')].map((root) => {
      const appPath = path.join(root, bundle);
      return {
        appPath,
        executable: tool === 'codex' ? path.join(appPath, executable) : '/usr/bin/open',
        args: tool === 'codex'
          ? (projectPath: string) => ['app', projectPath]
          : (projectPath: string) => ['-a', appPath, projectPath],
      };
    }),
  );
}

function windowsCandidates(home: string, appData: string, tool: AiToolId): readonly DesktopCandidate[] {
  const local = path.dirname(appData);
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const paths: Record<AiToolId, readonly string[]> = {
    codex: [path.join(local, 'Programs', 'OpenAI', 'Codex.exe'), path.join(local, 'Programs', 'OpenAI', 'ChatGPT.exe')],
    'claude-code': [path.join(local, 'AnthropicClaude', 'Claude.exe'), path.join(local, 'Programs', 'Claude', 'Claude.exe')],
    cursor: [path.join(local, 'Programs', 'cursor', 'Cursor.exe')],
    vscode: [path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'), path.join(programFiles, 'Microsoft VS Code', 'Code.exe')],
  };
  void home;
  return paths[tool].map((appPath) => ({ appPath, executable: appPath, args: (projectPath: string) => [projectPath] }));
}

function linuxCandidates(tool: AiToolId): readonly DesktopCandidate[] {
  const paths: Partial<Record<AiToolId, readonly string[]>> = {
    cursor: ['/usr/bin/cursor', '/usr/local/bin/cursor'],
    vscode: ['/usr/bin/code', '/usr/local/bin/code'],
    'claude-code': ['/usr/bin/claude', '/usr/local/bin/claude'],
  };
  return (paths[tool] ?? []).map((appPath) => ({ appPath, executable: appPath, args: (projectPath: string) => [projectPath] }));
}

async function firstExisting(candidates: readonly DesktopCandidate[]): Promise<DesktopCandidate | null> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate.appPath);
      return candidate;
    } catch {
      // Keep looking through known system and per-user install locations.
    }
  }
  return null;
}

export function createAiToolDesktopAdapter(home: string, appData: string): AiToolDesktopAdapter {
  // The installed app's own icon, read from its bundle (see app-icon.ts) —
  // the renderer falls back to the product's brand mark when there is none.
  const icons = createAppIconResolver();
  const candidates = (tool: AiToolId): readonly DesktopCandidate[] => {
    if (process.platform === 'darwin') return macCandidates(home, tool);
    if (process.platform === 'win32') return windowsCandidates(home, appData, tool);
    return linuxCandidates(tool);
  };

  return {
    async describe(tool) {
      const candidate = await firstExisting(candidates(tool));
      if (!candidate) return null;
      const iconDataUrl = await icons.iconFor(candidate.appPath);
      return { appPath: candidate.appPath, iconDataUrl };
    },
    async openProject(tool, projectPath) {
      const candidate = await firstExisting(candidates(tool));
      if (!candidate?.executable || !candidate.args) {
        throw new Error(`${tool} is not installed in a location Space recognizes.`);
      }
      const child = spawn(candidate.executable, [...candidate.args(projectPath)], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    },
    installPackage(tool) {
      if (process.platform !== 'darwin') return null;
      const casks: Record<AiToolId, string> = {
        codex: 'chatgpt',
        'claude-code': 'claude',
        cursor: 'cursor',
        vscode: 'visual-studio-code',
      };
      return { source: 'homebrew-cask', name: casks[tool] };
    },
  };
}
