import { readFileSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const developerToolsVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version as string;

export interface ScaffoldOptions {
  readonly directory: string;
  readonly publisher: string;
  readonly name: string;
  readonly displayName: string;
  readonly repository: string;
  readonly fileExtension: string;
}

export async function scaffoldPlugin(options: ScaffoldOptions): Promise<void> {
  const directory = path.resolve(options.directory);
  const publisher = slug(options.publisher, 'Publisher', 50);
  const name = slug(options.name, 'Plugin name', 100);
  const displayName = requiredDisplayName(options.displayName);
  const repository = normalizeRepository(options.repository);
  const fileExtension = normalizeExtension(options.fileExtension);
  const projectionId = `${publisher}.${name}.project`;
  const primaryCommand = `${publisher}.${name}.createProject`;
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length > 0) {
    throw new Error(`Scaffold directory is not empty: ${directory}`);
  }
  const manifest = {
    name,
    displayName,
    description: `${displayName} project surface for BaseHalf.`,
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
      primaryCommandLabel: `Create ${displayName} Project…`,
    },
    capabilities: {
      untrustedWorkspaces: {
        supported: false,
        description:
          'This plugin can act on local project files after an explicit user or Agent action.',
      },
      virtualWorkspaces: false,
    },
    contributes: {
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
    'src/extension.ts': extensionSource(projectionId, primaryCommand, fileExtension),
    'tsconfig.json': `${JSON.stringify(tsconfig(), null, 2)}\n`,
    '.vscode/launch.json': `${JSON.stringify(launchConfiguration(), null, 2)}\n`,
    'test-workspace/README.md': `# ${displayName} test workspace\n\nFiles created while running the plugin development host stay in this folder.\n`,
    'README.md': `# ${displayName}\n\nDescribe what this plugin lets people build in BaseHalf and which ordinary project files it owns.\n\n## Development\n\n- Run \`npm install\`.\n- Open this folder in BaseHalf and press F5.\n- Run \`npm run check\` before packaging.\n- Run \`npm run package\` to create the exact VSIX for review.\n`,
    'CHANGELOG.md': '# Changelog\n\n## 0.1.0\n\n- Initial project surface.\n',
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

function extensionSource(
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
