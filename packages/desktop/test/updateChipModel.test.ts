import { describe, expect, it } from 'vitest';
import {
  isTransientUpdatePhase,
  updateChipViewModel,
} from '../src/workbench/contrib/update/browser/updateChipModel.js';

describe('updateChipModel', () => {
  it('hides idle and explicitly hidden states', () => {
    expect(updateChipViewModel({ phase: 'idle' })).toBeNull();
    expect(
      updateChipViewModel({ phase: 'available', version: '1.2.3' }, { hidden: true }),
    ).toBeNull();
  });

  it('marks checking and up-to-date states as transient feedback', () => {
    expect(isTransientUpdatePhase('checking')).toBe(true);
    expect(isTransientUpdatePhase('upToDate')).toBe(true);
    expect(isTransientUpdatePhase('available')).toBe(false);
  });

  it('maps available and staged states to VS Code-style title bar actions', () => {
    expect(updateChipViewModel({ phase: 'available', version: '1.2.3' })).toMatchObject({
      kind: 'label',
      text: 'Update 1.2.3',
      tone: 'accent',
      action: 'download',
    });
    expect(
      updateChipViewModel({ phase: 'available', version: '1.2.3' }, { starting: true }),
    ).toMatchObject({
      text: 'Starting…',
      action: undefined,
    });
    expect(updateChipViewModel({ phase: 'staged', version: '1.2.3' })).toMatchObject({
      text: 'Restart to update',
      action: 'install',
    });
  });

  it('describes determinate and indeterminate download progress', () => {
    expect(
      updateChipViewModel({
        phase: 'downloading',
        version: '1.2.3',
        received: 25,
        total: 100,
      }),
    ).toEqual({
      kind: 'progress',
      text: 'Downloading… 25%',
      title: 'Downloading… 25%',
      progressKnown: true,
      progressPercent: 25,
    });
    expect(
      updateChipViewModel({
        phase: 'downloading',
        version: '1.2.3',
        received: 25,
        total: 0,
      }),
    ).toMatchObject({
      text: 'Downloading…',
      progressKnown: false,
      progressPercent: 0,
    });
  });

  it('keeps update errors actionable', () => {
    expect(updateChipViewModel({ phase: 'error', message: 'boom' })).toMatchObject({
      text: 'Update failed — Retry',
      tone: 'danger',
      action: 'check',
    });
  });
});
