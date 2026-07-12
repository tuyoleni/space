/**
 * Terminal worker (spec sections 15, 20.2.4): the only process that ever
 * owns a real PTY. Runs inside `utilityProcess.fork`, never the Electron
 * main thread or the renderer — mirrors storage-worker.ts's boundary
 * exactly, except output is pushed as events, not just returned as a
 * single response, because a terminal is a stream (spec 22.1).
 */
import { PtyHost, createNodePtySpawner } from '@space/terminal';
import type {
  TerminalCreateRequest,
  TerminalDisposeRequest,
  TerminalResizeRequest,
  TerminalWorkerEvent,
  TerminalWorkerRequest,
  TerminalWorkerResponse,
  TerminalWriteRequest,
} from '@space/terminal';

const host = new PtyHost({
  spawner: createNodePtySpawner(),
  emit: (event: TerminalWorkerEvent) => process.parentPort.postMessage(event),
});

function handle(request: TerminalWorkerRequest): unknown {
  switch (request.method) {
    case 'terminal.create':
      return host.create(request.payload as TerminalCreateRequest);
    case 'terminal.write': {
      const payload = request.payload as TerminalWriteRequest;
      host.write(payload.sessionId, payload.data);
      return undefined;
    }
    case 'terminal.resize': {
      const payload = request.payload as TerminalResizeRequest;
      host.resize(payload.sessionId, payload.cols, payload.rows);
      return undefined;
    }
    case 'terminal.dispose': {
      const payload = request.payload as TerminalDisposeRequest;
      host.dispose(payload.sessionId);
      return undefined;
    }
    case 'terminal.list':
      return host.list();
    default: {
      const exhaustive: never = request.method;
      throw new Error(`Unknown terminal worker method: ${String(exhaustive)}`);
    }
  }
}

process.parentPort.on('message', (event) => {
  const request = event.data as TerminalWorkerRequest;
  try {
    const result = handle(request);
    const response: TerminalWorkerResponse = { kind: 'response', id: request.id, ok: true, result };
    process.parentPort.postMessage(response);
  } catch (error) {
    const response: TerminalWorkerResponse = {
      kind: 'response',
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    process.parentPort.postMessage(response);
  }
});

process.on('exit', () => {
  host.disposeAll();
});
