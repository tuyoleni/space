/**
 * Storage worker (ADR-003, spec sections 20.2.4, 23.1): the only process
 * that ever opens the SQLite database. Runs inside `utilityProcess.fork`,
 * never the Electron main thread or the renderer. Reached exclusively
 * through the request/response protocol in ./storage-protocol — there is
 * no IPC surface here reachable by the renderer.
 */
import { createStorage } from '@space/storage';
import { handleStorageRequest } from './storage-handlers';
import type { StorageRequest, StorageResponse } from './storage-protocol';

const dbPath = process.argv[2];
if (!dbPath) {
  throw new Error('storage worker started without a database path argument');
}

const storage = createStorage(dbPath);

process.parentPort.on('message', (event) => {
  const request = event.data as StorageRequest;
  handleStorageRequest(storage, request).then(
    (result) => {
      const response: StorageResponse = { id: request.id, ok: true, result };
      process.parentPort.postMessage(response);
    },
    (error: unknown) => {
      const response: StorageResponse = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      process.parentPort.postMessage(response);
    },
  );
});

process.on('exit', () => {
  storage.close();
});
