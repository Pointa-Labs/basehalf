/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { URI } from '../../../base/common/uri.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';

export const IBaseHalfWorkspaceSetupService = createDecorator<IBaseHalfWorkspaceSetupService>('baseHalfWorkspaceSetupService');

/**
 * A tracked repository-level opt-out for folders that may be opened by a
 * BaseHalf development host but must not be initialized as product workspaces.
 * Presence alone disables setup; the file's contents are intentionally ignored.
 */
export const BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER = '.basehalf-no-workspace-setup';

/**
 * Workspace setup: the PUBLISH half of the agent protocol. Opening a folder as
 * a BaseHalf workspace installs the pointers that let any coding agent find
 * `.bh/` — without them the whole mirror (badges, references, focus) is
 * invisible to the agents it exists for.
 *
 * Non-destructive guarantees (ported semantics from the original product):
 *  - `.gitignore`: only APPENDS `.bh/cache/` when the file exists and doesn't
 *    already ignore it. The rest of `.bh/` (mirror tree + current_focus.yaml)
 *    stays in git so the map travels with the folder. No .gitignore → skip.
 *  - Agent hints: the same marker-delimited workspace-hint section lands in
 *    CLAUDE.md and AGENTS.md — between them, the filenames today's coding
 *    agents actually read. Existing content is preserved; a marker-delimited
 *    section is UPGRADED in place; files are created when missing.
 *  - Agent harness: BaseHalf-owned progressive-disclosure docs under
 *    `.bh/agent-harness/`, stamped with a managed sentinel. Refreshed on each
 *    app update; sentinel-bearing files a newer version no longer ships are
 *    pruned; user-authored files in the same directory are never touched.
 *  - A symlinked target is REFUSED (skipped), never followed — a workspace you
 *    drop in can plant a symlink whose write would land outside the folder.
 */
export interface IBaseHalfWorkspaceSetupService {
	readonly _serviceBrand: undefined;

	ensureSetup(workspaceFolder: URI): Promise<IBaseHalfSetupReport>;
}

export interface IBaseHalfSetupReport {
	readonly disabledByMarker: boolean;
	readonly gitignoreUpdated: boolean;
	readonly agentHarnessUpdated: boolean;
	readonly claudeMdUpdated: boolean;
	readonly agentsMdUpdated: boolean;
	readonly agentCapabilityCache: BaseHalfAgentCapabilityCacheState;
}

export type BaseHalfAgentCapabilityCacheState = 'disabled-no-secure-provider';

const HINT_MARKER = '<!-- bh:workspace-hint -->';
// Closing marker: lets a re-run UPGRADE the section in place (replace strictly
// between open + close) instead of skipping every existing install forever.
// Legacy installs carry only the open marker (the section ran to EOF).
const HINT_END_MARKER = '<!-- /bh:workspace-hint -->';
const LEGACY_CLAUDE_HINT_MARKER = '<!-- bh:recall-hint -->';
export const BASEHALF_AGENT_HARNESS_DIR = '.bh/agent-harness';
const AGENT_HARNESS_SCENARIOS_DIR = `${BASEHALF_AGENT_HARNESS_DIR}/scenarios`;
const AGENT_HARNESS_INDEX_REL = `${BASEHALF_AGENT_HARNESS_DIR}/index.md`;
// Marks a file as BaseHalf-managed. It pulls triple duty: a visible "don't
// hand-edit" banner; the licence for the sync to OVERWRITE it to the current
// app version; and the signal that lets the cross-version sweep DELETE a file
// this version no longer ships without ever touching a user-authored file.
// The prune matches this PREFIX, never the whole line, so the human-readable
// tail can be reworded later without orphaning already-stamped files.
const AGENT_HARNESS_MARKER = '<!-- bh:agent-harness managed';
const AGENT_HARNESS_SENTINEL = `${AGENT_HARNESS_MARKER} — regenerated on BaseHalf update; edits are overwritten -->`;

const managedDoc = (lines: readonly string[]): string =>
	`${AGENT_HARNESS_SENTINEL}\n\n${lines.join('\n')}\n`;

const AGENT_HARNESS_FILES: ReadonlyArray<{ readonly relPath: string; readonly content: string }> = [
	{
		relPath: AGENT_HARNESS_INDEX_REL,
		content: managedDoc([
			'# BaseHalf Agent Harness',
			'',
			'> Generated and maintained by BaseHalf. These files are refreshed on each app',
			'> update, so hand-edits are overwritten; don\'t store your own notes here.',
			'',
			'This directory contains BaseHalf-specific operational contracts for coding',
			'agents. Treat this file as the scenario index. Load only the scenario that',
			'matches the user\'s request.',
			'',
			'## Scenarios',
			'',
			'- Editing or rewriting the focused file: [scenarios/open-file-editing.md](scenarios/open-file-editing.md)',
			'- Answering cursor, line, or viewport questions: [scenarios/focus-coordinates.md](scenarios/focus-coordinates.md)',
			'- Generating or updating .bh mirror files: [scenarios/bh-mirror-writing.md](scenarios/bh-mirror-writing.md)',
			'- Building or running a canvas workflow: [scenarios/canvas-workflows.md](scenarios/canvas-workflows.md)',
			'',
			'## Boundary',
			'',
			'AGENTS.md / CLAUDE.md hold the always-on rules. This harness holds detailed,',
			'task-specific rules that should be loaded only when relevant.'
		])
	},
	{
		relPath: `${AGENT_HARNESS_SCENARIOS_DIR}/open-file-editing.md`,
		content: managedDoc([
			'# Open File Editing',
			'',
			'Use this scenario when the user asks to clear, rewrite, replace, regenerate, or',
			'transform the currently focused file.',
			'',
			'## Contract',
			'',
			'Treat the focused file as an open editor buffer. Preserve the file node and edit',
			'its bytes in place.',
			'',
			'## Allowed',
			'',
			'- Patch or replace content at the same path.',
			'- Truncate and write the same path without unlinking it.',
			'- Use the path from .bh/current_focus.yaml when the user says "this page",',
			'  "here", or "the current document".',
			'',
			'## Forbidden',
			'',
			'- Delete the focused file and add a new file at the same path.',
			'- Rename the focused file away and recreate it.',
			'- Use a delete-and-add sequence to satisfy a clear/rewrite/regenerate request.',
			'',
			'BaseHalf watches open documents through filesystem events. A delete-and-add',
			'sequence makes the open editor observe an unlink event and can surface a',
			'deleted-file state to the user even if a same-path file appears right after it.'
		])
	},
	{
		relPath: `${AGENT_HARNESS_SCENARIOS_DIR}/focus-coordinates.md`,
		content: managedDoc([
			'# Focus Coordinates',
			'',
			'Use this scenario when the user asks where their cursor is, what line they are',
			'looking at, or what text is near the cursor.',
			'',
			'## Coordinate Types',
			'',
			'- cursor.line / cursor.column are 1-based positions in the Markdown source.',
			'- cursor.block and visible_blocks.start are rendered block ordinals.',
			'- The visual screen line is not currently represented; soft wrapping can make a',
			'  source line appear as multiple on-screen rows.',
			'',
			'## Contract',
			'',
			'Use line + column to inspect or edit source text. Use block / visible_blocks to',
			'describe where the user is in the rendered editor. Do not present a whole source',
			'line as "the line on your screen" when soft wrapping may be involved.'
		])
	},
	{
		relPath: `${AGENT_HARNESS_SCENARIOS_DIR}/bh-mirror-writing.md`,
		content: managedDoc([
			'# .bh Mirror Writing',
			'',
			'Use this scenario when the user explicitly asks you to generate or update .bh',
			'mirror files.',
			'',
			'## Contract',
			'',
			'User files are the source of truth. .bh files are derived BaseHalf state.',
			'',
			'Before modifying a .bh file, read the latest version from disk and match its',
			'YAML shape. A reference A -> B means A context flows into B: write B to A\'s',
			'`references` and A to B\'s `referenced_by`. The graph is directed, not a tree.',
			'BaseHalf does not treat a one-sided pair as live; an explicit action must repair or discard it.',
			'Canvas edge rows store endpoints and anchor placement only; Markdown links are',
			'navigation only and never create references.',
			'To create a card, create the requested user file or folder first; a canvas card',
			'row stores geometry only. Never replace',
			'.bh/current_focus.yaml with a',
			'regular file; it must remain a symlink.'
		])
	},
	{
		relPath: `${AGENT_HARNESS_SCENARIOS_DIR}/canvas-workflows.md`,
		content: managedDoc([
			'# Canvas Workflows',
			'',
			'Use this scenario when the user explicitly asks you to create, configure,',
			'connect, inspect, or run main-canvas workflow nodes.',
			'',
			'## Discover the live contract',
			'',
			'Run `basehalf --list-capabilities` from an Agent Area terminal in the open',
			'workspace. The JSON response is the authority for the installed node document',
			'contract, recipes, templates, document formats, and deterministic operations.',
			'Do not guess recipe ids, input roles, parameters, result kinds, or operations.',
			'',
			'## One canvas grammar',
			'',
			'- Ordinary text and code remain normal user files.',
			'- A `.bhnode` starts as an editable Draft. Author only the subset returned by',
			'  capability discovery; immutable Attempts and the single sealed Result are host-owned.',
			'- A -> B means A\'s direct content is context for B; for a result node this',
			'  is its one sealed local file. It never means generate next, and execution never',
			'  recursively runs upstream nodes.',
			'- Input role and order belong to B\'s recipe binding, not to the edge.',
			'- A context edge may exist before it is assigned to a recipe input. B cannot',
			'  run until every direct incoming context edge has an explicit target-owned',
			'  role and the recipe\'s minimum input requirements are satisfied.',
			'',
			'## Execute explicitly',
			'',
			'Use `basehalf --run-node <workspace-relative-.bhnode-path>` for one saved node.',
			'Use `basehalf --run-operation \'{"operationId":"returned.operation.id","parameters":{}}\'` only',
			'for an operation',
			'returned by capability discovery. Never invent a command id or write generated',
			'lifecycle fields yourself. Each explicit submission creates an immutable Attempt;',
			'the first success seals exactly one ordinary local file as the Result. Once the host',
			'accepts a submission, closing or switching the Agent session does not cancel it.'
		])
	}
];

// A SHORT pointer, not an essay: the shorter the hint, the more reliably an
// agent reads it. It points at the live signal (current_focus) and the
// four-file mirror; deeper workflows live in the versionable harness docs.
const HINT_BODY = `## BaseHalf workspace

> Added by [BaseHalf](https://github.com/Pointa-Labs/basehalf) when this folder
> was opened as a workspace — it tells AI coding agents what the user is looking
> at. Your own content above/below is untouched; delete this section if you don't
> want agents reading that context.

This folder is a BaseHalf workspace: BaseHalf mirrors what the user is currently
viewing into \`.bh/\` so you stay in sync with their attention.

**At the start of every turn, read \`.bh/current_focus.yaml\`** — a symlink to the
focus file of the node the user is looking at right now:
- \`kind: file\` → they're reading a file. Use the file's content together with its
  \`badge.yaml\`, plus \`visible_lines.start\` / \`visible_blocks.start\` and \`cursor\`. In
  \`cursor\`, \`line\`/\`column\` are 1-based positions in the .md SOURCE (use them to
  locate/edit) and \`line_precision\` says how exact \`line\` is (\`exact\` |
  \`block_start\` | \`estimated\`); \`block\` is the ordinal of the rendered block they're
  in — the "Nth block" they actually see. Blank lines, multi-line blocks, and
  soft-wrapped long lines mean a source line is **not** the user's on-screen line — so
  use \`block\`/\`visible_blocks\` to say where they are, and \`line\`+\`column\` to
  locate/edit; never hand the user a whole source line as "the line on your screen".
- \`kind: folder\` → they're on a folder's canvas. Use that folder's \`badge.yaml\`
  and \`canvas.yaml\`, plus \`viewport_center\` and \`zoom\`.

The \`.bh/mirror/\` tree holds up to five YAML files per node (sparse — only what's
been annotated):
- \`.bh/mirror/<path>/badge.yaml\` — a node's one-line \`description\`, outbound
  \`references\` (paths) and inbound \`referenced_by\` (paths). \`A → B\` means A's
  context flows into B: B is in A's \`references\`, and A is in B's \`referenced_by\`.
  This is a general directed graph, not a tree or parent/child hierarchy.
  A one-sided pair is not live; BaseHalf surfaces it for explicit Repair or Discard.
- \`.bh/mirror/<folder>/canvas.yaml\` — a folder's canvas: child card positions and
  optional \`edges\` with endpoints and anchor placement for badge references.
  The badge graph is relationship truth; a canvas edge never creates a separate relation.
- \`.bh/mirror/<path>/focus.yaml\` — a node's viewport (\`current_focus\` points at
  the live one).
- \`.bh/mirror/<file>/adhd.yaml\` — per-file reading aids: \`highlight_keywords\` and
  read line-ranges (\`read_paragraphs\`).
- \`.bh/mirror/<path>/appearance.yaml\` — user-selected visual presentation such as
  the canvas card \`background\` preset.

To answer or edit, start from the focused node. Its incoming \`referenced_by\` nodes
are upstream context; follow either direction when more graph context is useful.
Markdown links are ordinary navigation links and never create reference edges.
To create a card, create its real user file or folder; a canvas card row stores only
geometry.
Only modify or create the user's own files when they explicitly ask.

When asked, you can GENERATE or update these \`.bh/\` files from content, including
creating references. Update both badge endpoints; the canvas derives the relation
from that graph. Use \`canvas.yaml\` only for card geometry and edge endpoints/anchors.
Match the existing YAML shape and read the latest version before editing so you
don't overwrite what
the app or user just wrote. \`.bh/current_focus.yaml\` is a symlink — never replace
it with a regular file.

For BaseHalf-specific workflows, use \`${AGENT_HARNESS_INDEX_REL}\` as the
progressive-disclosure index. Load only the matching scenario, such as focused-file
rewrites, cursor/viewport questions, canvas workflows, or \`.bh/\` mirror writes,
when that behavior matters.

The user's files are the source of truth; \`.bh/\` is derived. Edit user files with
your own tools; edit \`.bh/\` only on explicit request — otherwise the app owns it.
\`.bh/cache/\` is gitignored and rebuildable;
the rest of \`.bh/\` stays in git so the map travels with the folder.`;

const HINT_BLOCK = `${HINT_MARKER}\n${HINT_BODY}\n${HINT_END_MARKER}`;

export interface IBaseHalfHintTarget {
	readonly relPath: string;
	/** Content to start from when the file doesn't exist yet. */
	readonly emptyBase: string;
	/** An older marker that also counts as "installed here" (upgrade in place). */
	readonly legacyMarker?: string;
}

// When WE create the file, the heading explains what the file is — a user who
// finds it in their folder should understand it at a glance.
const CLAUDE_TARGET: IBaseHalfHintTarget = {
	relPath: 'CLAUDE.md',
	emptyBase: '# CLAUDE.md\n\nInstructions AI coding agents read when working in this folder.\n',
	legacyMarker: LEGACY_CLAUDE_HINT_MARKER
};
const AGENTS_TARGET: IBaseHalfHintTarget = {
	relPath: 'AGENTS.md',
	emptyBase: '# AGENTS.md\n\nInstructions AI coding agents read when working in this folder.\n'
};

/**
 * Compute the file content with the hint section installed or UPGRADED,
 * preserving every byte of the user's own content. Pure so it stays unit
 * testable. Returns null when nothing needs writing (idempotent re-run).
 */
export function applyBaseHalfWorkspaceHint(current: string | null, target: IBaseHalfHintTarget): string | null {
	if (current === null) {
		const base = target.emptyBase.endsWith('\n') ? target.emptyBase : `${target.emptyBase}\n`;
		return `${base}\n${HINT_BLOCK}\n`;
	}

	const openIdx = current.indexOf(HINT_MARKER);
	if (openIdx !== -1) {
		const endIdx = current.indexOf(HINT_END_MARKER, openIdx);
		if (endIdx !== -1) {
			const before = current.slice(0, openIdx);
			const after = current.slice(endIdx + HINT_END_MARKER.length);
			const next = `${before}${HINT_BLOCK}${after}`;
			return next === current ? null : next;
		}
		// Legacy: open marker, no close — the old section ran to EOF.
		const before = current.slice(0, openIdx).replace(/\n+$/, '');
		const next = `${before}\n\n${HINT_BLOCK}\n`;
		return next === current ? null : next;
	}

	if (target.legacyMarker !== undefined) {
		const legacyIdx = current.indexOf(target.legacyMarker);
		if (legacyIdx !== -1) {
			const before = current.slice(0, legacyIdx).replace(/\n+$/, '');
			const next = `${before}\n\n${HINT_BLOCK}\n`;
			return next === current ? null : next;
		}
	}

	const base = current.replace(/\n+$/, '');
	return `${base}\n\n${HINT_BLOCK}\n`;
}

export class BaseHalfWorkspaceSetupService implements IBaseHalfWorkspaceSetupService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService
	) { }

	async ensureSetup(workspaceFolder: URI): Promise<IBaseHalfSetupReport> {
		if (await this.isSetupDisabled(workspaceFolder)) {
			return {
				disabledByMarker: true,
				gitignoreUpdated: false,
				agentHarnessUpdated: false,
				claudeMdUpdated: false,
				agentsMdUpdated: false,
				agentCapabilityCache: 'disabled-no-secure-provider'
			};
		}

		const gitignoreUpdated = await this.updateGitignore(workspaceFolder);
		const agentHarnessUpdated = await this.installAgentHarness(workspaceFolder);
		const claudeMdUpdated = await this.installHint(workspaceFolder, CLAUDE_TARGET);
		const agentsMdUpdated = await this.installHint(workspaceFolder, AGENTS_TARGET);
		// The current file providers expose path-based writes only. Publishing an
		// automatic workspace cache would therefore leave a parent-directory swap
		// between validation and commit. Until a provider offers a directory-handle
		// relative, component-no-follow commit, publication remains fail-closed and
		// the managed harness does not advertise that cache.
		return {
			disabledByMarker: false,
			gitignoreUpdated,
			agentHarnessUpdated,
			claudeMdUpdated,
			agentsMdUpdated,
			agentCapabilityCache: 'disabled-no-secure-provider'
		};
	}

	private async isSetupDisabled(workspaceFolder: URI): Promise<boolean> {
		const resource = URI.joinPath(workspaceFolder, BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER);
		try {
			await this.fileService.resolve(resource);
			return true;
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return false;
			}
			// Setup mutates user-authored root files. If the provider cannot
			// safely determine whether an opt-out exists, fail closed.
			return true;
		}
	}

	private async updateGitignore(workspaceFolder: URI): Promise<boolean> {
		const resource = URI.joinPath(workspaceFolder, '.gitignore');
		if (await this.isSymbolicLink(resource)) {
			return false; // a planted symlink is refused, never followed
		}

		const current = await this.readOrNull(resource);
		if (current === null) {
			return false; // no .gitignore (no git repo yet) — nothing to update
		}

		// Match `.bh/cache/` (or `.bh/cache`) on its own line. A bare `.bh/` line
		// from an older install is NOT treated as already-ignored — the model wants
		// only the cache ignored so the rest of `.bh/` travels in git.
		const hasIgnore = current.split('\n').some(line => /^\s*\.bh\/cache\/?\s*(#.*)?$/.test(line));
		if (hasIgnore) {
			return false;
		}

		const trailingNewline = current.endsWith('\n') ? '' : '\n';
		await this.fileService.writeFile(resource, VSBuffer.fromString(
			`${current}${trailingNewline}\n# BaseHalf derived cache (rebuildable; the rest of .bh/ stays in git)\n.bh/cache/\n`
		));
		return true;
	}

	private async installAgentHarness(workspaceFolder: URI): Promise<boolean> {
		for (const dir of [BASEHALF_AGENT_HARNESS_DIR, AGENT_HARNESS_SCENARIOS_DIR]) {
			const dirResource = URI.joinPath(workspaceFolder, ...dir.split('/'));
			if (await this.isSymbolicLink(dirResource)) {
				return false; // a symlinked harness dir is refused, not clobbered
			}
			await this.fileService.createFolder(dirResource);
		}

		let updated = false;
		// Per-file loop: one tampered leaf skips THAT file only.
		for (const file of AGENT_HARNESS_FILES) {
			if (await this.writeManagedFile(workspaceFolder, file.relPath, file.content)) {
				updated = true;
			}
		}

		// Cross-version cleanup: a PRIOR version may have installed a scenario this
		// version renamed or retired. Only sentinel-bearing files are eligible — a
		// user-authored file in the same directory is never ours to delete.
		const managed = new Set(AGENT_HARNESS_FILES.map(file => file.relPath));
		for (const dir of [BASEHALF_AGENT_HARNESS_DIR, AGENT_HARNESS_SCENARIOS_DIR]) {
			if (await this.pruneOrphanHarnessFiles(workspaceFolder, dir, managed)) {
				updated = true;
			}
		}
		return updated;
	}

	/** Write one managed harness file when its on-disk content differs. The
	 *  compare normalizes CRLF→LF: these files travel in git, so an autocrlf
	 *  checkout must converge to "skip" instead of being rewritten forever. */
	private async writeManagedFile(workspaceFolder: URI, relPath: string, content: string): Promise<boolean> {
		const resource = URI.joinPath(workspaceFolder, ...relPath.split('/'));
		try {
			if (await this.isSymbolicLink(resource)) {
				return false;
			}
			const current = await this.readOrNull(resource);
			if (current !== null && current.replace(/\r\n/g, '\n') === content) {
				return false;
			}
			await this.fileService.writeFile(resource, VSBuffer.fromString(content));
			return true;
		} catch {
			return false; // one odd node (directory-at-leaf, permission) never aborts the install
		}
	}

	/** Remove managed files in `dir` (one level) the manifest no longer lists.
	 *  Best-effort per entry; deletes only sentinel-stamped regular files. */
	private async pruneOrphanHarnessFiles(workspaceFolder: URI, dir: string, managed: ReadonlySet<string>): Promise<boolean> {
		const dirResource = URI.joinPath(workspaceFolder, ...dir.split('/'));
		let children;
		try {
			children = (await this.fileService.resolve(dirResource)).children ?? [];
		} catch {
			return false;
		}

		let removed = false;
		for (const child of children) {
			const rel = `${dir}/${child.name}`;
			if (managed.has(rel) || !child.isFile || child.isSymbolicLink) {
				continue;
			}
			try {
				const current = await this.readOrNull(child.resource);
				if (current === null || !current.startsWith(AGENT_HARNESS_MARKER)) {
					continue;
				}
				await this.fileService.del(child.resource);
				removed = true;
			} catch {
				// best-effort: a vanished/locked entry skips, never aborts the sweep
			}
		}
		return removed;
	}

	/** Install OR upgrade the workspace hint in one target file (non-destructive
	 *  + idempotent). Creates the file when missing; replaces the marker-delimited
	 *  section in place when present; appends when absent. */
	private async installHint(workspaceFolder: URI, target: IBaseHalfHintTarget): Promise<boolean> {
		const resource = URI.joinPath(workspaceFolder, target.relPath);
		if (await this.isSymbolicLink(resource)) {
			return false;
		}

		const current = await this.readOrNull(resource);
		const next = applyBaseHalfWorkspaceHint(current, target);
		if (next === null) {
			return false;
		}

		await this.fileService.writeFile(resource, VSBuffer.fromString(next));
		return true;
	}

	private async readOrNull(resource: URI): Promise<string | null> {
		try {
			return (await this.fileService.readFile(resource)).value.toString();
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return null;
			}
			throw error;
		}
	}

	private async isSymbolicLink(resource: URI): Promise<boolean> {
		try {
			return (await this.fileService.resolve(resource)).isSymbolicLink === true;
		} catch {
			return false; // missing → not a symlink; creation may proceed
		}
	}
}

registerSingleton(IBaseHalfWorkspaceSetupService, BaseHalfWorkspaceSetupService, InstantiationType.Delayed);
