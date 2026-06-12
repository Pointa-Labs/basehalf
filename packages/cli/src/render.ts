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
  agentsMdUpdated: boolean;
  gitignoreSkipped: boolean;
  claudeMdSkipped: boolean;
  agentsMdSkipped: boolean;
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
    case 'workspace.rename':
      renderWsRename(result as { workspace: WorkspaceEntry; currentUpdated: boolean });
      return;
    case 'workspace.repath':
      renderWsRepath(
        result as { workspace: WorkspaceEntry; bhDirCreated: boolean; setup?: SetupReport },
      );
      return;
    case 'workspace.createDemo':
      renderWsCreateDemo(
        result as {
          workspace: WorkspaceEntry;
          filesCreated: readonly string[];
          setup: SetupReport;
        },
      );
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
    case 'badge.rename':
      renderBadgeRename(
        result as {
          badge: Badge;
          updatedRefs: readonly string[];
          focusUpdated: boolean;
        },
      );
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
    case 'focus.setIntent': {
      const r = result as { intent: string | null; skipped?: boolean };
      if (r.skipped) process.stdout.write('Intent unchanged (focus changed underneath).\n');
      else if (r.intent === null) process.stdout.write('Intent cleared.\n');
      else process.stdout.write(`Intent set: ${r.intent}\n`);
      return;
    }
    case 'focus.brief': {
      // Print the brief verbatim (it's already Markdown). Empty → a hint.
      const brief = (result as { brief: string }).brief;
      process.stdout.write(brief.length > 0 ? `${brief}\n` : '(no focus brief yet)\n');
      return;
    }
    case 'search.query':
      renderSearch(
        result as {
          query: string;
          hits: {
            file: string;
            total: number;
            truncated?: boolean;
            matches: { line: number; text: string }[];
          }[];
          truncated?: boolean;
        },
      );
      return;
    case 'search.brief': {
      // Print the assembled brief verbatim (it's already Markdown) — same
      // contract as focus.brief, so both paste cleanly into a chat.
      const r = result as { brief: string; files: readonly string[]; truncated?: boolean };
      if (r.files.length === 0) {
        process.stdout.write('(no matches — brief is empty)\n');
        return;
      }
      process.stdout.write(r.brief);
      if (r.truncated) {
        process.stderr.write('(search incomplete — results capped; the brief may miss files)\n');
      }
      return;
    }
    default:
      // Fallback: pretty-print whatever we got.
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

// ── workspace ───────────────────────────────────────────────────────────────

/** Summarize which agent-hint files `bh init` / `--setup` touched. One line for
 *  freshly installed, one for already-present — names match the files on disk. */
function renderHintSetup(s: SetupReport): void {
  const installed: string[] = [];
  if (s.claudeMdUpdated) installed.push('CLAUDE.md');
  if (s.agentsMdUpdated) installed.push('AGENTS.md');
  if (installed.length > 0)
    process.stdout.write(`  setup:   agent hint installed in ${installed.join(', ')}\n`);
  const present: string[] = [];
  if (s.claudeMdSkipped) present.push('CLAUDE.md');
  if (s.agentsMdSkipped) present.push('AGENTS.md');
  if (present.length > 0)
    process.stdout.write(`  setup:   agent hint already in ${present.join(', ')}\n`);
}

function renderWsAdd(r: {
  workspace: WorkspaceEntry;
  setAsCurrent: boolean;
  bhDirCreated: boolean;
  alreadyRegistered?: boolean;
  setup?: SetupReport;
}): void {
  process.stdout.write(
    r.alreadyRegistered
      ? `Folder already registered as "${r.workspace.name}"\n`
      : `Added workspace "${r.workspace.name}"\n`,
  );
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
    renderHintSetup(s);
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

function renderWsRename(r: { workspace: WorkspaceEntry; currentUpdated: boolean }): void {
  process.stdout.write(`Renamed workspace → "${r.workspace.name}"\n`);
  process.stdout.write(`  path:    ${r.workspace.path}\n`);
  if (r.currentUpdated) process.stdout.write('  current: yes (followed the rename)\n');
}

function renderWsRepath(r: {
  workspace: WorkspaceEntry;
  bhDirCreated: boolean;
  setup?: SetupReport;
}): void {
  process.stdout.write(`Repathed workspace "${r.workspace.name}"\n`);
  process.stdout.write(`  path:    ${r.workspace.path}\n`);
  if (r.bhDirCreated) process.stdout.write('  .bh/:    created at new path\n');
  if (r.setup) {
    const s = r.setup;
    if (s.gitignoreUpdated) process.stdout.write('  setup:   .bh/cache/ added to .gitignore\n');
    renderHintSetup(s);
  }
}

function renderWsCreateDemo(r: {
  workspace: WorkspaceEntry;
  filesCreated: readonly string[];
  setup: SetupReport;
}): void {
  process.stdout.write(`Created demo workspace "${r.workspace.name}"\n`);
  process.stdout.write(`  path:    ${r.workspace.path}\n`);
  if (r.filesCreated.length > 0) {
    process.stdout.write(`  seeded:  ${r.filesCreated.length} file(s)\n`);
    for (const f of r.filesCreated) process.stdout.write(`           - ${f}\n`);
  }
  renderHintSetup(r.setup);
  process.stdout.write(
    '\nOpen Claude Code in this folder and ask "what is this workspace about?"\n',
  );
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

function renderBadgeRename(r: {
  badge: Badge;
  updatedRefs: readonly string[];
  focusUpdated: boolean;
}): void {
  process.stdout.write(`Renamed badge → ${r.badge.file}\n`);
  if (r.updatedRefs.length > 0) {
    process.stdout.write(`  refs:    ${r.updatedRefs.length} neighbour(s) rewritten\n`);
  }
  if (r.focusUpdated) process.stdout.write('  focus:   updated (was in active list)\n');
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

// ── search ──────────────────────────────────────────────────────────────────

function renderSearch(r: {
  query: string;
  hits: {
    file: string;
    total: number;
    truncated?: boolean;
    matches: { line: number; text: string }[];
  }[];
  truncated?: boolean;
}): void {
  // `truncated` means the search was incomplete — either more files matched
  // than the cap, or a file larger than the read cap was only partially scanned
  // (a match could lie beyond it). Surface it in BOTH the no-match and the
  // has-matches case so "No matches" never hides an incomplete search.
  if (r.hits.length === 0) {
    const warn = r.truncated
      ? ' (search incomplete — some large files were only partially scanned; a match may lie beyond the cap)'
      : '';
    process.stdout.write(`No matches for "${r.query}".${warn}\n`);
    return;
  }
  const fileCount = r.hits.length;
  process.stdout.write(
    `${fileCount} file${fileCount === 1 ? '' : 's'} match "${r.query}"${r.truncated ? ' (results may be incomplete — capped)' : ''}\n`,
  );
  for (const hit of r.hits) {
    const more = hit.total > hit.matches.length ? ` (+${hit.total - hit.matches.length} more)` : '';
    const cut = hit.truncated ? ' [searched start of file]' : '';
    process.stdout.write(`\n${hit.file}${more}${cut}\n`);
    for (const m of hit.matches) {
      process.stdout.write(`  ${m.line}: ${m.text}\n`);
    }
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
