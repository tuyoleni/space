/**
 * Model privacy policy (spec 13.3 CHG-003, 19.3 "Agent data controls").
 * This module decides *what content is eligible to leave the machine* if
 * a remote model is ever used — it has no network code and no model
 * client of its own (see `model-provider.ts` for the DI seam that would
 * eventually call a real provider). Every rule here is enforced before
 * anything is handed to that seam, not left to the provider to respect.
 *
 * Non-negotiable floor (spec 13.3, 25.3.6): binary files are never sent by
 * default; files matching a known credential/env/key-material shape are
 * never sent, full stop, regardless of a "minimum evidence" calculation;
 * everything else is redacted for known secret shapes before disclosure;
 * the user can see exactly what would be sent; the whole operation is
 * cancellable and every request that is actually sent is recorded as an
 * audit entry (metadata only, spec 19.3: "logged as metadata, not raw
 * sensitive content").
 */
import { isSensitivePath, redactSecretPatterns } from '@space/workspace-runner';
import type { FileDiff } from '@space/git-engine';
import type { DiffSelection, StagedState } from './diff-selection';

export type ModelEvidenceExclusionReason = 'binary' | 'sensitive-path';

export interface ModelEvidenceFragment {
  readonly filePath: string;
  readonly staged: StagedState;
  readonly hunkHeader: string;
  /** Redacted patch fragment text — the exact bytes that would be sent. */
  readonly redactedText: string;
}

export interface ModelEvidenceExclusion {
  readonly filePath: string;
  readonly reason: ModelEvidenceExclusionReason;
}

export interface ModelDisclosure {
  readonly fragments: readonly ModelEvidenceFragment[];
  readonly excluded: readonly ModelEvidenceExclusion[];
}

/** True when `path` must never be sent to a remote model, regardless of any other policy (spec 13.3). */
export function isEligibleForModel(path: string, isBinary: boolean): boolean {
  if (isBinary) {
    return false;
  }
  if (isSensitivePath(path)) {
    return false;
  }
  return true;
}

function renderSelectionFragment(selection: DiffSelection, file: FileDiff): string | null {
  const hunk = file.hunks[selection.hunkIndex];
  if (!hunk) {
    return null;
  }
  const lines =
    selection.selectedLineIndexes === null
      ? hunk.lines
      : hunk.lines.filter((_, index) => (selection.selectedLineIndexes as readonly number[]).includes(index) || hunk.lines[index]?.type === 'context');
  const marker = (t: 'context' | 'add' | 'remove') => (t === 'context' ? ' ' : t === 'add' ? '+' : '-');
  return [hunk.header, ...lines.map((l) => `${marker(l.type)}${l.content}`)].join('\n');
}

/**
 * Builds exactly what would be disclosed to a remote model for a set of
 * evidence: the minimum necessary fragments (only the selected hunks —
 * never a whole file, never the whole repository), redacted for known
 * secret shapes, with binary files and known-sensitive paths excluded and
 * reported separately so the user can see *why* something was left out
 * (spec 13.3: "the user must know which files or diff fragments are
 * sent"; "the model must receive the minimum evidence required").
 */
export function buildModelDisclosure(
  selections: readonly DiffSelection[],
  fileLookup: (filePath: string, staged: StagedState) => FileDiff | null,
): ModelDisclosure {
  const fragments: ModelEvidenceFragment[] = [];
  const excluded: ModelEvidenceExclusion[] = [];
  const seenExclusions = new Set<string>();

  for (const selection of selections) {
    const file = fileLookup(selection.filePath, selection.staged);
    if (!file) {
      continue;
    }
    if (!isEligibleForModel(file.path, file.isBinary)) {
      const key = `${selection.filePath}:${file.isBinary ? 'binary' : 'sensitive-path'}`;
      if (!seenExclusions.has(key)) {
        seenExclusions.add(key);
        excluded.push({ filePath: selection.filePath, reason: file.isBinary ? 'binary' : 'sensitive-path' });
      }
      continue;
    }
    const rendered = renderSelectionFragment(selection, file);
    if (rendered === null) {
      continue;
    }
    fragments.push({
      filePath: selection.filePath,
      staged: selection.staged,
      hunkHeader: selection.hunkHeader,
      redactedText: redactSecretPatterns(rendered),
    });
  }

  return { fragments, excluded };
}

// ---------------------------------------------------------------------------
// Auditability and cancellation (spec 13.3: "the operation must be
// cancellable and auditable"; spec 19.3: "external model calls are logged
// as metadata, not raw sensitive content").
// ---------------------------------------------------------------------------

export interface ModelRequestAuditEntry {
  readonly requestId: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly outcome: 'pending' | 'completed' | 'cancelled' | 'failed';
  /** Counts and paths only — never the redacted/raw text itself. */
  readonly fragmentCount: number;
  readonly filePaths: readonly string[];
  readonly excludedFilePaths: readonly string[];
}

export function buildAuditEntry(
  requestId: string,
  disclosure: ModelDisclosure,
  startedAt: string,
): ModelRequestAuditEntry {
  return {
    requestId,
    startedAt,
    endedAt: null,
    outcome: 'pending',
    fragmentCount: disclosure.fragments.length,
    filePaths: [...new Set(disclosure.fragments.map((f) => f.filePath))],
    excludedFilePaths: disclosure.excluded.map((e) => e.filePath),
  };
}

export function completeAuditEntry(
  entry: ModelRequestAuditEntry,
  outcome: 'completed' | 'cancelled' | 'failed',
  endedAt: string,
): ModelRequestAuditEntry {
  return { ...entry, outcome, endedAt };
}

/** A simple cooperative cancellation token — the DI'd model-provider call is expected to poll/observe this (spec 13.3). */
export class ModelRequestCancellation {
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  throwIfCancelled(): void {
    if (this.cancelled) {
      throw new ModelRequestCancelledError();
    }
  }
}

export class ModelRequestCancelledError extends Error {
  constructor() {
    super('The model request was cancelled by the user.');
    this.name = 'ModelRequestCancelledError';
  }
}
