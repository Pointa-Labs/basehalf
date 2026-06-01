import { afterEach, describe, expect, it } from 'vitest';
import {
  type LiveDocView,
  __resetLiveDoc,
  broadcast,
  claimWriter,
  currentWriter,
  hasLiveDoc,
  registerView,
} from '../src/renderer/src/lib/liveDoc.js';

// A fake view that records the bus's calls into it.
function fakeView(file: string, content = 'DISK') {
  const log: string[] = [];
  let writer = false;
  const view: LiveDocView = {
    file,
    setWriter: (w) => {
      writer = w;
      log.push(`setWriter:${w}`);
    },
    getContent: async () => content,
    adopt: async (md) => {
      log.push(`adopt:${md}`);
    },
    flush: async () => {
      log.push('flush');
    },
  };
  return { view, log, isWriter: () => writer };
}

afterEach(() => __resetLiveDoc());

describe('liveDoc bus', () => {
  it('the first view that claims becomes the sole writer', () => {
    const a = fakeView('x.md');
    registerView(a.view);
    claimWriter(a.view);
    expect(a.isWriter()).toBe(true);
    expect(currentWriter('x.md')).toBe(a.view);
    expect(hasLiveDoc('x.md')).toBe(true);
  });

  it('a newer writer takes the role; the old one goes read-only and flushes first', () => {
    const a = fakeView('x.md');
    registerView(a.view);
    claimWriter(a.view);
    a.log.length = 0;

    const b = fakeView('x.md');
    registerView(b.view);
    claimWriter(b.view);

    expect(b.isWriter()).toBe(true);
    expect(a.isWriter()).toBe(false);
    expect(currentWriter('x.md')).toBe(b.view);
    // The outgoing writer (a) was told to go read-only AND to flush its edits.
    expect(a.log).toContain('setWriter:false');
    expect(a.log).toContain('flush');
  });

  it('claimWriter is a no-op when the view is already the writer (no spurious flush)', () => {
    const a = fakeView('x.md');
    registerView(a.view);
    claimWriter(a.view);
    a.log.length = 0;
    claimWriter(a.view); // already writer
    expect(a.log).toEqual([]); // no setWriter / flush churn
  });

  it('broadcast reaches every OTHER view, not the writer itself', () => {
    const a = fakeView('x.md');
    const b = fakeView('x.md');
    const c = fakeView('x.md');
    for (const v of [a, b, c]) registerView(v.view);
    claimWriter(a.view);
    a.log.length = 0;
    b.log.length = 0;
    c.log.length = 0;
    broadcast(a.view, 'NEW BODY');
    expect(a.log).toEqual([]); // writer doesn't adopt its own broadcast
    expect(b.log).toEqual(['adopt:NEW BODY']);
    expect(c.log).toEqual(['adopt:NEW BODY']);
  });

  it('unregistering the writer hands the role to a surviving view', () => {
    const a = fakeView('x.md');
    const b = fakeView('x.md');
    const unregA = registerView(a.view);
    registerView(b.view);
    claimWriter(a.view);
    expect(currentWriter('x.md')).toBe(a.view);

    b.log.length = 0;
    unregA(); // the writer leaves
    expect(currentWriter('x.md')).toBe(b.view); // role handed off
    expect(b.isWriter()).toBe(true);
  });

  it('unregistering the last view clears the file from the bus', () => {
    const a = fakeView('x.md');
    const unreg = registerView(a.view);
    claimWriter(a.view);
    unreg();
    expect(hasLiveDoc('x.md')).toBe(false);
    expect(currentWriter('x.md')).toBeUndefined();
  });

  it('views of different files are independent', () => {
    const a = fakeView('a.md');
    const b = fakeView('b.md');
    registerView(a.view);
    registerView(b.view);
    claimWriter(a.view);
    claimWriter(b.view);
    expect(a.isWriter()).toBe(true);
    expect(b.isWriter()).toBe(true); // separate files → separate writers
  });
});
