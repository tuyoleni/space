import { useCallback, useState } from 'react';
import type { AgentStandingPermissionSummary, Project } from '@space/contracts';
import { formatRelativeTime } from '@space/ui';

/**
 * Minimal M7 intent/agent surface (spec 36.7 exit criteria: agent changes
 * traceable to files/operations, secrets excluded, high-impact actions
 * confirmed) — mirrors GitPanel/GithubPanel's shape as a project-scoped
 * panel. `DiffSelection`/`ChangeIntent` are opaque `unknown` at the IPC
 * boundary (see contracts/space-api.ts); the shapes below mirror
 * @space/agent's real types for display purposes only, without importing
 * that package into the renderer bundle (spec section 32: packages that
 * touch native operations, which @space/agent transitively does via
 * @space/git-engine, must never be imported into the renderer).
 *
 * Group include/exclude here is a client-side filter over which evidence
 * is sent to `commitCompose` — the full rename/merge/split transitions
 * @space/agent already implements and tests are not yet wired as separate
 * IPC channels (noted as a deferred follow-up, not required by this
 * milestone's exit criteria).
 */
interface DiffSelectionLike {
  readonly filePath: string;
  readonly staged: 'staged' | 'unstaged';
  readonly hunkHeader: string;
}

interface ChangeIntentLike {
  readonly id: string;
  readonly title: string;
  readonly explanation: string;
  readonly confidence: number;
  readonly evidence: readonly DiffSelectionLike[];
  readonly generatedBy: 'rule' | 'model' | 'user';
}

const LOW_CONFIDENCE_THRESHOLD = 0.6;

interface AgentPanelProps {
  readonly project: Project;
  readonly workspaceId: string;
}

export function AgentPanel({ project, workspaceId }: AgentPanelProps) {
  const [evidence, setEvidence] = useState<DiffSelectionLike[]>([]);
  const [groups, setGroups] = useState<ChangeIntentLike[]>([]);
  const [includedGroupIds, setIncludedGroupIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [permissions, setPermissions] = useState<readonly AgentStandingPermissionSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guarded(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const refreshGroups = useCallback(async () => {
    const loadedEvidence = (await window.space.agent.diffLoad({ projectId: project.id })) as DiffSelectionLike[];
    setEvidence(loadedEvidence);
    const loadedGroups = (await window.space.agent.intentGenerate({ evidence: loadedEvidence })) as ChangeIntentLike[];
    setGroups(loadedGroups);
    setIncludedGroupIds(new Set(loadedGroups.map((g) => g.id)));
  }, [project.id]);

  function toggleIncluded(groupId: string): void {
    setIncludedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  function handleComposeCommit(): void {
    if (!message.trim()) {
      return;
    }
    const includedEvidence = groups.filter((g) => includedGroupIds.has(g.id)).flatMap((g) => g.evidence);
    void guarded(async () => {
      await window.space.agent.commitCompose({ projectId: project.id, evidence: includedEvidence, message: message.trim() });
      setMessage('');
      await refreshGroups();
    });
  }

  const refreshPermissions = useCallback(async () => {
    setPermissions(await window.space.agent.permissionList(workspaceId));
  }, [workspaceId]);

  function handleRevokePermission(id: string): void {
    void guarded(async () => {
      await window.space.agent.permissionRevoke({ id });
      await refreshPermissions();
    });
  }

  /**
   * Demonstrates the structural confirmation gate end to end: this
   * `window.confirm` is what actually sets `confirmed: true` in the
   * dispatched action — `dispatchAgentAction` (@space/agent) enforces it
   * server-side regardless of what the renderer sends, so a bypassed or
   * skipped dialog here still cannot push without confirmation.
   */
  function handleAgentPush(): void {
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
    <section style={{ border: '1px dashed #666', borderRadius: 6, padding: '0.75rem', marginTop: '0.5rem' }}>
      <h3>Agent</h3>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" disabled={busy} onClick={() => void guarded(refreshGroups)}>
          Load changes &amp; group intent
        </button>
        <button type="button" disabled={busy} onClick={() => void guarded(refreshPermissions)}>
          Load standing permissions
        </button>
        <button type="button" disabled={busy} onClick={handleAgentPush}>
          Agent: push current branch&hellip;
        </button>
      </div>

      {evidence.length === 0 && groups.length === 0 && (
        <p style={{ fontSize: '0.85rem' }}>No changes loaded yet.</p>
      )}

      {groups.length > 0 && (
        <div style={{ marginTop: '0.5rem' }}>
          <h4>Intent groups ({evidence.length} evidence item{evidence.length === 1 ? '' : 's'})</h4>
          <ul style={{ margin: '0.5rem 0', paddingLeft: '1rem', fontSize: '0.85rem' }}>
            {groups.map((group) => (
              <li key={group.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={includedGroupIds.has(group.id)}
                    onChange={() => toggleIncluded(group.id)}
                  />{' '}
                  <strong>{group.title}</strong>{' '}
                  {group.confidence < LOW_CONFIDENCE_THRESHOLD && <em>(low confidence: {Math.round(group.confidence * 100)}%)</em>}
                  {' '}[{group.generatedBy}]
                </label>
                <div style={{ paddingLeft: '1.5rem' }}>
                  {group.explanation}
                  <ul>
                    {group.evidence.map((e, index) => (
                      <li key={index}>
                        {e.filePath} ({e.staged}, {e.hunkHeader})
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
          <fieldset disabled={busy}>
            <legend>Compose commit from included groups</legend>
            <input
              type="text"
              placeholder="Commit message"
              aria-label="Commit message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              style={{ width: '20rem' }}
            />
            <button type="button" disabled={!message.trim()} onClick={handleComposeCommit}>
              Commit
            </button>
          </fieldset>
        </div>
      )}

      {permissions.length > 0 && (
        <div style={{ marginTop: '0.5rem' }}>
          <h4>Standing permissions</h4>
          <ul style={{ margin: '0.5rem 0', paddingLeft: '1rem', fontSize: '0.85rem' }}>
            {permissions.map((permission) => {
              const granted = formatRelativeTime(permission.grantedAt);
              return (
              <li key={permission.id}>
                {permission.actionType} &mdash; granted{' '}
                <time dateTime={permission.grantedAt} title={granted.exact} aria-label={`granted ${granted.exact}`}>
                  {granted.relative}
                </time>
                {permission.revokedAt ? ' (revoked)' : (
                  <>
                    {' '}
                    <button type="button" disabled={busy} onClick={() => handleRevokePermission(permission.id)}>
                      Revoke
                    </button>
                  </>
                )}
              </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && <p role="alert">{error}</p>}
    </section>
  );
}
