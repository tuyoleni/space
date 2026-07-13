import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { TerminalSessionInfo } from '@space/contracts';

/**
 * A real, workspace-bound terminal (TERM-001..006): xterm.js for
 * presentation, a real PTY behind window.space.terminal.* for the shell
 * itself. No command is ever sent through a generic execute channel —
 * every keystroke goes through terminal.write, which only accepts a
 * sessionId this component itself created.
 */
export function TerminalPanel({ session }: { readonly session: TerminalSessionInfo }) {
  const containerRef = useRef<HTMLDivElement>(null);

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
    const term = new Terminal({ convertEol: true, cursorBlink: !prefersReducedMotion, fontSize: 13 });
    term.open(container);
    term.writeln(`-- ${session.shell} (pid ${session.pid}) --`);

    const unsubscribe = window.space.terminal.subscribe(session.id, (event) => {
      if (event.type === 'output') {
        term.write(event.chunk);
      } else if (event.type === 'exit') {
        term.writeln(`\r\n-- process exited (code ${event.exitCode ?? 'unknown'}) --`);
      } else if (event.type === 'backpressure') {
        term.writeln(`\r\n-- output truncated: ${event.droppedBytes} bytes dropped --`);
      }
    });

    const disposable = term.onData((data) => {
      void window.space.terminal.write({ sessionId: session.id, data });
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
      container.removeEventListener('focus', focusTerminal);
      unsubscribe();
      disposable.dispose();
      term.dispose();
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
      style={{ height: 320, width: '100%', background: '#111' }}
    />
  );
}
