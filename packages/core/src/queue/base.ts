export type QueueGetResult<T> =
  | {
      done: false;
      item: T;
    }
  | {
      done: true;
    };

export interface Queue<T> {
  put(item: T): Promise<void>;
  get(): Promise<QueueGetResult<T>>;
  close(): void;
  size(): number;
}

export interface TaskExecutorOptions<T> {
  workerCount?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  onError?: (error: unknown, item: T) => void | Promise<void>;
}
