/**
 * Output backpressure (spec section 15.5 TERM-005: "Use backpressure to
 * prevent renderer overload"). A noisy child process can emit PTY data far
 * faster than IPC/the renderer can usefully consume it; this buffer
 * coalesces chunks and flushes them on a fixed interval instead of one
 * `postMessage` per `onData` callback, and caps how much unflushed data it
 * will hold so a runaway process cannot grow memory without bound — excess
 * bytes are dropped (oldest first) and reported via `droppedBytes` rather
 * than silently lost without a trace.
 */

export interface BackpressureBufferOptions {
  readonly maxBufferedBytes: number;
}

export interface FlushResult {
  readonly text: string;
  readonly droppedBytes: number;
}

export class BackpressureBuffer {
  private buffered = '';
  private droppedBytes = 0;

  constructor(private readonly options: BackpressureBufferOptions) {}

  push(chunk: string): void {
    this.buffered += chunk;
    const overflow = Buffer.byteLength(this.buffered, 'utf-8') - this.options.maxBufferedBytes;
    if (overflow > 0) {
      // Drop from the front (oldest data) so the buffer always holds the
      // most recent output, which is what a live terminal view needs.
      let dropped = 0;
      while (dropped < overflow && this.buffered.length > 0) {
        const removed = this.buffered[0] as string;
        this.buffered = this.buffered.slice(1);
        dropped += Buffer.byteLength(removed, 'utf-8');
      }
      this.droppedBytes += dropped;
    }
  }

  get pendingBytes(): number {
    return Buffer.byteLength(this.buffered, 'utf-8');
  }

  /** Returns null when there is nothing to flush (no wasted empty events). */
  flush(): FlushResult | null {
    if (this.buffered.length === 0 && this.droppedBytes === 0) {
      return null;
    }
    const result: FlushResult = { text: this.buffered, droppedBytes: this.droppedBytes };
    this.buffered = '';
    this.droppedBytes = 0;
    return result;
  }
}
