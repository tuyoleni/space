/**
 * About Dialog: shows app version, system info, and credits.
 * Opens from the sidebar or Command Palette.
 */
import { useState, useEffect } from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';
import { Button, Dialog } from '@space/ui';

interface AboutDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

interface SystemInfo {
  readonly electronVersion: string;
  readonly chromeVersion: string;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly appVersion: string;
}

async function getSystemInfo(): Promise<SystemInfo> {
  try {
    // In Electron renderer, process.versions is available directly
    return {
      electronVersion: process.versions.electron ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown',
      nodeVersion: process.versions.node ?? 'unknown',
      platform: process.platform,
      arch: process.arch,
      appVersion: 'dev',
    };
  } catch {
    return {
      electronVersion: 'unknown',
      chromeVersion: 'unknown',
      nodeVersion: 'unknown',
      platform: 'unknown',
      arch: 'unknown',
      appVersion: 'dev',
    };
  }
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const [sysInfo, setSysInfo] = useState<SystemInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && !sysInfo) {
      getSystemInfo().then(setSysInfo);
    }
  }, [open, sysInfo]);

  const handleCopyInfo = () => {
    if (!sysInfo) return;
    const text = [
      `Space v${sysInfo.appVersion}`,
      `Electron ${sysInfo.electronVersion}`,
      `Chrome ${sysInfo.chromeVersion}`,
      `Node ${sysInfo.nodeVersion}`,
      `${sysInfo.platform} ${sysInfo.arch}`,
    ].join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="About Space"
      size="md"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleCopyInfo}>
            {copied ? <Check size={12} className="mr-1" /> : <Copy size={12} className="mr-1" />}
            {copied ? 'Copied!' : 'Copy Info'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open('https://github.com/tuyoleni/space/releases', '_blank')}
          >
            <ExternalLink size={12} className="mr-1" />
            Releases
          </Button>
        </div>
      }
    >
      <div className="flex flex-col items-center py-4">
        {/* App icon */}
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-purple-500 shadow-lg">
          <span className="text-2xl font-bold text-white">S</span>
        </div>

        {/* Version */}
        <h2 className="text-lg font-bold text-fg">Space</h2>
        <p className="text-xs text-fg-muted">
          Version {sysInfo?.appVersion ?? 'dev'}
        </p>
        <p className="mt-1 text-[11px] text-fg-faint">
          Your AI-powered workspace for building software
        </p>

        {/* System info */}
        {sysInfo && (
          <div className="mt-6 w-full space-y-1.5 rounded-lg bg-surface p-3">
            {[
              ['Electron', sysInfo.electronVersion],
              ['Chrome', sysInfo.chromeVersion],
              ['Node.js', sysInfo.nodeVersion],
              ['Platform', `${sysInfo.platform} ${sysInfo.arch}`],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between text-[11px]">
                <span className="text-fg-faint">{label}</span>
                <span className="font-mono text-fg-muted">{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
