#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { crc32 } from 'node:zlib';
import {
  BASEHALF_CANVAS_TEMPLATE_MAX_BYTES,
  type BaseHalfPluginManifest,
  parseBaseHalfCanvasTemplateForManifest,
  validateBaseHalfPluginManifest,
} from '@basehalf/plugin-sdk';
import { createVSIX } from '@vscode/vsce';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { PluginApiClient, normalizeServer } from './apiClient.js';
import { removeSession, saveSession, sessionFor } from './credentials.js';
import { type ScaffoldKind, scaffoldPlugin } from './scaffold.js';
import type {
  DeviceAuthorization,
  DevicePoll,
  RemotePlugin,
  StoredSession,
  UploadGrant,
} from './types.js';

const DEFAULT_SERVER = 'https://plugins.basehalf.com';
const MAX_PLUGIN_PACKAGE_BYTES = 100 * 1024 * 1024;
const MAX_PLUGIN_PACKAGE_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_PLUGIN_PACKAGE_ENTRIES = 4_096;
const MAX_PLUGIN_PACKAGE_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_PLUGIN_MANIFEST_BYTES = 1024 * 1024;
const MAX_MODEL_PROVIDER_CATALOG_BYTES = 128 * 1024;
const MAX_RELEASE_NOTES_BYTES = 100_000;

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
  const fileExtension = option(args, 'file-extension');
  const kind = scaffoldKind(option(args, 'kind'));
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
    ...(kind ? { kind } : {}),
    ...(fileExtension ? { fileExtension } : {}),
  });
  console.log(`Created ${publisher}.${name} in ${path.resolve(directory)}.`);
  console.log('Next: npm install, open the folder in BaseHalf, and press F5.');
}

async function validate(args: ParsedArguments): Promise<void> {
  const directory = pluginDirectory(args);
  const manifest = await validatePluginProject(directory);
  console.log(`Validated ${extensionIdOf(manifest)}@${manifest.version}.`);
}

async function packageCommand(args: ParsedArguments): Promise<void> {
  const directory = pluginDirectory(args);
  const manifest = await validatePluginProject(directory);
  const extensionId = extensionIdOf(manifest);
  const output = option(args, 'out');
  const vsixPath = output
    ? path.resolve(output)
    : path.join(directory, `${extensionId}-${manifest.version}.vsix`);
  await createPluginVsix(directory, vsixPath, manifest);
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
  const verificationUrl = createVerificationUrl(
    server,
    authorization.verification_uri,
    authorization.user_code,
  );
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
      portalOrigin: verificationUrl.origin,
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
  const manifest = await validatePluginProject(directory);
  const extensionId = extensionIdOf(manifest);
  const releaseNotesFile = option(args, 'release-notes-file');
  const releaseNotes = releaseNotesFile
    ? await readReleaseNotes(path.resolve(directory, releaseNotesFile), false)
    : await readReleaseNotes(path.join(directory, 'CHANGELOG.md'), true);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'basehalf-plugin-'));
  const vsixPath = path.join(temporaryDirectory, `${extensionId}-${manifest.version}.vsix`);
  try {
    await createPluginVsix(directory, vsixPath, manifest);
    const bytes = await readFile(vsixPath);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
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
    const publishUrl = new URL('/publish', session.portalOrigin ?? server);
    publishUrl.searchParams.set('plugin', extensionId);
    console.log(publishUrl.href);
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

async function createPluginVsix(
  directory: string,
  vsixPath: string,
  manifest: BaseHalfPluginManifest,
): Promise<void> {
  try {
    await createVSIX({ cwd: directory, packagePath: vsixPath, dependencies: false });
    await assertPackagedPlugin(vsixPath, manifest);
  } catch (error) {
    await rm(vsixPath, { force: true });
    throw error;
  }
}

async function assertPackagedPlugin(
  vsixPath: string,
  sourceManifest: BaseHalfPluginManifest,
): Promise<void> {
  const packageStat = await stat(vsixPath);
  if (
    !packageStat.isFile() ||
    packageStat.size < 1 ||
    packageStat.size > MAX_PLUGIN_PACKAGE_BYTES
  ) {
    throw new Error(`Packaged VSIX must be no larger than ${MAX_PLUGIN_PACKAGE_BYTES} bytes.`);
  }
  const inspectedResourceArchivePaths = new Set([
    ...(sourceManifest.contributes.basehalfCanvasTemplates ?? []).map(
      (template) => `extension/${template.resource}`,
    ),
    ...(sourceManifest.contributes.basehalfModelProviderCatalogs ?? []).map(
      (catalog) => `extension/${catalog.resource}`,
    ),
    ...(sourceManifest.contributes.basehalfVideoModelCatalogs ?? []).map(
      (catalog) => `extension/${catalog.resource}`,
    ),
  ]);
  const inspection = await inspectPluginArchive(vsixPath, inspectedResourceArchivePaths);
  const packagedManifest = inspection.manifest;
  validateBaseHalfPluginManifest(packagedManifest);
  for (const field of [
    'publisher',
    'name',
    'version',
    'displayName',
    'description',
    'license',
    'repository',
    'main',
    'engines',
    'basehalf',
    'contributes',
    'activationEvents',
    'enabledApiProposals',
  ] as const) {
    if (!isDeepStrictEqual(packagedManifest[field], sourceManifest[field])) {
      throw new Error(`Packaged VSIX manifest field '${field}' differs from package.json.`);
    }
  }
  const main = sourceManifest.main.replace(/^\.\//, '');
  const requiredFiles = [
    `extension/${main}`,
    ...(sourceManifest.contributes.basehalfCanvasTemplates ?? []).map(
      (template) => `extension/${template.resource}`,
    ),
    ...(sourceManifest.contributes.basehalfModelProviderCatalogs ?? []).map(
      (catalog) => `extension/${catalog.resource}`,
    ),
    ...(sourceManifest.contributes.basehalfVideoModelCatalogs ?? []).map(
      (catalog) => `extension/${catalog.resource}`,
    ),
    ...(sourceManifest.contributes.jsonValidation ?? []).map(
      (validator) => `extension/${validator.url}`,
    ),
  ];
  for (const requiredFile of requiredFiles) {
    if (!inspection.files.has(requiredFile)) {
      throw new Error(`Packaged VSIX is missing '${requiredFile}' or uses different casing.`);
    }
  }
  for (const template of sourceManifest.contributes.basehalfCanvasTemplates ?? []) {
    const archivePath = `extension/${template.resource}`;
    const bytes = inspection.contents.get(archivePath);
    if (!bytes) {
      throw new Error(`Packaged VSIX is missing '${archivePath}' or uses different casing.`);
    }
    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      parseBaseHalfCanvasTemplateForManifest(source, packagedManifest);
    } catch (error) {
      throw new Error(
        `Packaged canvas template failed validation: ${template.resource}: ${(error as Error).message}`,
      );
    }
  }
  for (const catalog of sourceManifest.contributes.basehalfVideoModelCatalogs ?? []) {
    const archivePath = `extension/${catalog.resource}`;
    const bytes = inspection.contents.get(archivePath);
    if (!bytes) {
      throw new Error(`Packaged VSIX is missing '${archivePath}' or uses different casing.`);
    }
    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
    } catch (error) {
      throw new Error(
        `Packaged video model catalog is not valid UTF-8 JSON: ${catalog.resource}: ${(error as Error).message}`,
      );
    }
  }
  for (const catalog of sourceManifest.contributes.basehalfModelProviderCatalogs ?? []) {
    const archivePath = `extension/${catalog.resource}`;
    const bytes = inspection.contents.get(archivePath);
    if (!bytes) {
      throw new Error(`Packaged VSIX is missing '${archivePath}' or uses different casing.`);
    }
    try {
      parseUtf8JsonResource(bytes, MAX_MODEL_PROVIDER_CATALOG_BYTES);
    } catch (error) {
      throw new Error(
        `Packaged model provider catalog failed validation: ${catalog.resource}: ${(error as Error).message}`,
      );
    }
  }
  if (!hasArchiveFile(inspection.files, 'extension/readme.md')) {
    throw new Error('Packaged VSIX is missing README.md.');
  }
  if (
    !['extension/license', 'extension/license.md', 'extension/license.txt'].some((file) =>
      hasArchiveFile(inspection.files, file),
    )
  ) {
    throw new Error('Packaged VSIX is missing a license file.');
  }
}

function hasArchiveFile(files: ReadonlySet<string>, wanted: string): boolean {
  const canonical = wanted.normalize('NFC').toLowerCase();
  return [...files].some((file) => file.normalize('NFC').toLowerCase() === canonical);
}

function parseUtf8JsonResource(bytes: Uint8Array, maximumBytes: number): unknown {
  if (bytes.byteLength > maximumBytes) {
    throw new Error(`Resource exceeds ${maximumBytes} bytes.`);
  }
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
}

function inspectPluginArchive(
  vsixPath: string,
  retainedFiles: ReadonlySet<string> = new Set(),
): Promise<{
  manifest: Record<string, unknown>;
  files: ReadonlySet<string>;
  contents: ReadonlyMap<string, Buffer>;
}> {
  return new Promise((resolve, reject) => {
    yauzl.open(vsixPath, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) {
        reject(openError ?? new Error('Could not open packaged VSIX.'));
        return;
      }
      let settled = false;
      let entryCount = 0;
      let totalUncompressedBytes = 0;
      let manifest: Record<string, unknown> | undefined;
      const files = new Set<string>();
      const canonicalFiles = new Set<string>();
      const contents = new Map<string, Buffer>();
      const fail = (error: unknown) => {
        if (!settled) {
          settled = true;
          zip.close();
          reject(error);
        }
      };
      zip.on('error', fail);
      zip.on('end', () => {
        if (settled) return;
        if (!manifest) {
          fail(new Error('Packaged VSIX is missing extension/package.json.'));
          return;
        }
        try {
          assertNoArchivePathPrefixConflicts(files);
        } catch (error) {
          fail(error);
          return;
        }
        settled = true;
        resolve({ manifest, files, contents });
      });
      zip.on('entry', (entry) => {
        entryCount += 1;
        if (entryCount > MAX_PLUGIN_PACKAGE_ENTRIES) {
          fail(
            new Error(`Packaged VSIX contains more than ${MAX_PLUGIN_PACKAGE_ENTRIES} entries.`),
          );
          return;
        }
        if (
          !safeArchiveEntryName(entry.fileName) ||
          !isArchiveRegularFile(entry) ||
          isArchiveEncrypted(entry)
        ) {
          fail(new Error(`Packaged VSIX contains unsafe entry '${entry.fileName}'.`));
          return;
        }
        const canonical = entry.fileName.normalize('NFC').toLowerCase();
        if (entry.fileName !== entry.fileName.normalize('NFC') || canonicalFiles.has(canonical)) {
          fail(new Error(`Packaged VSIX contains ambiguous path '${entry.fileName}'.`));
          return;
        }
        canonicalFiles.add(canonical);
        files.add(entry.fileName);
        if (
          !Number.isSafeInteger(entry.uncompressedSize) ||
          entry.uncompressedSize < 0 ||
          entry.uncompressedSize > MAX_PLUGIN_PACKAGE_ENTRY_BYTES
        ) {
          fail(new Error(`Packaged VSIX entry '${entry.fileName}' exceeds the size limit.`));
          return;
        }
        totalUncompressedBytes += entry.uncompressedSize;
        if (
          !Number.isSafeInteger(totalUncompressedBytes) ||
          totalUncompressedBytes > MAX_PLUGIN_PACKAGE_UNCOMPRESSED_BYTES
        ) {
          fail(new Error('Packaged VSIX expands beyond the allowed size.'));
          return;
        }
        if (canonical === 'extension/package.json' && entry.fileName !== 'extension/package.json') {
          fail(new Error('Packaged VSIX manifest path must be exactly extension/package.json.'));
          return;
        }
        const retainManifest = entry.fileName === 'extension/package.json';
        const retainRequestedFile = retainedFiles.has(entry.fileName);
        const retain = retainManifest || retainRequestedFile;
        const maximumBytes = retainManifest
          ? MAX_PLUGIN_MANIFEST_BYTES
          : retainRequestedFile
            ? BASEHALF_CANVAS_TEMPLATE_MAX_BYTES
            : MAX_PLUGIN_PACKAGE_ENTRY_BYTES;
        readArchiveEntry(zip, entry, maximumBytes, retain).then((bytes) => {
          try {
            if (retainManifest) {
              const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
              const value = JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
              if (!value || typeof value !== 'object' || Array.isArray(value)) {
                throw new Error('Packaged VSIX manifest must be an object.');
              }
              manifest = value as Record<string, unknown>;
            }
            if (retainRequestedFile) {
              contents.set(entry.fileName, bytes);
            }
            zip.readEntry();
          } catch (error) {
            fail(error);
          }
        }, fail);
      });
      zip.readEntry();
    });
  });
}

function readArchiveEntry(
  zip: ZipFile,
  entry: Entry,
  maximumBytes: number,
  retain = true,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error ?? new Error(`Could not read '${entry.fileName}' from packaged VSIX.`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let checksum = 0;
      let settled = false;
      const fail = (reason: unknown) => {
        if (!settled) {
          settled = true;
          reject(reason);
        }
      };
      stream.on('data', (chunk) => {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > maximumBytes) {
          stream.destroy(new Error(`Packaged VSIX entry '${entry.fileName}' is too large.`));
          return;
        }
        checksum = crc32(bytes, checksum);
        if (retain) chunks.push(bytes);
      });
      stream.on('error', fail);
      stream.on('end', () => {
        if (settled) return;
        if (checksum >>> 0 !== entry.crc32 >>> 0) {
          fail(new Error(`Packaged VSIX entry '${entry.fileName}' failed CRC validation.`));
          return;
        }
        if (size !== entry.uncompressedSize) {
          fail(
            new Error(`Packaged VSIX entry '${entry.fileName}' did not match its declared size.`),
          );
          return;
        }
        settled = true;
        resolve(retain ? Buffer.concat(chunks, size) : Buffer.alloc(0));
      });
    });
  });
}

function safeArchiveEntryName(name: string): boolean {
  return (
    Boolean(name) &&
    name === name.normalize('NFC') &&
    name === name.trim() &&
    !name.startsWith('/') &&
    !name.startsWith('\\') &&
    !name.includes('\\') &&
    !containsArchiveForbiddenCharacter(name) &&
    !/^[A-Za-z]:/.test(name) &&
    name
      .split('/')
      .every(
        (segment) =>
          Boolean(segment) &&
          segment !== '.' &&
          segment !== '..' &&
          segment.length <= 255 &&
          !segment.endsWith('.') &&
          !segment.endsWith(' ') &&
          segment.toLowerCase() !== '.bh' &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
      )
  );
}

function containsArchiveForbiddenCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f || '<>:"|?*'.includes(character);
  });
}

function isArchiveRegularFile(entry: Entry): boolean {
  const fileType = (entry.externalFileAttributes >>> 16) & 0xf000;
  return fileType === 0 || fileType === 0x8000;
}

function isArchiveEncrypted(entry: Entry): boolean {
  return (entry.generalPurposeBitFlag & 0x1) !== 0;
}

function assertNoArchivePathPrefixConflicts(files: ReadonlySet<string>): void {
  const canonical = new Set([...files].map((file) => file.toLowerCase()));
  for (const file of canonical) {
    let slash = file.indexOf('/');
    while (slash >= 0) {
      if (canonical.has(file.slice(0, slash))) {
        throw new Error('Packaged VSIX contains a file and one of its descendants.');
      }
      slash = file.indexOf('/', slash + 1);
    }
  }
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

async function validatePluginProject(directory: string): Promise<BaseHalfPluginManifest> {
  const manifest = await readManifest(directory);
  await assertPublishFiles(directory, manifest);
  return manifest;
}

async function assertPublishFiles(
  directory: string,
  manifest: BaseHalfPluginManifest,
): Promise<void> {
  for (const relativePath of [manifest.main, 'README.md']) {
    try {
      if (!(await stat(path.resolve(directory, relativePath))).isFile()) {
        throw new Error('not a file');
      }
    } catch {
      throw new Error(`Required publish file is missing: ${relativePath}`);
    }
  }

  for (const validator of manifest.contributes.jsonValidation ?? []) {
    try {
      if (!(await stat(path.resolve(directory, validator.url))).isFile()) {
        throw new Error('not a file');
      }
    } catch {
      throw new Error(`Required JSON schema is missing: ${validator.url}`);
    }
  }
  for (const template of manifest.contributes.basehalfCanvasTemplates ?? []) {
    const templatePath = path.resolve(directory, template.resource);
    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(templatePath));
      parseBaseHalfCanvasTemplateForManifest(source, manifest);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Required canvas template is missing: ${template.resource}`);
      }
      throw new Error(
        `Canvas template failed validation: ${template.resource}: ${(error as Error).message}`,
      );
    }
  }
  for (const catalog of manifest.contributes.basehalfVideoModelCatalogs ?? []) {
    const catalogPath = path.resolve(directory, catalog.resource);
    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(catalogPath));
      JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Required video model catalog is missing: ${catalog.resource}`);
      }
      throw new Error(
        `Video model catalog is not valid UTF-8 JSON: ${catalog.resource}: ${(error as Error).message}`,
      );
    }
  }
  for (const catalog of manifest.contributes.basehalfModelProviderCatalogs ?? []) {
    const catalogPath = path.resolve(directory, catalog.resource);
    try {
      parseUtf8JsonResource(await readFile(catalogPath), MAX_MODEL_PROVIDER_CATALOG_BYTES);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Required model provider catalog is missing: ${catalog.resource}`);
      }
      throw new Error(
        `Model provider catalog failed validation: ${catalog.resource}: ${(error as Error).message}`,
      );
    }
  }
  const licenseFiles = (await readdir(directory)).filter((file) =>
    /^(?:license|license\.md|license\.txt)$/i.test(file),
  );
  const hasLicense = (
    await Promise.all(
      licenseFiles.map(async (file) => (await stat(path.join(directory, file))).isFile()),
    )
  ).some(Boolean);
  if (!hasLicense) throw new Error('Plugin must include a license file.');
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

function scaffoldKind(value: string | undefined): ScaffoldKind | undefined {
  if (value === undefined) return undefined;
  if (value === 'recipe') return 'recipe';
  if (value === 'projection') return 'projection';
  throw new Error("--kind must be 'recipe' or 'projection'.");
}

function createVerificationUrl(server: string, value: string, userCode: string): URL {
  let verificationUrl: URL;
  try {
    verificationUrl = new URL(value);
  } catch {
    throw new Error('Publishing service returned an invalid verification URL.');
  }
  if (verificationUrl.origin !== server) {
    throw new Error('Publishing verification URL must use the publishing server origin.');
  }
  if (verificationUrl.username || verificationUrl.password) {
    throw new Error('Publishing verification URL must not contain credentials.');
  }
  verificationUrl.searchParams.set('user_code', userCode);
  return verificationUrl;
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'explorer.exe'
        : 'xdg-open';
  const child = spawn(command, [url], {
    detached: true,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => undefined);
  child.unref();
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readReleaseNotes(file: string, optional: boolean): Promise<string | undefined> {
  try {
    const fileStat = await stat(file);
    if (!fileStat.isFile() || fileStat.size > MAX_RELEASE_NOTES_BYTES) {
      throw new Error('Release notes exceed the 100 KB publishing limit.');
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file));
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof TypeError) {
      throw new Error('Release notes must be valid UTF-8 text.');
    }
    throw error;
  }
}

function printHelp(): void {
  console.log(`BaseHalf plugin publishing

Usage:
  bh-plugin init <directory> --publisher <slug> --name <slug> --display-name <name> --repository <https-url> [--kind recipe|projection] [--file-extension <ext>]
  bh-plugin validate [directory]
  bh-plugin package [directory] [--out file]
  bh-plugin login [--publisher <slug>] [--server https://plugins.basehalf.com]
  bh-plugin whoami [--server https://plugins.basehalf.com]
  bh-plugin publish [directory] [--release-notes-file file]
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
