import { useEffect, useState } from 'react';
import { Button, Dialog, Input } from '@space/ui';

export interface PromptField {
  readonly key: string;
  readonly label: string;
  readonly placeholder?: string;
  readonly type?: 'text' | 'password';
  readonly helpText?: string;
}

interface PromptDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly fields: readonly PromptField[];
  readonly submitLabel?: string;
  readonly onSubmit: (values: Record<string, string>) => void;
}

/**
 * The "this service needs a value from you" popup: any CLI-backed
 * integration (Anthropic API key, a future project id, etc.) that would
 * otherwise require the user to type into a terminal collects it here
 * instead. Values are held in local state only — callers decide where
 * (if anywhere) the result gets persisted.
 */
export function PromptDialog({ open, onOpenChange, title, description, fields, submitLabel = 'Continue', onSubmit }: PromptDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setValues({});
    }
  }, [open]);

  const canSubmit = fields.every((field) => (values[field.key] ?? '').trim().length > 0);

  function handleSubmit(): void {
    if (!canSubmit) {
      return;
    }
    onSubmit(values);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      {...(description !== undefined ? { description } : {})}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={!canSubmit} onClick={handleSubmit}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {fields.map((field) => (
          <div key={field.key} className="flex flex-col gap-1">
            <label className="text-xs font-medium text-fg-muted" htmlFor={`prompt-${field.key}`}>
              {field.label}
            </label>
            <Input
              id={`prompt-${field.key}`}
              type={field.type ?? 'text'}
              placeholder={field.placeholder}
              value={values[field.key] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleSubmit();
                }
              }}
            />
            {field.helpText && <p className="text-[11px] text-fg-faint">{field.helpText}</p>}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
