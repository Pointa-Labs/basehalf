import { describe, expect, it } from 'vitest';
import { defineBaseHalfPlugin, validateBaseHalfPluginManifest } from '../src/index.js';

const valid = {
  publisher: 'studio',
  name: 'storyboard',
  version: '1.0.0',
  displayName: 'Storyboard',
  description: 'A workflow surface.',
  license: 'Apache-2.0',
  repository: 'https://github.com/studio/storyboard',
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
        extensions: ['.story-board'],
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

const recipeValid = {
  ...valid,
  basehalf: {
    primaryCommand: 'studio.storyboard.createFromTemplate',
    primaryCommandLabel: 'Create Storyboard from Template…',
  },
  contributes: {
    basehalfCanvasRecipes: [
      {
        id: 'studio.storyboard.create-document',
        label: 'Create document',
        inputs: [
          {
            id: 'prompt',
            label: 'Prompt',
            accepts: ['text', 'code'],
            minItems: 1,
            maxItems: 4,
          },
        ],
        parameters: [
          {
            id: 'tone',
            label: 'Tone',
            type: 'enum',
            default: 'plain',
            options: [{ value: 'plain', label: 'Plain' }],
          },
        ],
        outputs: [
          {
            id: 'document',
            kind: 'file',
            extensions: ['.md'],
            minItems: 1,
            maxItems: 1,
            primary: true,
          },
        ],
      },
    ],
    basehalfCanvasTemplates: [
      {
        id: 'studio.storyboard.starter',
        label: 'Starter',
        resource: 'templates/starter.json',
      },
    ],
    commands: [
      {
        command: 'studio.storyboard.createFromTemplate',
        title: 'Create Storyboard from Template…',
      },
    ],
  },
} as const;

const agentCapabilityValid = {
  ...valid,
  contributes: {
    commands: [
      ...valid.contributes.commands,
      { command: 'studio.storyboard.inspectSequence', title: 'Inspect Sequence' },
    ],
    basehalfAgentCapabilities: [
      {
        id: 'studio.storyboard.sequence-capability',
        label: 'Sequence',
        documents: [
          {
            kind: 'studio.storyboard.sequence',
            version: 1,
            fileExtensions: ['.json'],
            schemaSummary: 'A versioned root object with ordered result-node identities.',
          },
        ],
        operations: [
          {
            id: 'studio.storyboard.sequence-inspect',
            command: 'studio.storyboard.inspectSequence',
            description: 'Inspect result-node identities without modifying the document.',
            deterministic: true,
            parameters: [
              {
                name: 'sequence',
                type: 'uri',
                required: true,
                description: 'Sequence URI.',
              },
            ],
            returns: { type: 'object', description: 'Per-item state.' },
          },
        ],
      },
    ],
  },
} as const;

describe('BaseHalf plugin manifest contract', () => {
  it('preserves a valid literal manifest', () => {
    expect(defineBaseHalfPlugin(valid)).toBe(valid);
    expect(defineBaseHalfPlugin(recipeValid)).toBe(recipeValid);
    expect(defineBaseHalfPlugin(agentCapabilityValid)).toBe(agentCapabilityValid);
  });

  it('requires one canonical manifest version identity', () => {
    expect(() =>
      validateBaseHalfPluginManifest({ ...valid, version: '1.0.0-beta.1' }),
    ).not.toThrow();
    for (const version of ['v1.0.0', ' 1.0.0 ', '1.0.0+build.1']) {
      expect(() => validateBaseHalfPluginManifest({ ...valid, version })).toThrow(
        'canonical SemVer without build metadata',
      );
    }
  });

  it('uses the host projection suffix contract and permits the fixed icon fallback', () => {
    expect(() => validateBaseHalfPluginManifest(valid)).not.toThrow();
    expect(() =>
      validateBaseHalfPluginManifest({
        ...valid,
        contributes: {
          ...valid.contributes,
          basehalfCardProjections: [
            {
              ...valid.contributes.basehalfCardProjections[0],
              extensions: ['.story.board'],
            },
          ],
        },
      }),
    ).not.toThrow();
    expect(() =>
      validateBaseHalfPluginManifest({
        ...valid,
        contributes: {
          ...valid.contributes,
          basehalfCardProjections: [
            {
              id: 'studio.storyboard.sequence',
              label: 'Sequence',
              fileNames: ['your-plugin-sequence.json'],
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it('accepts standalone recipe, template, and structural-cleanup manifests', () => {
    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          basehalfCanvasRecipes: recipeValid.contributes.basehalfCanvasRecipes,
          commands: recipeValid.contributes.commands,
        },
      }),
    ).not.toThrow();
    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          basehalfCanvasTemplates: recipeValid.contributes.basehalfCanvasTemplates,
          commands: recipeValid.contributes.commands,
        },
      }),
    ).not.toThrow();
    expect(() =>
      validateBaseHalfPluginManifest({
        ...valid,
        activationEvents: ['onBaseHalfStructuralCleanup:studio.storyboard.result-references'],
        contributes: {
          basehalfStructuralCleanups: [
            {
              id: 'studio.storyboard.result-references',
              extensions: ['.bhnode'],
            },
          ],
          commands: valid.contributes.commands,
        },
      }),
    ).not.toThrow();
  });

  it('validates Agent capability ownership and declared commands while rejecting version pins', () => {
    expect(() => validateBaseHalfPluginManifest(agentCapabilityValid)).not.toThrow();
    expect(() =>
      validateBaseHalfPluginManifest({
        ...agentCapabilityValid,
        contributes: {
          ...agentCapabilityValid.contributes,
          basehalfAgentCapabilities: [
            {
              ...agentCapabilityValid.contributes.basehalfAgentCapabilities[0],
              operations: [
                {
                  ...agentCapabilityValid.contributes.basehalfAgentCapabilities[0].operations[0],
                  command: 'studio.storyboard.notDeclared',
                },
              ],
            },
          ],
        },
      }),
    ).toThrow('owned declared command');
    expect(() =>
      validateBaseHalfPluginManifest({
        ...agentCapabilityValid,
        contributes: {
          ...agentCapabilityValid.contributes,
          basehalfAgentCapabilities: [
            {
              ...agentCapabilityValid.contributes.basehalfAgentCapabilities[0],
              documents: [
                {
                  ...agentCapabilityValid.contributes.basehalfAgentCapabilities[0].documents[0],
                  pin: { mode: 'exact-result-version' },
                },
              ],
            },
          ],
        },
      }),
    ).toThrow('unsupported fields');
    expect(() =>
      validateBaseHalfPluginManifest({
        ...agentCapabilityValid,
        contributes: {
          ...agentCapabilityValid.contributes,
          basehalfAgentCapabilities: [
            agentCapabilityValid.contributes.basehalfAgentCapabilities[0],
            {
              ...agentCapabilityValid.contributes.basehalfAgentCapabilities[0],
              id: 'studio.storyboard.review-capability',
              documents: [],
            },
          ],
        },
      }),
    ).toThrow("Agent operation 'studio.storyboard.sequence-inspect' is declared more than once");
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
    expect(() => validateBaseHalfPluginManifest({ ...valid, extensionDependencies: [] })).toThrow(
      'cannot declare extensionDependencies',
    );
    expect(() => validateBaseHalfPluginManifest({ ...valid, extensionPack: [] })).toThrow(
      'cannot declare extensionPack',
    );
    expect(() =>
      validateBaseHalfPluginManifest({
        ...valid,
        contributes: { ...valid.contributes, menus: {} },
      }),
    ).toThrow('fixed application shell');
  });

  it('rejects identity casing, malformed commands, and detached activation events', () => {
    expect(() => validateBaseHalfPluginManifest({ ...valid, publisher: 'Studio' })).toThrow(
      'identity',
    );
    expect(() =>
      validateBaseHalfPluginManifest({
        ...valid,
        contributes: {
          ...valid.contributes,
          commands: [{ command: 'other.plugin.run', title: 'Run' }],
        },
      }),
    ).toThrow('not owned');
    expect(() =>
      validateBaseHalfPluginManifest({ ...valid, activationEvents: ['onStartupFinished'] }),
    ).toThrow('not tied to a declared contribution');
    expect(() =>
      validateBaseHalfPluginManifest({
        ...valid,
        activationEvents: ['onCommand:studio.storyboard.createProject'],
      }),
    ).not.toThrow();
    expect(() =>
      validateBaseHalfPluginManifest({
        ...valid,
        activationEvents: ['onBaseHalfCardProjection:Studio.storyboard.project'],
      }),
    ).toThrow('not tied to a declared contribution');
  });

  it('rejects invalid compatibility and missing BaseHalf contributions', () => {
    expect(() =>
      validateBaseHalfPluginManifest({ ...valid, engines: { ...valid.engines, basehalf: 'nope' } }),
    ).toThrow('SemVer ranges');
    expect(() =>
      validateBaseHalfPluginManifest({
        ...valid,
        contributes: { commands: valid.contributes.commands },
      }),
    ).toThrow(
      'Agent capability, card projection, canvas recipe, canvas template, model provider catalog, video model catalog, or structural cleanup',
    );
  });

  it('validates recipe ownership, ranges, primary output, and template resources', () => {
    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          ...recipeValid.contributes,
          basehalfCanvasRecipes: [
            {
              ...recipeValid.contributes.basehalfCanvasRecipes[0],
              id: 'another.plugin.create-document',
            },
          ],
        },
      }),
    ).toThrow("must start with 'studio.storyboard.'");

    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          ...recipeValid.contributes,
          basehalfCanvasRecipes: [
            {
              ...recipeValid.contributes.basehalfCanvasRecipes[0],
              inputs: [
                {
                  ...recipeValid.contributes.basehalfCanvasRecipes[0].inputs[0],
                  minItems: 5,
                  maxItems: 4,
                },
              ],
            },
          ],
        },
      }),
    ).toThrow('invalid item range');

    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          ...recipeValid.contributes,
          basehalfCanvasRecipes: [
            {
              ...recipeValid.contributes.basehalfCanvasRecipes[0],
              outputs: [
                {
                  ...recipeValid.contributes.basehalfCanvasRecipes[0].outputs[0],
                  primary: false,
                },
              ],
            },
          ],
        },
      }),
    ).toThrow('exactly one primary output');

    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          ...recipeValid.contributes,
          basehalfCanvasRecipes: [
            {
              ...recipeValid.contributes.basehalfCanvasRecipes[0],
              outputs: [
                {
                  ...recipeValid.contributes.basehalfCanvasRecipes[0].outputs[0],
                  maxItems: 2,
                },
              ],
            },
          ],
        },
      }),
    ).toThrow('primary output must produce exactly one artifact');

    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          ...recipeValid.contributes,
          basehalfCanvasTemplates: [
            {
              ...recipeValid.contributes.basehalfCanvasTemplates[0],
              resource: '../starter.json',
            },
          ],
        },
      }),
    ).toThrow('canonical relative JSON path');
  });

  it('accepts only owned resource envelopes for model provider catalogs', () => {
    const contribution = {
      id: 'studio.storyboard.official-providers',
      resource: 'models/provider-connections.json',
    } as const;
    const manifest = {
      ...valid,
      contributes: {
        ...valid.contributes,
        basehalfModelProviderCatalogs: [contribution],
      },
    } as const;
    expect(() => validateBaseHalfPluginManifest(manifest)).not.toThrow();

    expect(() =>
      validateBaseHalfPluginManifest({
        ...manifest,
        contributes: {
          ...manifest.contributes,
          basehalfModelProviderCatalogs: [
            { ...contribution, id: 'another.plugin.official-providers' },
          ],
        },
      }),
    ).toThrow("must start with 'studio.storyboard.'");
    expect(() =>
      validateBaseHalfPluginManifest({
        ...manifest,
        contributes: {
          ...manifest.contributes,
          basehalfModelProviderCatalogs: [
            { ...contribution, resource: '../provider-connections.json' },
          ],
        },
      }),
    ).toThrow('canonical relative JSON path');
    expect(() =>
      validateBaseHalfPluginManifest({
        ...manifest,
        contributes: {
          ...manifest.contributes,
          basehalfModelProviderCatalogs: [{ ...contribution, connections: [] }],
        },
      }),
    ).toThrow('unsupported fields: connections');
    expect(() =>
      validateBaseHalfPluginManifest({
        ...manifest,
        contributes: {
          ...manifest.contributes,
          basehalfModelProviderCatalogs: [contribution, contribution],
        },
      }),
    ).toThrow('declared more than once');
  });

  it('requires every video recipe to bind one declared owner catalog', () => {
    const catalogId = 'studio.storyboard.video-models';
    const videoRecipe = {
      ...recipeValid.contributes.basehalfCanvasRecipes[0],
      modelCapability: 'video',
      videoModelCatalogId: catalogId,
      parameters: [],
      outputs: [
        {
          ...recipeValid.contributes.basehalfCanvasRecipes[0].outputs[0],
          kind: 'video',
          extensions: ['.mp4'],
        },
      ],
    } as const;
    const videoManifest = {
      ...recipeValid,
      contributes: {
        ...recipeValid.contributes,
        basehalfCanvasRecipes: [videoRecipe],
        basehalfVideoModelCatalogs: [{ id: catalogId, resource: 'models/video-models.json' }],
      },
    } as const;
    expect(() => validateBaseHalfPluginManifest(videoManifest)).not.toThrow();

    const { videoModelCatalogId: _missing, ...withoutCatalog } = videoRecipe;
    expect(() =>
      validateBaseHalfPluginManifest({
        ...videoManifest,
        contributes: { ...videoManifest.contributes, basehalfCanvasRecipes: [withoutCatalog] },
      }),
    ).toThrow(/video model catalog/);

    expect(() =>
      validateBaseHalfPluginManifest({
        ...videoManifest,
        contributes: {
          ...videoManifest.contributes,
          basehalfCanvasRecipes: [
            { ...videoRecipe, videoModelCatalogId: 'another.plugin.video-models' },
          ],
        },
      }),
    ).toThrow("must start with 'studio.storyboard.'");

    expect(() =>
      validateBaseHalfPluginManifest({
        ...videoManifest,
        contributes: {
          ...videoManifest.contributes,
          basehalfCanvasRecipes: [
            { ...videoRecipe, videoModelCatalogId: 'studio.storyboard.missing-models' },
          ],
        },
      }),
    ).toThrow(/references undeclared video model catalog/);

    expect(() =>
      validateBaseHalfPluginManifest({
        ...videoManifest,
        contributes: {
          ...videoManifest.contributes,
          basehalfCanvasRecipes: [
            {
              ...recipeValid.contributes.basehalfCanvasRecipes[0],
              videoModelCatalogId: catalogId,
            },
          ],
        },
      }),
    ).toThrow(/cannot declare a video model catalog/);

    expect(() =>
      validateBaseHalfPluginManifest({
        ...videoManifest,
        contributes: {
          ...videoManifest.contributes,
          basehalfCanvasRecipes: [
            {
              ...videoRecipe,
              outputs: [{ ...videoRecipe.outputs[0], kind: 'image', extensions: ['.png'] }],
            },
          ],
        },
      }),
    ).toThrow(/must produce a video Result/);

    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          ...recipeValid.contributes,
          basehalfCanvasRecipes: [
            {
              ...recipeValid.contributes.basehalfCanvasRecipes[0],
              modelCapability: 'image',
              outputs: [
                {
                  ...recipeValid.contributes.basehalfCanvasRecipes[0].outputs[0],
                  kind: 'video',
                  extensions: ['.mp4'],
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(/Local video recipe.*must omit model capability/);
  });

  it('rejects invalid parameter declarations and undeclared recipe fields', () => {
    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          ...recipeValid.contributes,
          basehalfCanvasRecipes: [
            {
              ...recipeValid.contributes.basehalfCanvasRecipes[0],
              parameters: [
                {
                  id: 'title',
                  label: 'Title',
                  type: 'string',
                  required: true,
                  default: '   ',
                },
              ],
            },
          ],
        },
      }),
    ).toThrow('blank default');

    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          ...recipeValid.contributes,
          basehalfCanvasRecipes: [
            {
              ...recipeValid.contributes.basehalfCanvasRecipes[0],
              parameters: [
                {
                  id: 'tone',
                  label: 'Tone',
                  type: 'enum',
                  default: 'missing',
                  options: [{ value: 'plain', label: 'Plain' }],
                },
              ],
            },
          ],
        },
      }),
    ).toThrow('default is not an enum option');

    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          ...recipeValid.contributes,
          basehalfCanvasRecipes: [
            {
              ...recipeValid.contributes.basehalfCanvasRecipes[0],
              webview: true,
            },
          ],
        },
      }),
    ).toThrow('unsupported fields');
  });

  it('rejects non-canonical template contribution identifiers', () => {
    const ids = [
      'Studio.storyboard.starter',
      ' studio.storyboard.starter',
      'studio.storyboard.starter ',
      '1studio.storyboard.starter',
      'studio.2storyboard.starter',
      'studio.storyboard.starter_name',
      `studio.storyboard.${'a'.repeat(111)}`,
    ];
    for (const id of ids) {
      expect(() =>
        validateBaseHalfPluginManifest({
          ...recipeValid,
          contributes: {
            ...recipeValid.contributes,
            basehalfCanvasTemplates: [
              { ...recipeValid.contributes.basehalfCanvasTemplates[0], id },
            ],
          },
        }),
      ).toThrow(/Canvas template/);
    }
  });

  it('rejects duplicate local ids and non-result outputs', () => {
    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          ...recipeValid.contributes,
          basehalfCanvasRecipes: [
            {
              ...recipeValid.contributes.basehalfCanvasRecipes[0],
              inputs: [
                recipeValid.contributes.basehalfCanvasRecipes[0].inputs[0],
                recipeValid.contributes.basehalfCanvasRecipes[0].inputs[0],
              ],
            },
          ],
        },
      }),
    ).toThrow('duplicate');

    for (const kind of ['folder', 'text', 'code']) {
      expect(() =>
        validateBaseHalfPluginManifest({
          ...recipeValid,
          contributes: {
            ...recipeValid.contributes,
            basehalfCanvasRecipes: [
              {
                ...recipeValid.contributes.basehalfCanvasRecipes[0],
                outputs: [
                  {
                    ...recipeValid.contributes.basehalfCanvasRecipes[0].outputs[0],
                    kind,
                  },
                ],
              },
            ],
          },
        }),
      ).toThrow('invalid content kind');
    }
  });

  it('caps total recipe bindings and requires one output per Result node', () => {
    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          ...recipeValid.contributes,
          basehalfCanvasRecipes: [
            {
              ...recipeValid.contributes.basehalfCanvasRecipes[0],
              inputs: [
                { id: 'first', label: 'First', accepts: ['text'], minItems: 0, maxItems: 40 },
                { id: 'second', label: 'Second', accepts: ['text'], minItems: 0, maxItems: 40 },
              ],
            },
          ],
        },
      }),
    ).toThrow('no more than 64 inputs in total');

    expect(() =>
      validateBaseHalfPluginManifest({
        ...recipeValid,
        contributes: {
          ...recipeValid.contributes,
          basehalfCanvasRecipes: [
            {
              ...recipeValid.contributes.basehalfCanvasRecipes[0],
              outputs: [
                recipeValid.contributes.basehalfCanvasRecipes[0].outputs[0],
                {
                  id: 'alternates',
                  kind: 'file',
                  extensions: ['.md'],
                  minItems: 0,
                  maxItems: 64,
                },
              ],
            },
          ],
        },
      }),
    ).toThrow('exactly one output for one Result node');
  });

  it('accepts only bounded settings owned by the plugin namespace', () => {
    expect(() =>
      validateBaseHalfPluginManifest({
        ...valid,
        contributes: {
          ...valid.contributes,
          configuration: {
            title: 'Storyboard',
            properties: {
              'studio.storyboard.outputDirectory': {
                type: 'string',
                default: 'outputs',
              },
            },
          },
        },
      }),
    ).not.toThrow();
    expect(() =>
      validateBaseHalfPluginManifest({
        ...valid,
        contributes: {
          ...valid.contributes,
          configuration: {
            properties: {
              'other.plugin.apiKey': { type: 'string' },
            },
          },
        },
      }),
    ).toThrow("outside 'studio.storyboard'");
  });

  it('requires an HTTPS source disclosure URL', () => {
    expect(() => validateBaseHalfPluginManifest({ ...valid, repository: undefined })).toThrow(
      'absolute HTTPS URL',
    );
    expect(() =>
      validateBaseHalfPluginManifest({ ...valid, repository: 'file:///tmp/storyboard' }),
    ).toThrow('absolute HTTPS URL');
  });
});
