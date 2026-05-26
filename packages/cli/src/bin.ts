#!/usr/bin/env node
/**
 * bh — BaseHalf CLI (v0 scaffold)
 *
 * This is a thin shell. All real work lives in @basehalf/core. The argv parser
 * and the command dispatcher land in PR 2+, alongside the first real module.
 *
 * Right now: createCore() produces a kernel with no modules registered, so
 * every command name will throw UnknownCommand. The shell just confirms the
 * wiring is alive and points the user at where commands will appear.
 */
import { createCore } from '@basehalf/core';

const core = createCore();

const banner = [
  'bh — BaseHalf CLI (scaffold)',
  '',
  '  Status: kernel is up, no modules registered yet.',
  '  Next:   PR 2+ wires the first module under packages/core/src/modules/.',
  '',
  '  See CLAUDE.md for current agent instructions.',
  '',
].join('\n');

// `void` to satisfy "no floating promises" — `core.has` is sync, no await needed.
void core; // touch the imported value so tsup/biome don't trip "unused import" later

process.stdout.write(banner);
process.exit(0);
