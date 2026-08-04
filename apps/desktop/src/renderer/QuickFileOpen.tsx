/**
 * Quick File Open: Cmd+P overlay to fuzzy-search and open files in the
 * current project. Shows recent files, file icons, and path context.
 * Inspired by VS Code's quick file picker.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  FileText,
  Search,
  Clock,
  FileCode,
  FileImage,
  FileJson,
  Settings,
  Package,
} from 'lucide-react';
import { cn } from '@space/ui';

interface FileEntry {
  readonly path: string;
  readonly name: string;
  readonly relativePath: string;
  readonly isRecent?: boolean;
}

interface QuickFileOpenProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly files: readonly FileEntry[];
  readonly onOpenFile: (path: string) => void;
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return <FileCode size={13} className="text-blue-400" />;
    case 'json':
    case 'jsonc':
      return <FileJson size={13} className="text-yellow-400" />;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'svg':
    case 'ico':
      return <FileImage size={13} className="text-green-400" />;
    case 'css':
    case 'scss':
    case 'less':
      return <FileCode size={13} className="text-pink-400" />;
    case 'md':
    case 'mdx':
      return <FileText size={13} className="text-blue-300" />;
    case 'yaml':
    case 'yml':
    case 'toml':
      return <Settings size={13} className="text-gray-400" />;
    case 'lock':
      return <Package size={13} className="text-gray-500" />;
    default:
      return <FileText size={13} className="text-fg-faint" />;
  }
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (let i = 0; i < lower.length; i++) {
    if (lower[i] === queryLower[0] && lower.startsWith(queryLower, i)) {
      if (i > lastIndex) {
        parts.push(<span key={`pre-${i}`}>{text.slice(lastIndex, i)}</span>);
      }
      parts.push(
        <span key={`match-${i}`} className="bg-accent/20 text-accent font-medium">
          {text.slice(i, i + query.length)}
        </span>,
      );
      lastIndex = i + query.length;
      i += query.length - 1;
    }
  }
  if (lastIndex < text.length) {
    parts.push(<span key="rest">{text.slice(lastIndex)}</span>);
  }
  return parts.length > 0 ? parts : text;
}

export function QuickFileOpen({ open, onOpenChange, files, onOpenFile }: QuickFileOpenProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!query) return files.slice(0, 20);
    const q = query.toLowerCase();
    return files
      .map((file) => {
        const nameMatch = file.name.toLowerCase().includes(q) ? 2 : 0;
        const pathMatch = file.relativePath.toLowerCase().includes(q) ? 1 : 0;
        const score = nameMatch + pathMatch;
        return { file, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || (b.file.isRecent ? 1 : 0) - (a.file.isRecent ? 1 : 0))
      .slice(0, 30)
      .map(({ file }) => file);
  }, [files, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = results[selectedIndex];
        if (selected) {
          onOpenFile(selected.path);
          onOpenChange(false);
        }
      }
    },
    [results, selectedIndex, onOpenFile, onOpenChange],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={() => onOpenChange(false)} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search size={14} className="shrink-0 text-fg-faint" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type to search files..."
            className="flex-1 bg-transparent text-sm text-fg placeholder-fg-faint outline-none"
          />
          <span className="text-[10px] text-fg-faint">{results.length} results</span>
        </div>

        {/* Results */}
        <div className="max-h-72 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-fg-muted">No matching files</div>
          ) : (
            results.map((file, i) => (
              <div
                key={file.path}
                className={cn(
                  'flex cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors',
                  i === selectedIndex ? 'bg-accent/10 text-accent' : 'text-fg hover:bg-surface-hover',
                )}
                onClick={() => {
                  onOpenFile(file.path);
                  onOpenChange(false);
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                {getFileIcon(file.name)}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {highlightMatch(file.name, query)}
                  </p>
                  <p className="truncate text-[10px] text-fg-faint">
                    {highlightMatch(file.relativePath, query)}
                  </p>
                </div>
                {file.isRecent && (
                  <Clock size={10} className="shrink-0 text-fg-faint" />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
