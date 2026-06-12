import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FILE_NAME = 'prefs.json';

/**
 * App-level user preferences — settings the MAIN process must be able to read
 * (the renderer can't own them: e.g. the background update check runs in main
 * before any window exists). Window geometry stays in window-state.json; this
 * file is for explicit user choices made in the Settings UI.
 */
export interface Prefs {
  /** Background "is a newer version available?" polling. The check itself is a
   *  read-only fetch; downloading/installing always asks the user first. */
  autoUpdateCheck: boolean;
}

const DEFAULTS: Prefs = { autoUpdateCheck: true };

/** Keep only known keys with the right types — the file may have been edited
 *  by hand, written by a newer app version, or be plain corrupt. Unknown keys
 *  are dropped (not preserved) so the file always reflects this version's
 *  schema; bad values fall back to defaults. */
export function sanitizePrefs(raw: unknown): Prefs {
  const out: Prefs = { ...DEFAULTS };
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as Record<string, unknown>;
    if (typeof r.autoUpdateCheck === 'boolean') out.autoUpdateCheck = r.autoUpdateCheck;
  }
  return out;
}

/**
 * In-memory authoritative copy + write-through persistence. Reads are sync
 * (the IPC handler returns immediately); writes are serialized through a
 * single chain so two quick toggles can't interleave their file writes.
 */
export class PrefsStore {
  private prefs: Prefs = { ...DEFAULTS };
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly configDir: string) {}

  /** Load from disk; a missing/corrupt file means defaults. Call once at startup. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(join(this.configDir, FILE_NAME), 'utf8');
      this.prefs = sanitizePrefs(JSON.parse(raw));
    } catch {
      this.prefs = { ...DEFAULTS };
    }
  }

  get(): Prefs {
    return { ...this.prefs };
  }

  /** Merge a (renderer-supplied, hence untrusted) patch and persist. Returns
   *  the merged result. Persistence failures are swallowed after updating the
   *  in-memory copy — the toggle should still work for this session even if
   *  the disk is read-only. */
  set(patch: unknown): Prefs {
    this.prefs = sanitizePrefs({ ...this.prefs, ...(typeof patch === 'object' ? patch : {}) });
    const snapshot = { ...this.prefs };
    this.writeChain = this.writeChain.then(async () => {
      try {
        await mkdir(this.configDir, { recursive: true });
        await writeFile(join(this.configDir, FILE_NAME), JSON.stringify(snapshot, null, 2), 'utf8');
      } catch {
        // Best-effort; in-memory state already updated.
      }
    });
    return this.get();
  }

  /** Resolves when all queued writes have hit disk (used by tests + quit). */
  flush(): Promise<void> {
    return this.writeChain;
  }
}
