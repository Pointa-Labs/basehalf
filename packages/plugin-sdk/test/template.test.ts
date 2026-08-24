import { describe, expect, it } from 'vitest';
import {
  defineBaseHalfCanvasTemplate,
  parseBaseHalfCanvasTemplate,
  validateBaseHalfCanvasTemplate,
  validateBaseHalfCanvasTemplateAgainstManifest,
} from '../src/index.js';

const validTemplate = {
  version: 1,
  files: [{ path: 'brief.md', contents: '# Brief\n' }],
  nodes: [
    {
      path: 'result.bhnode',
      kind: 'file',
      title: 'Result',
      role: 'result',
      prompt: 'Write a concise result.',
      recipe: {
        recipeId: 'studio.writer.create-document',
        parameters: { heading: 'Result' },
        inputBindings: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }],
      },
    },
  ],
  cards: [
    { path: 'brief.md', x: 0, y: 0, width: 320, height: 200 },
    { path: 'result.bhnode', x: 400, y: 0, width: 320, height: 200 },
  ],
  references: [
    {
      from: 'brief.md',
      to: 'result.bhnode',
      fromAnchor: 'east',
      toAnchor: 'west',
    },
  ],
} as const;

const manifest = {
  publisher: 'studio',
  name: 'writer',
  version: '1.0.0',
  displayName: 'Writer',
  description: 'Document recipes.',
  license: 'Apache-2.0',
  repository: 'https://example.com/studio/writer',
  engines: { vscode: '^1.128.0', basehalf: '^0.4.0' },
  main: './out/extension.js',
  basehalf: {
    primaryCommand: 'studio.writer.createFromTemplate',
    primaryCommandLabel: 'Create from Template…',
  },
  contributes: {
    commands: [{ command: 'studio.writer.createFromTemplate', title: 'Create from Template…' }],
    basehalfCanvasRecipes: [
      {
        id: 'studio.writer.create-document',
        label: 'Create document',
        inputs: [{ id: 'prompt', label: 'Prompt', accepts: ['text'], minItems: 1, maxItems: 1 }],
        parameters: [
          { id: 'heading', label: 'Heading', type: 'string', required: true, maxLength: 80 },
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
  },
} as const;

const nonCanonicalContributionIds = [
  'Studio.writer.create-document',
  ' studio.writer.create-document',
  'studio.writer.create-document ',
  '1studio.writer.create-document',
  'studio.2writer.create-document',
  'studio.writer.create_document',
  `studio.writer.${'a'.repeat(115)}`,
] as const;

describe('canvas template v1 contract', () => {
  it('preserves a valid literal and returns a normalized frozen parse', () => {
    expect(defineBaseHalfCanvasTemplate(validTemplate)).toBe(validTemplate);
    expect(() => validateBaseHalfCanvasTemplate(validTemplate)).not.toThrow();

    const parsed = parseBaseHalfCanvasTemplate(`\ufeff${JSON.stringify(validTemplate)}`);
    expect(parsed).toEqual(validTemplate);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.nodes)).toBe(true);
    expect(Object.isFrozen(parsed.nodes[0]?.recipe?.inputBindings)).toBe(true);
  });

  it('rejects unknown fields, unsupported versions, kinds, and identifiers', () => {
    expect(() =>
      parseBaseHalfCanvasTemplate(JSON.stringify({ ...validTemplate, privateState: {} })),
    ).toThrow('unsupported property');
    expect(() =>
      parseBaseHalfCanvasTemplate(JSON.stringify({ ...validTemplate, version: 2 })),
    ).toThrow('Unsupported canvas template version');
    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          nodes: [{ ...validTemplate.nodes[0], kind: 'folder' }],
        }),
      ),
    ).toThrow('supported executable result kind');
    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          nodes: [
            {
              ...validTemplate.nodes[0],
              recipe: { ...validTemplate.nodes[0].recipe, recipeId: 'not-valid' },
            },
          ],
        }),
      ),
    ).toThrow('not a valid contribution identifier');
    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          nodes: [
            {
              ...validTemplate.nodes[0],
              recipe: {
                ...validTemplate.nodes[0].recipe,
                recipeId: 'Studio.writer.create-document',
              },
            },
          ],
        }),
      ),
    ).toThrow('not a valid contribution identifier');
  });

  it('accepts only canonical contribution identifiers', () => {
    for (const recipeId of nonCanonicalContributionIds) {
      expect(() =>
        parseBaseHalfCanvasTemplate(
          JSON.stringify({
            ...validTemplate,
            nodes: [
              {
                ...validTemplate.nodes[0],
                recipe: { ...validTemplate.nodes[0].recipe, recipeId },
              },
            ],
          }),
        ),
      ).toThrow('not a valid contribution identifier');
    }
  });

  it('accepts only host-owned executable result kinds', () => {
    for (const kind of ['file', 'image', 'video', 'audio', 'pdf', 'presentation'] as const) {
      const parsed = parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          nodes: [{ ...validTemplate.nodes[0], kind, recipe: undefined }],
          references: [],
        }),
      );
      expect(parsed.nodes[0]?.kind).toBe(kind);
    }
    for (const kind of ['text', 'code']) {
      expect(() =>
        parseBaseHalfCanvasTemplate(
          JSON.stringify({
            ...validTemplate,
            nodes: [{ ...validTemplate.nodes[0], kind, recipe: undefined }],
            references: [],
          }),
        ),
      ).toThrow('supported executable result kind');
    }
  });

  it('rejects reserved, escaping, duplicated, and forged project paths', () => {
    for (const path of ['../brief.md', '/brief.md', 'folder\\brief.md', '.BH/private.md']) {
      expect(() =>
        parseBaseHalfCanvasTemplate(
          JSON.stringify({ ...validTemplate, files: [{ path, contents: '' }] }),
        ),
      ).toThrow();
    }
    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({ ...validTemplate, files: [{ path: 'fake.BHNODE', contents: '' }] }),
      ),
    ).toThrow('reserved .bhnode');
    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          files: [validTemplate.files[0], validTemplate.files[0]],
        }),
      ),
    ).toThrow('must not contain duplicates');
  });

  it('requires cards, references, and bindings to describe created direct resources', () => {
    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          cards: [{ ...validTemplate.cards[0], path: 'missing.md' }],
        }),
      ),
    ).toThrow('does not have a matching file or node');
    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          references: [{ ...validTemplate.references[0], from: 'missing.md' }],
        }),
      ),
    ).toThrow('must connect created resources');
    expect(() =>
      parseBaseHalfCanvasTemplate(JSON.stringify({ ...validTemplate, references: [] })),
    ).toThrow('without a matching direct reference');
    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          nodes: [
            {
              ...validTemplate.nodes[0],
              recipe: {
                ...validTemplate.nodes[0].recipe,
                inputBindings: [
                  validTemplate.nodes[0].recipe.inputBindings[0],
                  {
                    ...validTemplate.nodes[0].recipe.inputBindings[0],
                    sourcePath: 'result.bhnode',
                  },
                ],
              },
            },
          ],
        }),
      ),
    ).toThrow('binding order');

    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          nodes: [
            {
              ...validTemplate.nodes[0],
              recipe: {
                ...validTemplate.nodes[0].recipe,
                inputBindings: [{ ...validTemplate.nodes[0].recipe.inputBindings[0], order: 1 }],
              },
            },
          ],
        }),
      ),
    ).toThrow('binding order must be contiguous from zero');
  });

  it('enforces source size and JSON parameter complexity limits', () => {
    expect(() => parseBaseHalfCanvasTemplate(' '.repeat(512 * 1024 + 1))).toThrow('no larger than');
    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          files: [{ path: 'brief.md', contents: '中'.repeat(100_000) }],
        }),
      ),
    ).toThrow('contents exceeds');
    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          nodes: [
            {
              ...validTemplate.nodes[0],
              recipe: {
                ...validTemplate.nodes[0].recipe,
                parameters: Object.fromEntries(
                  Array.from({ length: 129 }, (_, index) => [`parameter-${index}`, index]),
                ),
              },
            },
          ],
        }),
      ),
    ).toThrow('parameter complexity limit');
  });

  it('counts parameter object keys and scalar values with the host complexity budget', () => {
    const withScalarParameters = (count: number) => ({
      ...validTemplate,
      nodes: [
        {
          ...validTemplate.nodes[0],
          recipe: {
            ...validTemplate.nodes[0].recipe,
            parameters: Object.fromEntries(
              Array.from({ length: count }, (_, index) => [`parameter-${index}`, index]),
            ),
          },
        },
      ],
    });

    expect(() =>
      parseBaseHalfCanvasTemplate(JSON.stringify(withScalarParameters(64))),
    ).not.toThrow();
    expect(() => parseBaseHalfCanvasTemplate(JSON.stringify(withScalarParameters(65)))).toThrow(
      'parameter complexity limit',
    );
  });

  it('validates recipes, parameters, output kinds, slots, counts, and direct references together', () => {
    const complete = {
      ...validTemplate,
      nodes: [
        {
          ...validTemplate.nodes[0],
          recipe: { ...validTemplate.nodes[0].recipe, parameters: { heading: 'Result' } },
        },
      ],
    };
    expect(() => validateBaseHalfCanvasTemplateAgainstManifest(complete, manifest)).not.toThrow();

    expect(() =>
      validateBaseHalfCanvasTemplateAgainstManifest(
        {
          ...complete,
          nodes: [
            {
              ...complete.nodes[0],
              recipe: { ...complete.nodes[0].recipe, recipeId: 'studio.writer.missing' },
            },
          ],
        },
        manifest,
      ),
    ).toThrow('uses undeclared recipe');
    expect(() =>
      validateBaseHalfCanvasTemplateAgainstManifest(
        { ...complete, nodes: [{ ...complete.nodes[0], kind: 'image' }] },
        manifest,
      ),
    ).toThrow('primary output kind');
    expect(() =>
      validateBaseHalfCanvasTemplateAgainstManifest(
        {
          ...complete,
          nodes: [
            {
              ...complete.nodes[0],
              recipe: { ...complete.nodes[0].recipe, parameters: { heading: 12 } },
            },
          ],
        },
        manifest,
      ),
    ).toThrow("parameter 'heading' is invalid");
    expect(() =>
      validateBaseHalfCanvasTemplateAgainstManifest(
        {
          ...complete,
          nodes: [
            {
              ...complete.nodes[0],
              recipe: { ...complete.nodes[0].recipe, parameters: { heading: '   ' } },
            },
          ],
        },
        manifest,
      ),
    ).toThrow("parameter 'heading' is invalid");
    expect(() =>
      validateBaseHalfCanvasTemplateAgainstManifest(
        {
          ...complete,
          nodes: [
            {
              ...complete.nodes[0],
              recipe: {
                ...complete.nodes[0].recipe,
                inputBindings: [{ ...complete.nodes[0].recipe.inputBindings[0], slot: 'missing' }],
              },
            },
          ],
        },
        manifest,
      ),
    ).toThrow('invalid input binding');
    expect(() =>
      validateBaseHalfCanvasTemplateAgainstManifest(
        {
          ...complete,
          nodes: [
            {
              ...complete.nodes[0],
              recipe: { ...complete.nodes[0].recipe, inputBindings: [] },
            },
          ],
        },
        manifest,
      ),
    ).toThrow("0 inputs for 'prompt'");
  });

  it('allows direct context to remain unassigned until the target recipe is configured', () => {
    const template = {
      ...validTemplate,
      files: [...validTemplate.files, { path: 'extra.md', contents: '# Extra\n' }],
      nodes: [
        {
          ...validTemplate.nodes[0],
          recipe: { ...validTemplate.nodes[0].recipe, parameters: { heading: 'Result' } },
        },
      ],
      references: [
        ...validTemplate.references,
        {
          from: 'extra.md',
          to: 'result.bhnode',
          fromAnchor: 'east',
          toAnchor: 'west',
        },
      ],
    };
    expect(() => validateBaseHalfCanvasTemplateAgainstManifest(template, manifest)).not.toThrow();
  });

  it('rejects paths that are ambiguous or reserved on supported platforms', () => {
    for (const path of [
      'nested/.BH/private.md',
      'folder/CON.txt',
      'folder/trailing. ',
      'folder/e\u0301.md',
      'folder/\u0085name.md',
      'folder/name?.md',
    ]) {
      expect(() =>
        parseBaseHalfCanvasTemplate(
          JSON.stringify({ ...validTemplate, files: [{ path, contents: '' }] }),
        ),
      ).toThrow();
    }
  });

  it('rejects resource-prefix conflicts and repeated binding sources', () => {
    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          files: [
            { path: 'assets', contents: '' },
            { path: 'assets/reference.md', contents: '' },
          ],
        }),
      ),
    ).toThrow('resource and one of its descendants');

    expect(() =>
      parseBaseHalfCanvasTemplate(
        JSON.stringify({
          ...validTemplate,
          nodes: [
            {
              ...validTemplate.nodes[0],
              recipe: {
                ...validTemplate.nodes[0].recipe,
                inputBindings: [
                  validTemplate.nodes[0].recipe.inputBindings[0],
                  { sourcePath: 'brief.md', slot: 'reference', order: 1 },
                ],
              },
            },
          ],
        }),
      ),
    ).toThrow('binding source');
  });
});
