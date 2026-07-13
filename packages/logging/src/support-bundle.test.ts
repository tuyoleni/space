import { describe, expect, it } from 'vitest';
import { exportSupportBundle, previewSupportBundle, type SupportBundleFs } from './support-bundle';

function fakeFs(files: Record<string, string>): SupportBundleFs & { written: Record<string, string> } {
  const written: Record<string, string> = {};
  return {
    written,
    readTextFile: async (name) => {
      const content = files[name];
      if (content === undefined) {
        throw new Error(`no such fixture file: ${name}`);
      }
      return content;
    },
    writeTextFile: async (destinationPath, content) => {
      written[destinationPath] = content;
    },
  };
}

describe('previewSupportBundle (spec 29.3: "must preview exactly what will be exported")', () => {
  it('sorts by name and totals bytes', () => {
    const preview = previewSupportBundle([
      { name: 'z.log', sizeBytes: 10 },
      { name: 'a.log', sizeBytes: 5 },
    ]);
    expect(preview.files.map((f) => f.name)).toEqual(['a.log', 'z.log']);
    expect(preview.totalBytes).toBe(15);
  });
});

describe('exportSupportBundle', () => {
  it('exports exactly the files the preview described, in the same order, with redaction applied', async () => {
    const fs = fakeFs({
      'a.log': 'normal line\ntoken: ghp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8\n',
      'b.log': 'another normal line\n',
    });
    const preview = previewSupportBundle([
      { name: 'b.log', sizeBytes: 20 },
      { name: 'a.log', sizeBytes: 60 },
    ]);

    const result = await exportSupportBundle(fs, preview, '/tmp/bundle.txt');

    expect(result).toEqual({ destinationPath: '/tmp/bundle.txt', fileCount: 2, totalBytes: 80 });
    const written = fs.written['/tmp/bundle.txt'] ?? '';
    expect(written).toContain('===== a.log =====');
    expect(written).toContain('===== b.log =====');
    expect(written).toContain('normal line');
    expect(written).not.toContain('ghp_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8');
    expect(written).toContain('[REDACTED]');
    // a.log's preview entry came before b.log's (alphabetical from
    // previewSupportBundle) even though the caller listed b.log first.
    expect(written.indexOf('a.log')).toBeLessThan(written.indexOf('b.log'));
  });
});
