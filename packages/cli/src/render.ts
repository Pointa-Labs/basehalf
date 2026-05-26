/**
 * Renders core command results.
 *  - `--json` mode: stable JSON to stdout, one trailing newline.
 *  - default: human-readable pretty text.
 *
 * Per-command formatters live here so bin.ts stays a flat dispatcher.
 */

type WorkspaceEntry = { name: string; path: string; addedAt: string };

type Decision = {
  version: 1;
  slug: string;
  title: string;
  rationale: string;
  sources: readonly string[];
  tags: readonly string[];
  status: 'active' | 'deprecated' | 'superseded';
  decidedAt: string;
  decidedBy: string;
  supersedes: string | null;
  supersededBy: string | null;
};

export function render(commandName: string, result: unknown, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  switch (commandName) {
    case 'workspace.add':
      renderWsAdd(
        result as { workspace: WorkspaceEntry; setAsCurrent: boolean; bhDirCreated: boolean },
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
    case 'decision.add':
      renderDecAdd(result as { decision: Decision; path: string });
      return;
    case 'decision.recall':
      renderDecRecall(result as { matches: Decision[] });
      return;
    case 'decision.list':
      renderDecList(result as { decisions: Decision[] });
      return;
    case 'decision.show':
      renderDecShow(result as Decision);
      return;
    case 'decision.update':
      renderDecUpdate(result as { decision: Decision });
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
}): void {
  process.stdout.write(`Added workspace "${r.workspace.name}"\n`);
  process.stdout.write(`  path:    ${r.workspace.path}\n`);
  if (r.bhDirCreated) process.stdout.write('  .bh/:    created\n');
  if (r.setAsCurrent) process.stdout.write('  current: yes (first workspace)\n');
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

// ── decision ────────────────────────────────────────────────────────────────

function renderDecAdd(r: { decision: Decision; path: string }): void {
  process.stdout.write(`Recorded "${r.decision.title}" (${r.decision.slug})\n`);
  process.stdout.write(`  Why:     ${r.decision.rationale}\n`);
  if (r.decision.sources.length > 0) {
    process.stdout.write(`  Sources: ${r.decision.sources.join(', ')}\n`);
  }
  if (r.decision.tags.length > 0) {
    process.stdout.write(`  Tags:    ${r.decision.tags.join(', ')}\n`);
  }
  process.stdout.write(`  Path:    ${r.path}\n`);
}

function renderDecRecall(r: { matches: Decision[] }): void {
  if (r.matches.length === 0) {
    process.stdout.write('No matches.\n');
    return;
  }
  for (const d of r.matches) {
    renderDecisionLine(d);
  }
}

function renderDecList(r: { decisions: Decision[] }): void {
  if (r.decisions.length === 0) {
    process.stdout.write(
      'No decisions yet. Record one with `bh decision add "..." --because "..."`.\n',
    );
    return;
  }
  for (const d of r.decisions) {
    renderDecisionLine(d);
  }
}

function renderDecShow(d: Decision): void {
  process.stdout.write(`${d.title} (${d.slug})\n`);
  process.stdout.write(`  Why:        ${d.rationale}\n`);
  process.stdout.write(`  Status:     ${d.status}\n`);
  if (d.sources.length > 0) process.stdout.write(`  Sources:    ${d.sources.join(', ')}\n`);
  if (d.tags.length > 0) process.stdout.write(`  Tags:       ${d.tags.join(', ')}\n`);
  process.stdout.write(`  Decided at: ${d.decidedAt}\n`);
  process.stdout.write(`  Decided by: ${d.decidedBy}\n`);
  if (d.supersededBy) process.stdout.write(`  Superseded by: ${d.supersededBy}\n`);
  if (d.supersedes) process.stdout.write(`  Supersedes:    ${d.supersedes}\n`);
}

function renderDecUpdate(r: { decision: Decision }): void {
  process.stdout.write(`Updated "${r.decision.title}" (${r.decision.slug})\n`);
  process.stdout.write(`  Status:  ${r.decision.status}\n`);
  if (r.decision.sources.length > 0) {
    process.stdout.write(`  Sources: ${r.decision.sources.join(', ')}\n`);
  }
  if (r.decision.tags.length > 0) {
    process.stdout.write(`  Tags:    ${r.decision.tags.join(', ')}\n`);
  }
  if (r.decision.supersededBy) {
    process.stdout.write(`  Superseded by: ${r.decision.supersededBy}\n`);
  }
}

function renderDecisionLine(d: Decision): void {
  const status = d.status === 'active' ? '' : ` [${d.status}]`;
  process.stdout.write(`* ${d.title} (${d.slug})${status}\n`);
  process.stdout.write(`    Why:  ${d.rationale}\n`);
  if (d.sources.length > 0) process.stdout.write(`    Refs: ${d.sources.join(', ')}\n`);
  if (d.tags.length > 0) process.stdout.write(`    Tags: ${d.tags.join(', ')}\n`);
  process.stdout.write(`    Date: ${d.decidedAt.slice(0, 10)}\n`);
}
