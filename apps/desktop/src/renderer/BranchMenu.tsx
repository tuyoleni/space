import { useState } from 'react';
import * as RadixDropdownMenu from '@radix-ui/react-dropdown-menu';
import { ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, Cloud, GitBranch, Plus } from 'lucide-react';
import type { GitRefEntry } from '@space/contracts';
import { Dialog, Button, Input, cn } from '@space/ui';

interface BranchMenuProps {
  readonly branches: readonly GitRefEntry[];
  readonly currentBranch: string;
  readonly disabled: boolean;
  readonly onSwitch: (name: string) => void;
  readonly onCreate: (name: string) => void;
  readonly onFetch: () => void;
  readonly onPush: () => void;
}

const chipClasses = cn(
  'flex min-w-[7.5rem] flex-col items-start gap-0.5 rounded-lg bg-surface px-3 py-1.5 text-left outline-none',
  'hover:bg-surface-hover focus-visible:bg-surface-hover data-[state=open]:bg-surface-hover',
  'disabled:cursor-default disabled:hover:bg-surface',
);

const itemClasses = cn(
  'flex h-8 cursor-pointer select-none items-center gap-2 rounded px-2 text-sm text-fg outline-none',
  'data-[highlighted]:bg-surface-hover data-[disabled]:opacity-50',
);

/**
 * The topbar branch control — lists every real ref (local + remote, from
 * `git.listBranches`), not just the local ones, and is fully actionable:
 * switch/checkout, create-and-switch, fetch, and push. Remote branches are
 * grouped separately; switching to one creates the local tracking branch.
 */
export function BranchMenu({ branches, currentBranch, disabled, onSwitch, onCreate, onFetch, onPush }: BranchMenuProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');

  const local = branches.filter((branch) => branch.kind === 'local-branch');
  const remote = branches.filter((branch) => branch.kind === 'remote-branch');

  function submitCreate(): void {
    if (!name.trim()) {
      return;
    }
    onCreate(name.trim());
    setName('');
    setCreateOpen(false);
  }

  return (
    <>
      <RadixDropdownMenu.Root>
        <RadixDropdownMenu.Trigger asChild disabled={disabled}>
          <button type="button" className={chipClasses} aria-label={`Branch: ${currentBranch}`}>
            <span className="text-[10px] font-medium uppercase tracking-wide text-fg-faint">Branch</span>
            <span className="flex items-center gap-1.5 text-sm text-fg">
              <GitBranch size={13} className="text-fg-muted" />
              <span className="truncate">{currentBranch}</span>
              <ChevronDown size={12} className="text-fg-muted" />
            </span>
          </button>
        </RadixDropdownMenu.Trigger>
        <RadixDropdownMenu.Portal>
          <RadixDropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-50 max-h-[70vh] w-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-xl"
          >
            <RadixDropdownMenu.Item onSelect={() => setCreateOpen(true)} className={cn(itemClasses, 'text-accent')}>
              <Plus size={13} /> New branch…
            </RadixDropdownMenu.Item>
            <RadixDropdownMenu.Item onSelect={onFetch} className={itemClasses}>
              <ArrowDownToLine size={13} className="text-fg-muted" /> Fetch
            </RadixDropdownMenu.Item>
            <RadixDropdownMenu.Item onSelect={onPush} className={itemClasses}>
              <ArrowUpFromLine size={13} className="text-fg-muted" /> Push current branch
            </RadixDropdownMenu.Item>

            <RadixDropdownMenu.Separator className="my-1 h-px bg-border" />
            <RadixDropdownMenu.Label className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
              Local ({local.length})
            </RadixDropdownMenu.Label>
            {local.map((branch) => (
              <RadixDropdownMenu.Item key={branch.refname} onSelect={() => onSwitch(branch.refname)} className={itemClasses}>
                <span className="w-3.5 shrink-0">{branch.isHead && <Check size={13} className="text-accent" />}</span>
                <span className="truncate">{branch.shortName}</span>
                {branch.upstream && (branch.ahead || branch.behind) ? (
                  <span className="ml-auto shrink-0 text-[11px] text-fg-faint">
                    {branch.ahead ?? 0}↑ {branch.behind ?? 0}↓
                  </span>
                ) : null}
              </RadixDropdownMenu.Item>
            ))}

            {remote.length > 0 && (
              <>
                <RadixDropdownMenu.Separator className="my-1 h-px bg-border" />
                <RadixDropdownMenu.Label className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
                  Remote ({remote.length})
                </RadixDropdownMenu.Label>
                {remote.map((branch) => (
                  <RadixDropdownMenu.Item key={branch.refname} onSelect={() => onSwitch(branch.refname)} className={itemClasses}>
                    <Cloud size={13} className="shrink-0 text-fg-muted" />
                    <span className="truncate">{branch.shortName}</span>
                  </RadixDropdownMenu.Item>
                ))}
              </>
            )}
          </RadixDropdownMenu.Content>
        </RadixDropdownMenu.Portal>
      </RadixDropdownMenu.Root>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New branch"
        description={`Branch off ${currentBranch}`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={!name.trim()} onClick={submitCreate}>
              Create &amp; switch
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && submitCreate()}
          placeholder="feature/my-branch"
        />
      </Dialog>
    </>
  );
}
