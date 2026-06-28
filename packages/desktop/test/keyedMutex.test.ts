import { describe, expect, it } from 'vitest';
import { createKeyedMutex } from '../src/platform/async/common/keyedMutex.js';

describe('createKeyedMutex', () => {
  it('serializes operations with the same key', async () => {
    const withLock = createKeyedMutex();
    const events: string[] = [];
    let releaseFirst: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withLock('settings.json', async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
      return 1;
    });
    const second = withLock('settings.json', async () => {
      events.push('second:start');
      return 2;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('does not let a rejected operation wedge the queue', async () => {
    const withLock = createKeyedMutex();
    const first = withLock('mirror.yaml', async () => {
      throw new Error('boom');
    });
    const second = withLock('mirror.yaml', async () => 'after');

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('after');
  });

  it('allows unrelated keys to run concurrently', async () => {
    const withLock = createKeyedMutex();
    const events: string[] = [];
    let releaseA: () => void = () => {};
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const a = withLock('a', async () => {
      events.push('a:start');
      await gateA;
      events.push('a:end');
    });
    const b = withLock('b', async () => {
      events.push('b:start');
    });

    await b;
    expect(events).toEqual(['a:start', 'b:start']);
    releaseA();
    await a;
    expect(events).toEqual(['a:start', 'b:start', 'a:end']);
  });
});
