import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface ScaffoldOptions {
  readonly directory: string;
  readonly publisher: string;
  readonly name: string;
  readonly displayName: string;
  readonly fileExtension: string;
}

export async function scaffoldPlugin(options: ScaffoldOptions): Promise<void> {
  const directory = path.resolve(options.directory);
  const publisher = slug(options.publisher, 'Publisher');
  const name = slug(options.name, 'Plugin name');
  const fileExtension = normalizeExtension(options.fileExtension);
  const projectionId = `${publisher}.${name}.project`;
  const primaryCommand = `${publisher}.${name}.createProject`;
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length > 0) {
    throw new Error(`Scaffold directory is not empty: ${directory}`);
  }
  const manifest = {
    name,
    displayName: options.displayName,
    description: `${options.displayName} project surface for BaseHalf.`,
    version: '0.1.0',
    publisher,
    license: 'Apache-2.0',
    engines: { vscode: '^1.100.0', basehalf: '^0.4.0' },
    extensionKind: ['workspace'],
    categories: ['Other'],
    main: './out/extension.js',
    basehalf: {
      primaryCommand,
      primaryCommandLabel: `Create ${options.displayName} Project…`,
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
          label: options.displayName,
          extensions: [fileExtension],
          order: 100,
          defaultPriority: 100,
        },
      ],
      commands: [
        {
          command: primaryCommand,
          title: `Create ${options.displayName} Project…`,
          category: 'BaseHalf',
        },
      ],
    },
    scripts: {
      compile:
        'esbuild src/extension.ts --bundle --platform=node --format=cjs --external:vscode --outfile=out/extension.js',
      package: 'npm run compile && bh-plugin publish',
    },
    devDependencies: {
      '@basehalf/plugin-sdk': '^0.1.0',
      '@types/vscode': '^1.100.0',
      esbuild: '^0.25.0',
      typescript: '^5.7.0',
    },
  };
  const files: Readonly<Record<string, string>> = {
    'package.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'src/extension.ts': extensionSource(projectionId, primaryCommand, fileExtension),
    'README.md': `# ${options.displayName}\n\nDescribe what this plugin lets people build in BaseHalf and which ordinary project files it owns.\n`,
    'CHANGELOG.md': '# Changelog\n\n## 0.1.0\n\n- Initial project surface.\n',
    LICENSE: apacheNotice(options.displayName),
    '.gitignore': 'node_modules/\nout/\n*.vsix\n',
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
  return `import '@basehalf/plugin-sdk/vscode';
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

function slug(value: string, label: string): string {
  const result = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,98}[a-z0-9]$/.test(result)) {
    throw new Error(`${label} must use lowercase letters, numbers, and internal hyphens.`);
  }
  return result;
}

function normalizeExtension(value: string): string {
  const result = value.startsWith('.') ? value.toLowerCase() : `.${value.toLowerCase()}`;
  if (!/^\.[a-z0-9][a-z0-9.-]*$/.test(result)) throw new Error('File extension is invalid.');
  return result;
}

function apacheNotice(name: string): string {
  return `Copyright ${new Date().getUTCFullYear()} ${name} contributors\n\nLicensed under the Apache License, Version 2.0 (the "License");\nyou may not use this file except in compliance with the License.\nYou may obtain a copy of the License at\n\n    http://www.apache.org/licenses/LICENSE-2.0\n\nUnless required by applicable law or agreed to in writing, software\ndistributed under the License is distributed on an "AS IS" BASIS,\nWITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.\nSee the License for the specific language governing permissions and\nlimitations under the License.\n`;
}
