import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import type { TerminalSessionInfo } from '@space/contracts';

export interface TerminalPanelProps {
  readonly session: TerminalSessionInfo;
  // Fired with the real, accumulated keystrokes for one line (see onData
  // below) — never a synthesized or guessed value.
  readonly onCommand?: (command: string, timestamp: string) => void;
  // Fired with the real PTY output chunk, in addition to (not instead of)
  // writing it into xterm.
  readonly onOutputChunk?: (chunk: string, timestamp: string) => void;
}

export interface TerminalPanelHandle {
  clear(): void;
  find(term: string, opts?: { backwards?: boolean }): boolean;
  findNext(): boolean;
  findPrevious(): boolean;
  // Same window.space.terminal.write path a real keystroke uses — this is a
  // programmatic keypress, not a second, privileged command channel.
  sendLine(text: string): void;
  exportBuffer(): string;
  focus(): void;
}

/**
 * A real, workspace-bound terminal (TERM-001..006): xterm.js for
 * presentation, a real PTY behind window.space.terminal.* for the shell
 * itself. No command is ever sent through a generic execute channel —
 * every keystroke goes through terminal.write, which only accepts a
 * sessionId this component itself created.
 */
export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel(
  { session, onCommand, onOutputChunk },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Populated inside the effect below; the imperative handle reads through
  // these refs so it always reaches the live instance for this session,
  // never a stale closure from a prior mount.
  const termRef = useRef<Terminal | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  // findNext/findPrevious (no args) repeat whatever `find` last searched for,
  // matching the addon's own model of "the current search".
  const lastSearchTermRef = useRef('');
  // Mirrors exactly what the user has typed since the last Enter, so
  // onCommand can report real input instead of reconstructing it.
  const inputBufferRef = useRef('');

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        termRef.current?.clear();
      },
      find(term, opts) {
        lastSearchTermRef.current = term;
        const addon = searchAddonRef.current;
        if (!addon) {
          return false;
        }
        return opts?.backwards ? addon.findPrevious(term) : addon.findNext(term);
      },
      findNext() {
        const addon = searchAddonRef.current;
        return lastSearchTermRef.current && addon ? addon.findNext(lastSearchTermRef.current) : false;
      },
      findPrevious() {
        const addon = searchAddonRef.current;
        return lastSearchTermRef.current && addon ? addon.findPrevious(lastSearchTermRef.current) : false;
      },
      sendLine(text) {
        void window.space.terminal.write({ sessionId: session.id, data: `${text}\r` });
      },
      exportBuffer() {
        const term = termRef.current;
        if (!term) {
          return '';
        }
        const buffer = term.buffer.active;
        const lines: string[] = [];
        for (let i = 0; i < buffer.length; i += 1) {
          lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
        }
        return lines.join('\n');
      },
      focus() {
        termRef.current?.focus();
      },
    }),
    [session.id],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    // spec 28: "Respect operating-system reduced-motion settings" — xterm's
    // blinking cursor is the one animation this component controls
    // directly (CSS transitions/animations don't reach into its canvas
    // rendering), so it is read here rather than relying on the
    // stylesheet-level media query in index.css.
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // xterm paints its own canvas background regardless of the container's
    // CSS — 'theme.background' has to be transparent too, or the card
    // behind it (and its glassy alpha) gets covered by an opaque rectangle.
    const term = new Terminal({
      convertEol: true,
      cursorBlink: !prefersReducedMotion,
      fontSize: 13,
      allowTransparency: true,
      theme: { background: '#00000000', foreground: '#f2f2f2' },
    });
    const searchAddon = new SearchAddon();
    const fitAddon = new FitAddon();
    term.loadAddon(searchAddon);
    term.loadAddon(fitAddon);
    termRef.current = term;
    searchAddonRef.current = searchAddon;
    term.open(container);
    term.writeln(`-- ${session.shell} (pid ${session.pid}) --`);

    // Without this, xterm defaults to a fixed 80x24 grid regardless of the
    // container's real size — the terminal renders "capped" well short of
    // the space it's actually given. fit() measures the container and
    // resizes the grid to match; the resize call after it tells the real
    // PTY the same new size so the shell's own line-wrapping agrees with
    // what's on screen (mismatched PTY/display size is what breaks things
    // like vim's redraw or a wrapped `ls`).
    const syncSize = () => {
      // The Terminal view stays mounted-but-hidden (display:none) while
      // navigating elsewhere (see AppShell) so its live session survives —
      // but a hidden ancestor collapses this container to 0x0, and fit()
      // would happily "resize" the real PTY down to a degenerate ~2x1 grid
      // in the background. Skip entirely while not actually laid out.
      if (container.offsetWidth === 0 || container.offsetHeight === 0) {
        return;
      }
      fitAddon.fit();
      void window.space.terminal.resize({ sessionId: session.id, cols: term.cols, rows: term.rows });
    };
    syncSize();
    const resizeObserver = new ResizeObserver(() => syncSize());
    resizeObserver.observe(container);

    const unsubscribe = window.space.terminal.subscribe(session.id, (event) => {
      if (event.type === 'output') {
        term.write(event.chunk);
        onOutputChunk?.(event.chunk, new Date().toISOString());
      } else if (event.type === 'exit') {
        term.writeln(`\r\n-- process exited (code ${event.exitCode ?? 'unknown'}) --`);
      } else if (event.type === 'backpressure') {
        term.writeln(`\r\n-- output truncated: ${event.droppedBytes} bytes dropped --`);
      }
    });

    const disposable = term.onData((data) => {
      void window.space.terminal.write({ sessionId: session.id, data });
      if (!onCommand) {
        return;
      }
      // Walk char-by-char since a single onData call can carry more than one
      // logical keystroke (e.g. a paste), and each needs its own handling.
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          const command = inputBufferRef.current;
          inputBufferRef.current = '';
          onCommand(command, new Date().toISOString());
        } else if (ch === '\x7f' || ch === '\b') {
          inputBufferRef.current = inputBufferRef.current.slice(0, -1);
        } else {
          inputBufferRef.current += ch;
        }
      }
    });

    // spec 28: "Terminal remains keyboard accessible." xterm.js opens its
    // own hidden, focusable <textarea> inside `container`; Tab reaches the
    // wrapper div (tabIndex below) and this hands focus straight into that
    // real input so a keyboard-only user does not need a second Tab press
    // (or a mouse click) to actually start typing. Tab/Escape out of the
    // terminal remain xterm's own default behaviour — this component does
    // not trap focus.
    const focusTerminal = () => term.focus();
    container.addEventListener('focus', focusTerminal);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('focus', focusTerminal);
      unsubscribe();
      disposable.dispose();
      term.dispose();
      termRef.current = null;
      searchAddonRef.current = null;
    };
    // Session identity never changes for the lifetime of this component
    // instance (TERM-002: permanently bound at creation), so depending
    // only on session.id (not the whole session object) is intentional.
  }, [session.id]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label={`Terminal: ${session.shell}, process ${session.pid}`}
      className="h-full min-h-[20rem] w-full bg-transparent px-3 py-2 focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2"
    />
  );
});
