import { createHash } from 'node:crypto';
import type { ToolManifest, ToolManifestEntry } from './types';

/**
 * Bootstrap manifest (spec section 8.3, ONB-003; default essential set,
 * spec section 8.9). Deliberately five entries — pnpm, Yarn, Python,
 * Docker, WSL, Java, Android tooling, and cloud CLIs stay project-triggered
 * or optional, per spec section 39 ("install every optional tool during
 * onboarding" is a prohibited shortcut).
 *
 * "The manifest MUST be signed or packaged with the application release"
 * (spec 8.3). This manifest ships as a TypeScript module compiled into the
 * signed application bundle (ADR-001, spec section 31.2 code signing) —
 * that packaging is the trust boundary for v1. `MANIFEST_FINGERPRINT`
 * below is a belt-and-suspenders integrity check: any edit to the manifest
 * changes the fingerprint, which is asserted against a pinned constant in
 * manifest.test.ts, so an accidental or unreviewed change fails CI. It
 * also gives a real hook (`verifyManifestFingerprint`) for the "remote
 * manifest updates MAY be supported later but must be signature-verified"
 * case — not implemented, since no remote manifest source exists yet.
 */
const GIT: ToolManifestEntry = {
  id: 'git',
  displayName: 'Git',
  required: true,
  supportedPlatforms: ['darwin', 'win32'],
  architectures: ['arm64', 'x64'],
  detection: [
    { kind: 'command-on-path', executable: 'git' },
    {
      kind: 'version-command',
      executable: 'git',
      versionArgs: ['--version'],
      versionPattern: 'git version (\\d+\\.\\d+(?:\\.\\d+)?)',
    },
  ],
  installStrategies: [
    {
      id: 'git-homebrew',
      platform: 'darwin',
      kind: 'package-manager',
      packageManagerId: 'homebrew',
      packageId: 'git',
      executable: 'brew',
      args: ['install', 'git'],
      requiresElevation: false,
      interactive: false,
      sourceDescription: 'Homebrew (https://brew.sh)',
      officialSourceUrl: 'https://brew.sh',
    },
    {
      id: 'git-winget',
      platform: 'win32',
      kind: 'package-manager',
      packageManagerId: 'winget',
      packageId: 'Git.Git',
      executable: 'winget',
      args: ['install', '--id', 'Git.Git', '-e', '--accept-package-agreements', '--accept-source-agreements'],
      requiresElevation: false,
      interactive: false,
      sourceDescription: 'WinGet (Git.Git)',
      officialSourceUrl: 'https://git-scm.com/download/win',
    },
    {
      id: 'git-official-installer-win',
      platform: 'win32',
      kind: 'official-installer',
      executable: 'git-for-windows-installer',
      args: ['/VERYSILENT', '/NORESTART'],
      requiresElevation: true,
      interactive: false,
      sourceDescription: 'Git for Windows official installer',
      officialSourceUrl: 'https://git-scm.com/download/win',
    },
  ],
  verify: [
    { kind: 'version-output', executable: 'git', args: ['--version'], expectedPattern: 'git version \\d+\\.\\d+' },
    { kind: 'functional-command', executable: 'git', args: ['config', '--list', '--global'] },
  ],
  minimumVersion: '2.30.0',
  recommendedVersionPolicy: 'latest-supported',
  uninstallGuidance:
    'macOS: `brew uninstall git`. Windows: uninstall "Git" from Settings > Apps. Space does not automatically remove tools it did not install.',
};

const GH: ToolManifestEntry = {
  id: 'gh',
  displayName: 'GitHub CLI',
  required: true,
  supportedPlatforms: ['darwin', 'win32'],
  architectures: ['arm64', 'x64'],
  detection: [
    { kind: 'command-on-path', executable: 'gh' },
    {
      kind: 'version-command',
      executable: 'gh',
      versionArgs: ['--version'],
      versionPattern: 'gh version (\\d+\\.\\d+(?:\\.\\d+)?)',
    },
  ],
  installStrategies: [
    {
      id: 'gh-homebrew',
      platform: 'darwin',
      kind: 'package-manager',
      packageManagerId: 'homebrew',
      packageId: 'gh',
      executable: 'brew',
      args: ['install', 'gh'],
      requiresElevation: false,
      interactive: false,
      sourceDescription: 'Homebrew (https://brew.sh)',
      officialSourceUrl: 'https://brew.sh',
    },
    {
      id: 'gh-winget',
      platform: 'win32',
      kind: 'package-manager',
      packageManagerId: 'winget',
      packageId: 'GitHub.cli',
      executable: 'winget',
      args: ['install', '--id', 'GitHub.cli', '-e', '--accept-package-agreements', '--accept-source-agreements'],
      requiresElevation: false,
      interactive: false,
      sourceDescription: 'WinGet (GitHub.cli)',
      officialSourceUrl: 'https://cli.github.com',
    },
    {
      id: 'gh-official-installer-win',
      platform: 'win32',
      kind: 'official-installer',
      executable: 'gh-windows-installer',
      args: ['/VERYSILENT', '/NORESTART'],
      requiresElevation: true,
      interactive: false,
      sourceDescription: 'GitHub CLI official installer',
      officialSourceUrl: 'https://cli.github.com',
    },
  ],
  verify: [
    { kind: 'version-output', executable: 'gh', args: ['--version'], expectedPattern: 'gh version \\d+\\.\\d+' },
  ],
  minimumVersion: '2.40.0',
  recommendedVersionPolicy: 'latest-supported',
  uninstallGuidance:
    'macOS: `brew uninstall gh`. Windows: uninstall "GitHub CLI" from Settings > Apps.',
};

const VOLTA: ToolManifestEntry = {
  id: 'volta',
  displayName: 'Volta',
  required: true,
  supportedPlatforms: ['darwin', 'win32'],
  architectures: ['arm64', 'x64'],
  detection: [
    { kind: 'command-on-path', executable: 'volta' },
    { kind: 'version-command', executable: 'volta', versionArgs: ['--version'], versionPattern: '(\\d+\\.\\d+(?:\\.\\d+)?)' },
  ],
  installStrategies: [
    {
      id: 'volta-official-installer-mac',
      platform: 'darwin',
      kind: 'official-installer',
      executable: 'volta-install-sh',
      args: ['--skip-setup'],
      requiresElevation: false,
      interactive: true,
      sourceDescription: 'Volta official installer script (https://get.volta.sh)',
      officialSourceUrl: 'https://get.volta.sh',
    },
    {
      id: 'volta-winget',
      platform: 'win32',
      kind: 'package-manager',
      packageManagerId: 'winget',
      packageId: 'Volta.Volta',
      executable: 'winget',
      args: ['install', '--id', 'Volta.Volta', '-e', '--accept-package-agreements', '--accept-source-agreements'],
      requiresElevation: false,
      interactive: false,
      sourceDescription: 'WinGet (Volta.Volta)',
      officialSourceUrl: 'https://volta.sh',
    },
    {
      id: 'volta-official-installer-win',
      platform: 'win32',
      kind: 'official-installer',
      executable: 'volta-windows-installer',
      args: ['/quiet'],
      requiresElevation: true,
      interactive: false,
      sourceDescription: 'Volta official Windows installer',
      officialSourceUrl: 'https://volta.sh',
    },
  ],
  verify: [
    { kind: 'version-output', executable: 'volta', args: ['--version'], expectedPattern: '\\d+\\.\\d+' },
    { kind: 'functional-command', executable: 'volta', args: ['list', 'node'] },
  ],
  minimumVersion: '1.1.0',
  recommendedVersionPolicy: 'latest-supported',
  uninstallGuidance:
    'Follow https://docs.volta.sh/guide/getting-started#uninstalling — Volta manages Node installs, so uninstalling it also removes Volta-managed Node/npm.',
};

const NODE: ToolManifestEntry = {
  id: 'node',
  displayName: 'Node.js (via Volta)',
  required: true,
  supportedPlatforms: ['darwin', 'win32'],
  architectures: ['arm64', 'x64'],
  detection: [
    { kind: 'command-on-path', executable: 'node' },
    { kind: 'version-command', executable: 'node', versionArgs: ['--version'], versionPattern: 'v?(\\d+\\.\\d+\\.\\d+)' },
  ],
  installStrategies: [
    {
      id: 'node-volta-mac',
      platform: 'darwin',
      kind: 'volta-managed',
      executable: 'volta',
      args: ['install', 'node@lts'],
      requiresElevation: false,
      interactive: false,
      sourceDescription: 'Volta (installs the current Node LTS)',
      officialSourceUrl: 'https://nodejs.org',
    },
    {
      id: 'node-volta-win',
      platform: 'win32',
      kind: 'volta-managed',
      executable: 'volta',
      args: ['install', 'node@lts'],
      requiresElevation: false,
      interactive: false,
      sourceDescription: 'Volta (installs the current Node LTS)',
      officialSourceUrl: 'https://nodejs.org',
    },
  ],
  verify: [
    { kind: 'version-output', executable: 'node', args: ['--version'], expectedPattern: 'v?\\d+\\.\\d+\\.\\d+' },
    { kind: 'functional-command', executable: 'node', args: ['-e', '1'] },
  ],
  minimumVersion: '18.18.0',
  recommendedVersionPolicy: 'lts',
  uninstallGuidance: '`volta uninstall node` (Volta continues to manage per-project pins).',
};

const NPM: ToolManifestEntry = {
  id: 'npm',
  displayName: 'npm',
  required: true,
  supportedPlatforms: ['darwin', 'win32'],
  architectures: ['arm64', 'x64'],
  detection: [
    { kind: 'command-on-path', executable: 'npm' },
    { kind: 'version-command', executable: 'npm', versionArgs: ['--version'], versionPattern: '(\\d+\\.\\d+\\.\\d+)' },
  ],
  // npm is bundled with Node and installed transitively by the "node" entry's
  // Volta strategy — it has no independent install strategy of its own.
  installStrategies: [],
  verify: [{ kind: 'version-output', executable: 'npm', args: ['--version'], expectedPattern: '\\d+\\.\\d+\\.\\d+' }],
  minimumVersion: '9.0.0',
  recommendedVersionPolicy: 'latest-supported',
  uninstallGuidance: 'npm is removed alongside its Volta-managed Node install.',
};

export const TOOL_MANIFEST: ToolManifest = {
  manifestVersion: '1.0.0',
  entries: [GIT, GH, VOLTA, NODE, NPM],
};

/** Stable content hash of the manifest — see module doc for its role. */
export function computeManifestFingerprint(manifest: ToolManifest = TOOL_MANIFEST): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

/** Hook for a future signed remote manifest (spec 8.3: "MAY be supported later but must be signature-verified"). Not wired to any transport yet. */
export function verifyManifestFingerprint(manifest: ToolManifest, expectedFingerprint: string): boolean {
  return computeManifestFingerprint(manifest) === expectedFingerprint;
}
