#!/usr/bin/env node
/**
 * Single source of truth for the PRODUCT version. Bumps the workspace root and
 * the desktop app package.json in LOCKSTEP so they can never diverge — the
 * desktop one is what the packaged app reports (app.getVersion) and what
 * scripts/sign-update.mjs stamps into the update manifest.
 *
 *   node scripts/bump-version.mjs 0.3.0     # set an explicit version
 *   node scripts/bump-version.mjs patch     # 0.2.4 -> 0.2.5
 *   node scripts/bump-version.mjs minor     # 0.2.4 -> 0.3.0
 *   node scripts/bump-version.mjs major     # 0.2.4 -> 1.0.0
 *
 * Writes the files only and prints the follow-up release steps — it does NOT
 * git-commit or tag, so you stay in control. Run from the repo root.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = join(ROOT, 'packages', 'desktop', 'package.json');
const TARGETS = [join(ROOT, 'package.json'), DESKTOP];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function nextVersion(current, arg) {
  if (SEMVER.test(arg)) return arg; // explicit x.y.z
  const m = SEMVER.exec(current);
  if (!m) fail(`Current desktop version "${current}" is not strict x.y.z.`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (arg === 'major') return `${maj + 1}.0.0`;
  if (arg === 'minor') return `${maj}.${min + 1}.0`;
  if (arg === 'patch') return `${maj}.${min}.${pat + 1}`;
  fail('Usage: node scripts/bump-version.mjs <x.y.z|patch|minor|major>');
  return current; // unreachable (fail exits); keeps the type checker happy
}

const arg = process.argv[2];
if (!arg) fail('Usage: node scripts/bump-version.mjs <x.y.z|patch|minor|major>');

const current = JSON.parse(readFileSync(DESKTOP, 'utf8')).version;
const version = nextVersion(current, arg);
if (!SEMVER.test(version)) fail(`"${version}" is not strict x.y.z.`);

for (const path of TARGETS) {
  const raw = readFileSync(path, 'utf8');
  // Format-preserving: replace only the first (top-level) "version" field.
  const updated = raw.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
  if (updated === raw) fail(`No "version" field found in ${path}.`);
  writeFileSync(path, updated);
}

const DIST = `packages/desktop/dist/BaseHalf-${version}-arm64`;
console.log(`Version: ${current} -> ${version}  (root + desktop, in lockstep)`);
console.log('Next (all from the repo root):');
console.log('  1. pnpm --filter @basehalf/desktop dist:mac');
console.log(`  2. node packages/desktop/scripts/sign-update.mjs ${DIST}.zip`);
console.log(`  3. git commit -am "release: v${version}" && git tag v${version}`);
console.log(
  `  4. gh release create v${version} ${DIST}.dmg ${DIST}.zip packages/desktop/dist/update-manifest-darwin-arm64.json`,
);
