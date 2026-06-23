// Playwright-Electron driver for the `verify` skill — MULTI-WINDOW (Phase 3).
//
// Rewritten for the one-window-per-workspace end state. The old driver was a
// single-window script that drove a workspace "switch" via workspace.use+reload
// and asserted a since-deleted focus.md / editor-tab / file-badge-page surface;
// none of that survived the canvas redesign + the focus-mode-spec refactor + the
// multi-window refactor. This rewrite verifies the actual Phase-3 contract.
//
// What it covers (the Phase-3 payoff), driven through the real IPC bridges +
// Playwright's app.windows() so the assertions key on WINDOW COUNT and each
// window's BOUND WORKSPACE rather than fragile DOM internals:
//   - fresh config → exactly one welcome window (onboarding)
//   - open a workspace FROM the welcome window → REUSES it (rebind+reload, 1 window)
//   - open a 2nd workspace from a workspace window → a NEW window (2 windows)
//   - re-open the 1st workspace → FOCUSES its existing window (no 3rd window)
//   - per-window terminal cwd = that window's workspace (the original bug, fixed)
//   - an external edit in ws1 reaches ONLY ws1's window (root-scoped file events)
//   - File ▸ New Window → a fresh welcome window
//   - quit + relaunch → both workspace windows are restored (session restore)
//   - remove the open workspace → that window reloads to welcome
// Plus a lean DOM smoke inside a workspace window (canvas badge + editor overlay
// + autosave), using the CURRENT selectors.
//
// Run from packages/desktop (after `pnpm --filter @basehalf/core build` and
// `pnpm --filter @basehalf/desktop build`):
//   node test/verify-ui.mjs
//
// Outputs: /tmp/bh-verify-screens/*.png; exit 0 + summary on success, exit 1 on
// any failed assertion or the watchdog.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP_PKG = resolve(__dirname, '..');
const MAIN_ENTRY = join(DESKTOP_PKG, 'out', 'main', 'index.cjs');

const CONFIG_DIR = '/tmp/bh-verify-config';
const WS1_DIR = '/tmp/bh-verify-ws1';
const WS2_DIR = '/tmp/bh-verify-ws2';
const SCREENS_DIR = '/tmp/bh-verify-screens';

// Global watchdog — a hung waitFor / app.close must never trap the run for
// minutes (Electron GUI processes would pile up). Force-exit after the budget.
const WATCHDOG_MS = 150000;
const watchdog = setTimeout(() => {
  console.log(`\n❌ WATCHDOG: driver exceeded ${WATCHDOG_MS / 1000}s — forcing exit`);
  process.exit(1);
}, WATCHDOG_MS);

// ── Fresh state every run ────────────────────────────────────────────────────
for (const d of [CONFIG_DIR, WS1_DIR, WS2_DIR]) {
  if (existsSync(d)) rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
}
mkdirSync(SCREENS_DIR, { recursive: true });
writeFileSync(join(WS1_DIR, 'note-a.md'), '# Note A\n\nThe entry point.\n');
writeFileSync(join(WS1_DIR, 'note-b.md'), '# Note B\n\nThe second note.\n');
writeFileSync(join(WS2_DIR, 'other.md'), '# Other workspace\n\nDistinct file.\n');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Log page errors so a renderer crash is visible (the real reason a canvas
// might not render).
function attachLogs(page, tag) {
  page.on('pageerror', (err) => console.log(`  🛑 PAGEERROR[${tag}]:`, err.message.split('\n')[0]));
  page.on('console', (msg) => {
    if (msg.type() === 'error')
      console.log(`  🛑 CONSOLE.ERROR[${tag}]:`, msg.text().split('\n')[0]);
  });
}

// ── Launch helpers ───────────────────────────────────────────────────────────
function launch() {
  return electron.launch({
    args: [MAIN_ENTRY],
    cwd: DESKTOP_PKG,
    env: { ...process.env, BH_CONFIG_DIR: CONFIG_DIR, ELECTRON_RUN_AS_NODE: '' },
    timeout: 30000,
  });
}

const run = (w, name, args = {}) =>
  w.evaluate(({ name, args }) => window.bh.run(name, args), { name, args });

// The workspace NAME this window is bound to (null = welcome), via workspace.list's
// per-call `current` (derived from the window's injected root). Tolerant of a
// window mid-reload.
async function boundName(w) {
  try {
    const r = await run(w, 'workspace.list', {});
    return r?.current ?? null;
  } catch {
    return null;
  }
}

// Poll until a window reports it's bound to `name` (null = welcome) — a robust
// "this window finished (re)loading into the workspace" signal, independent of
// any canvas DOM.
async function waitBound(w, name, timeout = 12000) {
  const start = Date.now();
  for (;;) {
    if ((await boundName(w)) === name) return true;
    if (Date.now() - start > timeout) return false;
    await sleep(250);
  }
}

async function windowFor(app, name) {
  for (const w of app.windows()) {
    if (w.isClosed?.()) continue;
    if ((await boundName(w)) === name) return w;
  }
  return undefined;
}

const liveWindows = (app) => app.windows().filter((w) => !(w.isClosed?.() ?? false));

async function waitForWindowCount(app, n, timeout = 10000) {
  const start = Date.now();
  for (;;) {
    const live = liveWindows(app);
    if (live.length === n) return live;
    if (Date.now() - start > timeout) return live;
    await sleep(150);
  }
}

const card = (w, file) => w.locator(`[data-testid="canvas-card-${file}"]`);

// The canvas's DATA contract: the workspace's files ARE the canvas's children
// (workspace.listCanvas is the canvas's data source). This is the robust check —
// React Flow virtualizes the card DOM (off-screen nodes are culled), so the
// rendered card is a soft, logged check rather than a gating assertion.
async function canvasShows(w, file) {
  try {
    const { children } = await run(w, 'workspace.listCanvas', { folder: null });
    return Array.isArray(children) && children.some((c) => c.path === file);
  } catch {
    return false;
  }
}
// Soft: did a canvas-card actually render in the (virtualized) DOM? Logged, not gating.
async function logCardRendered(w, file) {
  const ok = await card(w, file)
    .waitFor({ timeout: 6000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) console.log(`   (soft: ${file} card not in the virtualized DOM — off-screen/culled)`);
}

async function ensureSidebarOpen(w) {
  if ((await w.locator('aside').count()) === 0) {
    await w
      .locator('[data-testid="sidebar-toggle"]')
      .click()
      .catch(() => undefined);
    await sleep(300);
  }
}

const openWorkspace = (w, name) =>
  w.evaluate((name) => window.bh.openWorkspace(name), name).catch(() => ({ reused: undefined }));

// =============================================================================
let app = await launch();
const welcome = await app.firstWindow();
attachLogs(welcome, 'win0');
await welcome.waitForLoadState('domcontentloaded');
await welcome.evaluate(() => localStorage.clear()).catch(() => undefined);
await welcome.reload();
await welcome.waitForLoadState('domcontentloaded');
await sleep(500);

await step('[1] Fresh config → exactly ONE welcome window (onboarding)', async () => {
  const live = await waitForWindowCount(app, 1);
  assert(live.length === 1, `Exactly one window at launch (${live.length})`);
  await welcome.screenshot({ path: `${SCREENS_DIR}/01-welcome.png` }).catch(() => undefined);
  const body = await welcome.locator('body').innerText();
  assert(/Welcome\./.test(body), 'Onboarding shows the "Welcome." heading');
  assert(
    (await welcome.locator('button', { hasText: 'Add a folder to begin' }).count()) === 1,
    'Onboarding has the "Add a folder to begin" CTA',
  );
  assert(
    (await boundName(welcome)) === null,
    'The launch window is bound to no workspace (welcome)',
  );
});

let ws1Name;
let ws2Name;

await step(
  '[2] Open a workspace from the welcome window → REUSES it (still 1 window)',
  async () => {
    const added = await run(welcome, 'workspace.add', { path: WS1_DIR, setup: true });
    ws1Name = added?.workspace?.name;
    assert(typeof ws1Name === 'string', `workspace.add registered ws1 (${ws1Name})`);
    await openWorkspace(welcome, ws1Name); // welcome (bound null) → reuse-sender (rebind+reload)
    // Robust load signal: the (reused) window rebinds to ws1.
    assert(await waitBound(welcome, ws1Name), 'The (reused) window rebinds to ws1');
    const live = await waitForWindowCount(app, 1);
    assert(
      live.length === 1,
      `Still exactly one window — the welcome window was REUSED (${live.length})`,
    );
    assert(
      await canvasShows(welcome, 'note-a.md'),
      'Canvas data includes note-a.md (workspace loaded)',
    );
    await logCardRendered(welcome, 'note-a.md');
    await welcome.screenshot({ path: `${SCREENS_DIR}/02-ws1.png` }).catch(() => undefined);
  },
);

// `welcome` is now the ws1 window.
const win1 = welcome;
let win2;

await step(
  '[3] Open a 2nd workspace from a workspace window → a NEW window (2 windows)',
  async () => {
    const added = await run(win1, 'workspace.add', { path: WS2_DIR, setup: false });
    ws2Name = added?.workspace?.name;
    assert(typeof ws2Name === 'string', `workspace.add registered ws2 (${ws2Name})`);
    const win2Promise = app.waitForEvent('window', { timeout: 12000 });
    await openWorkspace(win1, ws2Name); // win1 has a workspace → NEW window for ws2
    win2 = await win2Promise;
    attachLogs(win2, 'win2');
    assert(await waitBound(win2, ws2Name), 'The new window is bound to ws2');
    const live = await waitForWindowCount(app, 2);
    assert(live.length === 2, `Two windows now (${live.length})`);
    assert(
      (await boundName(win1)) === ws1Name,
      'The original window still shows ws1 (not switched)',
    );
    assert(await canvasShows(win2, 'other.md'), 'The new window’s canvas data is ws2 (other.md)');
    await logCardRendered(win2, 'other.md');
  },
);

await step(
  '[4] Re-open ws1 from ws2 window → FOCUSES the existing ws1 window (no 3rd)',
  async () => {
    const r = await openWorkspace(win2, ws1Name); // ws1 already open → focus it
    assert(
      r?.reused === false,
      'open-or-focus reported reused:false (a different window handled it)',
    );
    await sleep(600);
    const live = await waitForWindowCount(app, 2);
    assert(
      live.length === 2,
      `Still two windows — ws1 was focused, not duplicated (${live.length})`,
    );
  },
);

await step(
  '[5] Per-window terminal cwd = that window’s workspace (the original bug, fixed)',
  async () => {
    const t1 = await win1.evaluate(() => window.bh.terminal.spawn({}));
    const t2 = await win2.evaluate(() => window.bh.terminal.spawn({}));
    assert(t1?.cwd === WS1_DIR, `ws1 window's terminal spawned in ws1 (${t1?.cwd})`);
    assert(t2?.cwd === WS2_DIR, `ws2 window's terminal spawned in ws2 (${t2?.cwd})`);
    await win1.evaluate((id) => window.bh.terminal.kill(id), t1.id).catch(() => undefined);
    await win2.evaluate((id) => window.bh.terminal.kill(id), t2.id).catch(() => undefined);
  },
);

await step(
  '[6] External edit in ws1 reaches ONLY ws1’s window (root-scoped file events)',
  async () => {
    for (const w of [win1, win2]) {
      await w.evaluate(() => {
        window.__fe = [];
        window.bh.onFileEvent((e) => window.__fe.push(e));
      });
    }
    writeFileSync(join(WS1_DIR, 'note-a.md'), '# Note A\n\nEXT-EDIT-XYZ\n');
    let win1Got = false;
    for (let i = 0; i < 25; i++) {
      win1Got = await win1.evaluate(() =>
        (window.__fe ?? []).some((e) => e.relPath === 'note-a.md'),
      );
      if (win1Got) break;
      await sleep(200);
    }
    const win2Got = await win2.evaluate(() => (window.__fe ?? []).length > 0);
    assert(win1Got, 'ws1 window received its own workspace file event');
    assert(!win2Got, 'ws2 window received NO event for the ws1 edit (root-scoped broadcast)');
  },
);

await step('[6b] DOM smoke: open a file via the sidebar → editor overlay → autosave', async () => {
  // Drive the editor via the NavTree (sidebar) row — not the canvas card, which
  // React Flow virtualizes (off-screen → not in the DOM) and is unreliable to click.
  await ensureSidebarOpen(win1);
  const row = win1.locator('.bh-nav-row', { hasText: 'note-b.md' }).first();
  await row.waitFor({ timeout: 8000 });
  await row.click(); // a file row opens it (openInPanel)
  await win1.locator('[data-testid="editor-overlay"]').waitFor({ timeout: 8000 });
  assert(
    (await win1.locator('[data-testid="editor-overlay"]').count()) === 1,
    'Editor overlay opened for note-b.md',
  );
  const ed = win1
    .locator('[data-testid="editor-overlay"] .bn-editor[contenteditable="true"]')
    .first();
  await ed.waitFor({ timeout: 8000 });
  // Click into the editor, jump to the end of the doc, type, let autosave debounce.
  await ed.click();
  await sleep(200);
  await win1.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await win1.keyboard.type(' AUTOSAVE-PROBE');
  await sleep(1800);
  const onDisk = readFileSync(join(WS1_DIR, 'note-b.md'), 'utf-8');
  if (!onDisk.includes('AUTOSAVE-PROBE')) {
    const edText = await ed.innerText().catch(() => '?');
    console.log(
      `   (diag: editor="${edText.slice(0, 70).replace(/\s+/g, ' ')}" disk="${onDisk.slice(0, 70).replace(/\s+/g, ' ')}")`,
    );
  }
  assert(onDisk.includes('AUTOSAVE-PROBE'), 'Typed text auto-saved to note-b.md on disk');
});

await step('[7] File ▸ New Window → a fresh welcome window', async () => {
  const winPromise = app.waitForEvent('window', { timeout: 12000 });
  await win1.evaluate(() => window.bh.newWindow());
  const w3 = await winPromise;
  attachLogs(w3, 'win3');
  assert(await waitBound(w3, null), 'The New Window is a welcome window (no workspace bound)');
  const live = await waitForWindowCount(app, 3);
  assert(live.length === 3, `Three windows after New Window (${live.length})`);
  await w3.close(); // close it so session-restore below sees just ws1 + ws2
  await waitForWindowCount(app, 2);
});

await step(
  '[8] Quit + relaunch → BOTH workspace windows are restored (session restore)',
  async () => {
    // app.close() drives app.quit(); the quit fix flushes all windows then exits.
    // Guard it with a timeout so a regression can't hang the run.
    await Promise.race([app.close(), sleep(20000)]);
    app = await launch();
    const first = await app.firstWindow();
    attachLogs(first, 'relaunch');
    const live = await waitForWindowCount(app, 2, 15000);
    assert(live.length === 2, `Relaunch restored two windows (${live.length})`);
    const names = (await Promise.all(live.map((w) => boundName(w)))).sort();
    assert(
      names.length === 2 && names[0] === ws1Name && names[1] === ws2Name,
      `Restored windows are bound to ws1 + ws2 (${JSON.stringify(names)})`,
    );
  },
);

await step('[9] Remove the open workspace → that window reloads to welcome', async () => {
  const w = await windowFor(app, ws2Name);
  assert(!!w, 'Found the ws2 window after relaunch');
  if (w) {
    await w.evaluate(async (name) => {
      await window.bh.run('workspace.remove', { name });
      await window.bh.reopenWindow(null);
    }, ws2Name);
    assert(await waitBound(w, null), 'The window reloaded to the welcome state');
    await w.locator('button', { hasText: 'Add a folder to begin' }).waitFor({ timeout: 8000 });
    const live = await waitForWindowCount(app, 2);
    assert(
      live.length === 2,
      `Still two windows — removal reloaded, did not close (${live.length})`,
    );
  }
});

// ── Summary ──────────────────────────────────────────────────────────────────
await liveWindows(app)[0]
  ?.screenshot({ path: `${SCREENS_DIR}/zz-final.png` })
  .catch(() => undefined);
await Promise.race([app.close(), sleep(15000)]);
clearTimeout(watchdog);

console.log(`\n${'='.repeat(60)}`);
if (failures.length === 0) {
  console.log('✅ verify-ui: all multi-window checks passed');
  process.exit(0);
} else {
  console.log(`❌ verify-ui: ${failures.length} failure(s):`);
  for (const f of failures) console.log(`   - ${f}`);
  process.exit(1);
}
