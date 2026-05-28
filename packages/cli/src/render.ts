/**
 * Renders core command results.
 *  - `--json` mode: stable JSON to stdout, one trailing newline.
 *  - default: human-readable pretty text.
 *
 * Per-command formatters live here so bin.ts stays a flat dispatcher.
 */

type WorkspaceEntry = { name: string; path: string; addedAt: string };

type SetupReport = {
  gitignoreUpdated: boolean;
  claudeMdUpdated: boolean;
  gitignoreSkipped: boolean;
  claudeMdSkipped: boolean;
  gitignoreAbsent: boolean;
};

type Badge = {
  bhVersion: 1;
  file: string;
  kind: 'file' | 'folder';
  prompt?: string;
  references: { to: string; note?: string }[];
  canvas?: { x: number; y: number; collapsed: boolean };
  createdAt: string;
  modifiedAt: string;
};

type SavedView = {
  bhVersion: 1;
  id: string;
  name: string;
  prompt?: string;
  members: { file: string; x?: number; y?: number; collapsed?: boolean }[];
  createdAt: string;
  modifiedAt: string;
};

export function render(commandName: string, result: unknown, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  switch (commandName) {
    case 'workspace.add':
      renderWsAdd(
        result as {
          workspace: WorkspaceEntry;
          setAsCurrent: boolean;
          bhDirCreated: boolean;
          setup?: SetupReport;
        },
      );
      return;
    case 'workspace.list':
      renderWsList(result as { current: string | null; workspaces: WorkspaceEntry[] });
      return;
    case 'workspace.use':
      renderWsUse(result as { current: WorkspaceEntry });
      return;
    case 'workspace.current':
      renderWsCurrent(result as { current: WorkspaceEntry | null });
      return;
    case 'workspace.remove':
      renderWsRemove(result as { removed: string; newCurrent: string | null });
      return;
    case 'badge.get':
      renderBadge(result as Badge | null);
      return;
    case 'badge.set':
    case 'badge.addRef':
    case 'badge.removeRef':
      renderBadge(result as Badge);
      return;
    case 'badge.list':
      renderBadgeList(result as { badges: Badge[] });
      return;
    case 'inbound.get':
      renderInboundGet(result as { entries: { from: string; note?: string }[] });
      return;
    case 'inbound.rebuild':
      renderInboundRebuild(result as { rebuildAt: string; entryCount: number });
      return;
    case 'focus.set':
    case 'focus.get':
      renderFocusActive(result as { active: string[] });
      return;
    case 'focus.clear':
      process.stdout.write('Focus cleared.\n');
      return;
    case 'view.create':
    case 'view.get':
    case 'view.addMember':
    case 'view.removeMember':
      renderView(result as SavedView | null);
      return;
    case 'view.list':
      renderViewList(result as { views: SavedView[] });
      return;
    case 'view.delete':
      renderViewDelete(result as { deleted: boolean });
      return;
    default:
      // Fallback: pretty-print whatever we got.
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

// ── workspace ───────────────────────────────────────────────────────────────

function renderWsAdd(r: {
  workspace: WorkspaceEntry;
  setAsCurrent: boolean;
  bhDirCreated: boolean;
  setup?: SetupReport;
}): void {
  process.stdout.write(`Added workspace "${r.workspace.name}"\n`);
  process.stdout.write(`  path:    ${r.workspace.path}\n`);
  if (r.bhDirCreated) process.stdout.write('  .bh/:    created\n');
  if (r.setAsCurrent) process.stdout.write('  current: yes (first workspace)\n');
  if (r.setup) {
    const s = r.setup;
    if (s.gitignoreUpdated) process.stdout.write('  setup:   .bh/cache/ added to .gitignore\n');
    else if (s.gitignoreSkipped)
      process.stdout.write('  setup:   .gitignore already had .bh/cache/\n');
    else if (s.gitignoreAbsent)
      process.stdout.write('  setup:   no .gitignore (not a git repo?) — skipped\n');
    if (s.claudeMdUpdated)
      process.stdout.write('  setup:   workspace hint appended to CLAUDE.md\n');
    else if (s.claudeMdSkipped)
      process.stdout.write('  setup:   CLAUDE.md already had workspace hint\n');
  }
}

function renderWsList(r: { current: string | null; workspaces: WorkspaceEntry[] }): void {
  if (r.workspaces.length === 0) {
    process.stdout.write('No workspaces yet. Add one with `bh workspace add <path>`.\n');
    return;
  }
  for (const ws of r.workspaces) {
    const marker = ws.name === r.current ? '*' : ' ';
    process.stdout.write(`${marker} ${ws.name.padEnd(20)} ${ws.path}\n`);
  }
}

function renderWsUse(r: { current: WorkspaceEntry }): void {
  process.stdout.write(`Now using workspace "${r.current.name}" (${r.current.path})\n`);
}

function renderWsCurrent(r: { current: WorkspaceEntry | null }): void {
  if (r.current === null) {
    process.stdout.write('No active workspace. Use `bh workspace use <name>` to set one.\n');
    return;
  }
  process.stdout.write(`${r.current.name} (${r.current.path})\n`);
}

function renderWsRemove(r: { removed: string; newCurrent: string | null }): void {
  process.stdout.write(`Removed workspace "${r.removed}"\n`);
  if (r.newCurrent) process.stdout.write(`Current is now: ${r.newCurrent}\n`);
}

// ── badge ───────────────────────────────────────────────────────────────────

function renderBadge(badge: Badge | null): void {
  if (!badge) {
    process.stdout.write('(no badge — not materialized yet)\n');
    return;
  }
  process.stdout.write(`${badge.kind}: ${badge.file}\n`);
  if (badge.prompt) process.stdout.write(`  prompt:     ${badge.prompt}\n`);
  if (badge.references.length > 0) {
    process.stdout.write(`  references: (${badge.references.length})\n`);
    for (const ref of badge.references) {
      const note = ref.note ? `  — ${ref.note}` : '';
      process.stdout.write(`    → ${ref.to}${note}\n`);
    }
  }
  if (badge.canvas) {
    process.stdout.write(
      `  canvas:     (${badge.canvas.x}, ${badge.canvas.y})${badge.canvas.collapsed ? ' [collapsed]' : ''}\n`,
    );
  }
  process.stdout.write(`  modified:   ${badge.modifiedAt}\n`);
}

function renderBadgeList(r: { badges: Badge[] }): void {
  if (r.badges.length === 0) {
    process.stdout.write('No badges materialized in this workspace.\n');
    return;
  }
  for (const b of r.badges) {
    const kindMark = b.kind === 'folder' ? '/' : ' ';
    const prompt = b.prompt ? `  ${b.prompt.slice(0, 60)}${b.prompt.length > 60 ? '…' : ''}` : '';
    const refs = b.references.length > 0 ? ` (${b.references.length} refs)` : '';
    process.stdout.write(`${kindMark} ${b.file}${refs}${prompt}\n`);
  }
}

// ── inbound ─────────────────────────────────────────────────────────────────

function renderInboundGet(r: { entries: { from: string; note?: string }[] }): void {
  if (r.entries.length === 0) {
    process.stdout.write('(no inbound references)\n');
    return;
  }
  for (const e of r.entries) {
    const note = e.note ? `  — ${e.note}` : '';
    process.stdout.write(`← ${e.from}${note}\n`);
  }
}

function renderInboundRebuild(r: { rebuildAt: string; entryCount: number }): void {
  process.stdout.write(`Rebuilt inbound index: ${r.entryCount} targets at ${r.rebuildAt}\n`);
}

// ── focus ───────────────────────────────────────────────────────────────────

function renderFocusActive(r: { active: string[] }): void {
  if (r.active.length === 0) {
    process.stdout.write('(no active focus)\n');
    return;
  }
  for (const f of r.active) {
    process.stdout.write(`* ${f}\n`);
  }
}

// ── view ────────────────────────────────────────────────────────────────────

function renderView(view: SavedView | null): void {
  if (!view) {
    process.stdout.write('(no view)\n');
    return;
  }
  process.stdout.write(`${view.id}: ${view.name}\n`);
  if (view.prompt) process.stdout.write(`  prompt:  ${view.prompt}\n`);
  if (view.members.length > 0) {
    process.stdout.write(`  members: (${view.members.length})\n`);
    for (const m of view.members) {
      const pos = m.x !== undefined && m.y !== undefined ? `  (${m.x}, ${m.y})` : '';
      process.stdout.write(`    - ${m.file}${pos}\n`);
    }
  }
}

function renderViewList(r: { views: SavedView[] }): void {
  if (r.views.length === 0) {
    process.stdout.write('No saved views in this workspace.\n');
    return;
  }
  for (const v of r.views) {
    process.stdout.write(`${v.id.padEnd(20)} ${v.name}  (${v.members.length} members)\n`);
  }
}

function renderViewDelete(r: { deleted: boolean }): void {
  process.stdout.write(r.deleted ? 'View deleted.\n' : 'No such view.\n');
}
