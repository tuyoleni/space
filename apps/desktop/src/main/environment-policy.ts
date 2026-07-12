/**
 * The Space-side inherit/deny policy for @space/domain's buildEnvironment
 * (spec section 5.3), used by every process this app spawns directly
 * (terminal shells, project creation/clone/install, dev servers) so none
 * of them is a raw `process.env` passthrough (spec sections 9.6, 15.3).
 *
 * Workspace/project-specific tool paths and variables are layered in by
 * the caller; this module only owns the base OS-inherit allow-list and
 * the defence-in-depth secret deny-list.
 */
import { buildEnvironment, type EnvironmentInput, type EnvironmentLayer, type EnvironmentPolicy } from '@space/domain';

const INHERIT_ALLOW_LIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'SHELL',
  'TMPDIR',
  'TMP',
  'TEMP',
  // Windows
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'SystemRoot',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramData',
  'windir',
  'ComSpec',
  'PATHEXT',
];

/**
 * Defence in depth: even if one of these somehow ended up in
 * `machineToolPaths`/`workspaceVars`/etc, it is stripped from the final
 * environment before a child process ever sees it (spec 25.1: "Protected
 * assets" includes tokens, keys, and environment secrets).
 */
const SECRET_KEY_DENY_LIST = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'SPACE_SECRET',
];

export const SPACE_ENVIRONMENT_POLICY: EnvironmentPolicy = {
  inheritAllowList: INHERIT_ALLOW_LIST,
  denyList: SECRET_KEY_DENY_LIST,
};

export interface BuildSpaceEnvironmentInput {
  readonly osBase?: EnvironmentLayer;
  readonly workspaceVars?: EnvironmentLayer;
  readonly projectVars?: EnvironmentLayer;
  readonly operationVars?: EnvironmentLayer;
}

function currentOsEnv(): EnvironmentLayer {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

/** TERM-003/WS-006: the environment every Space-spawned process gets, never `process.env` directly. */
export function buildSpaceEnvironment(input: BuildSpaceEnvironmentInput = {}): Record<string, string> {
  const environmentInput: EnvironmentInput = {
    osBase: input.osBase ?? currentOsEnv(),
    machineToolPaths: {},
    workspaceToolConfig: {},
    workspaceVars: input.workspaceVars ?? {},
    projectVars: input.projectVars ?? {},
    secrets: {},
    operationVars: input.operationVars ?? {},
    policy: SPACE_ENVIRONMENT_POLICY,
  };
  return buildEnvironment(environmentInput);
}
