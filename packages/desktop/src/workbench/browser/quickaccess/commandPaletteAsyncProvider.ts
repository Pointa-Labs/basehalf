import { useEffect, useState } from 'react';

export interface CommandPaletteAsyncProviderOptions<T> {
  readonly open: boolean;
  readonly ready: boolean;
  readonly empty: () => T;
  readonly load: () => Promise<T>;
  readonly resetBeforeLoad?: boolean;
  readonly emptyOnError?: boolean;
  readonly delayMs?: number;
}

export function useCommandPaletteAsyncProvider<T>(
  options: CommandPaletteAsyncProviderOptions<T>,
): T {
  const [state, setState] = useState<T>(() => options.empty());

  useEffect(() => {
    if (!options.open) return;
    if (options.resetBeforeLoad === true) setState(options.empty());
    if (!options.ready) {
      setState(options.empty());
      return;
    }

    let cancelled = false;
    const load = (): void => {
      void options.load().then(
        (next) => {
          if (!cancelled) setState(next);
        },
        () => {
          if (!cancelled && options.emptyOnError === true) {
            setState(options.empty());
          }
        },
      );
    };

    const handle: ReturnType<typeof setTimeout> | undefined =
      options.delayMs === undefined ? undefined : setTimeout(load, options.delayMs);
    if (handle === undefined) load();

    return () => {
      cancelled = true;
      if (handle !== undefined) clearTimeout(handle);
    };
  }, [
    options.open,
    options.ready,
    options.resetBeforeLoad,
    options.empty,
    options.load,
    options.emptyOnError,
    options.delayMs,
  ]);

  return state;
}
