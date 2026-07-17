import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, FileDiff, FileQuestion, GitCompareArrows, RefreshCw } from 'lucide-react';
import type {
  ActivityEvent as ActivityEventRecord,
  ActivityEventType,
  GitCommitNode,
  GitFileDiffStat,
  GitStashEntry,
  GitStatusSummary,
  GithubPullRequestSummary,
  Project,
  WorkspaceSummary,
} from '@space/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, EmptyState, Input, cn, formatRelativeTime, useToast } from '@space/ui';
import { toErrorMessage } from '../errors';
import { usePersistentState } from '../usePersistentState';
import { ChangeStatTiles, type ChangeStatTile } from '../changes/ChangeStatTiles';
import {
  ChangesToolbarTabs,
  type ChangesFilter,
  type ChangesGroupByOption,
  type ChangesTab,
} from '../changes/ChangesToolbarTabs';
import { ChangeGroupList, type ChangeGroupItem } from '../changes/ChangeGroupList';
import { FileExplorerList, type FileDiffRow } from '../changes/FileExplorerList';
import { DiffPreview } from '../changes/DiffPreview';
import { ConflictResolverPanel } from '../changes/ConflictResolverPanel';
import { CommitGraph } from '../changes/CommitGraph';
import { RecentActivityCard, type ActivityEvent as ActivityFeedEvent, type ActivityKind } from '../changes/RecentActivityCard';
import { StashesCard } from '../changes/StashesCard';
import { ActivePullRequestsCard, type PullRequestRow, type PullRequestState } from '../changes/ActivePullRequestsCard';

/**
 * The unified "GitHub" screen (formerly "Changes"). It folds the former
 * standalone History view in as the commit-graph section and layers the
 * demo's stat tiles, tab/filter toolbar, file explorer, conflict resolver,
 * and the Recent Activity / Stashes / Pull Requests cards on top of the
 * original intent-group workflow — every value is sourced from a real
 * `window.space` call, never mocked. GitHub sign-in/out lives in the app
 * header (AppTopbar), not a card here — there's nothing this screen needs
 * from the auth state beyond gating the Pull Requests card.
 *
 * Real wiring, top → bottom:
 *  - Stat tiles ....... git.status (entries/branch ahead·behind/conflicts) + git.diffStats
 *  - Change Groups .... agent.diffLoad → agent.intentGenerate, totals from git.diffStats
 *  - File Explorer .... git.diffStats (merged per-path), diff via git.diffFile
 *  - Conflict resolver git.status conflicts, git.resolveConflict/stage/continue/abort
 *  - Commit graph ..... git.loadHistory (paginated — the former History view)
 *  - Recent Activity .. activity.listRange
 *  - Stashes .......... git.listStashes / applyStash / dropStash (confirmed)
 *  - Pull Requests .... github.authReport (guard) → github.prList
 *  - Commit footer .... agent.commitCompose (unchanged)
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

interface GroupFileRef {
  readonly filePath: string;
  readonly staged: boolean;
}

/** One unique working-tree path, with its summed diff counts and which sides of the index it touches. */
interface FileEntry {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly hasStaged: boolean;
  readonly hasUnstaged: boolean;
}

const HISTORY_PAGE_SIZE = 50;
const ACTIVITY_FEED_LIMIT = 8;
const PR_LIMIT = 8;

const GROUP_BY_OPTIONS: readonly ChangesGroupByOption[] = [
  { value: 'directory', label: 'Directory' },
  { value: 'status', label: 'Status' },
];

/**
 * Only genuinely repository-level events belong in this screen's feed — not
 * platform noise like opening a terminal, switching workspace, or the endless
 * "switched to branch" churn. This is the allow-list; everything else is dropped.
 */
const GIT_ACTIVITY_TYPES: ReadonlySet<ActivityEventType> = new Set<ActivityEventType>([
  'git-initialised',
  'commit',
  'branch-created',
  'branch-deleted',
  'fetch',
  'pull',
  'push',
  'pull-request',
  'check-or-workflow',
  'release-or-deployment',
]);

/** Map a persisted activity event type onto one of the feed card's glyph kinds. */
const ACTIVITY_KIND: Partial<Record<ActivityEventType, ActivityKind>> = {
  commit: 'commit',
  push: 'push',
  pull: 'pull',
  fetch: 'pull',
  'branch-created': 'branch',
  'branch-deleted': 'branch',
  'pull-request': 'other',
};

function uniqueFiles(evidence: readonly DiffSelectionLike[]): GroupFileRef[] {
  const seen = new Set<string>();
  const files: GroupFileRef[] = [];
  for (const item of evidence) {
    const key = `${item.staged}:${item.filePath}`;
    if (!seen.has(key)) {
      seen.add(key);
      files.push({ filePath: item.filePath, staged: item.staged === 'staged' });
    }
  }
  return files;
}

function statFor(stats: readonly GitFileDiffStat[], file: GroupFileRef): GitFileDiffStat | undefined {
  return stats.find((stat) => stat.path === file.filePath && stat.staged === file.staged);
}

function prState(pr: GithubPullRequestSummary): PullRequestState {
  if (pr.isDraft) return 'draft';
  if (pr.state === 'MERGED') return 'merged';
  if (pr.state === 'CLOSED') return 'closed';
  return 'open';
}

function toFeedEvent(event: ActivityEventRecord): ActivityFeedEvent {
  return {
    id: event.id,
    kind: ACTIVITY_KIND[event.eventType] ?? 'other',
    label: event.summary,
    ...(event.subjectRef ? { detail: event.subjectRef } : {}),
    at: event.occurredAt,
  };
}

interface ChangesViewProps {
  readonly workspace: WorkspaceSummary;
  readonly project: Project | null;
}

export function ChangesView({ workspace, project }: ChangesViewProps) {
  // Intent groups + diff stats (the original CHG workflow).
  const [groups, setGroups] = useState<ChangeIntentLike[]>([]);
  const [stats, setStats] = useState<readonly GitFileDiffStat[]>([]);
  const [includedGroupIds, setIncludedGroupIds] = useState<Set<string>>(new Set());
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupsLoaded, setGroupsLoaded] = useState(false);

  // Real repository status (stat tiles, conflicts, untracked, ahead/behind).
  const [gitStatus, setGitStatus] = useState<GitStatusSummary | null>(null);

  // Commit graph (the former History view).
  const [commits, setCommits] = useState<GitCommitNode[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [fullyLoaded, setFullyLoaded] = useState(false);

  // Bottom cards.
  const [stashes, setStashes] = useState<readonly GitStashEntry[]>([]);
  const [activity, setActivity] = useState<readonly ActivityEventRecord[]>([]);
  const [prs, setPrs] = useState<readonly PullRequestRow[]>([]);

  // Toolbar preferences — persisted so they survive navigating away/back and reloads.
  const [tab, setTab] = usePersistentState<ChangesTab>('changes.tab', 'groups');
  const [filter, setFilter] = usePersistentState<ChangesFilter>('changes.filter', 'all');
  const [groupBy, setGroupBy] = usePersistentState('changes.groupBy', 'directory');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<GroupFileRef | null>(null);
  const [previewPatch, setPreviewPatch] = useState<string | null>(null);

  // Conflict resolver.
  const [conflictFile, setConflictFile] = useState<string | null>(null);
  const [conflictPatch, setConflictPatch] = useState<string | null>(null);

  // Commit compose + shared busy/error.
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const { toast } = useToast();

  // Destructive stash-drop confirmation.
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  // Remote (server) sync — what's on origin, not just the stale local view.
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [fetching, setFetching] = useState(false);

  const projectId = project?.id ?? null;
  const hasRepo = Boolean(project?.repositoryRoot);

  // --- Loaders (each a real window.space call) ---------------------------

  const refreshGroups = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const [evidence, diffStats] = await Promise.all([
        window.space.agent.diffLoad({ projectId }) as Promise<DiffSelectionLike[]>,
        window.space.git.diffStats({ projectId }),
      ]);
      const loadedGroups = (await window.space.agent.intentGenerate({ evidence })) as ChangeIntentLike[];
      setGroups(loadedGroups);
      setStats(diffStats.files);
      setIncludedGroupIds(new Set(loadedGroups.map((group) => group.id)));
      // Intent groups are regenerated (with fresh ids) on every scan, so the
      // previously selected id is almost always stale by the time this
      // resolves — validate it's still present rather than keeping a dead
      // id around, which left the diff pane stuck on "No selection" even
      // though groups had loaded.
      setSelectedGroupId((current) =>
        current && loadedGroups.some((group) => group.id === current) ? current : loadedGroups[0]?.id ?? null,
      );
      setGroupsLoaded(true);
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  const refreshStatus = useCallback(async () => {
    if (!projectId || !hasRepo) {
      setGitStatus(null);
      return;
    }
    try {
      setGitStatus(await window.space.git.status({ projectId }));
    } catch (caught) {
      toast({ variant: 'error', message: toErrorMessage(caught) });
    }
  }, [projectId, hasRepo]);

  const loadHistory = useCallback(
    async (count: number) => {
      if (!projectId) return;
      setHistoryBusy(true);
      try {
        const page = await window.space.git.loadHistory({ projectId, offset: 0, count });
        setCommits([...page.commits]);
        setFullyLoaded(page.fullyIndexed && page.commits.length >= page.totalIndexed);
      } catch (caught) {
        toast({ variant: 'error', message: toErrorMessage(caught) });
      } finally {
        setHistoryBusy(false);
      }
    },
    [projectId],
  );

  const refreshStashes = useCallback(async () => {
    if (!projectId || !hasRepo) {
      setStashes([]);
      return;
    }
    try {
      setStashes(await window.space.git.listStashes({ projectId }));
    } catch {
      setStashes([]);
    }
  }, [projectId, hasRepo]);

  const refreshActivity = useCallback(async () => {
    const now = new Date();
    const from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const events = await window.space.activity.listRange({
        workspaceId: workspace.id,
        fromInclusive: from,
        toInclusive: now.toISOString(),
      });
      setActivity(events);
    } catch {
      setActivity([]);
    }
  }, [workspace.id]);

  const refreshPrs = useCallback(async () => {
    try {
      const report = await window.space.github.authReport({ workspaceId: workspace.id });
      if (!report.authenticated) {
        setPrs([]);
        return;
      }
      // Scoped to this screen's project so the list reflects its repo, not
      // whatever directory the host process happens to be running in.
      const list = await window.space.github.prList({ workspaceId: workspace.id, projectId: project?.id, state: 'open', limit: PR_LIMIT });
      setPrs(
        list.map((pr) => ({
          number: pr.number,
          title: pr.title,
          author: pr.author,
          headRef: pr.headRefName,
          baseRef: pr.baseRefName,
          state: prState(pr),
          updatedAt: pr.updatedAt,
        })),
      );
    } catch {
      setPrs([]);
    }
  }, [workspace.id, project?.id]);

  // Fetch from the remote so what's shown reflects the server (real incoming
  // commits, remote branches, accurate ahead/behind) — not a stale local view.
  // Best-effort: a repo with no remote, offline, or missing auth just keeps the
  // local view rather than surfacing a hard error.
  const fetchRemote = useCallback(async () => {
    if (!projectId || !hasRepo) return;
    setFetching(true);
    try {
      await window.space.git.fetch({ projectId });
      setLastFetchedAt(Date.now());
      await Promise.all([refreshStatus(), loadHistory(HISTORY_PAGE_SIZE), refreshGroups(), refreshActivity()]);
    } catch {
      // No remote / offline / auth — the local view stays as-is.
    } finally {
      setFetching(false);
    }
  }, [projectId, hasRepo, refreshStatus, loadHistory, refreshGroups, refreshActivity]);

  // Reset + load everything when the project changes.
  useEffect(() => {
    setGroups([]);
    setStats([]);
    setSelectedGroupId(null);
    setSelectedFilePath(null);
    setPreviewFile(null);
    setPreviewPatch(null);
    setConflictFile(null);
    setGroupsLoaded(false);
    setCommits([]);
    setLastFetchedAt(null);
    void refreshGroups();
    void refreshStatus();
    void loadHistory(HISTORY_PAGE_SIZE);
    void refreshStashes();
    void refreshActivity();
    void refreshPrs();
  }, [refreshGroups, refreshStatus, loadHistory, refreshStashes, refreshActivity, refreshPrs]);

  // Auto-fetch the remote once per project so incoming/outgoing and the graph
  // reflect origin on open — the whole point of this screen is server state.
  useEffect(() => {
    void fetchRemote();
  }, [fetchRemote]);

  // --- Derived data ------------------------------------------------------

  const conflictedFiles = useMemo(() => gitStatus?.conflictedFiles ?? [], [gitStatus]);
  const conflictSet = useMemo(() => new Set(conflictedFiles), [conflictedFiles]);

  // One row per unique path, counts summed across both index sides.
  const fileEntries = useMemo<FileEntry[]>(() => {
    const map = new Map<string, { added: number; removed: number; hasStaged: boolean; hasUnstaged: boolean }>();
    for (const stat of stats) {
      const current = map.get(stat.path) ?? { added: 0, removed: 0, hasStaged: false, hasUnstaged: false };
      map.set(stat.path, {
        added: current.added + (stat.added ?? 0),
        removed: current.removed + (stat.removed ?? 0),
        hasStaged: current.hasStaged || stat.staged,
        hasUnstaged: current.hasUnstaged || !stat.staged,
      });
    }
    return [...map.entries()].map(([path, value]) => ({ path, ...value }));
  }, [stats]);

  const fileMap = useMemo(() => new Map(fileEntries.map((entry) => [entry.path, entry])), [fileEntries]);

  const totalAdded = useMemo(() => fileEntries.reduce((sum, entry) => sum + entry.added, 0), [fileEntries]);
  const totalRemoved = useMemo(() => fileEntries.reduce((sum, entry) => sum + entry.removed, 0), [fileEntries]);

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const selectedGroupFiles = useMemo(() => (selectedGroup ? uniqueFiles(selectedGroup.evidence) : []), [selectedGroup]);

  function groupTotals(group: ChangeIntentLike): { added: number; removed: number; fileCount: number; anyStaged: boolean } {
    const files = uniqueFiles(group.evidence);
    let added = 0;
    let removed = 0;
    for (const file of files) {
      const stat = statFor(stats, file);
      added += stat?.added ?? 0;
      removed += stat?.removed ?? 0;
    }
    return { added, removed, fileCount: files.length, anyStaged: group.evidence.some((item) => item.staged === 'staged') };
  }

  // Groups list, filtered + mapped to the presentational item shape.
  const visibleGroups = useMemo<ChangeGroupItem[]>(() => {
    return groups
      .filter((group) => {
        if (filter === 'all') return true;
        if (filter === 'staged') return group.evidence.some((item) => item.staged === 'staged');
        if (filter === 'unstaged') return group.evidence.some((item) => item.staged !== 'staged');
        return group.evidence.some((item) => conflictSet.has(item.filePath));
      })
      .map((group) => {
        const totals = groupTotals(group);
        return {
          id: group.id,
          title: group.title,
          explanation: group.explanation,
          generatedBy: group.generatedBy,
          confidence: group.confidence,
          added: totals.added,
          removed: totals.removed,
          fileCount: totals.fileCount,
          anyStaged: totals.anyStaged,
        };
      });
    // groupTotals is stable given `stats`; listing it would need useCallback churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, filter, conflictSet, stats]);

  // File rows, filtered + ordered by the Group-by selector.
  const visibleFileRows = useMemo<FileDiffRow[]>(() => {
    if (filter === 'conflicts') {
      return conflictedFiles.map((path) => {
        const entry = fileMap.get(path);
        return { path, added: entry?.added ?? 0, removed: entry?.removed ?? 0, staged: entry?.hasStaged ?? false };
      });
    }
    let entries = fileEntries;
    if (filter === 'staged') entries = entries.filter((entry) => entry.hasStaged);
    else if (filter === 'unstaged') entries = entries.filter((entry) => entry.hasUnstaged);
    const ordered = [...entries].sort((a, b) =>
      groupBy === 'status' ? Number(b.hasStaged) - Number(a.hasStaged) || a.path.localeCompare(b.path) : a.path.localeCompare(b.path),
    );
    return ordered.map((entry) => ({ path: entry.path, added: entry.added, removed: entry.removed, staged: entry.hasStaged }));
  }, [filter, conflictedFiles, fileMap, fileEntries, groupBy]);

  const counts = useMemo<Record<ChangesFilter, number>>(() => {
    if (tab === 'groups') {
      return {
        all: groups.length,
        staged: groups.filter((group) => group.evidence.some((item) => item.staged === 'staged')).length,
        unstaged: groups.filter((group) => group.evidence.some((item) => item.staged !== 'staged')).length,
        conflicts: groups.filter((group) => group.evidence.some((item) => conflictSet.has(item.filePath))).length,
      };
    }
    return {
      all: fileEntries.length,
      staged: fileEntries.filter((entry) => entry.hasStaged).length,
      unstaged: fileEntries.filter((entry) => entry.hasUnstaged).length,
      conflicts: conflictedFiles.length,
    };
  }, [tab, groups, conflictSet, fileEntries, conflictedFiles]);

  // Selecting a group auto-previews its first file.
  useEffect(() => {
    setPreviewFile(selectedGroupFiles[0] ?? null);
  }, [selectedGroupFiles]);

  // File Explorer: always keep the top file selected so the diff below is
  // populated without a click — never leave the pane blank asking to pick one.
  useEffect(() => {
    setSelectedFilePath((current) =>
      current && visibleFileRows.some((row) => row.path === current) ? current : visibleFileRows[0]?.path ?? null,
    );
  }, [visibleFileRows]);

  // The file/hunk whose diff the detail pane shows, unified across both tabs.
  const activePreview = useMemo<GroupFileRef | null>(() => {
    if (tab === 'files') {
      if (!selectedFilePath) return null;
      const info = fileMap.get(selectedFilePath);
      if (!info) return null;
      return { filePath: selectedFilePath, staged: info.hasUnstaged ? false : true };
    }
    return previewFile;
  }, [tab, selectedFilePath, fileMap, previewFile]);

  useEffect(() => {
    setPreviewPatch(null);
    if (!projectId || !activePreview) return;
    let cancelled = false;
    void window.space.git
      .diffFile({ projectId, path: activePreview.filePath, staged: activePreview.staged })
      .then((result) => {
        if (!cancelled) setPreviewPatch(result.patchText);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, activePreview]);

  // Conflict resolver: auto-select the first conflicted file, load its diff.
  useEffect(() => {
    setConflictFile((current) => (current && conflictedFiles.includes(current) ? current : conflictedFiles[0] ?? null));
  }, [conflictedFiles]);

  useEffect(() => {
    setConflictPatch(null);
    if (!projectId || !conflictFile) return;
    let cancelled = false;
    void window.space.git
      .diffFile({ projectId, path: conflictFile, staged: false })
      .then((result) => {
        if (!cancelled) setConflictPatch(result.patchText);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, conflictFile]);

  // --- Actions -----------------------------------------------------------

  function toggleIncluded(groupId: string): void {
    setIncludedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  const includedGroups = groups.filter((group) => includedGroupIds.has(group.id));
  const includedTotals = includedGroups.reduce(
    (acc, group) => {
      const totals = groupTotals(group);
      return { added: acc.added + totals.added, removed: acc.removed + totals.removed, files: acc.files + totals.fileCount };
    },
    { added: 0, removed: 0, files: 0 },
  );

  function handleCommit(): void {
    if (!projectId || !message.trim()) return;
    const includedEvidence = includedGroups.flatMap((group) => group.evidence);
    setBusy(true);
    void (async () => {
      try {
        await window.space.agent.commitCompose({ projectId, evidence: includedEvidence, message: message.trim() });
        setMessage('');
        await Promise.all([refreshGroups(), refreshStatus(), loadHistory(commits.length || HISTORY_PAGE_SIZE), refreshActivity()]);
      } catch (caught) {
        toast({ variant: 'error', message: toErrorMessage(caught) });
      } finally {
        setBusy(false);
      }
    })();
  }

  function handleGenerateMessage(): void {
    if (!projectId || generatingMessage || includedGroups.length === 0) return;
    const filePaths = Array.from(new Set(includedGroups.flatMap((group) => group.evidence.map((item) => item.filePath))));
    setGeneratingMessage(true);
    void (async () => {
      try {
        const result = await window.space.ai.generateCommitMessage({ projectId, filePaths });
        setMessage(result.message);
      } catch (caught) {
        toast({ variant: 'error', message: toErrorMessage(caught) });
      } finally {
        setGeneratingMessage(false);
      }
    })();
  }

  function runConflictAction(action: () => Promise<unknown>): void {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        await action();
        await Promise.all([refreshStatus(), refreshGroups()]);
      } catch (caught) {
        toast({ variant: 'error', message: toErrorMessage(caught) });
      } finally {
        setBusy(false);
      }
    })();
  }

  function handleUseSide(side: 'ours' | 'theirs'): void {
    if (!projectId || !conflictFile) return;
    runConflictAction(() => window.space.git.resolveConflict({ projectId, path: conflictFile, side }));
  }

  function handleStageResolved(): void {
    if (!projectId || !conflictFile) return;
    runConflictAction(() => window.space.git.stage({ projectId, paths: [conflictFile] }));
  }

  function handleContinueConflict(): void {
    if (!projectId) return;
    runConflictAction(() => window.space.git.continueConflict({ projectId }));
  }

  function handleAbortConflict(): void {
    if (!projectId) return;
    runConflictAction(() => window.space.git.abortConflict({ projectId }));
  }

  function handleApplyStash(index: number): void {
    if (!projectId || busy) return;
    setBusy(true);
    void (async () => {
      try {
        await window.space.git.applyStash({ projectId, index });
        await Promise.all([refreshStatus(), refreshStashes(), refreshGroups()]);
      } catch (caught) {
        toast({ variant: 'error', message: toErrorMessage(caught) });
      } finally {
        setBusy(false);
      }
    })();
  }

  function confirmDropStash(): void {
    if (!projectId || dropTarget === null) return;
    const index = dropTarget;
    setDropTarget(null);
    setBusy(true);
    void (async () => {
      try {
        await window.space.git.dropStash({ projectId, index, confirmed: true });
        await refreshStashes();
      } catch (caught) {
        toast({ variant: 'error', message: toErrorMessage(caught) });
      } finally {
        setBusy(false);
      }
    })();
  }

  // --- Guards ------------------------------------------------------------

  if (!project) {
    return (
      <div className="p-6">
        <EmptyState title="No project selected" description="Pick a project in the sidebar to review and stage its changes." />
      </div>
    );
  }
  if (!project.repositoryRoot) {
    return (
      <div className="p-6">
        <EmptyState title="Not a Git repository" description={`"${project.name}" has no repository — changes tracking needs one.`} />
      </div>
    );
  }

  const hasConflicts = conflictedFiles.length > 0;
  const changedCount = gitStatus ? gitStatus.entries.filter((entry) => entry.kind !== 'ignored').length : 0;
  const untrackedCount = gitStatus ? gitStatus.entries.filter((entry) => entry.kind === 'untracked').length : 0;
  const behind = gitStatus?.branch.behind ?? 0;
  const ahead = gitStatus?.branch.ahead ?? 0;
  const branchName = gitStatus?.branch.detached ? '(detached)' : gitStatus?.branch.branchName ?? 'HEAD';
  const upstream = gitStatus?.branch.upstream ?? null;
  const upstreamLabel = upstream ? ` (${upstream})` : '';
  const fileCount = fileEntries.length;

  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

  const tiles: readonly ChangeStatTile[] = [
    {
      label: 'Total Changes',
      value: changedCount,
      icon: <GitCompareArrows size={13} />,
      sub: (
        <>
          <span className="text-success">+{totalAdded}</span> <span className="text-danger">−{totalRemoved}</span>
          <span className="text-fg-faint"> · {plural(fileCount, 'file')}</span>
        </>
      ),
    },
    { label: `Incoming${upstreamLabel}`, value: `+${behind}`, tone: behind > 0 ? 'accent' : 'default', icon: <ArrowDownToLine size={13} />, sub: plural(behind, 'commit') },
    { label: `Outgoing${upstreamLabel}`, value: `+${ahead}`, tone: ahead > 0 ? 'success' : 'default', icon: <ArrowUpFromLine size={13} />, sub: plural(ahead, 'commit') },
    { label: 'Conflicts', value: conflictedFiles.length, tone: hasConflicts ? 'danger' : 'default', icon: <AlertTriangle size={13} />, sub: plural(conflictedFiles.length, 'file') },
    { label: 'Untracked', value: untrackedCount, tone: untrackedCount > 0 ? 'accent' : 'default', icon: <FileQuestion size={13} />, sub: plural(untrackedCount, 'file') },
  ];

  // Only this project's real git events — no terminal/workspace/platform noise.
  const activityEvents = [...activity]
    .filter((event) => event.projectId === project.id && GIT_ACTIVITY_TYPES.has(event.eventType))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, ACTIVITY_FEED_LIMIT)
    .map(toFeedEvent);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-6 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-fg">GitHub</h1>
            <p className="text-sm text-fg-muted">
              All changes in {project.name} · on {branchName} ·{' '}
              {fetching ? (
                <span className="text-fg-faint">fetching from origin…</span>
              ) : lastFetchedAt ? (
                <span className="text-fg-faint">
                  last fetched {formatRelativeTime(new Date(lastFetchedAt).toISOString()).relative}
                </span>
              ) : (
                <span className="text-fg-faint">local only — not yet fetched</span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={() => void Promise.all([refreshGroups(), refreshStatus()])} disabled={busy}>
              <RefreshCw size={13} className={busy ? 'animate-spin' : undefined} /> Scan
            </Button>
            <Button size="sm" variant="primary" onClick={() => void fetchRemote()} disabled={fetching}>
              <ArrowDownToLine size={13} className={fetching ? 'animate-pulse' : undefined} /> Fetch
            </Button>
          </div>
        </div>

        <ChangeStatTiles tiles={tiles} />

        <ChangesToolbarTabs
          tab={tab}
          onTabChange={setTab}
          filter={filter}
          onFilterChange={setFilter}
          counts={counts}
          groupBy={groupBy}
          groupByOptions={GROUP_BY_OPTIONS}
          onGroupByChange={setGroupBy}
        />

        {/* Three columns: change list · commit graph · conflict resolver / diff. */}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)]">
          {/* Column 1 — the change list, headed by the current repo's summary. */}
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center justify-between gap-2 px-1 text-[11px]">
              <span className="truncate font-semibold uppercase tracking-wide text-fg-muted">
                {project.name} <span className="font-normal text-fg-faint">(current)</span>
              </span>
              <span className="shrink-0">
                <span className="text-success">+{totalAdded}</span> <span className="text-danger">−{totalRemoved}</span>{' '}
                <span className="text-fg-faint">{plural(fileCount, 'file')}</span>
              </span>
            </div>

            {tab === 'groups' ? (
              groupsLoaded && visibleGroups.length === 0 ? (
                <EmptyState
                  title={groups.length === 0 ? 'Working tree clean' : 'No groups match this filter'}
                  description={groups.length === 0 ? 'No changes to group — edit some files and scan again.' : 'Try a different filter.'}
                />
              ) : (
                <div className="max-h-[32rem] overflow-y-auto pr-0.5">
                  <ChangeGroupList
                    groups={visibleGroups}
                    selectedGroupId={selectedGroupId}
                    includedGroupIds={includedGroupIds}
                    onSelectGroup={setSelectedGroupId}
                    onToggleIncluded={toggleIncluded}
                  />
                </div>
              )
            ) : visibleFileRows.length === 0 ? (
              <EmptyState title="No files" description="No changed files match this filter." />
            ) : (
              <Card>
                <CardContent className="py-2">
                  <div className="max-h-[32rem] overflow-y-auto">
                    <FileExplorerList files={visibleFileRows} selectedPath={selectedFilePath} onSelect={setSelectedFilePath} />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Column 2 — conflict resolver while mid-conflict, else the selected item's diff. This
              is the pane that changes with the selection, so it sits next to the change list;
              the commit graph (column 3) stays fixed regardless of what's selected. */}
          <div className="min-w-0">
            {hasConflicts ? (
              <ConflictResolverPanel
                conflictedFiles={conflictedFiles}
                selectedFile={conflictFile}
                onSelectFile={setConflictFile}
                patchText={conflictPatch}
                onUseOurs={() => handleUseSide('ours')}
                onUseTheirs={() => handleUseSide('theirs')}
                onStageResolved={handleStageResolved}
                onContinue={handleContinueConflict}
                onAbort={handleAbortConflict}
                busy={busy}
              />
            ) : tab === 'groups' && selectedGroup ? (
              <Card className="flex h-full flex-col">
                <CardHeader>
                  <CardTitle className="truncate">{selectedGroup.title}</CardTitle>
                  <Badge variant={includedGroupIds.has(selectedGroup.id) ? 'success' : 'neutral'}>
                    {includedGroupIds.has(selectedGroup.id) ? 'Included' : 'Excluded'}
                  </Badge>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3 pt-3">
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
                      Changed files ({selectedGroupFiles.length})
                    </p>
                    <ul className="flex max-h-44 flex-col gap-0.5 overflow-y-auto">
                      {selectedGroupFiles.map((file) => {
                        const stat = statFor(stats, file);
                        const isPreviewed = previewFile?.filePath === file.filePath && previewFile.staged === file.staged;
                        return (
                          <li key={`${file.staged}:${file.filePath}`}>
                            <button
                              type="button"
                              onClick={() => setPreviewFile(file)}
                              className={cn(
                                'flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-surface-hover',
                                isPreviewed && 'bg-surface-hover',
                              )}
                            >
                              <span className="flex min-w-0 items-center gap-1.5 text-fg">
                                <FileDiff size={12} className="shrink-0 text-fg-muted" />
                                <span className="truncate">{file.filePath}</span>
                              </span>
                              <span className="shrink-0 text-xs">
                                <span className="text-success">+{stat?.added ?? 0}</span>{' '}
                                <span className="text-danger">−{stat?.removed ?? 0}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
                      Diff{activePreview ? ` — ${activePreview.filePath.split('/').pop()}` : ''}
                    </p>
                    {previewPatch === null ? (
                      <p className="text-xs text-fg-faint">Loading diff&hellip;</p>
                    ) : previewPatch.trim() === '' ? (
                      <p className="text-xs text-fg-faint">No textual diff on this side of the index.</p>
                    ) : (
                      <DiffPreview patchText={previewPatch} />
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : tab === 'files' && activePreview ? (
              <Card className="flex h-full flex-col">
                <CardHeader>
                  <CardTitle className="truncate">{activePreview.filePath.split('/').pop()}</CardTitle>
                </CardHeader>
                <CardContent className="pt-3">
                  {previewPatch === null ? (
                    <p className="text-xs text-fg-faint">Loading diff&hellip;</p>
                  ) : previewPatch.trim() === '' ? (
                    <p className="text-xs text-fg-faint">No textual diff on this side of the index.</p>
                  ) : (
                    <DiffPreview patchText={previewPatch} />
                  )}
                </CardContent>
              </Card>
            ) : (
              <EmptyState title="No selection" description="Pick a change on the left to see its diff." />
            )}
          </div>

          {/* Column 3 — the commit graph (the merged-in History), with its own header. Doesn't
              change with the selection, so it's pinned on the far right. */}
          <Card className="flex min-w-0 flex-col">
            <CardHeader>
              <CardTitle className="truncate">
                {project.name} <span className="font-normal text-fg-faint">({branchName})</span>
                <span className="ml-2 text-xs font-normal text-fg-faint">{plural(commits.length, 'commit')}</span>
              </CardTitle>
              <div className="flex shrink-0 items-center gap-1.5">
                {upstream && behind > 0 && <Badge>{behind} behind</Badge>}
                {upstream && ahead > 0 && <Badge variant="accent">{ahead} ahead</Badge>}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void loadHistory(commits.length || HISTORY_PAGE_SIZE)}
                  disabled={historyBusy}
                  aria-label="Refresh history"
                >
                  <RefreshCw size={13} className={historyBusy ? 'animate-spin' : undefined} />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3 pt-3">
              <div className="max-h-[32rem] overflow-y-auto">
                <CommitGraph commits={commits} />
              </div>
              {!fullyLoaded && commits.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => void loadHistory(commits.length + HISTORY_PAGE_SIZE)} disabled={historyBusy}>
                  Load more
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Bottom row — recent activity, stashes, and open pull requests. */}
        <div className="grid gap-4 lg:grid-cols-3">
          <RecentActivityCard events={activityEvents} />
          <StashesCard stashes={stashes} onApply={handleApplyStash} onDrop={setDropTarget} busy={busy} />
          <ActivePullRequestsCard prs={prs} />
        </div>
      </div>

      {/* Commit footer */}
      <div className="flex shrink-0 items-center gap-3 border-t border-border bg-sidebar px-6 py-3">
        <span className="text-sm text-fg-muted">
          {includedGroups.length} group{includedGroups.length === 1 ? '' : 's'} selected
        </span>
        <span className="text-xs">
          <span className="text-success">+{includedTotals.added}</span> <span className="text-danger">−{includedTotals.removed}</span>{' '}
          <span className="text-fg-faint">{includedTotals.files} files</span>
        </span>
        <Input
          placeholder="Commit message"
          aria-label="Commit message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && handleCommit()}
          disabled={busy}
          className="max-w-md flex-1"
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={handleGenerateMessage}
          disabled={generatingMessage || includedGroups.length === 0}
          aria-label="Generate commit message"
          title="Generate commit message"
        >
          <RefreshCw size={13} className={generatingMessage ? 'animate-spin' : undefined} />
        </Button>
        <Button variant="primary" onClick={handleCommit} disabled={busy || !message.trim() || includedGroups.length === 0}>
          Commit
        </Button>
      </div>

      <Dialog
        open={dropTarget !== null}
        onOpenChange={(open) => !open && setDropTarget(null)}
        title="Drop stash?"
        {...(dropTarget !== null
          ? { description: `stash@{${dropTarget}} will be permanently deleted. This cannot be undone.` }
          : {})}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDropTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDropStash}>
              Drop stash
            </Button>
          </>
        }
      >
        <p className="text-xs text-fg-muted">Applying a stash first (Apply) keeps it in the list. Dropping removes it for good.</p>
      </Dialog>
    </div>
  );
}
