export interface Queue<T> {
  enqueue(item: T): void;
  dequeueBatch(maxItems: number): T[];
  size(): number;
  flush(timeoutMs?: number): Promise<void>;
}
