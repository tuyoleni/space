import { HighImpactGithubActionNotConfirmedError } from '@space/domain';
import { describe, expect, it } from 'vitest';
import {
  applySemverBump,
  compareSinceTag,
  createDraftRelease,
  generateReleaseNotes,
  parseSemverTag,
  publishRelease,
  publishReleaseArgs,
  releaseCreateDraftArgs,
  releaseUploadArgs,
  suggestNextVersionTag,
  suggestSemverBump,
  uploadReleaseArtifacts,
} from './releases';
import type { GhExecutor } from './executor';

describe('compareSinceTag', () => {
  it('parses commits and files from the compare API', async () => {
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(['api', 'repos/acme/widgets/compare/v1.0.0...main']);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          ahead_by: 2,
          total_commits: 2,
          commits: [{ commit: { message: 'feat: add filtering\n\nlonger body' } }, { commit: { message: 'fix: typo' } }],
          files: [{ filename: 'src/filter.ts' }],
        }),
        stderr: '',
      };
    };
    const summary = await compareSinceTag(executor, 'acme/widgets', 'v1.0.0', 'main');
    expect(summary).toEqual({ aheadBy: 2, totalCommits: 2, commitSubjects: ['feat: add filtering', 'fix: typo'], changedFiles: ['src/filter.ts'] });
  });
});

describe('suggestSemverBump', () => {
  it('suggests major for a breaking change', () => {
    expect(suggestSemverBump(['feat!: remove old API'])).toBe('major');
    expect(suggestSemverBump(['chore: x', 'BREAKING CHANGE: drop node 16'])).toBe('major');
  });

  it('suggests minor for a feature with no breaking change', () => {
    expect(suggestSemverBump(['feat: add filtering', 'fix: typo'])).toBe('minor');
  });

  it('suggests patch for fixes only, and as the default fallback', () => {
    expect(suggestSemverBump(['fix: typo'])).toBe('patch');
    expect(suggestSemverBump(['chore: bump deps'])).toBe('patch');
  });
});

describe('parseSemverTag / applySemverBump / suggestNextVersionTag', () => {
  it('parses a v-prefixed and bare semver tag', () => {
    expect(parseSemverTag('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemverTag('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemverTag('not-a-version')).toBeNull();
  });

  it('applies each bump kind resetting lower components', () => {
    const base = { major: 1, minor: 2, patch: 3 };
    expect(applySemverBump(base, 'patch')).toEqual({ major: 1, minor: 2, patch: 4 });
    expect(applySemverBump(base, 'minor')).toEqual({ major: 1, minor: 3, patch: 0 });
    expect(applySemverBump(base, 'major')).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it('suggests the next tag preserving the v-prefix convention', () => {
    expect(suggestNextVersionTag('v1.2.3', ['feat: add filtering'])).toBe('v1.3.0');
    expect(suggestNextVersionTag('1.2.3', ['fix: typo'])).toBe('1.2.4');
  });

  it('returns null (never guesses) when the previous tag is not a recognisable semver', () => {
    expect(suggestNextVersionTag('release-2026-07', ['feat: x'])).toBeNull();
  });
});

describe('generateReleaseNotes', () => {
  it('returns the generated notes body, unmodified and editable', async () => {
    const executor: GhExecutor = async (args) => {
      expect(args.join(' ')).toContain('releases/generate-notes');
      return { exitCode: 0, stdout: '## What changed\n- Added filtering\n', stderr: '' };
    };
    expect(await generateReleaseNotes(executor, 'acme/widgets', 'v1.3.0')).toBe('## What changed\n- Added filtering');
  });
});

describe('releaseCreateDraftArgs / createDraftRelease', () => {
  it('always includes --draft', () => {
    expect(releaseCreateDraftArgs({ tagName: 'v1.3.0', title: 'v1.3.0', notes: 'Notes' })).toEqual([
      'release',
      'create',
      'v1.3.0',
      '--title',
      'v1.3.0',
      '--notes',
      'Notes',
      '--draft',
    ]);
  });

  it('creates a draft for real and never publishes it', async () => {
    const executor: GhExecutor = async (args) => {
      expect(args).toContain('--draft');
      return { exitCode: 0, stdout: 'https://github.com/acme/widgets/releases/tag/v1.3.0\n', stderr: '' };
    };
    const result = await createDraftRelease(executor, { tagName: 'v1.3.0', title: 'v1.3.0', notes: 'Notes' });
    expect(result.url).toBe('https://github.com/acme/widgets/releases/tag/v1.3.0');
  });
});

describe('publishRelease', () => {
  it('refuses to publish without confirmation and never calls gh', async () => {
    let called = false;
    const executor: GhExecutor = async () => {
      called = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(publishRelease(executor, { tagName: 'v1.3.0', confirmed: false })).rejects.toThrow(HighImpactGithubActionNotConfirmedError);
    expect(called).toBe(false);
  });

  it('publishes for real once confirmed, flipping draft to false', async () => {
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(publishReleaseArgs('v1.3.0'));
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(publishRelease(executor, { tagName: 'v1.3.0', confirmed: true })).resolves.toBeUndefined();
  });
});

describe('uploadReleaseArtifacts', () => {
  it('does nothing for an empty file list', async () => {
    let called = false;
    const executor: GhExecutor = async () => {
      called = true;
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await uploadReleaseArtifacts(executor, 'v1.3.0', []);
    expect(called).toBe(false);
  });

  it('uploads selected artifacts, optionally with --clobber', async () => {
    expect(releaseUploadArgs('v1.3.0', ['/tmp/out.zip'], true)).toEqual(['release', 'upload', 'v1.3.0', '/tmp/out.zip', '--clobber']);
    const executor: GhExecutor = async (args) => {
      expect(args).toEqual(['release', 'upload', 'v1.3.0', '/tmp/out.zip']);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await uploadReleaseArtifacts(executor, 'v1.3.0', ['/tmp/out.zip']);
  });
});
