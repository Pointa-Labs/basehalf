/**
 * In-process serial queue keyed by an arbitrary string.
 *
 * Serializes async read-modify-write sequences against a shared resource
 * (typically a JSON file on disk) so two concurrent operations can't both
 * read the pre-write state and have the second write clobber the first —
 * the classic lost-update race. Each key gets its own chain, so operations
 * on unrelated resources still run concurrently.
 *
 * Scope: a single process. This covers the desktop app and the MCP server
 * (both single-process). Cross-process `bh` CLI invocations writing the
 * same file still race at the filesystem level — closing that would need
 * OS-level file locking and is deliberately out of scope.
 *
 * Lives in the kernel because concurrency control is cross-cutting
 * infrastructure: modules may not import each other's internals, but all
 * may depend on the kernel. The inbound and views modules share this one
 * primitive rather than each carrying their own copy (which would drift).
 */
export function createKeyedMutex(): <T>(key: string, op: () => Promise<T>) => Promise<T> {
  const chains = new Map<string, Promise<unknown>>();
  return function withLock<T>(key: string, op: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve();
    // Run op after prev settles, regardless of whether prev resolved or
    // threw — a failed op must not wedge the queue for the same key.
    const result = prev.then(op, op);
    // The gate for the NEXT op swallows this op's outcome so one rejection
    // doesn't reject the following op's `prev`. The returned `result` keeps
    // the real (possibly-rejecting) value for this caller.
    chains.set(
      key,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  };
}
