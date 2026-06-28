import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  confirm,
  pick,
  pickWithInputValue,
  prompt,
  useDialogStore,
} from '../src/platform/dialogs/browser/dialogService.js';

class FakeHTMLElement {
  isConnected = true;
  focus = vi.fn();
}

describe('dialogService', () => {
  let returnFocusElement: FakeHTMLElement;

  beforeEach(() => {
    returnFocusElement = new FakeHTMLElement();
    vi.stubGlobal('HTMLElement', FakeHTMLElement);
    vi.stubGlobal('document', { activeElement: returnFocusElement });
    useDialogStore.setState({ current: null, returnFocusElement: null });
  });

  afterEach(() => {
    useDialogStore.setState({ current: null, returnFocusElement: null });
    vi.unstubAllGlobals();
  });

  it('opens and resolves confirmation dialogs through the platform controller', async () => {
    const accepted = confirm({ title: 'Delete file?', destructive: true });

    expect(useDialogStore.getState().current).toMatchObject({
      type: 'confirm',
      title: 'Delete file?',
      confirmText: 'Continue',
      cancelText: 'Cancel',
      destructive: true,
    });

    useDialogStore.getState().resolveAndClose(true);

    await expect(accepted).resolves.toBe(true);
    await Promise.resolve();
    expect(returnFocusElement.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('opens prompt dialogs with default labels and values', async () => {
    const value = prompt({
      title: 'Create Branch',
      label: 'Branch name',
      placeholder: 'feature/x',
      defaultValue: 'feature/',
    });

    expect(useDialogStore.getState().current).toMatchObject({
      type: 'prompt',
      title: 'Create Branch',
      label: 'Branch name',
      placeholder: 'feature/x',
      defaultValue: 'feature/',
      confirmText: 'OK',
      cancelText: 'Cancel',
    });

    useDialogStore.getState().resolveAndClose('feature/dialogs');
    await expect(value).resolves.toBe('feature/dialogs');
  });

  it('opens single and many pick dialogs with quick-pick state isolated from the host', async () => {
    const single = pick({
      title: 'Switch Branch',
      options: [{ value: 'main', label: 'main' }],
    });
    expect(useDialogStore.getState().current).toMatchObject({
      type: 'pick',
      title: 'Switch Branch',
      placeholder: 'Search…',
      emptyText: 'Nothing to choose from.',
      canSelectMany: false,
      selectedValues: [],
      includeInputValue: false,
    });
    useDialogStore.getState().resolveAndClose('main');
    await expect(single).resolves.toBe('main');

    const many = pick({
      title: 'Select refs',
      canSelectMany: true,
      selectedValues: ['main'],
      options: [
        { value: 'main', label: 'main' },
        { value: 'topic', label: 'topic' },
      ],
    });
    expect(useDialogStore.getState().current).toMatchObject({
      type: 'pick',
      canSelectMany: true,
      selectedValues: ['main'],
    });
    useDialogStore.getState().resolveAndClose(['main', 'topic']);
    await expect(many).resolves.toEqual(['main', 'topic']);
  });

  it('can resolve a pick together with the raw input value', async () => {
    const value = pickWithInputValue({
      title: 'Create from',
      options: [{ value: 'cmd:create', label: 'Create new branch' }],
    });

    expect(useDialogStore.getState().current).toMatchObject({
      type: 'pick',
      includeInputValue: true,
    });

    useDialogStore.getState().resolveAndClose({
      value: 'cmd:create',
      inputValue: 'feature/x',
    });
    await expect(value).resolves.toEqual({ value: 'cmd:create', inputValue: 'feature/x' });
  });
});
