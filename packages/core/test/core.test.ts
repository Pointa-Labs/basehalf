import { describe, expect, it } from 'vitest';
import { UnknownCommand, createCore } from '../src/index.js';

describe('createCore (v0 scaffold)', () => {
  it('returns a frozen Core with register/run/has', () => {
    const core = createCore();
    expect(typeof core.register).toBe('function');
    expect(typeof core.run).toBe('function');
    expect(typeof core.has).toBe('function');
    expect(Object.isFrozen(core)).toBe(true);
  });

  it('run() throws UnknownCommand for unregistered names', async () => {
    const core = createCore();
    await expect(core.run('not.a.real.command', {})).rejects.toBeInstanceOf(UnknownCommand);
  });

  it('register + run round-trip works', async () => {
    const core = createCore();
    core.register<{ x: number }, number>('double', async ({ x }) => x * 2);
    expect(core.has('double')).toBe(true);
    const result = await core.run<{ x: number }, number>('double', { x: 21 });
    expect(result).toBe(42);
  });

  it('register() refuses duplicate names', () => {
    const core = createCore();
    core.register('once', async () => null);
    expect(() => core.register('once', async () => null)).toThrow(/already registered/);
  });
});
