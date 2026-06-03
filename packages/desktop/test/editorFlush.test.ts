import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  flushDoc,
  registerDocFlusher,
  unregisterDocFlusher,
} from '../src/renderer/src/lib/editorFlush.js';

const registered: Array<[string, () => Promise<boolean>]> = [];

const register = (docKey: string, fn: () => Promise<boolean>): void => {
  registered.push([docKey, fn]);
  registerDocFlusher(docKey, fn);
};

afterEach(() => {
  for (const [docKey, fn] of registered.splice(0)) {
    unregisterDocFlusher(docKey, fn);
  }
});

describe('editorFlush doc registry', () => {
  it('flushes every mounted view for a shared document', async () => {
    const docKey = `doc:${Date.now()}:all`;
    const owner = vi.fn(async () => true);
    const sibling = vi.fn(async () => true);
    register(docKey, owner);
    register(docKey, sibling);

    await expect(flushDoc(docKey)).resolves.toBe(true);
    expect(owner).toHaveBeenCalledTimes(1);
    expect(sibling).toHaveBeenCalledTimes(1);
  });

  it('reports false when any view blocks the document flush', async () => {
    const docKey = `doc:${Date.now()}:blocked`;
    register(
      docKey,
      vi.fn(async () => true),
    );
    register(
      docKey,
      vi.fn(async () => false),
    );

    await expect(flushDoc(docKey)).resolves.toBe(false);
  });

  it('passes force-serialize intent to document flushers', async () => {
    const docKey = `doc:${Date.now()}:force`;
    const flusher = vi.fn(async () => true);
    register(docKey, flusher);

    await expect(flushDoc(docKey, { forceSerialize: true })).resolves.toBe(true);
    expect(flusher).toHaveBeenCalledWith({ forceSerialize: true });
  });

  it('is a no-op when no view is registered for the document', async () => {
    await expect(flushDoc(`doc:${Date.now()}:missing`)).resolves.toBe(true);
  });
});
