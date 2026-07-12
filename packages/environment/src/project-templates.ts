/**
 * PRJ-004: new project creation. A project template provider declares
 * everything spec section 10.4 requires up front — supported platform,
 * required CLI/runtime, a non-interactive creation command, user-editable
 * options, expected files, a verification command, a development command,
 * and default ignore rules — so the UI can show the concrete framework,
 * language, package manager, and creation command *before* anything runs.
 *
 * Only one concrete template ships in M4 (a minimal Node package via
 * `npm init -y`, chosen specifically because it needs no network access
 * and is safe to exercise for real in a hermetic test); the registry shape
 * supports adding more without touching call sites.
 */
import type { SupportedPlatform } from './types';

export interface ProjectTemplateOption {
  readonly id: string;
  readonly label: string;
  readonly kind: 'string' | 'boolean' | 'choice';
  readonly choices?: readonly string[];
  readonly defaultValue: string | boolean;
}

export interface TemplateCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export interface ProjectTemplate {
  readonly id: string;
  readonly displayName: string;
  readonly supportedPlatforms: readonly SupportedPlatform[];
  readonly requiredExecutables: readonly string[];
  readonly userEditableOptions: readonly ProjectTemplateOption[];
  readonly expectedFiles: readonly string[];
  readonly verifyCommand: TemplateCommand;
  readonly devCommand: TemplateCommand | null;
  readonly defaultIgnoreRules: readonly string[];
  /**
   * The exact non-interactive command that will run, given resolved
   * option values and the target directory name. Space shows this to the
   * user before executing it (spec 10.4) — it must never be interactive.
   */
  creationCommand(
    options: Readonly<Record<string, string | boolean>>,
    targetDirectoryName: string,
  ): TemplateCommand;
}

export const NODE_MINIMAL_TEMPLATE: ProjectTemplate = {
  id: 'node-minimal',
  displayName: 'Minimal Node.js package',
  supportedPlatforms: ['darwin', 'win32'],
  requiredExecutables: ['npm', 'node'],
  userEditableOptions: [
    {
      id: 'private',
      label: 'Private package (never published)',
      kind: 'boolean',
      defaultValue: true,
    },
  ],
  expectedFiles: ['package.json'],
  // Reads package.json back rather than mutating anything — a safe,
  // non-interactive check that creation actually produced a valid manifest.
  verifyCommand: { executable: 'npm', args: ['pkg', 'get', 'name'] },
  devCommand: null,
  defaultIgnoreRules: ['node_modules', '.env', '.env.local', 'dist'],
  creationCommand: () => ({ executable: 'npm', args: ['init', '--yes'] }),
};

export const BUILT_IN_PROJECT_TEMPLATES: readonly ProjectTemplate[] = [NODE_MINIMAL_TEMPLATE];

export function findProjectTemplate(templateId: string): ProjectTemplate | null {
  return BUILT_IN_PROJECT_TEMPLATES.find((template) => template.id === templateId) ?? null;
}

/**
 * PRJ-006: "when a known development script is available, Space may offer
 * Run." Reads a project's own `package.json` scripts (already-created
 * project, independent of which template — or none — produced it) rather
 * than trusting a template's static `devCommand`.
 */
export function detectDevScript(
  packageJsonScripts: Readonly<Record<string, string>> | undefined,
): string | null {
  if (!packageJsonScripts) {
    return null;
  }
  for (const candidate of ['dev', 'start']) {
    if (typeof packageJsonScripts[candidate] === 'string') {
      return candidate;
    }
  }
  return null;
}
