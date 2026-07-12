import { describe, expect, it } from 'vitest';
import { detectProject, detectedTypesFromReport, type ProjectDetectionFsPort } from './project-detection';

function fakeFs(entries: readonly string[], files: Record<string, string> = {}): ProjectDetectionFsPort {
  return {
    listDirectory: async () => entries,
    readTextFile: async (targetPath: string) => files[targetPath] ?? null,
  };
}

describe('detectProject', () => {
  it('detects git, node, a single lockfile, and a framework config with confidence scores', async () => {
    const fs = fakeFs(['.git', 'package.json', 'package-lock.json', 'next.config.js'], {
      '/proj/package.json': JSON.stringify({ dependencies: { next: '14.0.0' } }),
    });
    const report = await detectProject('/proj', fs);

    const byId = new Map(report.facts.map((fact) => [fact.id, fact]));
    expect(byId.get('git')?.confidence).toBe(1);
    expect(byId.get('node')?.confidence).toBeGreaterThan(0);
    expect(byId.get('lockfile:npm')?.confidence).toBe(1);
    expect(byId.get('framework:next')).toBeTruthy();
    // Found via both the config file and the dependency: at least one fact recorded.
    expect(report.facts.filter((f) => f.id === 'framework:next').length).toBeGreaterThanOrEqual(1);
  });

  it('detects a Volta pin from package.json content', async () => {
    const fs = fakeFs(['package.json'], {
      '/proj/package.json': JSON.stringify({ volta: { node: '20.10.0' } }),
    });
    const report = await detectProject('/proj', fs);
    expect(report.facts.some((f) => f.id === 'volta' && f.confidence === 1)).toBe(true);
  });

  it('reports env file names without ever reading their contents', async () => {
    let readCalls: string[] = [];
    const fs: ProjectDetectionFsPort = {
      listDirectory: async () => ['.env', '.env.local'],
      readTextFile: async (targetPath: string) => {
        readCalls.push(targetPath);
        return 'SECRET=should-never-be-read';
      },
    };
    const report = await detectProject('/proj', fs);
    expect(report.facts.some((f) => f.id === 'env-file:.env')).toBe(true);
    expect(report.facts.some((f) => f.id === 'env-file:.env.local')).toBe(true);
    // package.json isn't present, so readTextFile should never have been called.
    expect(readCalls).toEqual([]);
  });

  it('detects Python, Rust, Java, and .NET manifests independently of Node facts', async () => {
    const fs = fakeFs(['pyproject.toml', 'Cargo.toml', 'pom.xml', 'App.csproj']);
    const report = await detectProject('/proj', fs);
    const ids = report.facts.map((f) => f.id);
    expect(ids).toContain('python');
    expect(ids).toContain('rust');
    expect(ids).toContain('java');
    expect(ids).toContain('dotnet');
  });

  it('detects common generated directories', async () => {
    const fs = fakeFs(['node_modules', 'dist', '.next']);
    const report = await detectProject('/proj', fs);
    const ids = report.facts.map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining(['generated:node_modules', 'generated:dist', 'generated:.next']),
    );
  });

  it('produces no facts for an empty directory', async () => {
    const report = await detectProject('/proj', fakeFs([]));
    expect(report.facts).toEqual([]);
  });

  it('tolerates malformed package.json without throwing', async () => {
    const fs = fakeFs(['package.json'], { '/proj/package.json': '{not json' });
    const report = await detectProject('/proj', fs);
    expect(report.facts.some((f) => f.id === 'node')).toBe(true);
    expect(report.facts.some((f) => f.id === 'volta')).toBe(false);
  });
});

describe('detectedTypesFromReport', () => {
  it('collapses high-confidence runtime/language facts into a flat type list', async () => {
    const fs = fakeFs(['package.json', 'Cargo.toml'], { '/proj/package.json': '{}' });
    const report = await detectProject('/proj', fs);
    expect(detectedTypesFromReport(report).sort()).toEqual(['node', 'rust']);
  });

  it('excludes framework and env-file facts from the flat type list', async () => {
    const fs = fakeFs(['package.json', 'next.config.js', '.env'], {
      '/proj/package.json': '{}',
    });
    const report = await detectProject('/proj', fs);
    expect(detectedTypesFromReport(report)).toEqual(['node']);
  });
});
