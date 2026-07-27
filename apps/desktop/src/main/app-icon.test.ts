import { describe, expect, it, vi } from 'vitest';
import { createAppIconResolver, icnsCandidateNames, type AppIconPorts } from './app-icon';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;

const INFO_PLIST_JSON = JSON.stringify({ CFBundleIconFile: 'AppIcon', CFBundleName: 'Arc' });

function setup(overrides: Partial<AppIconPorts> = {}) {
  const existing = new Set([
    '/Applications/Arc.app/Contents/Info.plist',
    '/Applications/Arc.app/Contents/Resources/AppIcon.icns',
  ]);
  const ports: AppIconPorts = {
    platform: 'darwin',
    runCommand: vi.fn(async (command: string) => {
      if (command === 'plutil') return { exitCode: 0, stdout: INFO_PLIST_JSON };
      if (command === 'sips') return { exitCode: 0, stdout: '' };
      throw new Error(`Unexpected command: ${command}`);
    }),
    readFile: vi.fn(async () => PNG),
    fileExists: vi.fn(async (filePath: string) => existing.has(filePath)),
    removeFile: vi.fn(async () => undefined),
    temporaryDirectory: () => '/tmp',
    systemIconDataUrl: vi.fn(async () => 'data:image/png;base64,GENERIC'),
    ...overrides,
  };
  return { ports, resolver: createAppIconResolver(ports) };
}

describe('icnsCandidateNames', () => {
  it('accepts CFBundleIconFile with or without the .icns extension', () => {
    expect(icnsCandidateNames({ CFBundleIconFile: 'electron.icns' })[0]).toBe('electron.icns');
    expect(icnsCandidateNames({ CFBundleIconFile: 'dropover-icon' })[0]).toBe('dropover-icon.icns');
  });

  it('falls back to the Xcode default for a bundle that declares no icon', () => {
    expect(icnsCandidateNames({})).toEqual(['AppIcon.icns']);
  });

  it('ignores non-string and empty declarations', () => {
    expect(icnsCandidateNames({ CFBundleIconFile: '', CFBundleIconName: 42 })).toEqual(['AppIcon.icns']);
  });
});

describe('createAppIconResolver', () => {
  it('reads the bundle\'s own icon rather than the generic Launch Services placeholder', async () => {
    const { ports, resolver } = setup();

    await expect(resolver.iconFor('/Applications/Arc.app')).resolves.toBe(PNG_DATA_URL);
    expect(ports.systemIconDataUrl).not.toHaveBeenCalled();
    expect(ports.runCommand).toHaveBeenCalledWith(
      'sips',
      expect.arrayContaining(['/Applications/Arc.app/Contents/Resources/AppIcon.icns']),
      expect.anything(),
    );
  });

  it('deletes the converted PNG it wrote, including when the conversion fails', async () => {
    const { ports, resolver } = setup({
      runCommand: vi.fn(async (command: string) =>
        command === 'plutil' ? { exitCode: 0, stdout: INFO_PLIST_JSON } : { exitCode: 1, stdout: '' },
      ),
    });

    await resolver.iconFor('/Applications/Arc.app');

    expect(ports.removeFile).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ports.removeFile).mock.calls[0]?.[0]).toMatch(/^\/tmp\/space-app-icon-.*\.png$/);
  });

  it('falls back to Launch Services for a bundle that ships no .icns (asset-catalog icon)', async () => {
    const { ports, resolver } = setup({ fileExists: vi.fn(async (filePath: string) => filePath.endsWith('Info.plist')) });

    await expect(resolver.iconFor('/Applications/Arc.app')).resolves.toBe('data:image/png;base64,GENERIC');
    expect(ports.systemIconDataUrl).toHaveBeenCalledWith('/Applications/Arc.app');
  });

  it('uses Launch Services directly off macOS and for non-bundle targets', async () => {
    const windows = setup({ platform: 'win32' });
    await expect(windows.resolver.iconFor('C:\\Program Files\\Cursor\\Cursor.exe')).resolves.toBe('data:image/png;base64,GENERIC');
    expect(windows.ports.runCommand).not.toHaveBeenCalled();

    const mac = setup();
    await expect(mac.resolver.iconFor('/usr/local/bin/code')).resolves.toBe('data:image/png;base64,GENERIC');
    expect(mac.ports.runCommand).not.toHaveBeenCalled();
  });

  it('resolves each path once — the process list re-polls the same bundles every few seconds', async () => {
    const { ports, resolver } = setup();

    await resolver.iconFor('/Applications/Arc.app');
    await resolver.iconFor('/Applications/Arc.app');

    expect(vi.mocked(ports.runCommand).mock.calls.filter(([command]) => command === 'sips')).toHaveLength(1);
  });

  it('caches a miss too, so a bundle with no icon is not re-converted on every poll', async () => {
    const { ports, resolver } = setup({
      fileExists: vi.fn(async (filePath: string) => filePath.endsWith('Info.plist')),
      systemIconDataUrl: vi.fn(async () => null),
    });

    await expect(resolver.iconFor('/Applications/Arc.app')).resolves.toBeNull();
    await expect(resolver.iconFor('/Applications/Arc.app')).resolves.toBeNull();

    expect(ports.systemIconDataUrl).toHaveBeenCalledTimes(1);
  });
});
