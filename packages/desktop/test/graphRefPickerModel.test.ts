import { describe, expect, it } from 'vitest';
import {
  graphRefDisplayName,
  graphRefFilterFromPick,
  graphRefFilterLabel,
  graphRefPickOptions,
} from '../src/workbench/contrib/scm/browser/graphRefPickerModel.js';
import {
  historyLogArgsForAvailableFilter,
  historyLogArgsForFilter,
  historyRefExists,
} from '../src/workbench/contrib/scm/browser/historyGraphModel.js';
import type { GitRefInfo } from '../src/workbench/contrib/scm/common/git.js';

const branch = (name: string, props: Partial<GitRefInfo> = {}): GitRefInfo => ({
  id: `refs/heads/${name}`,
  name,
  type: 'head',
  current: false,
  ...props,
});

const remote = (name: string, props: Partial<GitRefInfo> = {}): GitRefInfo => ({
  id: `refs/remotes/${name}`,
  name,
  type: 'remoteHead',
  remote: name.split('/')[0],
  current: false,
  ...props,
});

const tag = (name: string, props: Partial<GitRefInfo> = {}): GitRefInfo => ({
  id: `refs/tags/${name}`,
  name,
  type: 'tag',
  current: false,
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
      'control:auto',
      'control:all',
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

  it('displays full ref ids using VS Code history item names', () => {
    expect(graphRefDisplayName('refs/heads/798')).toBe('798');
    expect(graphRefDisplayName('refs/remotes/origin/main')).toBe('origin/main');
    expect(graphRefDisplayName('refs/tags/v1')).toBe('v1');
    expect(graphRefFilterLabel({ kind: 'ref', ref: 'refs/heads/798' })).toBe('798');
    expect(graphRefFilterLabel({ kind: 'all' })).toBe('All');
    expect(graphRefFilterLabel({ kind: 'auto' })).toBe('Auto');
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
      all: true,
    });
    expect(
      historyLogArgsForFilter({ kind: 'ref', ref: 'refs/heads/feature/auth' }, 'main', 50, 10),
    ).toEqual({
      maxCount: 50,
      skip: 10,
      ref: 'refs/heads/feature/auth',
    });
  });

  it('falls back to HEAD when a picked full ref is no longer available', () => {
    const refs = [branch('main'), remote('origin/main'), tag('v1.0')];

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
        filter: { kind: 'ref', ref: 'refs/tags/v1.0' },
        refs,
        currentBranch: 'main',
        pageSize: 50,
        skip: 0,
      }),
    ).toEqual({ maxCount: 50, skip: 0, ref: 'refs/tags/v1.0' });
  });
});
