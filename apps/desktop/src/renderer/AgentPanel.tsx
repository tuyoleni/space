import { useCallback, useEffect, useState } from 'react';
import { Bot, Shield, Sparkles, Upload } from 'lucide-react';
import type { AgentStandingPermissionSummary, AiReviewFinding, Project } from '@space/contracts';
import { Badge, Button, formatRelativeTime, useToast } from '@space/ui';
import { PromptDialog } from './PromptDialog';
import { toErrorMessage } from './errors';

/**
 * Agent trust surface (spec 19.2.3/19.3): standing permissions
 * (list/revoke) and the structurally-confirmed remote dispatch demo. The
 * change-grouping/compose flow this panel used to host lives in
 * ChangesView now — this panel is only about what the agent is allowed to
 * do. `window.confirm` here is what actually sets `confirmed: true`;
 * dispatchAgentAction enforces it server-side regardless.
 *
 * "AI review" is a separate, smaller trust surface: it reads TODO/FIXME
 * comments and proposes one-line fixes via the real Gemini API — never
 * autonomous, never writes without a per-fix `window.confirm` (same pattern
 * as the agent push demo above). The API key never touches this component's
 * state; it's collected once via PromptDialog and stored server-side,
 * encrypted, through ai-handlers.ts's `setApiKey`.
 */
interface AgentPanelProps {
  readonly project: Project | null;
  readonly workspaceId: string;
}

export function AgentPanel({ project, workspaceId }: AgentPanelProps) {
  const [permissions, setPermissions] = useState<readonly AgentStandingPermissionSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const [aiKeyConfigured, setAiKeyConfigured] = useState(false);
  const [apiKeyPromptOpen, setApiKeyPromptOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [findings, setFindings] = useState<readonly AiReviewFinding[] | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  async function guarded(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  const refreshPermissions = useCallback(async () => {
    setPermissions(await window.space.agent.permissionList(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    void refreshPermissions();
  }, [refreshPermissions]);

  useEffect(() => {
    void window.space.ai.keyStatus().then((status) => setAiKeyConfigured(status.configured));
  }, []);

  function runReview(): void {
    if (!project) {
      return;
    }
    setReviewing(true);
    void window.space.ai
      .reviewComments({ projectId: project.id })
      .then((result) => setFindings(result.findings))
      .catch((caught) => toast({ variant: 'error', message: toErrorMessage(caught) }))
      .finally(() => setReviewing(false));
  }

  function handleAiReview(): void {
    if (!aiKeyConfigured) {
      setApiKeyPromptOpen(true);
      return;
    }
    runReview();
  }

  function handleApiKeySubmit(values: Record<string, string>): void {
    const apiKey = values['apiKey'];
    if (!apiKey) {
      return;
    }
    void guarded(async () => {
      await window.space.ai.setApiKey({ apiKey });
      setAiKeyConfigured(true);
      runReview();
    });
  }

  function handleApplyFix(finding: AiReviewFinding): void {
    if (!project || !finding.proposedFix) {
      return;
    }
    const confirmed = window.confirm(
      `Replace line ${finding.line} in ${finding.file}?\n\n- ${finding.originalLine.trim()}\n+ ${finding.proposedFix.trim()}`,
    );
    if (!confirmed) {
      return;
    }
    setApplyingId(finding.id);
    void window.space.ai
      .applyFix({
        projectId: project.id,
        file: finding.file,
        line: finding.line,
        originalLine: finding.originalLine,
        newLine: finding.proposedFix,
      })
      .then(() => {
        setFindings((current) => current?.filter((item) => item.id !== finding.id) ?? null);
        toast({ variant: 'success', message: `Applied fix to ${finding.file}:${finding.line}.` });
      })
      .catch((caught) => toast({ variant: 'error', message: toErrorMessage(caught) }))
      .finally(() => setApplyingId(null));
  }

  function handleRevokePermission(id: string): void {
    void guarded(async () => {
      await window.space.agent.permissionRevoke({ id });
      await refreshPermissions();
    });
  }

  function handleAgentPush(): void {
    if (!project) {
      return;
    }
    const confirmed = window.confirm(`Let the agent push the current branch for project "${project.name}"?`);
    void guarded(async () => {
      await window.space.agent.planDispatch({
        action: {
          id: crypto.randomUUID(),
          type: 'git.push',
          workspaceId,
          projectId: project.id,
          parameters: { branch: 'main' },
          explanation: 'Push the current branch on the user\'s behalf',
          risk: 'remote',
        },
        confirmed,
      });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-faint">
          <Shield size={12} /> Standing permissions
        </p>
        {permissions.length === 0 ? (
          <p className="text-sm text-fg-faint">No standing permissions granted.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {permissions.map((permission) => {
              const granted = formatRelativeTime(permission.grantedAt);
              return (
                <li key={permission.id} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-sm">
                  <span className="text-fg">
                    {permission.actionType} — granted{' '}
                    <time dateTime={permission.grantedAt} title={granted.exact} aria-label={`granted ${granted.exact}`} className="text-fg-muted">
                      {granted.relative}
                    </time>
                  </span>
                  {permission.revokedAt ? (
                    <Badge>revoked</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleRevokePermission(permission.id)}>
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {project && (
        <div>
          <Button size="sm" variant="ghost" disabled={busy} onClick={handleAgentPush}>
            <Upload size={13} /> Agent: push current branch&hellip;
          </Button>
        </div>
      )}

      {project && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-faint">
            <Bot size={12} /> AI review
          </p>
          <Button size="sm" variant="ghost" disabled={reviewing} onClick={handleAiReview}>
            <Sparkles size={13} /> {reviewing ? 'Reviewing…' : 'Review TODO/FIXME comments'}
          </Button>

          {findings && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {findings.length === 0 && <p className="text-sm text-fg-faint">No TODO/FIXME comments found.</p>}
              {findings.map((finding) => (
                <li key={finding.id} className="rounded border border-border px-2 py-1.5 text-sm">
                  <p className="text-fg-muted">
                    {finding.file}:{finding.line}
                  </p>
                  <p className="truncate text-fg">{finding.comment}</p>
                  {finding.proposedFix ? (
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <code className="truncate text-xs text-success">{finding.proposedFix.trim()}</code>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={applyingId === finding.id}
                        onClick={() => handleApplyFix(finding)}
                      >
                        {applyingId === finding.id ? 'Applying…' : 'Apply'}
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-fg-faint">No confident one-line fix.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <PromptDialog
        open={apiKeyPromptOpen}
        onOpenChange={setApiKeyPromptOpen}
        title="Connect Gemini"
        description="Paste your Gemini API key to enable AI comment review. It's encrypted and stored locally, never sent anywhere but Google's API."
        fields={[{ key: 'apiKey', label: 'Gemini API key', type: 'password', placeholder: 'AIza…' }]}
        submitLabel="Save & review"
        onSubmit={handleApiKeySubmit}
      />
    </div>
  );
}
