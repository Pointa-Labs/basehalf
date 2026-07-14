import { describe, expect, it } from 'vitest';
import { defineBaseHalfPlugin, validateBaseHalfPluginManifest } from '../src/index.js';

const valid = {
  publisher: 'studio',
  name: 'storyboard',
  version: '1.0.0',
  displayName: 'Storyboard',
  description: 'A workflow surface.',
  license: 'Apache-2.0',
  engines: { vscode: '^1.128.0', basehalf: '^0.4.0' },
  main: './dist/extension.js',
  basehalf: {
    primaryCommand: 'studio.storyboard.createProject',
    primaryCommandLabel: 'Create Storyboard Project…',
  },
  contributes: {
    basehalfCardProjections: [
      {
        id: 'studio.storyboard.project',
        label: 'Storyboard',
        extensions: ['.storyboard'],
      },
    ],
    commands: [
      {
        command: 'studio.storyboard.createProject',
        title: 'Create Storyboard Project…',
      },
    ],
  },
} as const;

describe('BaseHalf plugin manifest contract', () => {
  it('preserves a valid literal manifest', () => {
    expect(defineBaseHalfPlugin(valid)).toBe(valid);
  });

  it('rejects proposed APIs and competing global surfaces', () => {
    expect(() => validateBaseHalfPluginManifest({ ...valid, enabledApiProposals: ['x'] })).toThrow(
      'cannot depend on proposed APIs',
    );
    expect(() =>
      validateBaseHalfPluginManifest({
        ...valid,
        contributes: { ...valid.contributes, viewsContainers: {} },
      }),
    ).toThrow('fixed application shell');
  });

  it('rejects invalid compatibility and missing BaseHalf projections', () => {
    expect(() =>
      validateBaseHalfPluginManifest({ ...valid, engines: { ...valid.engines, basehalf: 'nope' } }),
    ).toThrow('SemVer ranges');
    expect(() =>
      validateBaseHalfPluginManifest({
        ...valid,
        contributes: { commands: valid.contributes.commands },
      }),
    ).toThrow('at least one BaseHalf card projection');
  });
});
