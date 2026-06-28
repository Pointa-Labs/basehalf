import { afterEach, describe, expect, it, vi } from 'vitest';
import { debounceWithFlush } from '../src/workbench/common/editor/mdEditorModel.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('mdEditorModel', () => {
  it('debounces, cancels, and flushes pending autosave work', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const save = debounceWithFlush((value: string) => calls.push(value), 20);

    save('one');
    save('two');
    vi.advanceTimersByTime(19);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual(['two']);

    save('cancelled');
    save.cancel();
    vi.advanceTimersByTime(20);
    expect(calls).toEqual(['two']);

    save('flushed');
    save.flush();
    expect(calls).toEqual(['two', 'flushed']);
    vi.advanceTimersByTime(20);
    expect(calls).toEqual(['two', 'flushed']);
  });
});
