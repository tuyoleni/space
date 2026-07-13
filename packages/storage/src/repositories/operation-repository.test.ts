import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorage, type Storage } from '../storage';
import { MAX_RETAINED_OPERATION_OUTPUT_BYTES } from './operation-repository';

let dir: string;
let storage: Storage;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-operation-'));
  storage = createStorage(path.join(dir, 'space.sqlite'));
  storage.workspaces.create({ id: 'ws-a', name: 'A', iconToken: null, defaultProjectDirectory: null, createdAt: 'now', updatedAt: 'now' });
});

afterEach(() => {
  storage.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('OperationRepository resource limit (spec 27.4: maximum retained operation output)', () => {
  it('retains partialState under the limit unchanged', () => {
    storage.operations.start({ id: 'op-1', workspaceId: 'ws-a', projectId: null, type: 'test.op', risk: 'observe', humanSummary: 's', startedAt: 'now' });
    const completed = storage.operations.complete('op-1', {
      state: 'failed',
      endedAt: 'now',
      exitCode: 1,
      partialState: { error: 'small error message' },
    });
    expect(completed.partialState).toEqual({ error: 'small error message' });
  });

  it('truncates partialState larger than MAX_RETAINED_OPERATION_OUTPUT_BYTES instead of storing it unbounded', () => {
    storage.operations.start({ id: 'op-2', workspaceId: 'ws-a', projectId: null, type: 'test.op', risk: 'observe', humanSummary: 's', startedAt: 'now' });
    const hugeOutput = 'x'.repeat(MAX_RETAINED_OPERATION_OUTPUT_BYTES * 4);
    const completed = storage.operations.complete('op-2', {
      state: 'failed',
      endedAt: 'now',
      exitCode: 1,
      partialState: { stderr: hugeOutput },
    });
    const stored = completed.partialState as { truncated: boolean; maxBytes: number; preview: string };
    expect(stored.truncated).toBe(true);
    expect(stored.maxBytes).toBe(MAX_RETAINED_OPERATION_OUTPUT_BYTES);
    expect(Buffer.byteLength(stored.preview, 'utf-8')).toBeLessThanOrEqual(MAX_RETAINED_OPERATION_OUTPUT_BYTES);

    // Re-reading from the database (not just the in-memory return value) confirms it was actually persisted truncated.
    const reread = storage.operations.findById('op-2');
    expect(Buffer.byteLength(JSON.stringify(reread?.partialState), 'utf-8')).toBeLessThan(hugeOutput.length);
  });
});
