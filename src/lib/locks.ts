const active = new Map<string, Promise<unknown>>();

export async function withRequestLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const existing = active.get(key);
  if (existing) return await existing as T;

  const pending = operation().finally(() => active.delete(key));
  active.set(key, pending);
  return await pending;
}
