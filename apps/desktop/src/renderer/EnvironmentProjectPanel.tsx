import { useEffect, useState } from 'react';
import type { ProjectEnvironmentInfo } from '@space/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardRows, CardTitle, Tooltip } from '@space/ui';

interface EnvironmentProjectPanelProps {
  readonly projectId: string | null;
}

/**
 * "Project Environment" card: the real runtime/package-manager/lockfile/
 * scripts/env-var summary for the currently selected project, fetched
 * independently on `projectId` change (mirrors HomeView's Dependencies
 * card's own per-project fetch, not a value threaded down from a parent
 * scan). Switch/Change/Manage are deliberately inert here — actually
 * changing a runtime version, package manager, or env values is out of
 * scope for this panel, so they're present but disabled rather than
 * faked.
 */
export function EnvironmentProjectPanel({ projectId }: EnvironmentProjectPanelProps) {
  const [info, setInfo] = useState<ProjectEnvironmentInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptsExpanded, setScriptsExpanded] = useState(false);

  useEffect(() => {
    setInfo(null);
    setError(null);
    setScriptsExpanded(false);
    if (!projectId) {
      return;
    }
    let cancelled = false;
    setBusy(true);
    void window.space.project
      .environmentInfo({ projectId })
      .then((result) => {
        if (!cancelled) {
          setInfo(result);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Project Environment</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-faint">Select a project to see its environment.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Project Environment</CardTitle>
      </CardHeader>
      {error ? (
        <CardContent>
          <p className="text-sm text-danger">{error}</p>
        </CardContent>
      ) : !info ? (
        <CardContent>
          <p className="text-sm text-fg-faint">{busy ? 'Loading…' : ''}</p>
        </CardContent>
      ) : (
        <CardRows>
          <div className="flex items-center justify-between py-2 text-sm">
            <span className="text-fg-muted">Runtime</span>
            <span className="flex items-center gap-2">
              <span className="text-fg">
                {info.runtimeVersion ? `${info.runtimeVersion}${info.runtimeSource ? ` (${info.runtimeSource})` : ''}` : 'Not found'}
              </span>
              <Tooltip content="Not yet available">
                <span>
                  <Button size="sm" variant="ghost" disabled>
                    Switch
                  </Button>
                </span>
              </Tooltip>
            </span>
          </div>

          <div className="flex items-center justify-between py-2 text-sm">
            <span className="text-fg-muted">Package manager</span>
            <span className="flex items-center gap-2">
              <span className="text-fg">{info.packageManager ?? '—'}</span>
              <Tooltip content="Not yet available">
                <span>
                  <Button size="sm" variant="ghost" disabled>
                    Change
                  </Button>
                </span>
              </Tooltip>
            </span>
          </div>

          <div className="flex items-center justify-between py-2 text-sm">
            <span className="text-fg-muted">Lockfile</span>
            <span className="flex items-center gap-2">
              <span className="text-fg">{info.lockfileDetected ? info.lockfileName : 'Not detected'}</span>
              <Badge variant={info.lockfileDetected ? 'success' : 'neutral'}>{info.lockfileDetected ? 'Detected' : 'Missing'}</Badge>
            </span>
          </div>

          <div className="flex flex-col gap-1.5 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-fg-muted">Scripts</span>
              <span className="flex items-center gap-2">
                <span className="text-fg">{info.scriptNames.length} scripts</span>
                <Button size="sm" variant="ghost" onClick={() => setScriptsExpanded((expanded) => !expanded)} disabled={info.scriptNames.length === 0}>
                  {scriptsExpanded ? 'Hide' : 'View'}
                </Button>
              </span>
            </div>
            {scriptsExpanded && info.scriptNames.length > 0 && <p className="text-xs text-fg-faint">{info.scriptNames.join(', ')}</p>}
          </div>

          <div className="flex items-center justify-between py-2 text-sm">
            <span className="text-fg-muted">Environment variables</span>
            <span className="flex items-center gap-2">
              <span className="text-fg">{info.envFileName ? `${info.envVariableNames.length} variables` : 'No .env file'}</span>
              <Tooltip content="Open the file directly to edit">
                <span>
                  <Button size="sm" variant="ghost" disabled>
                    Manage
                  </Button>
                </span>
              </Tooltip>
            </span>
          </div>
        </CardRows>
      )}
    </Card>
  );
}
