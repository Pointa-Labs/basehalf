/**
 * In-process serial queue keyed by an arbitrary resource id.
 *
 * This is desktop platform infrastructure, analogous to VS Code's shared
 * async/common primitives: main-process providers can serialize
 * read-modify-write operations without depending on the legacy core kernel.
 */
export function createKeyedMutex(): <T>(key: string, op: () => Promise<T>) => Promise<T> {
  const chains = new Map<string, Promise<unknown>>();

  return <T>(key: string, op: () => Promise<T>): Promise<T> => {
    const previous = chains.get(key) ?? Promise.resolve();
    const result = previous.then(op, op);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    chains.set(key, tail);
    tail.finally(() => {
      if (chains.get(key) === tail) chains.delete(key);
    });
    return result;
  };
}
