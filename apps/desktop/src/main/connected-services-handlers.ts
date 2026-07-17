/**
 * Real, read-only Docker/Vercel/Supabase/gcloud CLI presence + auth checks
 * for the Environment screen's "Connected Services" panel — GitHub itself
 * is already covered by githubHandlers, this only adds the
 * project-triggered services that live outside the bootstrap toolchain
 * manifest. Uses @space/environment's `nodeRunCommand` (same safe-spawn
 * primitive dependency-handlers.ts/environment-handlers.ts use, spec
 * 25.3.2: never `shell: true`) with a short timeout, and never throws when
 * a CLI is simply missing — that's `installed: false`, not an error.
 * `startLogin` opens a real login PTY exactly like github-handlers.ts's
 * `startAuthLogin` does for `gh auth login` — never a fabricated OAuth
 * screen — and is deliberately simpler: no config-dir juggling, no
 * output-parsing side effects, just spawn and hand back the session id.
 * `deploy` is the non-interactive counterpart to `startLogin`: real work
 * (`vercel deploy --prod --yes`) run to completion via `nodeRunCommand`
 * rather than a PTY, because the caller wants a result (a URL), not a
 * terminal to watch. `--yes` is what keeps it from blocking on the
 * "set up and deploy?" prompt a bare `vercel deploy` would ask on a
 * never-linked project.
 */
import os from 'node:os';
import { nodeRunCommand } from '@space/environment';
import type {
  ConnectedServiceDeployInput,
  ConnectedServiceDeployResult,
  ConnectedServiceId,
  ConnectedServiceLoginInput,
  ConnectedServiceLoginResult,
  ConnectedServiceStatus,
  ConnectedServicesResult,
  Project,
} from '@space/contracts';
import type { TerminalCaller } from './github-handlers';
import type { StorageCaller } from './project-handlers';
import { buildSpaceEnvironment } from './environment-policy';

const STATUS_TIMEOUT_MS = 5_000;
const DEPLOY_TIMEOUT_MS = 180_000;

/** Services with a real, non-interactive deploy implementation below — drives `ConnectedServiceStatus.deployable`. */
const DEPLOYABLE_SERVICES: ReadonlySet<ConnectedServiceId> = new Set(['vercel']);

const LOGIN_COMMANDS: Readonly<Record<ConnectedServiceId, { readonly executable: string; readonly args: readonly string[] }>> = {
  docker: { executable: 'docker', args: ['login'] },
  vercel: { executable: 'vercel', args: ['login'] },
  supabase: { executable: 'supabase', args: ['login'] },
  gcloud: { executable: 'gcloud', args: ['auth', 'login'] },
};

/** Real `<executable> --version` — missing CLI (ENOENT) or non-zero exit both mean "not installed", never thrown. */
async function checkInstalled(executable: string): Promise<{ installed: boolean; version: string | null }> {
  const result = await nodeRunCommand(executable, ['--version'], { timeoutMs: STATUS_TIMEOUT_MS }).catch(() => null);
  if (!result || result.exitCode !== 0) {
    return { installed: false, version: null };
  }
  const version = result.stdout.trim();
  return { installed: true, version: version.length > 0 ? version : null };
}

/** Docker has no CLI login concept relevant here — "connected" means the daemon actually answers, not that a token exists. */
async function checkDocker(): Promise<ConnectedServiceStatus> {
  const { installed, version } = await checkInstalled('docker');
  let connected = false;
  let detail: string | null = null;
  if (installed) {
    const infoResult = await nodeRunCommand('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: STATUS_TIMEOUT_MS }).catch(
      () => null,
    );
    connected = infoResult !== null && infoResult.exitCode === 0 && infoResult.stdout.trim().length > 0;
    detail = connected ? 'Docker Desktop' : 'Not running';
  }
  return { id: 'docker', displayName: 'Docker', installed, version, connected, account: null, detail, deployable: false };
}

/** `vercel whoami`'s stdout on success is the logged-in username/team — trimmed into `account` as-is, never reformatted. */
async function checkVercel(): Promise<ConnectedServiceStatus> {
  const { installed, version } = await checkInstalled('vercel');
  let connected = false;
  let account: string | null = null;
  if (installed) {
    const whoamiResult = await nodeRunCommand('vercel', ['whoami'], { timeoutMs: STATUS_TIMEOUT_MS }).catch(() => null);
    if (whoamiResult && whoamiResult.exitCode === 0) {
      connected = true;
      const trimmed = whoamiResult.stdout.trim();
      account = trimmed.length > 0 ? trimmed : null;
    }
  }
  return { id: 'vercel', displayName: 'Vercel', installed, version, connected, account, detail: null, deployable: DEPLOYABLE_SERVICES.has('vercel') };
}

/** `supabase projects list` only succeeds when logged in; its output isn't a single clean identity string, so `account` stays null rather than a wrong guess. */
async function checkSupabase(): Promise<ConnectedServiceStatus> {
  const { installed, version } = await checkInstalled('supabase');
  let connected = false;
  if (installed) {
    const projectsResult = await nodeRunCommand('supabase', ['projects', 'list'], { timeoutMs: STATUS_TIMEOUT_MS }).catch(() => null);
    connected = projectsResult !== null && projectsResult.exitCode === 0;
  }
  return { id: 'supabase', displayName: 'Supabase', installed, version, connected, account: null, detail: null, deployable: false };
}

/** `gcloud auth list --filter=status:ACTIVE` prints the active account's email on success, nothing on stdout otherwise. */
async function checkGcloud(): Promise<ConnectedServiceStatus> {
  const { installed, version } = await checkInstalled('gcloud');
  let connected = false;
  let account: string | null = null;
  if (installed) {
    const authResult = await nodeRunCommand(
      'gcloud',
      ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'],
      { timeoutMs: STATUS_TIMEOUT_MS },
    ).catch(() => null);
    if (authResult && authResult.exitCode === 0) {
      const trimmed = authResult.stdout.trim();
      if (trimmed.length > 0) {
        connected = true;
        account = trimmed;
      }
    }
  }
  return { id: 'gcloud', displayName: 'Google Cloud', installed, version, connected, account, detail: null, deployable: false };
}

/** The deployed URL is the only `https://` token `vercel deploy`'s stdout prints — take the last one (earlier ones are inspect-URL noise from the build log). */
function extractDeployUrl(output: string): string | null {
  const matches = output.match(/https?:\/\/\S+/g);
  return matches && matches.length > 0 ? (matches[matches.length - 1]?.replace(/[).,]+$/, '') ?? null) : null;
}

export interface ConnectedServicesHandlersOptions {
  readonly terminal: TerminalCaller;
}

export interface ConnectedServicesHandlers {
  status(): Promise<ConnectedServicesResult>;
  startLogin(input: ConnectedServiceLoginInput): Promise<ConnectedServiceLoginResult>;
  deploy(input: ConnectedServiceDeployInput): Promise<ConnectedServiceDeployResult>;
}

export function createConnectedServicesHandlers(storage: StorageCaller, options: ConnectedServicesHandlersOptions): ConnectedServicesHandlers {
  async function status(): Promise<ConnectedServicesResult> {
    const [docker, vercel, supabase, gcloud] = await Promise.all([checkDocker(), checkVercel(), checkSupabase(), checkGcloud()]);
    return { scannedAt: new Date().toISOString(), services: [docker, vercel, supabase, gcloud] };
  }

  async function startLogin(input: ConnectedServiceLoginInput): Promise<ConnectedServiceLoginResult> {
    const command = LOGIN_COMMANDS[input.service];
    const session = await options.terminal.call<{ id: string }>('terminal.create', {
      workspaceId: input.workspaceId,
      projectId: null,
      shell: command.executable,
      args: command.args,
      cwd: os.homedir(),
      env: buildSpaceEnvironment(),
      cols: 80,
      rows: 24,
    });
    return { sessionId: session.id };
  }

  async function deploy(input: ConnectedServiceDeployInput): Promise<ConnectedServiceDeployResult> {
    if (!DEPLOYABLE_SERVICES.has(input.service)) {
      throw new Error(`Deploy isn't available for ${input.service} yet — only Vercel supports a non-interactive deploy today.`);
    }
    const project = await storage.call<Project>('project.get', { projectId: input.projectId });
    const result = await nodeRunCommand('vercel', ['deploy', '--prod', '--yes'], {
      cwd: project.canonicalPath,
      timeoutMs: DEPLOY_TIMEOUT_MS,
    });
    const output = `${result.stdout}${result.stderr}`;
    const success = result.exitCode === 0;
    return { success, url: success ? extractDeployUrl(output) : null, output: output.trim() };
  }

  return { status, startLogin, deploy };
}
