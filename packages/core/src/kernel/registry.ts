import type { Handler } from './types.js';

/**
 * In-memory command registry. The kernel's single source of truth for which
 * module owns which command name. v0 = a plain Map; we keep the surface tiny so
 * later replacements (lazy modules, namespacing, ACLs) are local.
 *
 * Not exported from the package barrel — modules touch commands via the
 * `Core` API (`register` / `run`), not the registry directly.
 */
export class Registry {
  readonly #handlers = new Map<string, Handler>();

  register(name: string, handler: Handler): void {
    if (this.#handlers.has(name)) {
      throw new Error(`Command already registered: ${name}`);
    }
    this.#handlers.set(name, handler);
  }

  get(name: string): Handler | undefined {
    return this.#handlers.get(name);
  }

  has(name: string): boolean {
    return this.#handlers.has(name);
  }

  /** For diagnostics only (`bh --list-commands` style). */
  list(): readonly string[] {
    return Object.freeze([...this.#handlers.keys()]);
  }
}
