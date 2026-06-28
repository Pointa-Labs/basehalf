import { describe, expect, it } from 'vitest';
import { segmentLine } from '../src/workbench/services/editor/browser/adhdModel.js';

describe('segmentLine', () => {
  it('returns one non-hit segment when there are no keywords', () => {
    expect(segmentLine('hello world', [])).toEqual([{ text: 'hello world', hit: false, start: 0 }]);
  });

  it('marks a case-insensitive keyword hit (with stable char-offset starts)', () => {
    expect(segmentLine('The Cost curve', ['cost'])).toEqual([
      { text: 'The ', hit: false, start: 0 },
      { text: 'Cost', hit: true, start: 4 },
      { text: ' curve', hit: false, start: 8 },
    ]);
  });

  it('handles CJK keywords and multiple occurrences', () => {
    expect(segmentLine('供需均衡与供需弹性', ['供需'])).toEqual([
      { text: '供需', hit: true, start: 0 },
      { text: '均衡与', hit: false, start: 2 },
      { text: '供需', hit: true, start: 5 },
      { text: '弹性', hit: false, start: 7 },
    ]);
  });

  it('merges overlapping keywords into one highlight (longest wins, no torn markup)', () => {
    // 'supply' and 'supply curve' overlap; the union is one hit span.
    expect(segmentLine('the supply curve', ['supply', 'supply curve'])).toEqual([
      { text: 'the ', hit: false, start: 0 },
      { text: 'supply curve', hit: true, start: 4 },
    ]);
  });

  it('ignores blank keywords', () => {
    expect(segmentLine('abc', ['  ', ''])).toEqual([{ text: 'abc', hit: false, start: 0 }]);
  });
});
