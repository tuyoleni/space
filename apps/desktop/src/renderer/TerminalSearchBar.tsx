/**
 * Terminal Search Bar: an overlay search bar for finding text in the
 * active terminal. Opens with Cmd+F when terminal is focused.
 * Supports next/previous match, case sensitivity toggle, and regex.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Search,
  ChevronUp,
  ChevronDown,
  CaseSensitive,
  Regex,
  X,
} from 'lucide-react';
import { cn } from '@space/ui';

interface TerminalSearchBarProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSearch: (query: string, options: SearchOptions) => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly matchCount?: number;
  readonly currentMatch?: number;
}

export interface SearchOptions {
  readonly caseSensitive: boolean;
  readonly useRegex: boolean;
  readonly wrapAround: boolean;
}

export function TerminalSearchBar({
  open,
  onClose,
  onSearch,
  onNext,
  onPrevious,
  matchCount = 0,
  currentMatch = 0,
}: TerminalSearchBarProps) {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  useEffect(() => {
    if (query) {
      onSearch(query, { caseSensitive, useRegex, wrapAround: true });
    }
  }, [query, caseSensitive, useRegex, onSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        onPrevious();
      } else {
        onNext();
      }
    }
  }, [onClose, onNext, onPrevious]);

  if (!open) return null;

  return (
    <div className="absolute right-2 top-2 z-50 flex items-center gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-xl">
      <Search size={12} className="shrink-0 text-fg-faint" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find..."
        className="w-40 bg-transparent text-xs text-fg placeholder-fg-faint outline-none"
      />

      {/* Match count */}
      {query && (
        <span className="shrink-0 px-1 text-[10px] text-fg-faint">
          {matchCount > 0 ? `${currentMatch}/${matchCount}` : 'No matches'}
        </span>
      )}

      {/* Navigation */}
      <button
        type="button"
        onClick={onPrevious}
        disabled={matchCount === 0}
        className="shrink-0 rounded p-0.5 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30"
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp size={12} />
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={matchCount === 0}
        className="shrink-0 rounded p-0.5 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg disabled:opacity-30"
        title="Next match (Enter)"
      >
        <ChevronDown size={12} />
      </button>

      {/* Options */}
      <div className="mx-0.5 h-4 w-px bg-border" />
      <button
        type="button"
        onClick={() => setCaseSensitive(!caseSensitive)}
        className={cn(
          'shrink-0 rounded p-0.5 transition-colors',
          caseSensitive ? 'bg-accent/20 text-accent' : 'text-fg-faint hover:bg-surface-hover hover:text-fg',
        )}
        title="Case sensitive"
      >
        <CaseSensitive size={12} />
      </button>
      <button
        type="button"
        onClick={() => setUseRegex(!useRegex)}
        className={cn(
          'shrink-0 rounded p-0.5 transition-colors',
          useRegex ? 'bg-accent/20 text-accent' : 'text-fg-faint hover:bg-surface-hover hover:text-fg',
        )}
        title="Use regex"
      >
        <Regex size={12} />
      </button>

      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded p-0.5 text-fg-faint transition-colors hover:bg-surface-hover hover:text-fg"
        title="Close (Escape)"
      >
        <X size={12} />
      </button>
    </div>
  );
}
