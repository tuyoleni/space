/**
 * Theme toggle: switches between dark and light mode.
 * Persists preference via usePersistentState.
 * Applies the `data-theme` attribute on <html> to drive CSS custom properties.
 */
import { useEffect, useCallback } from 'react';
import { Moon, Sun } from 'lucide-react';
import { cn } from '@space/ui';
import { usePersistentState } from './usePersistentState';

export type Theme = 'dark' | 'light';

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = usePersistentState<Theme>('space:theme', 'dark');

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, [setTheme]);

  return [theme, toggle];
}

interface ThemeToggleProps {
  readonly theme: Theme;
  readonly onToggle: () => void;
  readonly className?: string;
}

export function ThemeToggle({ theme, onToggle, className }: ThemeToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        'text-fg-muted hover:bg-surface-hover hover:text-fg',
        className,
      )}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
