#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BaseHalfPluginManifest, validateBaseHalfPluginManifest } from '@basehalf/plugin-sdk';
import { createVSIX } from '@vscode/vsce';
import { PluginApiClient, normalizeServer } from './apiClient.js';
import { removeSession, saveSession, sessionFor } from './credentials.js';
import { scaffoldPlugin } from './scaffold.js';
import type {
  DeviceAuthorization,
  DevicePoll,
  RemotePlugin,
  StoredSession,
  UploadGrant,
} from './types.js';

const DEFAULT_SERVER = 'https://plugins.basehalf.com';

interface ParsedArguments {
  readonly command: string;
  readonly positional: readonly string[];
  readonly options: Readonly<Record<string, string | true>>;
}

export async function run(argv: readonly string[]): Promise<void> {
  const args = parseArguments(argv);
  const server = normalizeServer(
    option(args, 'server') ?? process.env.BASEHALF_PLUGIN_SERVER ?? DEFAULT_SERVER,
  );
  switch (args.command) {
    case 'help':
    case '--help':
    case '-h':
    case '':
      printHelp();
      return;
    case 'init':
      await initialize(args);
      return;
    case 'validate':
      await validate(args);
      return;
    case 'package':
      await packageCommand(args);
      return;
    case 'login':
      await login(server, option(args, 'client-name') ?? os.hostname(), option(args, 'publisher'));
      return;
    case 'logout':
      await removeSession(server);
      console.log(`Signed out of ${server}.`);
      return;
    case 'whoami':
      await whoami(server);
      return;
    case 'publish':
      await publish(server, args);
      return;
    case 'status':
      await status(server, args);
      return;
    default:
      throw new Error(`Unknown command '${args.command}'. Run 'bh-plugin help'.`);
  }
}

async function initialize(args: ParsedArguments): Promise<void> {
  const directory = args.positional[0] ?? option(args, 'directory');
  const publisher = option(args, 'publisher');
  const name = option(args, 'name');
  const displayName = option(args, 'display-name');
  const repository = option(args, 'repository');
  if (!directory || !publisher || !name || !displayName || !repository) {
    throw new Error(
      'init requires a directory, --publisher, --name, --display-name, and --repository.',
    );
  }
  await scaffoldPlugin({
    directory,
    publisher,
    name,
    displayName,
    repository,
    fileExtension: option(args, 'file-extension') ?? name,
  });
  console.log(`Created ${publisher}.${name} in ${path.resolve(directory)}.`);
  console.log('Next: npm install, open the folder in BaseHalf, and press F5.');
}

async function validate(args: ParsedArguments): Promise<void> {
  const directory = pluginDirectory(args);
  const manifest = await readManifest(directory);
  await assertPublishFiles(directory, manifest);
  console.log(`Validated ${extensionIdOf(manifest)}@${manifest.version}.`);
}

async function packageCommand(args: ParsedArguments): Promise<void> {
  const directory = pluginDirectory(args);
  const manifest = await readManifest(directory);
  await assertPublishFiles(directory, manifest);
  const extensionId = extensionIdOf(manifest);
  const output = option(args, 'out');
  const vsixPath = output
    ? path.resolve(output)
    : path.join(directory, `${extensionId}-${manifest.version}.vsix`);
  await createPluginVsix(directory, vsixPath);
  console.log(`Packaged ${extensionId}@${manifest.version}.`);
  console.log(vsixPath);
}

async function login(
  server: string,
  clientName: string,
  publisherSlug?: string,
): Promise<StoredSession> {
  const client = new PluginApiClient(server);
  const authorization = await client.post<DeviceAuthorization>('/device/authorizations', {
    client_name: `Basehalf CLI on ${clientName}`,
    scopes: ['publisher:read', 'plugin:write', 'submission:write'],
    ...(publisherSlug ? { publisher_slug: publisherSlug } : {}),
  });
  const verificationUrl = new URL(authorization.verification_uri);
  verificationUrl.searchParams.set('user_code', authorization.user_code);
  console.log('Opening BaseHalf to confirm plugin publishing.');
  console.log(`If prompted, verify this code: ${authorization.user_code}`);
  console.log(verificationUrl.href);
  openBrowser(verificationUrl.href);
  const deadline = Date.now() + authorization.expires_in * 1000;
  let intervalSeconds = Math.max(1, authorization.interval);
  while (Date.now() < deadline) {
    await delay(intervalSeconds * 1000);
    const result = await client.post<DevicePoll>('/device/token', {
      device_code: authorization.device_code,
    });
    if (result.status === 'pending') {
      intervalSeconds = Math.max(intervalSeconds, result.interval);
      continue;
    }
    if (result.status !== 'approved') {
      throw new Error(`Publishing authorization ended with status '${result.status}'.`);
    }
    const provisional: StoredSession = {
      accessToken: result.access_token,
      publisherId: result.publisher_id,
      expiresAt: result.expires_at,
      scopes: result.scopes,
    };
    const session = await new PluginApiClient(server, provisional).get<{
      publisher?: { slug?: string; display_name?: string };
    }>('/cli/session');
    const storedSession: StoredSession = {
      ...provisional,
      ...(session.publisher?.slug ? { publisherSlug: session.publisher.slug } : {}),
    };
    await saveSession(server, storedSession);
    console.log(`Publishing connected to ${session.publisher?.display_name ?? server}.`);
    return storedSession;
  }
  throw new Error('Publishing authorization expired.');
}

async function whoami(server: string): Promise<void> {
  const session = await sessionFor(server);
  const value = await new PluginApiClient(server, session).get<{
    publisher?: { slug?: string; display_name?: string };
    scopes: readonly string[];
  }>('/cli/session');
  console.log(
    `${value.publisher?.display_name ?? 'Unknown Publisher'} (${value.publisher?.slug ?? session.publisherId})`,
  );
  console.log(`Scopes: ${value.scopes.join(', ')}`);
  console.log(`Expires: ${session.expiresAt}`);
}

async function publish(server: string, args: ParsedArguments): Promise<void> {
  const directory = pluginDirectory(args);
  const manifest = await readManifest(directory);
  validateBaseHalfPluginManifest(manifest);
  await assertPublishFiles(directory, manifest);
  const extensionId = extensionIdOf(manifest);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'basehalf-plugin-'));
  const suppliedVsix = option(args, 'vsix');
  const vsixPath = suppliedVsix
    ? path.resolve(suppliedVsix)
    : path.join(temporaryDirectory, `${extensionId}-${manifest.version}.vsix`);
  try {
    if (!suppliedVsix) {
      await createPluginVsix(directory, vsixPath);
    }
    const bytes = await readFile(vsixPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const releaseNotesFile = option(args, 'release-notes-file');
    const releaseNotes = releaseNotesFile
      ? await readFile(path.resolve(directory, releaseNotesFile), 'utf8')
      : await optionalRead(path.join(directory, 'CHANGELOG.md'));
    if (releaseNotes && Buffer.byteLength(releaseNotes, 'utf8') > 100_000) {
      throw new Error('Release notes exceed the 100 KB publishing limit.');
    }
    const session = await sessionForPublisher(server, manifest.publisher);
    const client = new PluginApiClient(server, session);
    const plugins = await client.get<RemotePlugin[]>('/cli/plugins');
    let plugin = plugins.find((candidate) => candidate.extension_id === extensionId);
    if (!plugin) {
      plugin = await client.post<RemotePlugin>('/cli/plugins', {
        name: manifest.name,
        display_name: manifest.displayName,
        description: manifest.description,
        ...repositoryPayload(manifest.repository),
      });
      console.log(`Registered ${extensionId}.`);
    }
    const grant = await client.post<UploadGrant>(`/cli/plugins/${plugin.id}/submissions`, {
      version: manifest.version,
      sha256,
      byte_size: bytes.byteLength,
      ...(releaseNotes?.trim() ? { release_notes: releaseNotes.trim() } : {}),
    });
    const upload = await fetch(grant.upload_url, {
      method: grant.method,
      headers: grant.headers,
      body: bytes,
      signal: AbortSignal.timeout(120_000),
    });
    if (!upload.ok) throw new Error(`Artifact upload failed with status ${upload.status}.`);
    const submission = await client.post<{ id: string; status: string }>(
      `/cli/submissions/${grant.submission_id}/finalize`,
    );
    console.log(`Submitted ${extensionId}@${manifest.version} (${submission.status}).`);
    console.log(`${server}/publish?plugin=${encodeURIComponent(extensionId)}`);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function sessionForPublisher(server: string, publisherSlug: string): Promise<StoredSession> {
  try {
    const session = await sessionFor(server);
    if (session.publisherSlug?.toLowerCase() === publisherSlug.toLowerCase()) {
      return session;
    }
  } catch {
    // Publishing owns the happy-path sign-in. The browser confirmation below
    // is used for a missing or expired local session.
  }
  return login(server, os.hostname(), publisherSlug);
}

function pluginDirectory(args: ParsedArguments): string {
  return path.resolve(args.positional[0] ?? option(args, 'directory') ?? '.');
}

function extensionIdOf(manifest: BaseHalfPluginManifest): string {
  return `${manifest.publisher}.${manifest.name}`.toLowerCase();
}

async function createPluginVsix(directory: string, vsixPath: string): Promise<void> {
  await createVSIX({ cwd: directory, packagePath: vsixPath, dependencies: false });
}

async function status(server: string, args: ParsedArguments): Promise<void> {
  const session = await sessionFor(server);
  const client = new PluginApiClient(server, session);
  let extensionId = option(args, 'extension-id');
  if (!extensionId) {
    try {
      const manifest = await readManifest(path.resolve(args.positional[0] ?? '.'));
      extensionId = `${manifest.publisher}.${manifest.name}`.toLowerCase();
    } catch {
      extensionId = undefined;
    }
  }
  const submissions =
    await client.get<
      Array<{
        id: string;
        version: string;
        status: string;
        review_summary?: string | null;
        plugin: { extension_id: string };
      }>
    >('/cli/submissions');
  const selected = extensionId
    ? submissions.filter((submission) => submission.plugin.extension_id === extensionId)
    : submissions;
  if (selected.length === 0) {
    console.log('No matching submissions.');
    return;
  }
  for (const submission of selected) {
    console.log(
      `${submission.plugin.extension_id}@${submission.version}\t${submission.status}${submission.review_summary ? `\t${submission.review_summary}` : ''}`,
    );
  }
}

async function readManifest(directory: string): Promise<BaseHalfPluginManifest> {
  const file = path.join(directory, 'package.json');
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read plugin manifest at ${file}: ${(error as Error).message}`);
  }
  validateBaseHalfPluginManifest(value);
  return value;
}

async function assertPublishFiles(
  directory: string,
  manifest: BaseHalfPluginManifest,
): Promise<void> {
  for (const relativePath of [manifest.main, 'README.md']) {
    try {
      await access(path.resolve(directory, relativePath));
    } catch {
      throw new Error(`Required publish file is missing: ${relativePath}`);
    }
  }
  const hasLicense = await Promise.any(
    ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].map((file) => access(path.join(directory, file))),
  ).then(
    () => true,
    () => false,
  );
  if (!hasLicense && !manifest.license) throw new Error('Plugin must include license information.');
}

function repositoryPayload(value: unknown): { repository_url?: string } {
  if (typeof value === 'string' && value.startsWith('https://')) return { repository_url: value };
  if (value && typeof value === 'object' && 'url' in value) {
    const url = (value as { url?: unknown }).url;
    if (typeof url === 'string' && url.startsWith('https://')) return { repository_url: url };
  }
  return {};
}

function parseArguments(argv: readonly string[]): ParsedArguments {
  const command = argv[0] ?? '';
  const positional: string[] = [];
  const options: Record<string, string | true> = {};
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value?.startsWith('--')) {
      if (value) positional.push(value);
      continue;
    }
    const equals = value.indexOf('=');
    if (equals > 2) {
      options[value.slice(2, equals)] = value.slice(equals + 1);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { command, positional, options };
}

function option(args: ParsedArguments, name: string): string | undefined {
  const value = args.options[name];
  return typeof value === 'string' ? value : undefined;
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function optionalRead(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function printHelp(): void {
  console.log(`BaseHalf plugin publishing

Usage:
  bh-plugin init <directory> --publisher <slug> --name <slug> --display-name <name> --repository <https-url> [--file-extension <ext>]
  bh-plugin validate [directory]
  bh-plugin package [directory] [--out file]
  bh-plugin login [--publisher <slug>] [--server https://plugins.basehalf.com]
  bh-plugin whoami [--server https://plugins.basehalf.com]
  bh-plugin publish [directory] [--vsix file] [--release-notes-file file]
  bh-plugin status [directory] [--extension-id publisher.name]
  bh-plugin logout [--server https://plugins.basehalf.com]

Run publish directly from a plugin project. The first publish opens a browser confirmation
automatically. Uploads enter private validation and review before the signed desktop catalog
can expose them.`);
}

if (isMainModule()) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
