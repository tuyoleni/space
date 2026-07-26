import { useState } from 'react';
import type { GithubRepoVisibility, ProjectTemplateSummary } from '@space/contracts';
import { Button, Checkbox, Dialog, Input, Select } from '@space/ui';
import { useGithubAuth } from '../useGithubAuth';

/** Exactly what the create flow needs from this dialog — mirrors `CreateProjectFromTemplateInput`'s optional half. */
export interface CreateProjectRequest {
  readonly templateId: string;
  readonly name: string;
  readonly initializeGit: boolean;
  readonly publishToGithub?: {
    readonly owner: string;
    readonly visibility: GithubRepoVisibility;
    readonly push: boolean;
  };
}

interface CreateProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly templates: readonly ProjectTemplateSummary[];
  readonly workspaceId: string;
  readonly onCreate: (request: CreateProjectRequest) => void;
}

const VISIBILITY_OPTIONS: readonly { value: GithubRepoVisibility; label: string }[] = [
  { value: 'private', label: 'Private' },
  { value: 'public', label: 'Public' },
  { value: 'internal', label: 'Internal' },
];

/**
 * PRJ-004's create flow, whole: scaffold, initialise Git, and optionally
 * create the repository on the workspace's connected GitHub account in one
 * pass. "Initialize a Git repository" defaults on because a project without
 * one cannot be committed, branched, or published — leaving it off was what
 * produced "… is not a Git repository" on every subsequent action.
 *
 * The GitHub half is only offered when this workspace actually has an
 * authenticated `gh` session; there is no field to type an account into,
 * because the account comes from that session, never from this dialog.
 */
export function CreateProjectDialog({ open, onOpenChange, templates, workspaceId, onCreate }: CreateProjectDialogProps) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [name, setName] = useState('');
  const [initializeGit, setInitializeGit] = useState(true);
  const [createRepo, setCreateRepo] = useState(false);
  const [owner, setOwner] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<GithubRepoVisibility>('private');
  const [push, setPush] = useState(true);
  const { report } = useGithubAuth(workspaceId);

  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
  const githubReady = report?.authenticated === true && report.activeAccount !== null;
  const ownerOptions = report
    ? [
        ...(report.activeAccount ? [{ value: report.activeAccount.account, label: `${report.activeAccount.account} (your account)` }] : []),
        ...(report.availableOrgs ?? []).map((org) => ({ value: org.login, label: org.login })),
      ]
    : [];
  const effectiveOwner = owner ?? report?.activeAccount?.account ?? '';

  function submit(): void {
    if (!templateId || !name.trim()) {
      return;
    }
    const wantsRepo = createRepo && githubReady && effectiveOwner !== '';
    onCreate({
      templateId,
      name: name.trim(),
      // A GitHub repository implies a local one, whatever the checkbox says.
      initializeGit: initializeGit || wantsRepo,
      ...(wantsRepo ? { publishToGithub: { owner: effectiveOwner, visibility, push } } : {}),
    });
    setName('');
    setCreateRepo(false);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create project"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!templateId || !name.trim()} onClick={submit}>
            Create&hellip;
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          Template
          <Select
            ariaLabel="Project template"
            value={templateId || undefined}
            onValueChange={setTemplateId}
            options={templates.map((template) => ({ value: template.id, label: template.displayName }))}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          Directory name
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
            placeholder="my-app"
          />
        </label>

        <div className="flex flex-col gap-2 rounded-md border border-border p-2.5">
          <label className="flex items-center gap-2 text-xs text-fg">
            <Checkbox
              checked={initializeGit || createRepo}
              disabled={createRepo}
              onCheckedChange={setInitializeGit}
              aria-label="Initialize a Git repository"
            />
            Initialize a Git repository and make an initial commit
          </label>

          <label className="flex items-center gap-2 text-xs text-fg">
            <Checkbox
              checked={createRepo}
              disabled={!githubReady}
              onCheckedChange={setCreateRepo}
              aria-label="Create a repository on GitHub"
            />
            Create it on GitHub
            {report && !githubReady && <span className="text-fg-faint">— sign in to GitHub first</span>}
          </label>

          {createRepo && githubReady && (
            <div className="mt-0.5 flex flex-col gap-2 border-l border-border pl-3">
              <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
                Owner
                <Select
                  ariaLabel="Repository owner"
                  value={effectiveOwner || undefined}
                  onValueChange={setOwner}
                  options={ownerOptions}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
                Visibility
                <Select
                  ariaLabel="Repository visibility"
                  value={visibility}
                  onValueChange={(next) => setVisibility(next as GithubRepoVisibility)}
                  options={[...VISIBILITY_OPTIONS]}
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-fg">
                <Checkbox checked={push} onCheckedChange={setPush} aria-label="Push the initial commit" />
                Push the initial commit
              </label>
            </div>
          )}
        </div>

        {selectedTemplate && (
          <p className="text-xs text-fg-faint">
            No framework is scaffolded (not Vite/Expo/Next/etc.) — this creates a plain{' '}
            {selectedTemplate.displayName.toLowerCase()}. Requires: {selectedTemplate.requiredExecutables.join(', ')}. Runs:{' '}
            <code className="text-fg-muted">
              {selectedTemplate.previewCreationCommand.executable} {selectedTemplate.previewCreationCommand.args.join(' ')}
            </code>
          </p>
        )}
      </div>
    </Dialog>
  );
}

interface CloneProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onClone: (url: string, name: string) => void;
}

export function CloneProjectDialog({ open, onOpenChange, onClone }: CloneProjectDialogProps) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');

  function submit(): void {
    if (!url.trim()) {
      return;
    }
    onClone(url.trim(), name.trim());
    setUrl('');
    setName('');
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Clone from GitHub"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!url.trim()} onClick={submit}>
            Clone&hellip;
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          Remote URL or path
          <Input autoFocus value={url} onChange={(event) => setUrl(event.target.value)} placeholder="git@github.com:org/repo.git" />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          Directory name (optional)
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && submit()}
            placeholder="repo"
          />
        </label>
      </div>
    </Dialog>
  );
}
