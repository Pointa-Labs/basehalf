import { describe, expect, it } from 'vitest';
import { createFileEventService } from '../src/platform/files/browser/fileEventService.js';

describe('fileEventService', () => {
  it('maps workspace watcher subscriptions to the preload bridge', () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const handler = (): void => {};
    const unsubscribe = (): void => {};
    const service = createFileEventService({
      onDidChangeFiles: (fn) => {
        calls.push({ name: 'onDidChangeFiles', args: [fn] });
        return unsubscribe;
      },
    });

    expect(service.onDidChangeFiles(handler)).toBe(unsubscribe);
    expect(calls).toEqual([{ name: 'onDidChangeFiles', args: [handler] }]);
  });
});
