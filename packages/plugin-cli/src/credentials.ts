import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CredentialsFile, StoredSession } from './types.js';

const EMPTY: CredentialsFile = { version: 1, servers: {} };

export function credentialsPath(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.BASEHALF_PLUGIN_CONFIG_HOME?.trim();
  const root = configured ? path.resolve(configured) : path.join(os.homedir(), '.basehalf');
  return path.join(root, 'plugin-publisher.json');
}

export async function readCredentials(file = credentialsPath()): Promise<CredentialsFile> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as Partial<CredentialsFile>;
    if (value.version !== 1 || !value.servers || typeof value.servers !== 'object') return EMPTY;
    return { version: 1, servers: value.servers };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw error;
  }
}

export async function sessionFor(server: string, file = credentialsPath()): Promise<StoredSession> {
  const session = (await readCredentials(file)).servers[server];
  if (!session) throw new Error(`Not signed in to ${server}. Run 'bh-plugin login' first.`);
  if (Date.parse(session.expiresAt) <= Date.now()) {
    throw new Error(`The publishing session for ${server} expired. Run 'bh-plugin login' again.`);
  }
  return session;
}

export async function saveSession(
  server: string,
  session: StoredSession,
  file = credentialsPath(),
): Promise<void> {
  const current = await readCredentials(file);
  await writeAtomic(file, { version: 1, servers: { ...current.servers, [server]: session } });
}

export async function removeSession(server: string, file = credentialsPath()): Promise<void> {
  const current = await readCredentials(file);
  const servers = { ...current.servers };
  delete servers[server];
  await writeAtomic(file, { version: 1, servers });
}

async function writeAtomic(file: string, value: CredentialsFile): Promise<void> {
  const directory = path.dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, file);
    await chmod(file, 0o600);
  } finally {
    await rm(temporary, { force: true });
  }
}
