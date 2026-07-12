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
    const term = new Terminal({ convertEol: true, cursorBlink: true, fontSize: 13 });
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

    return () => {
      unsubscribe();
      disposable.dispose();
      term.dispose();
    };
    // Session identity never changes for the lifetime of this component
    // instance (TERM-002: permanently bound at creation), so depending
    // only on session.id (not the whole session object) is intentional.
  }, [session.id]);

  return <div ref={containerRef} style={{ height: 320, width: '100%', background: '#111' }} />;
}
