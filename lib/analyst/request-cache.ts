interface Completed<T> { value: T; expiresAt: number; }
interface Pending<T> {
  controller: AbortController;
  promise: Promise<T>;
  users: number;
  settled: boolean;
}

/** Short-lived LRU with one request per key and independent caller cancellation. */
export class SharedRequestCache<T> {
  private readonly completed = new Map<string, Completed<T>>();
  private readonly pending = new Map<string, Pending<T>>();

  constructor(
    private readonly maxEntries: number,
    private readonly maxAgeMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string, loader: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const now = this.now();
    for (const [id, entry] of this.completed)
      if (entry.expiresAt <= now) this.completed.delete(id);
    const saved = this.completed.get(key);
    if (saved) {
      this.completed.delete(key);
      this.completed.set(key, saved);
      return Promise.resolve().then(() => {
        signal?.throwIfAborted();
        return saved.value;
      });
    }

    let request = this.pending.get(key);
    if (!request) {
      const controller = new AbortController();
      request = { controller, promise: undefined!, users: 0, settled: false };
      const started = request;
      started.promise = Promise.resolve().then(async () => {
        controller.signal.throwIfAborted();
        const value = await loader(controller.signal);
        controller.signal.throwIfAborted();
        if (this.maxEntries > 0 && this.maxAgeMs > 0) {
          this.completed.set(key, { value, expiresAt: this.now() + this.maxAgeMs });
          while (this.completed.size > this.maxEntries)
            this.completed.delete(this.completed.keys().next().value!);
        }
        return value;
      }).finally(() => {
        started.settled = true;
        if (this.pending.get(key) === started) this.pending.delete(key);
      });
      this.pending.set(key, started);
    }

    const shared = request;
    shared.users++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener('abort', onAbort);
        shared.users--;
        if (!shared.users && !shared.settled) {
          if (this.pending.get(key) === shared) this.pending.delete(key);
          shared.controller.abort();
        }
        return true;
      };
      const onAbort = () => { if (finish()) reject(signal!.reason); };
      signal?.addEventListener('abort', onAbort, { once: true });
      shared.promise.then(
        value => { if (finish()) resolve(value); },
        error => { if (finish()) reject(error); },
      );
    });
  }
}
