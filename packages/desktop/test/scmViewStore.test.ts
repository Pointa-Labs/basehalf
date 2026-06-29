import { beforeEach, describe, expect, it } from 'vitest';
import { useScmViewStore } from '../src/workbench/contrib/scm/browser/scmViewStore.js';

describe('scmViewStore', () => {
  beforeEach(() => {
    useScmViewStore.setState({
      changesOpen: true,
      graphOpen: true,
      historyFilter: { kind: 'auto' },
      selectedHistoryItemId: null,
      historyReloadRequest: 0,
      focusCommit: null,
    });
  });

  it('reveals commits through the shared graph selection state', () => {
    useScmViewStore.setState({ graphOpen: false });

    useScmViewStore.getState().revealCommit('abc123');

    expect(useScmViewStore.getState()).toMatchObject({
      graphOpen: true,
      focusCommit: 'abc123',
      selectedHistoryItemId: 'abc123',
    });
  });

  it('emits monotonic reload requests for history views', () => {
    expect(useScmViewStore.getState().historyReloadRequest).toBe(0);

    useScmViewStore.getState().requestHistoryReload();
    useScmViewStore.getState().requestHistoryReload();

    expect(useScmViewStore.getState().historyReloadRequest).toBe(2);
  });
});
