import { useState } from 'react';
import type { ProjectTemplateSummary } from '@space/contracts';
import { Button, Dialog, Input, Select } from '@space/ui';

interface CreateProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly templates: readonly ProjectTemplateSummary[];
  readonly onCreate: (templateId: string, name: string) => void;
}

export function CreateProjectDialog({ open, onOpenChange, templates, onCreate }: CreateProjectDialogProps) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [name, setName] = useState('');
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;

  function submit(): void {
    if (!templateId || !name.trim()) {
      return;
    }
    onCreate(templateId, name.trim());
    setName('');
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
