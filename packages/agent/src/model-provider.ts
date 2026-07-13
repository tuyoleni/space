/**
 * The remote-model DI seam (spec 13.3 CHG-003, ADR-008). `ModelProvider`
 * is the only place a real network call to a model API would ever be
 * made, and no implementation of it in this codebase does that yet — this
 * milestone builds the seam and a canned `FakeModelProvider` for tests,
 * matching the `GhExecutor`/`GitExecutor` DI pattern the rest of the app
 * uses for every other external system. Wiring a real provider behind
 * this interface is explicitly out of scope for this milestone (see
 * ADR-008); when it happens, it must only ever be called with a
 * `ModelDisclosure` that has already passed through `model-privacy.ts`'s
 * policy — this module never sees raw, unredacted, or excluded content.
 *
 * Rule-based grouping (`change-intent.ts`) is the real, always-available
 * default and does not depend on this module at all (spec 13.3: "a local
 * or offline grouping fallback must exist"). A model provider is
 * additive: it can *propose* groups, but every proposal is re-anchored to
 * real evidence by `applyModelProposals` below — a model can never invent
 * evidence that doesn't trace back to a selection the caller actually
 * disclosed to it (spec 25.3.6: "model output is data, never executable
 * authority").
 */
import type { ModelDisclosure } from './model-privacy';
import type { ChangeIntent } from './change-intent';
import type { DiffSelection } from './diff-selection';

export interface ModelIntentGroupingRequest {
  readonly disclosure: ModelDisclosure;
}

export interface ModelProposedIntentGroup {
  readonly title: string;
  readonly explanation: string;
  readonly userVisibleOutcome?: string;
  readonly confidence: number;
  /** File paths this proposed group covers — must be a subset of the disclosed fragments' paths. */
  readonly filePaths: readonly string[];
}

export interface ModelCommitMessageRequest {
  readonly disclosure: ModelDisclosure;
}

/**
 * DI seam for an optional remote (or local) model backend. No
 * implementation in this codebase calls a real provider; see
 * `FakeModelProvider` for the canned implementation every test in this
 * milestone uses instead.
 */
export interface ModelProvider {
  readonly id: string;
  proposeIntentGroups(request: ModelIntentGroupingRequest): Promise<readonly ModelProposedIntentGroup[]>;
  generateCommitMessage(request: ModelCommitMessageRequest): Promise<string>;
}

/**
 * A canned, deterministic, offline `ModelProvider` used by every test in
 * this milestone (per this milestone's hard safety boundary: zero real
 * network calls to any model provider). Responses are configured up
 * front, never computed by calling out anywhere.
 */
export class FakeModelProvider implements ModelProvider {
  readonly id = 'fake';

  constructor(
    private readonly canned: {
      readonly intentGroups?: readonly ModelProposedIntentGroup[];
      readonly commitMessage?: string;
    } = {},
  ) {}

  async proposeIntentGroups(_request: ModelIntentGroupingRequest): Promise<readonly ModelProposedIntentGroup[]> {
    return this.canned.intentGroups ?? [];
  }

  async generateCommitMessage(_request: ModelCommitMessageRequest): Promise<string> {
    return this.canned.commitMessage ?? 'Update files';
  }
}

let modelGroupCounter = 0;
function nextModelGroupId(): string {
  modelGroupCounter += 1;
  return `model-group-${modelGroupCounter}`;
}

/** Test-only: keeps applyModelProposals' generated ids reproducible across test runs. */
export function resetModelGroupIdCounterForTests(): void {
  modelGroupCounter = 0;
}

/**
 * Re-anchors a model's proposed groups to real evidence: a proposal's
 * `filePaths` is intersected against the real `evidence` pool actually
 * disclosed to the model, so a model can only ever regroup/relabel
 * evidence that is real — it cannot fabricate a `ChangeIntent` covering a
 * file it was never shown (spec 13.1 CHG-001, 25.3.6). Proposals that end
 * up covering zero real evidence are dropped rather than surfaced as an
 * empty group.
 */
export function applyModelProposals(
  evidence: readonly DiffSelection[],
  proposals: readonly ModelProposedIntentGroup[],
): ChangeIntent[] {
  const groups: ChangeIntent[] = [];
  for (const proposal of proposals) {
    const pathSet = new Set(proposal.filePaths);
    const matchedEvidence = evidence.filter((e) => pathSet.has(e.filePath));
    if (matchedEvidence.length === 0) {
      continue;
    }
    groups.push({
      id: nextModelGroupId(),
      title: proposal.title,
      explanation: proposal.explanation,
      ...(proposal.userVisibleOutcome !== undefined ? { userVisibleOutcome: proposal.userVisibleOutcome } : {}),
      confidence: proposal.confidence,
      evidence: matchedEvidence,
      included: true,
      generatedBy: 'model',
    });
  }
  return groups;
}
