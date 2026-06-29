import { describe, expect, it } from 'vitest';
import { createWorkbenchFileChangeService } from '../src/workbench/services/files/browser/fileChangeService.js';

describe('workbenchFileChangeService', () => {
  it('maps file change subscriptions to the backend service', () => {
    const calls: Array<{ name: string; args: unknown[] }> = [];
    const handler = (): void => {};
    const unsubscribe = (): void => {};
    const service = createWorkbenchFileChangeService({
      onDidChangeFiles: (fn) => {
        calls.push({ name: 'onDidChangeFiles', args: [fn] });
        return unsubscribe;
      },
    });

    expect(service.onDidChangeFiles(handler)).toBe(unsubscribe);
    expect(calls).toEqual([{ name: 'onDidChangeFiles', args: [handler] }]);
  });
});
