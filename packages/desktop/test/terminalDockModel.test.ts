import { describe, expect, it } from 'vitest';
import {
  terminalActiveLayout,
  terminalPaneMounts,
} from '../src/workbench/contrib/terminal/browser/terminalDockModel.js';
import type { TermTab } from '../src/workbench/contrib/terminal/browser/terminalStore.js';
import { type TermNode, leaf } from '../src/workbench/contrib/terminal/browser/terminalTree.js';

const split = (
  id: string,
  dir: 'row' | 'column',
  a: TermNode,
  b: TermNode,
  fraction = 0.5,
): TermNode => ({ type: 'split', id, dir, a, b, fraction });

const tab = (
  id: string,
  tree: TermNode,
  activePaneId: string,
  zoomedPaneId: string | null = null,
): TermTab => ({
  id,
  tree,
  activePaneId,
  zoomedPaneId,
});

describe('terminalDockModel', () => {
  it('keeps active, soft-closed tab, and soft-closed pane ptys mounted', () => {
    const main = tab('tab1', split('s1', 'row', leaf('p1'), leaf('p2')), 'p1');
    const closed = tab('tab2', split('s2', 'column', leaf('p3'), leaf('p4')), 'p3');

    expect(
      terminalPaneMounts(
        [main],
        [
          { kind: 'tab', tab: closed },
          { kind: 'pane', paneId: 'p5' },
        ],
      ),
    ).toEqual([
      { paneId: 'p1', tab: main },
      { paneId: 'p2', tab: main },
      { paneId: 'p3', tab: closed },
      { paneId: 'p4', tab: closed },
      { paneId: 'p5', tab: null },
    ]);
  });

  it('derives active tab rects and dividers from the split tree', () => {
    const active = tab('tab1', split('s1', 'row', leaf('p1'), leaf('p2'), 0.25), 'p1');

    const layout = terminalActiveLayout(active);

    expect(layout.activeRects.get('p1')).toEqual({ x: 0, y: 0, w: 0.25, h: 1 });
    expect(layout.activeRects.get('p2')).toEqual({ x: 0.25, y: 0, w: 0.75, h: 1 });
    expect(layout.dividers).toHaveLength(1);
    expect(layout.dimUnfocused).toBe(true);
    expect(layout.zoomedPaneId).toBeNull();
  });

  it('hides dividers and unfocused dimming while a pane is zoomed', () => {
    const active = tab('tab1', split('s1', 'row', leaf('p1'), leaf('p2')), 'p1', 'p2');

    expect(terminalActiveLayout(active)).toMatchObject({
      zoomedPaneId: 'p2',
      dividers: [],
      dimUnfocused: false,
    });
  });
});
