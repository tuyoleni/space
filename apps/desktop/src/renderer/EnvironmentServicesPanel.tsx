import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Rocket } from 'lucide-react';
import type { ConnectedServiceDeployResult, ConnectedServiceId, ConnectedServicesResult, GithubAuthReport, TerminalSessionInfo } from '@space/contracts';
import { Badge, Button, Card, CardHeader, CardRows, CardTitle, StatusDot, useToast } from '@space/ui';
import { BrandIcon, SERVICE_BRAND } from './brand-icons';
import { TerminalPanel } from './TerminalPanel';

interface EnvironmentServicesPanelProps {
  readonly workspaceId: string | null;
  readonly projectId: string | null;
  readonly githubReport: GithubAuthReport | null;
}

const SERVICE_ORDER: readonly ConnectedServiceId[] = ['docker', 'vercel', 'supabase', 'gcloud'];

/**
 * "Connected Services" card: GitHub's status comes from the `githubReport`
 * prop (already fetched elsewhere in the app — see AppTopbar) so this panel
 * never duplicates that auth check; Docker/Vercel/Supabase/gcloud are
 * fetched here via connectedServices.status(). Only services whose CLI is
 * actually present on this machine are shown — a not-installed CLI has no
 * login to offer, and showing a "Connect" button for one that doesn't exist
 * misleads (install it from the Packages panel below first, then it shows
 * up here). "Connect" opens a real login PTY the same way GithubPanel's
 * "Sign in" does, embedding the session with TerminalPanel. "Deploy" (only
 * on services connectedServices marks `deployable`, currently Vercel) runs
 * the real CLI deploy to completion and surfaces the resulting URL — no
 * terminal needed for that part.
 */
export function EnvironmentServicesPanel({ workspaceId, projectId, githubReport }: EnvironmentServicesPanelProps) {
  const { toast } = useToast();
  const [result, setResult] = useState<ConnectedServicesResult | null>(null);
  const [connectingId, setConnectingId] = useState<ConnectedServiceId | null>(null);
  const [loginSession, setLoginSession] = useState<TerminalSessionInfo | null>(null);
  const [deployingId, setDeployingId] = useState<ConnectedServiceId | null>(null);
  const [deployResult, setDeployResult] = useState<{ readonly id: ConnectedServiceId; readonly result: ConnectedServiceDeployResult } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setResult(await window.space.connectedServices.status());
    } catch (caught) {
      toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
    }
  }, [toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function handleConnect(service: ConnectedServiceId): void {
    if (!workspaceId) {
      return;
    }
    setConnectingId(service);
    void window.space.connectedServices
      .startLogin({ workspaceId, service })
      .then(({ sessionId }) => {
        setLoginSession({
          id: sessionId,
          workspaceId,
          projectId: null,
          shell: service,
          cwd: '',
          pid: 0,
          state: 'running',
          startedAt: new Date().toISOString(),
          endedAt: null,
          exitCode: null,
          lastOutputAt: null,
        });
      })
      .catch((caught) => {
        toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
      })
      .finally(() => {
        setConnectingId(null);
      });
  }

  function handleDeploy(service: ConnectedServiceId): void {
    if (!projectId) {
      return;
    }
    setDeployingId(service);
    setDeployResult(null);
    void window.space.connectedServices
      .deploy({ projectId, service })
      .then((deploy) => {
        setDeployResult({ id: service, result: deploy });
      })
      .catch((caught) => {
        toast({ variant: 'error', message: caught instanceof Error ? caught.message : String(caught) });
      })
      .finally(() => {
        setDeployingId(null);
      });
  }

  const services = result?.services ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected Services</CardTitle>
      </CardHeader>
      <CardRows>
        <div className="flex items-center justify-between py-2 text-sm">
          <span className="flex items-center gap-2 text-fg">
            {SERVICE_BRAND.github && <BrandIcon icon={SERVICE_BRAND.github} size={15} />} GitHub
          </span>
          {githubReport?.authenticated && githubReport.activeAccount ? (
            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
              <StatusDot tone="success" />
              {githubReport.activeAccount.account}
            </span>
          ) : (
            <Badge>Not connected</Badge>
          )}
        </div>

        {SERVICE_ORDER.map((id) => {
          const service = services.find((candidate) => candidate.id === id);
          // Not installed on this machine — nothing real to connect, so don't show it at all
          // (install the CLI from Packages below and it appears here on the next refresh).
          if (!service?.installed) {
            return null;
          }
          const brand = SERVICE_BRAND[id];
          return (
            <div key={id} className="flex flex-col gap-2 py-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-fg">
                  {brand && <BrandIcon icon={brand} size={15} />}
                  {service.displayName}
                </span>
                {service.connected ? (
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-xs text-fg-muted">
                      <StatusDot tone="success" />
                      {service.account ?? service.detail ?? 'Connected'}
                    </span>
                    {service.deployable && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!projectId || deployingId === id}
                        title={!projectId ? 'Select a project first' : undefined}
                        onClick={() => handleDeploy(id)}
                      >
                        <Rocket size={13} /> {deployingId === id ? 'Deploying…' : 'Deploy'}
                      </Button>
                    )}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!workspaceId || connectingId === id}
                    title={!workspaceId ? 'Select a workspace first' : undefined}
                    onClick={() => handleConnect(id)}
                  >
                    {connectingId === id ? 'Connecting…' : 'Connect'}
                  </Button>
                )}
              </div>
              {service.detail && !service.connected && <p className="text-xs text-fg-faint">{service.detail}</p>}
            </div>
          );
        })}
        {services.length > 0 && services.every((service) => !service.installed) && (
          <p className="py-2 text-sm text-fg-faint">None of Docker, Vercel, Supabase, or Google Cloud are installed on this machine.</p>
        )}
      </CardRows>

      {deployResult && (
        <div className="border-t border-border p-3 text-sm">
          {deployResult.result.success ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-muted">Deployed successfully.</span>
              {deployResult.result.url && (
                <Button size="sm" variant="secondary" onClick={() => window.open(deployResult.result.url ?? '', '_blank')}>
                  <ExternalLink size={13} /> Open deployment
                </Button>
              )}
            </div>
          ) : (
            <div>
              <p className="text-danger">Deploy failed.</p>
              <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface-hover p-2 text-xs text-fg-muted">
                {deployResult.result.output || 'No output.'}
              </pre>
            </div>
          )}
        </div>
      )}

      {loginSession && (
        <div className="border-t border-border p-3">
          <p className="mb-1.5 text-xs text-fg-muted">Follow the instructions below to finish signing in, then reconnect.</p>
          <div className="overflow-hidden rounded-md border border-border">
            <TerminalPanel session={loginSession} />
          </div>
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setLoginSession(null);
                void refresh();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
