import type {
  CancellationToken,
  QuickAccessControllerState,
  QuickAccessOptions,
} from './quickAccess.js';

export class QuickAccessCancellationTokenSource {
  private cancellationRequested = false;
  private readonly listeners = new Set<() => void>();
  readonly token: CancellationToken;

  constructor() {
    const source = this;
    this.token = {
      get isCancellationRequested() {
        return source.cancellationRequested;
      },
      onCancellationRequested: (listener) => source.onCancellationRequested(listener),
    };
  }

  cancel(): void {
    if (this.cancellationRequested) return;
    this.cancellationRequested = true;
    for (const listener of this.listeners) listener();
    this.listeners.clear();
  }

  private onCancellationRequested(listener: () => void): () => void {
    if (this.cancellationRequested) {
      listener();
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export function closedQuickAccessState(): QuickAccessControllerState {
  return {
    visible: false,
    value: '',
    filterValue: '',
    prefix: '',
    valueSelection: [0, 0],
  };
}

export function valueSelectionForQuickAccess(
  value: string,
  prefix: string,
  options: QuickAccessOptions,
): readonly [number, number] {
  if (options.preserveValue === true) return [value.length, value.length];
  return [prefix.length, value.length];
}

export function quickAccessStatesEqual(
  a: QuickAccessControllerState,
  b: QuickAccessControllerState,
): boolean {
  return (
    a.visible === b.visible &&
    a.value === b.value &&
    a.filterValue === b.filterValue &&
    a.providerId === b.providerId &&
    a.prefix === b.prefix &&
    a.placeholder === b.placeholder &&
    a.valueSelection[0] === b.valueSelection[0] &&
    a.valueSelection[1] === b.valueSelection[1]
  );
}
