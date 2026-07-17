import { useCallback, useState } from 'react';

export interface CommandHistoryEntry {
  readonly id: string;
  readonly sessionId: string;
  readonly command: string;
  readonly timestamp: string;
}

export interface ProblemEntry {
  readonly id: string;
  readonly sessionId: string;
  readonly text: string;
  readonly timestamp: string;
  readonly severity: 'error' | 'warning';
}

// PTYs can produce an unbounded stream over a long session; cap both lists
// so memory stays flat and the UI never has to render an ever-growing feed.
const MAX_HISTORY = 200;
const MAX_PROBLEMS = 100;

// eslint-disable-next-line no-control-regex -- \x1b is the real ANSI escape byte PTYs emit, not a typo.
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*m/g;

const ERROR_PATTERNS = [/\berror\b/i, /\bfatal\b/i, /exception/i, /\bfailed\b/i];
const WARNING_PATTERN = /\bwarn(ing)?\b/i;

const SUGGESTION_RULES: ReadonlyArray<readonly [string, string]> = [
  ['git pull', 'git status'],
  ['git status', 'git add .'],
  ['git add', 'git commit -m "..."'],
  ['git commit', 'git push'],
  ['npm install', 'npm run dev'],
  ['npm run build', 'npm run start'],
  ['yarn install', 'yarn dev'],
  ['pnpm install', 'pnpm dev'],
];

export function suggestionFor(command: string): string | null {
  const trimmed = command.trim();
  const rule = SUGGESTION_RULES.find(([key]) => trimmed.startsWith(key));
  return rule ? rule[1] : null;
}

function classifyLine(line: string): 'error' | 'warning' | null {
  if (ERROR_PATTERNS.some((pattern) => pattern.test(line))) {
    return 'error';
  }
  if (WARNING_PATTERN.test(line)) {
    return 'warning';
  }
  return null;
}

export function useTerminalActivity(): {
  recordCommand: (sessionId: string, command: string, timestamp: string) => void;
  recordOutput: (sessionId: string, chunk: string, timestamp: string) => void;
  history: readonly CommandHistoryEntry[];
  problems: readonly ProblemEntry[];
} {
  const [history, setHistory] = useState<readonly CommandHistoryEntry[]>([]);
  const [problems, setProblems] = useState<readonly ProblemEntry[]>([]);

  const recordCommand = useCallback((sessionId: string, command: string, timestamp: string) => {
    if (!command.trim()) {
      return;
    }
    setHistory((prev) => [...prev, { id: crypto.randomUUID(), sessionId, command, timestamp }].slice(-MAX_HISTORY));
  }, []);

  const recordOutput = useCallback((sessionId: string, chunk: string, timestamp: string) => {
    const lines = chunk.split('\n');
    const found: ProblemEntry[] = [];
    for (const rawLine of lines) {
      const severity = classifyLine(rawLine);
      if (!severity) {
        continue;
      }
      const text = rawLine.replace(ANSI_ESCAPE_PATTERN, '').trim();
      if (!text) {
        continue;
      }
      found.push({ id: crypto.randomUUID(), sessionId, text, timestamp, severity });
    }
    if (found.length === 0) {
      return;
    }
    setProblems((prev) => {
      let next = prev;
      for (const entry of found) {
        // PTYs often repeat/re-render the same line (progress bars, prompts);
        // only dedupe against the immediately-preceding entry for this session.
        const previous = [...next].reverse().find((candidate) => candidate.sessionId === entry.sessionId);
        if (previous && previous.text === entry.text) {
          continue;
        }
        next = [...next, entry];
      }
      return next.slice(-MAX_PROBLEMS);
    });
  }, []);

  return {
    recordCommand,
    recordOutput,
    history: [...history].reverse(),
    problems: [...problems].reverse(),
  };
}
