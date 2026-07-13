import { describe, expect, it, vi } from 'vitest';
import { RepositoryOperationQueue } from './queue';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('RepositoryOperationQueue.enqueueMutating', () => {
  it('serialises mutating operations for the same repository in order', async () => {
    const queue = new RepositoryOperationQueue();
    const order: number[] = [];
    const first = deferred<void>();

    const p1 = queue.enqueueMutating('repo-a', async () => {
      await first.promise;
      order.push(1);
    });
    const p2 = queue.enqueueMutating('repo-a', async () => {
      order.push(2);
    });

    // p2's operation must not have started yet — it is queued behind p1.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]);

    first.resolve();
    await Promise.all([p1, p2]);
    expect(order).toEqual([1, 2]);
  });

  it('runs operations for different repositories independently (per-repository lock, not one global lock)', async () => {
    const queue = new RepositoryOperationQueue();
    const order: string[] = [];
    const blockA = deferred<void>();

    const pA = queue.enqueueMutating('repo-a', async () => {
      await blockA.promise;
      order.push('a');
    });
    const pB = queue.enqueueMutating('repo-b', async () => {
      order.push('b');
    });

    await pB;
    expect(order).toEqual(['b']);
    blockA.resolve();
    await pA;
    expect(order).toEqual(['b', 'a']);
  });

  it('continues the queue for a repository after a prior operation fails, and rejects with the real error', async () => {
    const queue = new RepositoryOperationQueue();
    const failing = queue.enqueueMutating('repo-a', async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');

    const next = await queue.enqueueMutating('repo-a', async () => 'ok');
    expect(next).toBe('ok');
  });
});

describe('RepositoryOperationQueue.coalesceStatusRefresh', () => {
  it('shares one in-flight status refresh across concurrent callers for the same repository', async () => {
    const queue = new RepositoryOperationQueue();
    const operation = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 'status';
    });

    const [a, b, c] = await Promise.all([
      queue.coalesceStatusRefresh('repo-a', operation),
      queue.coalesceStatusRefresh('repo-a', operation),
      queue.coalesceStatusRefresh('repo-a', operation),
    ]);

    expect(operation).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual(['status', 'status', 'status']);
  });

  it('runs a fresh refresh once the previous one has completed', async () => {
    const queue = new RepositoryOperationQueue();
    const operation = vi.fn(async () => 'status');

    await queue.coalesceStatusRefresh('repo-a', operation);
    await queue.coalesceStatusRefresh('repo-a', operation);

    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('coalesces independently per repository', async () => {
    const queue = new RepositoryOperationQueue();
    const opA = vi.fn(async () => 'a');
    const opB = vi.fn(async () => 'b');

    await Promise.all([
      queue.coalesceStatusRefresh('repo-a', opA),
      queue.coalesceStatusRefresh('repo-a', opA),
      queue.coalesceStatusRefresh('repo-b', opB),
    ]);

    expect(opA).toHaveBeenCalledTimes(1);
    expect(opB).toHaveBeenCalledTimes(1);
  });
});

describe('RepositoryOperationQueue.enqueueRead (spec 27.4: concurrent repository reads)', () => {
  it('never allows more than the configured cap to run at once, across different repositories', async () => {
    const queue = new RepositoryOperationQueue({ maxConcurrentReads: 2 });
    let inFlight = 0;
    let maxObservedInFlight = 0;
    const gate = deferred<void>();

    const run = () =>
      queue.enqueueRead(async () => {
        inFlight += 1;
        maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
        await gate.promise;
        inFlight -= 1;
        return 'ok';
      });

    const results = Promise.all([run(), run(), run(), run()]);
    // Give the first two a chance to start; the other two must be waiting.
    await Promise.resolve();
    await Promise.resolve();
    expect(inFlight).toBe(2);
    expect(queue.inFlightReadCount).toBe(2);

    gate.resolve();
    await results;
    expect(maxObservedInFlight).toBe(2);
    expect(queue.inFlightReadCount).toBe(0);
  });

  it('lets a caller through immediately once a slot frees up (FIFO), never dropping or rejecting a read', async () => {
    const queue = new RepositoryOperationQueue({ maxConcurrentReads: 1 });
    const order: string[] = [];

    const first = queue.enqueueRead(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('first');
    });
    const second = queue.enqueueRead(async () => {
      order.push('second');
    });

    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });
});
