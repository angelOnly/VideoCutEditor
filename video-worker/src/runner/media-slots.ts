/** 同宿主全部任务与预览共用，整批申请避免两个批次各占一槽后互等。 */
export class MediaSlots {
  private used = 0;
  private waiting: {
    count: number;
    signal: AbortSignal;
    resolve: (release: () => void) => void;
    reject: (e: unknown) => void;
    abort: () => void;
  }[] = [];
  constructor(readonly capacity = 2) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 3)
      throw Error('媒体槽数量必须为 1 至 3');
  }
  private pump() {
    while (this.waiting.length && this.used + this.waiting[0].count <= this.capacity) {
      const item = this.waiting.shift()!;
      item.signal.removeEventListener('abort', item.abort);
      if (item.signal.aborted) {
        item.reject(item.signal.reason);
        continue;
      }
      this.used += item.count;
      let released = false;
      item.resolve(() => {
        if (!released) {
          released = true;
          this.used -= item.count;
          this.pump();
        }
      });
    }
  }
  private acquire(count: number, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!Number.isInteger(count) || count < 1 || count > this.capacity)
      throw Error(`申请渲染槽超出宿主上限 ${this.capacity}`);
    return new Promise<() => void>((resolve, reject) => {
      const item = { count, signal, resolve, reject, abort: () => {} };
      item.abort = () => {
        this.waiting = this.waiting.filter((x) => x !== item);
        reject(signal.reason);
        this.pump();
      };
      signal.addEventListener('abort', item.abort, { once: true });
      this.waiting.push(item);
      this.pump();
    });
  }
  async run<T>(count: number, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const release = await this.acquire(count, signal);
    try {
      signal.throwIfAborted();
      return await work();
    } finally {
      release();
    }
  }
}
