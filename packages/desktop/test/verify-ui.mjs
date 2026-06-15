// Playwright-Electron driver for the `verify` skill.
//
// Rewritten for the three-region layout (sidebar | canvas | editor space) the
// canvas-as-backdrop redesign (#119/#120) introduced — the old driver was
// written for the pre-redesign TopBar+Main shell and broke wholesale (it failed
// at [2]/[3] on the removed `sidebar-workspace-select` testid and the old
// `<aside>` assumption, before reaching any later check).
//
// Design of this rewrite:
//  - Each check runs inside `step(name, fn)`, which try/catches so ONE failing
//    step (e.g. a selector timeout) reports and the run CONTINUES — instead of
//    crashing the whole driver on the first throw (the old monolith's flaw).
//  - UI prefs (sidebar open/width, right-panel, zoom, fda-tip) live in the
//    renderer's localStorage, which persists in Electron's userData across runs
//    independently of BH_CONFIG_DIR. We localStorage.clear() + reload at startup
//    so sidebar/panel state is deterministic (the real cause of the old driver's
//    flaky `[3] aside` timeout was a leaked bh:sidebar-open='0').
//
// Run from packages/desktop (after `pnpm --filter @basehalf/desktop build`):
//   node test/verify-ui.mjs
//
// Outputs: /tmp/bh-verify-screens/*.png; exit 0 + summary on success, exit 1 on
// any failed assertion.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP_PKG = resolve(__dirname, '..');
const MAIN_ENTRY = join(DESKTOP_PKG, 'out', 'main', 'index.cjs');

const CONFIG_DIR = '/tmp/bh-verify-config';
const WORKSPACE_DIR = '/tmp/bh-verify-ws';
const WORKSPACE2_DIR = '/tmp/bh-verify-ws2';
const SCREENS_DIR = '/tmp/bh-verify-screens';

// ── Fresh state every run ────────────────────────────────────────────────────
for (const d of [CONFIG_DIR, WORKSPACE_DIR, WORKSPACE2_DIR]) {
  if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
}
mkdirSync(SCREENS_DIR, { recursive: true });

// Seed the primary workspace. Canvas badges materialize for md / image / pdf;
// code/text (.ts) lives in the NavTree only. Small but representative.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAADBJREFUOE9j/M+ABzC+JEHB/8N/MQpAFCBSDIw0OAUkVlMQVAxANCKvAAOJyERjqzgFAJ+lFXmwl/2QAAAAAElFTkSuQmCC';
writeFileSync(join(WORKSPACE_DIR, 'note-a.md'), '# Note A\n\nThe entry point.\n');
writeFileSync(join(WORKSPACE_DIR, 'note-b.md'), '# Note B\n\nThe second note.\n');
writeFileSync(
  join(WORKSPACE_DIR, 'note-c.md'),
  '# Note C\n\nA note we delete to test orphaning.\n',
);
writeFileSync(join(WORKSPACE_DIR, 'icon.png'), Buffer.from(TINY_PNG_BASE64, 'base64'));
writeFileSync(join(WORKSPACE_DIR, 'sample.pdf'), '%PDF-1.4\n%verify placeholder\n%%EOF\n');
writeFileSync(
  join(WORKSPACE_DIR, 'sample.ts'),
  'export const answer = 42;\r\nconsole.log(answer);\r\n',
);
// A subfolder (+ a file in it) so the canvas shows a FOLDER badge to navigate into.
mkdirSync(join(WORKSPACE_DIR, 'chapter'), { recursive: true });
writeFileSync(join(WORKSPACE_DIR, 'chapter', 'sec.md'), '# Section\n\nInside a folder.\n');
writeFileSync(join(WORKSPACE2_DIR, 'other.md'), '# Other workspace\n\nDistinct file.\n');

// ── Assertion + step harness ─────────────────────────────────────────────────
const failures = [];
const assert = (cond, msg) => {
  if (cond) console.log(`  ✅ ${msg}`);
  else {
    console.log(`  ❌ ${msg}`);
    failures.push(msg);
  }
};
async function step(name, fn) {
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (e) {
    const m = (e instanceof Error ? e.message : String(e)).split('\n')[0];
    console.log(`  ❌ EXCEPTION: ${m}`);
    failures.push(`${name} → ${m}`);
  }
}

// ── Launch ───────────────────────────────────────────────────────────────────
const app = await electron.launch({
  args: [MAIN_ENTRY],
  cwd: DESKTOP_PKG,
  env: { ...process.env, BH_CONFIG_DIR: CONFIG_DIR, ELECTRON_RUN_AS_NODE: '' },
  timeout: 30000,
});
const win = await app.firstWindow();
await win.waitForLoadState('domcontentloaded');
win.on('pageerror', (err) => console.log('  🛑 PAGEERROR:', err.message));
win.on('console', (msg) => {
  if (msg.type() === 'error') console.log('  🛑 CONSOLE.ERROR:', msg.text());
});

// Deterministic UI prefs: wipe any leaked localStorage then reload.
await win.evaluate(() => localStorage.clear());
await win.reload();
await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(500);

// ── Helpers ──────────────────────────────────────────────────────────────────
const bhRun = (name, args = {}) =>
  win.evaluate(({ name, args }) => window.bh.run(name, args), { name, args });

const card = (file) => win.locator(`[data-testid="canvas-card-${file}"]`);
const editorAside = () => win.locator('aside').last(); // sidebar = first, editor = last
const sidebarAside = () => win.locator('aside').first();

const openPalette = async () => {
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await win.locator('[data-testid="command-palette-input"]').waitFor({ timeout: 3000 });
};

async function ensureSidebarOpen() {
  if ((await sidebarAside().count()) === 0) {
    await win.locator('[data-testid="sidebar-toggle"]').click();
    await win.waitForTimeout(200);
  }
}

// =============================================================================
await step('[1] Empty state (onboarding)', async () => {
  await win.screenshot({ path: `${SCREENS_DIR}/01-empty.png` });
  const body = await win.locator('body').innerText();
  assert(/Welcome\./.test(body), 'Onboarding shows the "Welcome." heading');
  assert(/canvas for any file/i.test(body), 'Onboarding shows the pitch copy');
  assert(
    (await win.locator('button', { hasText: 'Add a folder to begin' }).count()) === 1,
    'Onboarding has the "Add a folder to begin" CTA',
  );
  assert(
    (await win.locator('button', { hasText: 'Try a demo workspace' }).count()) === 1,
    'Onboarding offers the "Try a demo workspace" CTA',
  );
  assert(
    (await win.locator('[data-testid="sidebar-toggle"]').count()) === 1,
    'TitleBar carries the sidebar toggle',
  );
  assert(
    (await win.locator('[data-testid="command-center"]').count()) === 1,
    'TitleBar carries the command center (search)',
  );
});

await step('[1b] workspace.createDemo (core path)', async () => {
  const demoPath = '/tmp/bh-verify-demo-ws';
  if (existsSync(demoPath)) rmSync(demoPath, { recursive: true, force: true });
  const demo = await bhRun('workspace.createDemo', { path: demoPath, name: 'bh-verify-demo' });
  assert(
    demo?.filesCreated?.includes('intro.md'),
    `createDemo seeded intro.md (${JSON.stringify(demo?.filesCreated)})`,
  );
  assert(
    demo?.setup?.claudeMdUpdated === true,
    'createDemo installed the agent-protocol hint in CLAUDE.md',
  );
  await bhRun('workspace.remove', { name: 'bh-verify-demo' }).catch(() => undefined);
  if (existsSync(demoPath)) rmSync(demoPath, { recursive: true, force: true });
});

await step('[2] Register workspace + reload → canvas loads', async () => {
  const add = await bhRun('workspace.add', { path: WORKSPACE_DIR, setup: true });
  assert(
    add?.setup?.claudeMdUpdated === true || add?.setup?.claudeMdSkipped === true,
    'workspace.add(setup:true) returned a setup report',
  );
  const claudeMd = readFileSync(join(WORKSPACE_DIR, 'CLAUDE.md'), 'utf-8');
  assert(
    /bh:workspace-hint/.test(claudeMd) && /focus\.md/.test(claudeMd),
    'CLAUDE.md installed with the agent-protocol hint (marker + focus.md)',
  );
  await bhRun('workspace.use', { name: add?.workspace?.name ?? 'bh-verify-ws' });
  await bhRun('workspace.add', { path: WORKSPACE2_DIR, setup: false });
  await bhRun('workspace.use', { name: 'bh-verify-ws' });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1200);
  await win.screenshot({ path: `${SCREENS_DIR}/02-loaded.png` });
  await card('note-a.md').waitFor({ timeout: 8000 });
  assert((await card('note-a.md').count()) === 1, 'Canvas renders the note-a.md badge');
  assert(
    (await win.locator('button', { hasText: 'New note' }).count()) >= 1,
    'Canvas shows the floating "New note" button',
  );
});

await step('[3] Sidebar: aside, name, path-in-title, sash resize, toggle', async () => {
  await ensureSidebarOpen();
  const sidebar = sidebarAside();
  await sidebar.waitFor({ timeout: 5000 });
  assert(
    (await sidebar.innerText()).toLowerCase().includes('bh-verify-ws'),
    'Sidebar shows the workspace name',
  );
  const titleAttr = await sidebar.locator('> div').first().getAttribute('title');
  assert(
    typeof titleAttr === 'string' && titleAttr.includes('/tmp/bh-verify-ws'),
    'Workspace path is in the header title tooltip (not visible text)',
  );
  const sash = win.locator('[data-testid="sidebar-sash"]');
  assert((await sash.count()) === 1, 'Sidebar has a resize sash');
  const wBefore = (await sidebar.boundingBox()).width;
  const sb = await sash.boundingBox();
  await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await win.mouse.down();
  await win.mouse.move(sb.x + sb.width / 2 + 80, sb.y + sb.height / 2, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(150);
  const wAfter = (await sidebar.boundingBox()).width;
  // Assert the drag WIDENED the sidebar meaningfully in the right direction. (Not
  // an exact +80: the pointer delta doesn't map 1:1 to width — window scaling +
  // the sash grab-point introduce slack — so an exact check is flaky.)
  const grew = wAfter - wBefore;
  assert(
    grew > 30 && grew < 200,
    `Sash drag widened the sidebar (${Math.round(wBefore)} → ${Math.round(wAfter)}, +${Math.round(grew)})`,
  );
  await win.locator('[data-testid="sidebar-toggle"]').click();
  await win.waitForTimeout(200);
  assert((await win.locator('aside').count()) === 0, 'Toggle fully hides the sidebar');
  await win.locator('[data-testid="sidebar-toggle"]').click();
  await win.waitForTimeout(200);
  assert((await sidebarAside().count()) === 1, 'Toggle brings the sidebar back');
});

await step('[4] NavTree renders file rows', async () => {
  await ensureSidebarOpen();
  const rows = win.locator('.bh-nav-row');
  assert((await rows.count()) >= 3, `NavTree renders rows (${await rows.count()})`);
  assert(
    (await win.locator('.bh-nav-row', { hasText: 'sample.ts' }).count()) >= 1,
    'NavTree lists sample.ts (code lives in the tree, not the canvas)',
  );
});

await step('[5] Canvas badges for supported files; code excluded', async () => {
  for (const f of ['note-a.md', 'note-b.md', 'note-c.md', 'icon.png', 'sample.pdf']) {
    assert((await card(f).count()) === 1, `Canvas badge present: ${f}`);
  }
  assert((await card('sample.ts').count()) === 0, 'Code file is NOT a canvas badge (NavTree only)');
});

await step(
  '[5d] Selection-as-deixis: single = UI-only, multi (≥2) mirrors to focus.md',
  async () => {
    await bhRun('focus.clear', {});
    await card('note-a.md').click();
    await win.waitForTimeout(450); // past FOCUS_MIRROR_DEBOUNCE (250ms)
    assert(
      (await card('note-a.md').getAttribute('data-selected')) === 'true',
      'Single click selects the badge (data-selected=true)',
    );
    const afterSingle = await bhRun('focus.get', {});
    assert(
      Array.isArray(afterSingle.active) && afterSingle.active.length === 0,
      `Single selection stays UI-only — focus empty (${JSON.stringify(afterSingle.active)})`,
    );
    await card('note-b.md').click({ modifiers: ['Shift'] });
    await win.waitForTimeout(500);
    const afterMulti = await bhRun('focus.get', {});
    assert(
      afterMulti.active.length === 2 &&
        afterMulti.active.includes('note-a.md') &&
        afterMulti.active.includes('note-b.md'),
      `Multi-select (≥2) mirrors both into focus (${JSON.stringify(afterMulti.active)})`,
    );
    const brief = (await bhRun('focus.brief', {})).brief ?? '';
    assert(
      /^\s*-\s*note-a\.md\s*$/m.test(brief) && /^\s*-\s*note-b\.md\s*$/m.test(brief),
      'focus.md lists both files after multi-select',
    );
  },
);

await step('[5d-chip] Agent Context chip + clear', async () => {
  const chip = win.locator('[data-testid="focus-chip"]');
  await chip.waitFor({ timeout: 3000 });
  assert(
    (await chip.innerText()).toLowerCase().includes('agent context'),
    'Focus chip shows "Agent Context"',
  );
  await win.locator('[data-testid="focus-clear"]').click();
  await win.waitForTimeout(400);
  assert((await bhRun('focus.get', {})).active.length === 0, 'focus-clear empties the context');
});

await step('[5-folder] Folder badge → sub-canvas (folder = the grouping) → exit', async () => {
  assert((await card('chapter').count()) === 1, 'Canvas shows the chapter/ folder badge');
  await card('chapter').dblclick();
  await win.waitForTimeout(700);
  assert(
    (await card('chapter/sec.md').count()) === 1,
    'Double-click scopes INTO the folder — its file badge is shown',
  );
  const sidebarBox = await sidebarAside().boundingBox();
  const chromeBox = await win.locator('[data-testid="folder-scope-chrome"]').boundingBox();
  const crumbBox = await win.locator('[data-testid="breadcrumb"]').boundingBox();
  assert(
    sidebarBox &&
      chromeBox &&
      crumbBox &&
      chromeBox.x >= sidebarBox.x + sidebarBox.width - 1 &&
      crumbBox.x >= sidebarBox.x + sidebarBox.width - 1,
    'Folder breadcrumb chrome clears the floating sidebar',
  );
  assert(
    (await win.locator('[data-testid="breadcrumb-current"]', { hasText: 'chapter' }).count()) === 1,
    'Breadcrumb shows the scoped folder as the current (non-clickable) crumb',
  );
  assert((await card('note-a.md').count()) === 0, 'Root-level badges are hidden inside the scope');
  // The home/workspace crumb (the trail's only ancestor link here) returns to root.
  await win.locator('[data-testid="breadcrumb"] button').first().click();
  await win.waitForTimeout(500);
  await card('note-a.md').waitFor({ timeout: 4000 });
  assert(
    (await card('note-a.md').count()) === 1,
    'Exiting the folder scope restores the root canvas',
  );
});

await step('[6] Double-click a badge → editor opens in the right panel', async () => {
  await card('note-a.md').dblclick();
  await win.waitForTimeout(800);
  await editorAside().waitFor({ timeout: 5000 });
  assert(
    (await win.locator('[data-testid="editor-tab"]', { hasText: 'note-a.md' }).count()) >= 1,
    'An editor tab opened for note-a.md',
  );
  await win.locator('[data-editor-surface="panel"] .bn-editor').first().waitFor({ timeout: 5000 });
  assert(
    (await win.locator('[data-editor-surface="panel"]').count()) >= 1,
    'The editor surface mounted for the markdown file',
  );
});

await step('[7] Edit Markdown → auto-saves to disk', async () => {
  const ed = win
    .locator('[data-editor-surface="panel"] .bn-editor[contenteditable="true"]')
    .first();
  await ed.waitFor({ timeout: 5000 });
  await ed.click();
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await win.keyboard.type(' AUTOSAVE-PROBE-XYZ');
  await win.waitForTimeout(900);
  const onDisk = readFileSync(join(WORKSPACE_DIR, 'note-a.md'), 'utf-8');
  assert(onDisk.includes('AUTOSAVE-PROBE-XYZ'), 'Typed text auto-saved to note-a.md on disk');
});

await step(
  '[7-ext] External edit on disk → the open (clean) editor adopts it (file = truth)',
  async () => {
    // note-a.md is open + clean (autosaved above). An agent/Finder edit to the file
    // must be ADOPTED by the editor, not silently lost.
    writeFileSync(join(WORKSPACE_DIR, 'note-a.md'), '# Note A\n\nEXTERNALLY-EDITED-XYZ\n');
    let adopted = false;
    for (let i = 0; i < 20; i++) {
      const txt = await win
        .locator('[data-editor-surface="panel"] .bn-editor')
        .first()
        .innerText()
        .catch(() => '');
      if (txt.includes('EXTERNALLY-EDITED-XYZ')) {
        adopted = true;
        break;
      }
      await win.waitForTimeout(300);
    }
    assert(adopted, 'Editor adopted the external on-disk edit');
  },
);

await step('[7-img] Image badge opens the image viewer', async () => {
  await card('icon.png').dblclick();
  await win.waitForTimeout(800);
  assert((await win.locator('[data-pane-id] img').count()) >= 1, 'Image opens in an <img> viewer');
});

await step('[7-code] Code file (NavTree) opens read-only text viewer', async () => {
  await ensureSidebarOpen();
  await win.locator('.bh-nav-row', { hasText: 'sample.ts' }).first().click();
  await win.waitForTimeout(800);
  assert(
    (await win.locator('[data-pane-id] pre').count()) >= 1,
    'Code file opens in a read-only <pre> viewer',
  );
});

await step('[7-pdf] PDF badge opens the iframe viewer', async () => {
  await card('sample.pdf').dblclick();
  await win.waitForTimeout(800);
  // The placeholder PDF's content may error in Electron's sandboxed PDF renderer
  // (a content-load quirk, not a missing viewer) — assert the tab + the <iframe>
  // element, which mount regardless of whether pdfium can parse the bytes.
  assert(
    (await win.locator('[data-testid="editor-tab"]', { hasText: 'sample.pdf' }).count()) >= 1,
    'PDF opens an editor tab',
  );
  assert(
    (await win.locator('[data-pane-id] iframe').count()) >= 1,
    'PDF opens in an <iframe> viewer',
  );
});

await step('[8] File Badge page: open via card → prompt persists', async () => {
  const titled = card('note-b.md').locator('button[title="Edit File Badge"]');
  if ((await titled.count()) >= 1) await titled.first().click();
  else await card('note-b.md').locator('button').last().click();
  const page = win.locator('[data-testid="file-badge-page"]');
  await page.waitFor({ timeout: 4000 });
  assert((await page.count()) === 1, 'File Badge page opened');
  await win.locator('[data-testid="file-badge-prompt"]').fill('Verify-driver prompt for note-b');
  await win.waitForTimeout(900); // debounced save
  const badge = await bhRun('badge.get', { file: 'note-b.md' });
  assert(
    badge?.prompt === 'Verify-driver prompt for note-b',
    'Badge prompt persisted via the page',
  );
});

await step('[9] Cmd+K palette: opens, finds a file, opens it', async () => {
  await openPalette();
  await win.locator('[data-testid="command-palette-input"]').fill('note-c');
  await win.waitForTimeout(300);
  const opt = win.locator('[role=option]', { hasText: 'note-c.md' }).first();
  assert((await opt.count()) >= 1, 'Palette finds note-c.md');
  await opt.click();
  await win.waitForTimeout(700);
  assert(
    (await win.locator('[data-testid="editor-tab"]', { hasText: 'note-c.md' }).count()) >= 1,
    'Selecting the palette file opened it in the editor',
  );
});

await step('[10] Workspace switch via palette replaces the canvas', async () => {
  await openPalette();
  await win.locator('[data-testid="command-palette-input"]').fill('bh-verify-ws2');
  await win.waitForTimeout(300);
  const opt = win.locator('[role=option]', { hasText: 'bh-verify-ws2' }).first();
  assert((await opt.count()) >= 1, 'Palette offers the 2nd workspace');
  await opt.click();
  await win.waitForTimeout(1200);
  await card('other.md').waitFor({ timeout: 6000 });
  assert((await card('other.md').count()) === 1, 'Switched workspace shows other.md');
  assert((await card('note-a.md').count()) === 0, 'Previous workspace badges are gone');
  await bhRun('workspace.use', { name: 'bh-verify-ws' });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(1000);
  await card('note-a.md').waitFor({ timeout: 6000 });
});

await step('[11] External delete → badge marked orphan', async () => {
  await bhRun('focus.clear', {});
  rmSync(join(WORKSPACE_DIR, 'note-c.md'), { force: true });
  let orphaned = false;
  for (let i = 0; i < 20; i++) {
    const b = await bhRun('badge.get', { file: 'note-c.md' }).catch(() => null);
    if (b?.orphan === true) {
      orphaned = true;
      break;
    }
    await win.waitForTimeout(300);
  }
  assert(orphaned, 'Watcher marked note-c.md badge as orphan after external delete');
});

// ── Summary ──────────────────────────────────────────────────────────────────
await win.screenshot({ path: `${SCREENS_DIR}/zz-final.png` });
await app.close();

console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log('✅ verify-ui: all checks passed');
  process.exit(0);
} else {
  console.log(`❌ verify-ui: ${failures.length} failure(s):`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
