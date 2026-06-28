import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { safeStorage } from 'electron';
import type { SecretStore } from '../common/secrets.js';

/**
 * The desktop SecretStore — credentials encrypted at rest with Electron's
 * `safeStorage` (Keychain on macOS, libsecret/DPAPI elsewhere) and written under
 * the config dir. Tokens live only in the main process, OS-encrypted, and never
 * reach the sandboxed renderer after the one-time sign-in entry. Mirrors VS Code
 * keeping credentials in the host/provider boundary.
 */
export function createSafeStorageSecrets(configDir: string): SecretStore {
  const fileFor = (key: string): string =>
    join(configDir, 'secrets', `${encodeURIComponent(key)}.bin`);
  return {
    async get(key) {
      try {
        if (!safeStorage.isEncryptionAvailable()) return null;
        const buf = await readFile(fileFor(key));
        return safeStorage.decryptString(buf);
      } catch {
        // Missing file, or undecryptable (different OS user / corrupted) → treat
        // as "no secret" so the app falls back to the signed-out state cleanly.
        return null;
      }
    },
    async set(key, value) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS encryption is unavailable; cannot store the credential securely.');
      }
      const enc = safeStorage.encryptString(value);
      const file = fileFor(key);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, enc);
    },
    async delete(key) {
      await rm(fileFor(key), { force: true });
    },
  };
}
