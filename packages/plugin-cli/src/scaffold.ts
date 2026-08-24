import { readFileSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BaseHalfCanvasTemplate } from '@basehalf/plugin-sdk';

const developerToolsVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version as string;

export interface ScaffoldOptions {
  readonly directory: string;
  readonly publisher: string;
  readonly name: string;
  readonly displayName: string;
  readonly repository: string;
  readonly kind?: ScaffoldKind;
  readonly fileExtension?: string;
}

export type ScaffoldKind = 'recipe' | 'projection';

export async function scaffoldPlugin(options: ScaffoldOptions): Promise<void> {
  const directory = path.resolve(options.directory);
  const publisher = slug(options.publisher, 'Publisher', 50);
  const name = slug(options.name, 'Plugin name', 100);
  const displayName = requiredDisplayName(options.displayName);
  const repository = normalizeRepository(options.repository);
  const kind = normalizeScaffoldKind(options.kind, options.fileExtension);
  const extensionId = `${publisher}.${name}`;
  const fileExtension = normalizeExtension(options.fileExtension ?? name);
  const projectionId = `${extensionId}.project`;
  const recipeId = `${extensionId}.create-document`;
  const templateId = `${extensionId}.starter`;
  const primaryCommand =
    kind === 'recipe' ? `${extensionId}.createFromTemplate` : `${extensionId}.createProject`;
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length > 0) {
    throw new Error(`Scaffold directory is not empty: ${directory}`);
  }
  const manifest = {
    name,
    displayName,
    description:
      kind === 'recipe'
        ? `${displayName} recipes and templates for the BaseHalf canvas.`
        : `${displayName} project surface for BaseHalf.`,
    version: '0.1.0',
    publisher,
    license: 'Apache-2.0',
    repository: {
      type: 'git',
      url: repository,
    },
    engines: { vscode: '^1.100.0', basehalf: '^0.4.0' },
    extensionKind: ['workspace'],
    categories: ['Other'],
    main: './out/extension.js',
    basehalf: {
      primaryCommand,
      primaryCommandLabel:
        kind === 'recipe'
          ? `Create ${displayName} from Template…`
          : `Create ${displayName} Project…`,
    },
    capabilities: {
      untrustedWorkspaces: {
        supported: false,
        description:
          'This plugin can act on local project files after an explicit user or Agent action.',
      },
      virtualWorkspaces: false,
    },
    contributes:
      kind === 'recipe'
        ? {
            basehalfCanvasRecipes: [
              {
                id: recipeId,
                label: `Create ${displayName} document`,
                description: 'Creates one ordinary Markdown artifact from direct canvas context.',
                icon: 'run',
                inputs: [
                  {
                    id: 'prompt',
                    label: 'Prompt',
                    accepts: ['text', 'code', 'file'],
                    minItems: 1,
                    maxItems: 8,
                  },
                ],
                parameters: [
                  {
                    id: 'heading',
                    label: 'Heading',
                    type: 'string',
                    default: displayName,
                    maxLength: 120,
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
                id: templateId,
                label: `${displayName} Starter`,
                description: 'Creates a brief connected to one executable result node.',
                resource: 'templates/starter.json',
              },
            ],
            commands: [
              {
                command: primaryCommand,
                title: `Create ${displayName} from Template…`,
                category: 'BaseHalf',
              },
            ],
          }
        : {
            basehalfCardProjections: [
              {
                id: projectionId,
                label: displayName,
                extensions: [fileExtension],
                order: 100,
                defaultPriority: 100,
              },
            ],
            commands: [
              {
                command: primaryCommand,
                title: `Create ${displayName} Project…`,
                category: 'BaseHalf',
              },
            ],
          },
    scripts: {
      compile:
        'esbuild src/extension.ts --bundle --platform=node --format=cjs --external:vscode --sourcemap --outfile=out/extension.js',
      watch:
        'esbuild src/extension.ts --bundle --platform=node --format=cjs --external:vscode --sourcemap --outfile=out/extension.js --watch',
      check: 'npm run compile && tsc --noEmit && bh-plugin validate .',
      package: 'npm run compile && bh-plugin package .',
      publish: 'npm run compile && bh-plugin publish .',
    },
    devDependencies: {
      '@basehalf/plugin-cli': `^${developerToolsVersion}`,
      '@basehalf/plugin-sdk': `^${developerToolsVersion}`,
      '@types/vscode': '^1.100.0',
      esbuild: '^0.25.0',
      typescript: '^5.7.0',
    },
  };
  const files: Readonly<Record<string, string>> = {
    'package.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'src/extension.ts':
      kind === 'recipe'
        ? recipeExtensionSource(recipeId, templateId, primaryCommand)
        : projectionExtensionSource(projectionId, primaryCommand, fileExtension),
    ...(kind === 'recipe'
      ? { 'templates/starter.json': recipeTemplate(recipeId, displayName) }
      : {}),
    'tsconfig.json': `${JSON.stringify(tsconfig(), null, 2)}\n`,
    '.vscode/launch.json': `${JSON.stringify(launchConfiguration(), null, 2)}\n`,
    'test-workspace/README.md': `# ${displayName} test workspace\n\nFiles created while running the plugin development host stay in this folder.\n`,
    'README.md': `# ${displayName}\n\nDescribe what this plugin lets people build in BaseHalf and which ordinary project files it owns.\n\n${
      kind === 'recipe'
        ? 'This project contributes one host-owned canvas recipe and one starter template. Its executor receives direct input snapshots and writes its one result file only to the Attempt directory supplied by BaseHalf.\n\n'
        : 'This project contributes a card-detail projection for its project file extension.\n\n'
    }## Development\n\n- Run \`npm install\`.\n- Open this folder in BaseHalf and press F5.\n- Run \`npm run check\` before publishing.\n- Run \`npm run package\` to inspect the exact VSIX locally.\n- Run \`npm run publish\` to confirm your BaseHalf account and submit a version for review.\n`,
    'CHANGELOG.md': `# Changelog\n\n## 0.1.0\n\n- ${
      kind === 'recipe'
        ? 'Initial canvas Recipe and starter Template.'
        : 'Initial card-detail Projection.'
    }\n`,
    LICENSE: apacheNotice(displayName),
    '.gitignore': 'node_modules/\nout/\n*.vsix\n',
    '.vscodeignore': '.vscode/**\nsrc/**\ntest-workspace/**\ntsconfig.json\n*.vsix\n',
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(directory, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
}

function recipeExtensionSource(
  recipeId: string,
  templateId: string,
  primaryCommand: string,
): string {
  return `import type {} from '@basehalf/plugin-sdk/vscode';
import * as vscode from 'vscode';

const recipeId = '${recipeId}';
const templateId = '${templateId}';
const primaryCommand = '${primaryCommand}';
const maximumInputBytes = 256 * 1024;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(primaryCommand, () =>
    vscode.commands.executeCommand('basehalf.canvas.createFromTemplate', templateId)));
  context.subscriptions.push(vscode.basehalf.registerCanvasRecipeExecutor(recipeId, {
    execute: (request, progress, token) => executeRecipe(request, progress, token),
  }));
}

async function executeRecipe(
  request: vscode.basehalf.CanvasRecipeExecutionRequest,
  progress: vscode.Progress<vscode.basehalf.CanvasRecipeProgress>,
  token: vscode.CancellationToken,
): Promise<vscode.basehalf.CanvasRecipeExecutionResult> {
  throwIfCancelled(token);
  progress.report({ message: 'Reading direct inputs', increment: 20 });
  const inputs = await Promise.all(request.inputs.map(readDirectInput));
  throwIfCancelled(token);

  const heading = typeof request.parameters.heading === 'string'
    ? request.parameters.heading.trim() || 'Result'
    : 'Result';
  const body = inputs.map((input, index) =>
    \`## Input \${index + 1}: \${input.path}\n\n\${input.contents}\`).join('\\n\\n');
  const output = \`# \${heading}\n\n\${body || '_No direct input content was available._'}\n\`;
  const resource = vscode.Uri.joinPath(request.outputDirectory, 'result.md');
  await vscode.workspace.fs.createDirectory(request.outputDirectory);
  await vscode.workspace.fs.writeFile(resource, new TextEncoder().encode(output));
  throwIfCancelled(token);
  progress.report({ message: 'Saved result', increment: 80 });

  const artifactId = \`\${request.attemptId}:document\`;
  return {
    artifact: {
      id: artifactId,
      outputId: 'document',
      kind: 'file',
      resource,
      label: heading,
    },
  };
}

async function readDirectInput(input: vscode.basehalf.CanvasRecipeInput): Promise<{ path: string; contents: string }> {
  const resource = input.source.result?.resource ?? input.source.resource;
  if (!resource || input.source.kind === 'folder') {
    return { path: input.source.path, contents: '_Input is available by reference only._' };
  }
  try {
    const stat = await vscode.workspace.fs.stat(resource);
    if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maximumInputBytes) {
      return { path: input.source.path, contents: '_Input exceeds the text-read limit and is available by reference only._' };
    }
    const bytes = await vscode.workspace.fs.readFile(resource);
    if (bytes.byteLength > maximumInputBytes) {
      return { path: input.source.path, contents: '_Input exceeds the text-read limit and is available by reference only._' };
    }
    return { path: input.source.path, contents: new TextDecoder().decode(bytes) };
  } catch {
    return { path: input.source.path, contents: '_Input could not be read as text._' };
  }
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) throw new vscode.CancellationError();
}
`;
}

function recipeTemplate(recipeId: string, displayName: string): string {
  const template = {
    version: 1,
    files: [
      {
        path: 'brief.md',
        contents: `# Brief\n\nDescribe what the ${displayName} recipe should create.\n`,
      },
    ],
    nodes: [
      {
        path: 'result.bhnode',
        kind: 'file',
        title: `${displayName} Result`,
        role: 'result',
        recipe: {
          recipeId,
          parameters: { heading: displayName },
          inputBindings: [{ sourcePath: 'brief.md', slot: 'prompt', order: 0 }],
        },
      },
    ],
    cards: [
      { path: 'brief.md', x: 40, y: 80, width: 320, height: 240 },
      { path: 'result.bhnode', x: 440, y: 80, width: 320, height: 240 },
    ],
    references: [
      {
        from: 'brief.md',
        to: 'result.bhnode',
        fromAnchor: 'east',
        toAnchor: 'west',
      },
    ],
  } satisfies BaseHalfCanvasTemplate;
  return `${JSON.stringify(template, null, 2)}\n`;
}

function projectionExtensionSource(
  projectionId: string,
  primaryCommand: string,
  fileExtension: string,
): string {
  return `import type {} from '@basehalf/plugin-sdk/vscode';
import * as vscode from 'vscode';

const projectionId = '${projectionId}';
const primaryCommand = '${primaryCommand}';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand(primaryCommand, createProject));
  context.subscriptions.push(vscode.basehalf.registerCardProjectionProvider(projectionId, {
    resolveCardProjection(resource, view) {
      view.webview.options = { enableScripts: false };
      view.webview.html = render(resource);
      view.setDirty(false);
    },
  }));
}

async function createProject(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const resource = await vscode.window.showSaveDialog({
    defaultUri: root ? vscode.Uri.joinPath(root, 'Untitled${fileExtension}') : undefined,
    saveLabel: 'Create Project',
    filters: { Project: ['${fileExtension.slice(1)}'] },
  });
  if (!resource) return;
  await vscode.workspace.fs.writeFile(resource, new TextEncoder().encode('{}\\n'));
  await vscode.commands.executeCommand('basehalf.openResource', resource);
}

function render(resource: vscode.Uri): string {
  const name = resource.path.split('/').pop() ?? 'Project';
  return \`<!doctype html><html><body style="margin:0;padding:32px;background:#171717;color:#e7e7e7;font:13px -apple-system,BlinkMacSystemFont,sans-serif"><h1 style="font-size:20px">\${escapeHtml(name)}</h1><p>Your plugin owns this central project surface. Keep durable content in ordinary local files.</p></body></html>\`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
`;
}

function slug(value: string, label: string, maximumLength: number): string {
  const result = value.trim().toLowerCase();
  if (
    result.length < 3 ||
    result.length > maximumLength ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(result)
  ) {
    throw new Error(
      `${label} must be 3-${maximumLength} lowercase letters, numbers, and internal hyphens.`,
    );
  }
  return result;
}

function requiredDisplayName(value: string): string {
  const result = value.trim();
  if (result.length < 2 || result.length > 150) {
    throw new Error('Display name must be 2-150 characters.');
  }
  return result;
}

function normalizeScaffoldKind(
  value: ScaffoldKind | undefined,
  fileExtension: string | undefined,
): ScaffoldKind {
  if (value === undefined) return fileExtension === undefined ? 'recipe' : 'projection';
  if (value !== 'recipe' && value !== 'projection') {
    throw new Error("Scaffold kind must be 'recipe' or 'projection'.");
  }
  if (value === 'recipe' && fileExtension !== undefined) {
    throw new Error('Recipe scaffolds do not use a file extension.');
  }
  return value;
}

function normalizeRepository(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname) throw new Error('not https');
    return url.href.replace(/\/$/, '');
  } catch {
    throw new Error('Repository must be an absolute HTTPS URL.');
  }
}

function tsconfig(): Record<string, unknown> {
  return {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM'],
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ['src/**/*.ts'],
  };
}

function launchConfiguration(): Record<string, unknown> {
  return {
    version: '0.2.0',
    configurations: [
      {
        name: 'Run BaseHalf Plugin',
        type: 'extensionHost',
        request: 'launch',
        runtimeExecutable: '${execPath}',
        args: [
          '--extensionDevelopmentPath=${workspaceFolder}',
          '${workspaceFolder}/test-workspace',
        ],
        outFiles: ['${workspaceFolder}/out/**/*.js'],
        preLaunchTask: 'npm: compile',
      },
    ],
  };
}

function normalizeExtension(value: string): string {
  const result = value.startsWith('.') ? value.toLowerCase() : `.${value.toLowerCase()}`;
  if (!/^\.[a-z0-9][a-z0-9.-]*$/.test(result)) throw new Error('File extension is invalid.');
  return result;
}

function apacheNotice(name: string): string {
  return `Copyright ${new Date().getUTCFullYear()} ${name} contributors\n\nLicensed under the Apache License, Version 2.0 (the "License");\nyou may not use this file except in compliance with the License.\nYou may obtain a copy of the License at\n\n    http://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software\ndistributed under the License is distributed on an "AS IS" BASIS,\nWITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\nSee the License for the specific language governing permissions and\nlimitations under the License.\n`;
}
