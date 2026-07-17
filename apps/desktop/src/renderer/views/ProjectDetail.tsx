import { useEffect, useState } from 'react';
import { Download, Play, Square, TerminalSquare } from 'lucide-react';
import type { PackageManagerDetection, Project, WorkspaceSummary } from '@space/contracts';
import { Badge, Button, StatusDot, Tabs, TabsContent, TabsList, TabsTrigger, identityColor } from '@space/ui';
import type { ProjectActions, ProjectRuntimeState } from '../AppShell';
import { GitPanel } from '../GitPanel';
import { GithubPanel } from '../GithubPanel';
import { AgentPanel } from '../AgentPanel';
import { ActivityGrid } from '../ActivityGrid';
import { TerminalPanel } from '../TerminalPanel';

interface ProjectDetailProps {
  readonly workspace: WorkspaceSummary;
  readonly project: Project;
  readonly runtime: ProjectRuntimeState;
  readonly actions: ProjectActions;
  readonly busy: boolean;
}

export function ProjectDetail({ workspace, project, runtime, actions, busy }: ProjectDetailProps) {
  const [packageManager, setPackageManager] = useState<PackageManagerDetection | null>(null);

  useEffect(() => {
    setPackageManager(null);
    void window.space.project.detectPackageManager({ canonicalPath: project.canonicalPath }).then(setPackageManager);
  }, [project.canonicalPath]);

  const detection = runtime.detections[project.id];
  const devServers = runtime.devServers[project.id] ?? [];
  const runningServer = devServers.find((server) => server.state === 'running');
  const session = runtime.openTerminal[project.id];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <StatusDot color={identityColor(project.id)} />
          <h2 className="text-lg font-semibold text-fg">{project.name}</h2>
          <Badge variant={project.trustState === 'trusted' ? 'success' : 'warning'}>{project.trustState}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-fg-faint">{project.canonicalPath}</p>
      </div>

      <Tabs defaultValue="overview" className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="px-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="git">Git</TabsTrigger>
          <TabsTrigger value="github">GitHub</TabsTrigger>
          <TabsTrigger value="agent">Agent</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto p-5">
          <TabsContent value="overview" className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {project.trustState === 'untrusted' ? (
                <>
                  <Button size="sm" onClick={() => actions.trustDecision(project, 'trust-this-project')} disabled={busy}>
                    Trust this project
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => actions.trustDecision(project, 'keep-untrusted')} disabled={busy}>
                    Keep untrusted
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => actions.install(project, true)} disabled={busy}>
                    <Download size={13} /> Install deps (allow once)
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => actions.install(project, false)} disabled={busy}>
                  <Download size={13} /> Install dependencies
                </Button>
              )}
              {runningServer ? (
                <Button size="sm" variant="secondary" onClick={() => actions.stopDevServer(project, runningServer.id)} disabled={busy}>
                  <Square size={13} /> Stop dev server{runningServer.detectedUrl ? ` (${runningServer.detectedUrl})` : ''}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => actions.startDevServer(project, project.trustState === 'untrusted')}
                  disabled={busy}
                >
                  <Play size={13} /> Start dev server
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => actions.detect(project)} disabled={busy}>
                Detect stack
              </Button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {project.detectedTypes.map((type) => (
                <Badge key={type}>{type}</Badge>
              ))}
              {packageManager?.packageManager && <Badge variant="accent">{packageManager.packageManager}</Badge>}
            </div>

            {detection && detection.facts.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-fg-faint">Detected facts</p>
                <ul className="flex flex-col gap-1">
                  {detection.facts.map((fact) => (
                    <li key={fact.id} className="text-sm text-fg-muted">
                      <span className="text-fg">{fact.label}</span> ({Math.round(fact.confidence * 100)}%) — {fact.evidence}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>

          <TabsContent value="git">
            <GitPanel project={project} />
          </TabsContent>

          <TabsContent value="github">
            <GithubPanel workspaceId={workspace.id} projectId={project.id} />
          </TabsContent>

          <TabsContent value="agent">
            <AgentPanel project={project} workspaceId={workspace.id} />
          </TabsContent>

          <TabsContent value="activity">
            <ActivityGrid workspaceId={workspace.id} />
          </TabsContent>

          <TabsContent value="terminal" className="flex h-full flex-col gap-3">
            {session ? (
              <>
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" onClick={() => actions.closeTerminal(project)} disabled={busy}>
                    Close terminal
                  </Button>
                </div>
                <div className="min-h-[24rem] flex-1 overflow-hidden rounded-md border border-border">
                  <TerminalPanel session={session} />
                </div>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => actions.openTerminal(project)} disabled={busy}>
                <TerminalSquare size={13} /> Open terminal
              </Button>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
