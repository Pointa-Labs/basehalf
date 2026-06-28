import { describe, expect, it } from 'vitest';
import {
  graphRefDisplayName,
  graphRefFilterFromPick,
  graphRefFilterLabel,
  graphRefNormalizeSelectedValues,
  graphRefPickOptions,
  graphRefSelectedValues,
} from '../src/workbench/contrib/scm/browser/graphRefPickerModel.js';
import {
  historyLogArgsForAvailableFilter,
  historyLogArgsForFilter,
  historyRefExists,
} from '../src/workbench/contrib/scm/browser/historyGraphModel.js';
import type { GitRefInfo } from '../src/workbench/contrib/scm/common/git.js';
import type { ScmHistoryItemRef } from '../src/workbench/contrib/scm/common/history.js';

const gitBranch = (name: string, props: Partial<GitRefInfo> = {}): GitRefInfo => ({
  id: `refs/heads/${name}`,
  name,
  type: 'head',
  current: false,
  ...props,
});

const gitRemote = (name: string, props: Partial<GitRefInfo> = {}): GitRefInfo => ({
  id: `refs/remotes/${name}`,
  name,
  type: 'remoteHead',
  remote: name.split('/')[0],
  current: false,
  ...props,
});

const gitTag = (name: string, props: Partial<GitRefInfo> = {}): GitRefInfo => ({
  id: `refs/tags/${name}`,
  name,
  type: 'tag',
  current: false,
  ...props,
});

const branch = (name: string, props: Partial<ScmHistoryItemRef> = {}): ScmHistoryItemRef => ({
  id: `refs/heads/${name}`,
  name,
  category: 'branch',
  ...props,
});

const remote = (name: string, props: Partial<ScmHistoryItemRef> = {}): ScmHistoryItemRef => ({
  id: `refs/remotes/${name}`,
  name,
  category: 'remote',
  ...props,
});

const tag = (name: string, props: Partial<ScmHistoryItemRef> = {}): ScmHistoryItemRef => ({
  id: `refs/tags/${name}`,
  name,
  category: 'tag',
  ...props,
});

describe('graphRefPickerModel', () => {
  it('keeps control picks separate from VS Code-style full ref ids', () => {
    const options = graphRefPickOptions([
      branch('auto'),
      branch('all'),
      branch('798'),
      branch('feature/auth'),
    ]);

    expect(options.map((option) => option.value)).toEqual([
      'control:all',
      'control:auto',
      'ref:refs/heads/auto',
      'ref:refs/heads/all',
      'ref:refs/heads/798',
      'ref:refs/heads/feature/auth',
    ]);
    expect(graphRefFilterFromPick('control:auto')).toEqual({ kind: 'auto' });
    expect(graphRefFilterFromPick('control:all')).toEqual({ kind: 'all' });
    expect(graphRefFilterFromPick('ref:refs/heads/auto')).toEqual({
      kind: 'ref',
      ref: 'refs/heads/auto',
    });
    expect(graphRefFilterFromPick('ref:refs/heads/all')).toEqual({
      kind: 'ref',
      ref: 'refs/heads/all',
    });
  });

  it('marks remote branch picks with VS Code-style secondary metadata', () => {
    expect(graphRefPickOptions([remote('origin/main')])[2]).toMatchObject({
      value: 'ref:refs/remotes/origin/main',
      label: 'origin/main',
      hint: 'remote',
      detail: 'Remote Branch',
    });
  });

  it('includes tag refs', () => {
    expect(graphRefPickOptions([tag('v1.0')])[2]).toMatchObject({
      value: 'ref:refs/tags/v1.0',
      label: 'v1.0',
      hint: 'tag',
      detail: 'Tag',
    });
  });

  it('promotes selected refs near All and Auto like VS Code history picker', () => {
    const options = graphRefPickOptions(
      [branch('main'), remote('origin/main'), tag('v1.0')],
      ['ref:refs/tags/v1.0'],
    );

    expect(options.map((option) => option.value)).toEqual([
      'control:all',
      'control:auto',
      'ref:refs/tags/v1.0',
      'ref:refs/heads/main',
      'ref:refs/remotes/origin/main',
    ]);
  });

  it('normalizes previously stored bare selected labels to full ref picker values', () => {
    const options = graphRefPickOptions(
      [branch('main'), branch('798'), remote('origin/798'), tag('v798')],
      ['ref:798', 'ref:origin/798'],
    );

    expect(options.map((option) => option.value)).toEqual([
      'control:all',
      'control:auto',
      'ref:refs/heads/798',
      'ref:refs/remotes/origin/798',
      'ref:refs/heads/main',
      'ref:refs/tags/v798',
    ]);
  });

  it('displays full ref ids using VS Code history item names', () => {
    expect(graphRefDisplayName('refs/heads/798')).toBe('798');
    expect(graphRefDisplayName('refs/remotes/origin/main')).toBe('origin/main');
    expect(graphRefDisplayName('refs/tags/v1')).toBe('v1');
    expect(graphRefFilterLabel({ kind: 'ref', ref: 'refs/heads/798' })).toBe('798');
    expect(graphRefFilterLabel({ kind: 'all' })).toBe('All');
    expect(graphRefFilterLabel({ kind: 'auto' })).toBe('Auto');
  });

  it('supports VS Code-style multiple history item refs', () => {
    const filter = graphRefFilterFromPick(['ref:refs/heads/main', 'ref:refs/tags/v1']);

    expect(filter).toEqual({ kind: 'refs', refs: ['refs/heads/main', 'refs/tags/v1'] });
    expect(graphRefSelectedValues(filter ?? { kind: 'auto' })).toEqual([
      'ref:refs/heads/main',
      'ref:refs/tags/v1',
    ]);
    expect(graphRefFilterLabel(filter ?? { kind: 'auto' })).toBe('2 Items');
  });

  it('keeps All and Auto exclusive when multi-selecting refs', () => {
    expect(
      graphRefNormalizeSelectedValues({
        previousValues: ['control:auto'],
        nextValues: ['control:auto', 'ref:refs/heads/main'],
        addedValue: 'ref:refs/heads/main',
      }),
    ).toEqual(['ref:refs/heads/main']);
    expect(
      graphRefNormalizeSelectedValues({
        previousValues: ['ref:refs/heads/main', 'ref:refs/tags/v1'],
        nextValues: ['ref:refs/heads/main', 'ref:refs/tags/v1', 'control:all'],
        addedValue: 'control:all',
      }),
    ).toEqual(['control:all']);
  });

  it('maps Auto to HEAD and All to the full graph', () => {
    expect(historyLogArgsForFilter({ kind: 'auto' }, '798', 50, 10)).toEqual({
      maxCount: 50,
      skip: 10,
      ref: 'HEAD',
    });
    expect(historyLogArgsForFilter({ kind: 'auto' }, null, 50, 10)).toEqual({
      maxCount: 50,
      skip: 10,
      ref: 'HEAD',
    });
    expect(historyLogArgsForFilter({ kind: 'all' }, 'main', 50, 10)).toEqual({
      maxCount: 50,
      skip: 10,
      ref: 'HEAD',
    });
    expect(
      historyLogArgsForFilter({ kind: 'ref', ref: 'refs/heads/feature/auth' }, 'main', 50, 10),
    ).toEqual({
      maxCount: 50,
      skip: 10,
      ref: 'refs/heads/feature/auth',
    });
    expect(
      historyLogArgsForFilter(
        { kind: 'refs', refs: ['refs/heads/main', 'refs/tags/v1.0'] },
        'main',
        50,
        10,
      ),
    ).toEqual({
      maxCount: 50,
      skip: 10,
      refNames: ['refs/heads/main', 'refs/tags/v1.0'],
    });
  });

  it('falls back to HEAD when a picked full ref is no longer available', () => {
    const refs = [gitBranch('main'), gitRemote('origin/main'), gitTag('v1.0')];

    expect(historyRefExists({ kind: 'ref', ref: 'refs/remotes/origin/main' }, refs)).toBe(true);
    expect(historyRefExists({ kind: 'ref', ref: 'refs/heads/deleted' }, refs)).toBe(false);
    expect(
      historyLogArgsForAvailableFilter({
        filter: { kind: 'ref', ref: 'refs/heads/deleted' },
        refs,
        currentBranch: 'main',
        pageSize: 50,
        skip: 0,
      }),
    ).toEqual({ maxCount: 50, skip: 0, ref: 'HEAD' });
    expect(
      historyLogArgsForAvailableFilter({
        filter: { kind: 'all' },
        refs,
        currentBranch: 'main',
        pageSize: 50,
        skip: 0,
      }),
    ).toEqual({
      maxCount: 50,
      skip: 0,
      refNames: ['refs/heads/main', 'refs/remotes/origin/main', 'refs/tags/v1.0'],
    });
    expect(
      historyLogArgsForAvailableFilter({
        filter: { kind: 'refs', refs: ['refs/tags/v1.0', 'refs/heads/deleted'] },
        refs,
        currentBranch: 'main',
        pageSize: 50,
        skip: 0,
      }),
    ).toEqual({ maxCount: 50, skip: 0, ref: 'refs/tags/v1.0' });
  });
});
