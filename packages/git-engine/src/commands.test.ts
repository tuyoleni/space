import { describe, expect, it } from 'vitest';
import {
  addPathsArgs,
  applyPatchArgs,
  branchIsMergedArgs,
  checkoutPathsArgs,
  commitArgs,
  createBranchArgs,
  deleteBranchArgs,
  diffNumstatArgs,
  diffPatchArgs,
  diffRawArgs,
  fetchArgs,
  forEachRefArgs,
  gitDirArgs,
  initArgs,
  isInsideWorkTreeArgs,
  pullArgs,
  pushArgs,
  renameBranchArgs,
  repositoryRootArgs,
  resetPathsArgs,
  statusArgs,
  switchBranchArgs,
} from './commands';

describe('structured command builders (spec 11.3)', () => {
  it('builds repository root/state commands exactly as spec 11.3.1 requires', () => {
    expect(repositoryRootArgs()).toEqual(['rev-parse', '--show-toplevel']);
    expect(gitDirArgs()).toEqual(['rev-parse', '--git-dir']);
    expect(isInsideWorkTreeArgs()).toEqual(['rev-parse', '--is-inside-work-tree']);
    expect(statusArgs()).toEqual(['status', '--porcelain=v2', '-z', '--branch']);
  });

  it('builds for-each-ref with default patterns and a structured format', () => {
    const args = forEachRefArgs();
    expect(args[0]).toBe('for-each-ref');
    expect(args[1]).toMatch(/^--format=/);
    expect(args.slice(2)).toEqual(['refs/heads', 'refs/remotes', 'refs/tags']);
  });

  it('builds diff variants with --no-ext-diff always present', () => {
    expect(diffRawArgs()).toEqual(['diff', '--no-ext-diff', '--raw', '-z']);
    expect(diffRawArgs({ cached: true })).toEqual(['diff', '--no-ext-diff', '--cached', '--raw', '-z']);
    expect(diffNumstatArgs({ cached: true })).toEqual(['diff', '--no-ext-diff', '--cached', '--numstat', '-z']);
    expect(diffPatchArgs({ paths: ['a.txt'] })).toEqual(['diff', '--no-ext-diff', '--binary', '--', 'a.txt']);
  });

  it('builds init with the requested default branch', () => {
    expect(initArgs('main')).toEqual(['init', '--initial-branch=main']);
  });

  it('builds staging commands with -- path separation', () => {
    expect(addPathsArgs(['a.txt', 'b.txt'])).toEqual(['add', '--', 'a.txt', 'b.txt']);
    expect(resetPathsArgs(['a.txt'])).toEqual(['restore', '--staged', '--', 'a.txt']);
    expect(checkoutPathsArgs(['a.txt'])).toEqual(['checkout', '--', 'a.txt']);
  });

  it('builds patch application to always read from stdin, never a shell-escaped string', () => {
    expect(applyPatchArgs()).toEqual(['apply', '-']);
    expect(applyPatchArgs({ cached: true })).toEqual(['apply', '--cached', '-']);
    expect(applyPatchArgs({ reverse: true })).toEqual(['apply', '--reverse', '-']);
  });

  it('builds commit to always read the message from stdin, never -m', () => {
    expect(commitArgs()).toEqual(['commit', '-F', '-']);
    expect(commitArgs({ amend: true, noVerify: true })).toEqual(['commit', '--amend', '--no-verify', '-F', '-']);
  });

  it('builds branch operations with -- name separation', () => {
    expect(createBranchArgs('feature')).toEqual(['branch', '--', 'feature']);
    expect(createBranchArgs('feature', 'abc123')).toEqual(['branch', '--', 'feature', 'abc123']);
    expect(switchBranchArgs('feature')).toEqual(['switch', '--', 'feature']);
    expect(renameBranchArgs('old', 'new')).toEqual(['branch', '--move', '--', 'old', 'new']);
    expect(deleteBranchArgs('feature', false)).toEqual(['branch', '-d', '--', 'feature']);
    expect(deleteBranchArgs('feature', true)).toEqual(['branch', '-D', '--', 'feature']);
    expect(branchIsMergedArgs('feature', 'main')).toEqual(['branch', '--list', '--merged', 'main', '--', 'feature']);
  });

  it('builds fetch/pull with explicit merge-vs-rebase mode', () => {
    expect(fetchArgs()).toEqual(['fetch', '--prune', '--', 'origin']);
    expect(pullArgs('rebase')).toEqual(['pull', '--rebase', '--', 'origin']);
    expect(pullArgs('merge', 'origin', 'main')).toEqual(['pull', '--no-rebase', '--', 'origin', 'main']);
  });

  it('builds push with force-with-lease as the only default force mode', () => {
    expect(pushArgs({ branch: 'main' })).toEqual(['push', '--', 'origin', 'main']);
    expect(pushArgs({ branch: 'main', setUpstream: true })).toEqual(['push', '--set-upstream', '--', 'origin', 'main']);
    expect(pushArgs({ branch: 'main', force: 'with-lease' })).toEqual(['push', '--force-with-lease', '--', 'origin', 'main']);
    expect(pushArgs({ branch: 'main', force: 'raw' })).toEqual(['push', '--force', '--', 'origin', 'main']);
  });
});
