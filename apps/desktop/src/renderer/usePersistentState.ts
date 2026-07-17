import { useCallback, useState } from 'react';

/**
 * useState that mirrors its value into localStorage, so a UI preference
 * (which tab, which filter, how things are grouped) survives navigating away
 * and back — and a full app reload — instead of resetting every mount. Data
 * is always re-fetched from the real backend on mount; only the small,
 * cheap-to-restore view preferences are persisted here.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // A private-mode / quota failure must never break the view — the
          // in-memory value still updates; only cross-session persistence is lost.
        }
        return next;
      });
    },
    [key],
  );

  return [state, set];
}
