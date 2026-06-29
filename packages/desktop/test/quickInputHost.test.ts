import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { useDialogStore } from '../src/platform/dialogs/browser/dialogService.js';
import type {
  IQuickPick,
  IQuickPickItem,
} from '../src/platform/quickinput/browser/quickInputService.js';
import { quickInputService } from '../src/platform/quickinput/browser/quickInputService.js';
import { DialogHost, quickPickHostRows } from '../src/workbench/browser/parts/dialogs/Dialog.js';

describe('quick input host separators', () => {
  let picker: IQuickPick<IQuickPickItem> | undefined;

  afterEach(() => {
    quickInputService.cancel();
    quickInputService.quickAccess.hide();
    if (picker !== undefined && !picker.disposed) picker.dispose();
    picker = undefined;
    useDialogStore.setState({ current: null, returnFocusElement: null });
  });

  it('keeps separators in visual rows without turning them into item rows', () => {
    const first = { id: 'first', label: 'First' };
    const second = { id: 'second', label: 'Second' };

    const rows = quickPickHostRows([
      { type: 'separator', label: 'Commands' },
      first,
      { type: 'separator', label: 'Branches' },
      second,
    ]);

    expect(
      rows.map((row) =>
        row.kind === 'separator'
          ? `separator:${row.visualIndex}:${row.separator.label ?? ''}`
          : `item:${row.visualIndex}:${row.item.id ?? ''}`,
      ),
    ).toEqual(['separator:0:Commands', 'item:1:first', 'separator:2:Branches', 'item:3:second']);
  });

  it('renders separator rows while keeping the active descendant on a real item', () => {
    const createBranch = { id: 'create', label: 'Create Branch...' };
    const main = { id: 'main', label: 'main', description: 'current' };
    picker = quickInputService.createQuickPick({ renderInHost: true, useSeparators: true });
    picker.title = 'Switch Branch';
    picker.items = [
      { type: 'separator', label: 'Commands' },
      createBranch,
      { type: 'separator', label: 'Branches' },
      main,
    ];
    picker.activeItems = [main];
    picker.show();

    const html = renderToStaticMarkup(createElement(DialogHost));

    expect(html).toContain('data-bh-pick-separator="true"');
    expect(html).toContain('Commands');
    expect(html).toContain('Branches');
    expect(html).toContain('aria-activedescendant="bh-pick-option-3"');
    expect(html).toContain('id="bh-pick-option-1"');
    expect(html).toContain('id="bh-pick-option-3"');
    expect(html).not.toContain('id="bh-pick-option-0"');
    expect(html).not.toContain('id="bh-pick-option-2"');
    expect(html).not.toMatch(/role="separator"[^>]*aria-selected/);
  });
});
