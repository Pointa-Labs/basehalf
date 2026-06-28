export const AUTOSAVE_MS = 400;

export function debounceWithFlush<TArgs extends unknown[]>(
  fn: (...args: TArgs) => void,
  ms: number,
): ((...args: TArgs) => void) & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: TArgs | undefined;
  const wrapped = (...args: TArgs): void => {
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      pending = undefined;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  wrapped.flush = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (pending !== undefined) {
      const args = pending;
      pending = undefined;
      fn(...args);
    }
  };
  return wrapped;
}
