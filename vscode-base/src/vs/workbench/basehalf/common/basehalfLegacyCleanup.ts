/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { dirname, isEqual, isEqualOrParent, relativePath as getRelativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { parse as parseYaml, YamlNode, YamlParseError } from '../../../base/common/yaml.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { FileOperationResult, FileSystemProviderCapabilities, IFileService, IFileStatWithPartialMetadata, toFileOperationResult } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IWorkingCopyService } from '../../services/workingCopy/common/workingCopyService.js';
import { IBaseHalfCanvasViewportStateService, IBaseHalfLegacyCanvasViewport } from './basehalfCanvasViewportState.js';
import { BASEHALF_LEGACY_AGENT_GUIDE_SECTIONS, IBaseHalfLegacyAgentGuideSection } from './basehalfLegacyAgentGuideSections.js';
import { baseHalfAssertBhPathComponentsNotSymbolicLink, baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorPathSegments, baseHalfMirrorRoot, baseHalfWalkMirror } from './basehalfMirrorTree.js';
import { IBaseHalfWorkspaceMutationCoordinator } from './basehalfWorkspaceMutation.js';

export const IBaseHalfLegacyCleanupService = createDecorator<IBaseHalfLegacyCleanupService>('baseHalfLegacyCleanupService');

/**
 * A tracked repository-level opt-out for folders that may be opened by a
 * BaseHalf development host but must not be treated as product workspaces.
 * Presence alone disables every BaseHalf write, including legacy cleanup; the
 * file's contents are intentionally ignored.
 */
export const BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER = '.basehalf-no-workspace-setup';

const WORKSPACE_HINT_MARKER = '<!-- bh:workspace-hint -->';
const WORKSPACE_HINT_END_MARKER = '<!-- /bh:workspace-hint -->';
const RECALL_HINT_MARKER = '<!-- bh:recall-hint -->';
const AGENT_HARNESS_SENTINEL_PREFIX = '<!-- bh:agent-harness managed';
const FOCUS_FILE_NAME = 'focus.yaml';
const CURRENT_FOCUS_FILE_NAME = 'current_focus.yaml';
const FOCUS_YAML_MAX_BYTES = 64 * 1024;
const AGENT_GUIDE_MAX_BYTES = 1024 * 1024;
const UTF8_BOM = [0xEF, 0xBB, 0xBF] as const;
const AGENT_GUIDE_INSTRUCTIONS_LINE = 'Instructions AI coding agents read when working in this folder.';

/** Root files earlier BaseHalf versions wrote an agent-instructions section into. */
export const BASEHALF_AGENT_GUIDE_FILES = ['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md'] as const;
export type BaseHalfAgentGuideFile = typeof BASEHALF_AGENT_GUIDE_FILES[number];

/** The file contents BaseHalf itself created around a section, per file. */
const AGENT_GUIDE_BASES: Readonly<Record<BaseHalfAgentGuideFile, readonly string[]>> = {
	'CLAUDE.md': ['# CLAUDE.md', `# CLAUDE.md\n\n${AGENT_GUIDE_INSTRUCTIONS_LINE}`],
	'AGENTS.md': ['# AGENTS.md', `# AGENTS.md\n\n${AGENT_GUIDE_INSTRUCTIONS_LINE}`],
	'.github/copilot-instructions.md': ['# Copilot instructions']
};

//#region Legacy focus documents

/** A `focus.yaml` / `current_focus.yaml` document earlier versions wrote. */
export interface IBaseHalfLegacyFocusDocument {
	readonly path: string;
	readonly kind: 'file' | 'folder';
	/** Present for a folder document with numeric `viewport_center` and a positive `zoom`. */
	readonly viewport?: { readonly x: number; readonly y: number; readonly zoom: number };
}

const FOCUS_DOCUMENT_KEYS = new Set(['path', 'kind', 'projection', 'visible_lines', 'visible_blocks', 'cursor', 'viewport_center', 'zoom']);

/**
 * Parse a legacy focus document. Only a YAML map with a string `path`, a
 * `kind` of `file` or `folder`, and no keys other than the ones the focus
 * mirror wrote counts; anything else is a user file and is never deleted as
 * focus state.
 */
export function parseBaseHalfLegacyFocusDocument(raw: string): IBaseHalfLegacyFocusDocument | undefined {
	const errors: YamlParseError[] = [];
	let node: YamlNode | undefined;
	try {
		node = parseYaml(raw, errors);
	} catch {
		return undefined;
	}
	if (errors.length > 0 || !node || node.type !== 'map') {
		return undefined;
	}

	const record = new Map<string, YamlNode>();
	for (const property of node.properties) {
		if (!FOCUS_DOCUMENT_KEYS.has(property.key.value) || record.has(property.key.value)) {
			return undefined;
		}
		record.set(property.key.value, property.value);
	}

	const path = scalarString(record.get('path'));
	const kind = scalarString(record.get('kind'));
	if (path === undefined || (kind !== 'file' && kind !== 'folder')) {
		return undefined;
	}
	if (kind === 'file') {
		return { path, kind };
	}

	const center = record.get('viewport_center');
	const zoom = scalarNumber(record.get('zoom'));
	if (!center || center.type !== 'map' || zoom === undefined || zoom <= 0) {
		return { path, kind };
	}
	const x = scalarNumber(center.properties.find(property => property.key.value === 'x')?.value);
	const y = scalarNumber(center.properties.find(property => property.key.value === 'y')?.value);
	if (x === undefined || y === undefined) {
		return { path, kind };
	}
	return { path, kind, viewport: { x, y, zoom } };
}

function scalarString(node: YamlNode | undefined): string | undefined {
	return node?.type === 'scalar' ? node.value : undefined;
}

function scalarNumber(node: YamlNode | undefined): number | undefined {
	if (node?.type !== 'scalar' || node.format !== 'none' || !/^-?\d+(?:\.\d+)?$/.test(node.value.trim())) {
		return undefined;
	}
	const value = Number(node.value.trim());
	return Number.isFinite(value) ? value : undefined;
}

//#endregion

//#region Agent guide sections

export interface IBaseHalfAgentGuideSelection {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}

export type BaseHalfAgentGuideRemoval =
	/** No BaseHalf section. */
	| { readonly kind: 'none' }
	/** A section whose exact bytes cannot be determined; the file stays unchanged. */
	| { readonly kind: 'unrecognized'; readonly lineNumber: number }
	| {
		readonly kind: 'removed';
		/** The file text without the BaseHalf sections (no BOM). */
		readonly text: string;
		/** What remains equals a base BaseHalf itself created around the section. */
		readonly boilerplateOnly: boolean;
		/** The first removed section, for revealing it before removal. */
		readonly selection: IBaseHalfAgentGuideSelection;
	};

interface ILineSpan {
	/** Offset of the first character. */
	readonly start: number;
	/** Offset after the content, before `\r\n` / `\n`. */
	readonly contentEnd: number;
	/** Offset after the line break (or the end of the text). */
	readonly end: number;
}

/** Whether the text contains any BaseHalf agent-guide section marker. */
export function baseHalfHasAgentGuideSection(text: string): boolean {
	return text.includes(WORKSPACE_HINT_MARKER) || text.includes(RECALL_HINT_MARKER);
}

/**
 * Compute the removal of every BaseHalf section from an agent guide file.
 * `text` must not contain the BOM; the caller keeps it outside. Pure, so the
 * exact byte rules stay unit testable:
 *
 *  - A closed section runs from the start of the open-marker line through the
 *    line break ending the close-marker line, plus one empty line immediately
 *    before the open-marker line. Everything after it is kept verbatim.
 *  - An open-marker-only or recall-hint section runs to the end of the file.
 *    It is removed only when its text equals a known shipped body (ignoring
 *    CRLF versus LF and trailing whitespace): the section plus one preceding
 *    empty line is removed and the file ends with exactly one line break. A
 *    known body followed by other text loses only the known body.
 *  - Anything else leaves the file unchanged (`unrecognized`).
 */
export function baseHalfRemoveAgentGuideSections(
	text: string,
	file: BaseHalfAgentGuideFile,
	knownSections: readonly IBaseHalfLegacyAgentGuideSection[] = BASEHALF_LEGACY_AGENT_GUIDE_SECTIONS
): BaseHalfAgentGuideRemoval {
	if (!baseHalfHasAgentGuideSection(text)) {
		return { kind: 'none' };
	}

	const lines = lineSpans(text);
	const content = (index: number) => text.slice(lines[index].start, lines[index].contentEnd);
	const isEmptyLine = (index: number) => lines[index].start === lines[index].contentEnd;
	const cuts: Array<{ readonly start: number; readonly end: number; readonly toEndOfFile: boolean }> = [];
	let selection: IBaseHalfAgentGuideSelection | undefined;
	let lastCutEnd = 0;

	const cutStart = (markerLine: number): number => {
		if (markerLine > 0 && isEmptyLine(markerLine - 1) && lines[markerLine - 1].start >= lastCutEnd) {
			return lines[markerLine - 1].start;
		}
		return lines[markerLine].start;
	};

	let index = 0;
	while (index < lines.length) {
		const line = content(index);
		const trimmed = line.trim();
		const hasMarker = line.includes(WORKSPACE_HINT_MARKER) || line.includes(RECALL_HINT_MARKER);
		if (!hasMarker) {
			index++;
			continue;
		}
		if (trimmed !== WORKSPACE_HINT_MARKER && trimmed !== RECALL_HINT_MARKER) {
			return { kind: 'unrecognized', lineNumber: index + 1 };
		}

		if (trimmed === WORKSPACE_HINT_MARKER) {
			let close = -1;
			for (let candidate = index + 1; candidate < lines.length; candidate++) {
				const candidateContent = content(candidate);
				if (candidateContent.includes(WORKSPACE_HINT_END_MARKER)) {
					close = candidate;
					break;
				}
				if (candidateContent.includes(WORKSPACE_HINT_MARKER) || candidateContent.includes(RECALL_HINT_MARKER)) {
					break;
				}
			}
			if (close !== -1) {
				if (content(close).trim() !== WORKSPACE_HINT_END_MARKER) {
					return { kind: 'unrecognized', lineNumber: close + 1 };
				}
				selection ??= sectionSelection(text, lines, index, close);
				const start = cutStart(index);
				cuts.push({ start, end: lines[close].end, toEndOfFile: false });
				lastCutEnd = lines[close].end;
				index = close + 1;
				continue;
			}
		}

		// Open-marker-only or recall-hint: runs to the end of the file.
		const marker = trimmed === WORKSPACE_HINT_MARKER ? 'workspace-hint' : 'recall-hint';
		const matched = longestKnownSectionPrefix(text, lines, index, marker, knownSections);
		if (matched === 0) {
			return { kind: 'unrecognized', lineNumber: index + 1 };
		}
		const lastBodyLine = index + matched - 1;
		let restIsBlank = true;
		for (let rest = lastBodyLine + 1; rest < lines.length; rest++) {
			if (content(rest).trim() !== '') {
				restIsBlank = false;
				break;
			}
		}
		if (restIsBlank) {
			selection ??= sectionSelection(text, lines, index, lines.length - 1);
			cuts.push({ start: cutStart(index), end: text.length, toEndOfFile: true });
			break;
		}
		selection ??= sectionSelection(text, lines, index, lastBodyLine);
		cuts.push({ start: lines[index].start, end: lines[lastBodyLine].end, toEndOfFile: false });
		lastCutEnd = lines[lastBodyLine].end;
		index = lastBodyLine + 1;
	}

	if (cuts.length === 0 || !selection) {
		return { kind: 'none' };
	}

	let next = '';
	let offset = 0;
	for (const cut of cuts) {
		next += text.slice(offset, cut.start);
		offset = cut.end;
	}
	next += text.slice(offset);

	if (cuts[cuts.length - 1].toEndOfFile) {
		const eol = preferredLineBreak(text);
		const withoutTrailingBreaks = next.replace(/(?:\r?\n)+$/, '');
		next = withoutTrailingBreaks.length > 0 ? `${withoutTrailingBreaks}${eol}` : '';
	}

	return {
		kind: 'removed',
		text: next,
		boilerplateOnly: isBaseHalfAgentGuideBoilerplate(next, file),
		selection
	};
}

/** Whether `text` (after the same normalization used for comparison) is only
 *  the base BaseHalf created for `file`. */
export function isBaseHalfAgentGuideBoilerplate(text: string, file: BaseHalfAgentGuideFile): boolean {
	const normalized = normalizeForComparison(text).join('\n');
	return AGENT_GUIDE_BASES[file].includes(normalized);
}

function longestKnownSectionPrefix(
	text: string,
	lines: readonly ILineSpan[],
	markerLine: number,
	marker: IBaseHalfLegacyAgentGuideSection['marker'],
	knownSections: readonly IBaseHalfLegacyAgentGuideSection[]
): number {
	const section = lines.slice(markerLine).map(line => text.slice(line.start, line.contentEnd).replace(/\s+$/, ''));
	let longest = 0;
	for (const known of knownSections) {
		if (known.marker !== marker) {
			continue;
		}
		const body = normalizeForComparison(known.lines.join('\n'));
		if (body.length <= longest || body.length > section.length) {
			continue;
		}
		if (body.every((line, lineIndex) => section[lineIndex] === line)) {
			longest = body.length;
		}
	}
	return longest;
}

/** BOM, CRLF versus LF, and trailing whitespace are ignored for comparison. */
function normalizeForComparison(text: string): string[] {
	const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n').map(line => line.replace(/\s+$/, ''));
	while (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}

function lineSpans(text: string): ILineSpan[] {
	const lines: ILineSpan[] = [];
	let start = 0;
	while (start < text.length) {
		const newline = text.indexOf('\n', start);
		if (newline === -1) {
			lines.push({ start, contentEnd: text.length, end: text.length });
			break;
		}
		const contentEnd = newline > start && text.charCodeAt(newline - 1) === 13 ? newline - 1 : newline;
		lines.push({ start, contentEnd, end: newline + 1 });
		start = newline + 1;
	}
	return lines;
}

function preferredLineBreak(text: string): string {
	const crlf = text.split('\r\n').length - 1;
	const lf = text.split('\n').length - 1 - crlf;
	return crlf > lf ? '\r\n' : '\n';
}

function sectionSelection(text: string, lines: readonly ILineSpan[], first: number, last: number): IBaseHalfAgentGuideSelection {
	let end = last;
	while (end > first && lines[end].start === lines[end].contentEnd) {
		end--;
	}
	return {
		startLineNumber: first + 1,
		startColumn: 1,
		endLineNumber: end + 1,
		endColumn: lines[end].contentEnd - lines[end].start + 1
	};
}

/** Split a UTF-8 BOM from the bytes and decode the rest strictly. Undefined
 *  when the bytes are not UTF-8 text that re-encodes to the same bytes. */
export function baseHalfDecodeAgentGuide(bytes: VSBuffer): { readonly bom: boolean; readonly text: string } | undefined {
	const raw = bytes.buffer;
	const bom = raw.length >= 3 && raw[0] === UTF8_BOM[0] && raw[1] === UTF8_BOM[1] && raw[2] === UTF8_BOM[2];
	const body = bom ? raw.subarray(3) : raw;
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
	} catch {
		return undefined;
	}
	const reencoded = VSBuffer.fromString(text).buffer;
	if (reencoded.length !== body.length || reencoded.some((value, offset) => value !== body[offset])) {
		return undefined;
	}
	return { bom, text };
}

/** Re-encode the text, restoring the BOM when the file had one. */
export function baseHalfEncodeAgentGuide(bom: boolean, text: string): VSBuffer {
	const encoded = VSBuffer.fromString(text);
	return bom ? VSBuffer.concat([VSBuffer.wrap(Uint8Array.from(UTF8_BOM)), encoded]) : encoded;
}

//#endregion

//#region Service

export interface IBaseHalfLegacyCleanupItem {
	/** Workspace-relative path. */
	readonly path: string;
	readonly reason: string;
}

export interface IBaseHalfLegacyCleanupReport {
	/** `marker`: the folder opted out; `symbolicLink`: `.bh` itself is a link. */
	readonly skipped?: 'marker' | 'symbolicLink';
	readonly importedViewports: number;
	/** Workspace-relative paths of removed files and symbolic links. */
	readonly removedFiles: readonly string[];
	/** Workspace-relative paths of removed empty directories. */
	readonly removedDirectories: readonly string[];
	/** Legacy-looking entries deliberately left in place. */
	readonly kept: readonly IBaseHalfLegacyCleanupItem[];
	/** Entries that failed; the next open retries them. */
	readonly failed: readonly IBaseHalfLegacyCleanupItem[];
}

export interface IBaseHalfAgentGuide {
	readonly workspaceFolder: URI;
	readonly resource: URI;
	readonly file: BaseHalfAgentGuideFile;
	/** The first BaseHalf section, for Show. */
	readonly selection: IBaseHalfAgentGuideSelection;
	/** Only BaseHalf boilerplate remains after removal: Remove moves it to the trash. */
	readonly moveToTrash: boolean;
}

export interface IBaseHalfAgentGuideScan {
	readonly skipped?: 'marker';
	readonly guides: readonly IBaseHalfAgentGuide[];
}

export type BaseHalfAgentGuideSkipReason = 'marker' | 'dirty' | 'symbolicLink' | 'unreadable' | 'notText' | 'unrecognized' | 'changed' | 'writeFailed';
export type BaseHalfAgentGuideNotTrashedReason = 'trashUnavailable' | 'trashFailed' | 'changed';

export interface IBaseHalfAgentGuideRemovalReport {
	/** Files whose BaseHalf section was removed, including trashed ones. */
	readonly removed: readonly IBaseHalfAgentGuide[];
	readonly trashed: readonly IBaseHalfAgentGuide[];
	readonly skipped: readonly { readonly guide: IBaseHalfAgentGuide; readonly reason: BaseHalfAgentGuideSkipReason }[];
	/** Boilerplate-only files left in place with their base text. */
	readonly notTrashed: readonly { readonly guide: IBaseHalfAgentGuide; readonly reason: BaseHalfAgentGuideNotTrashedReason }[];
}

/**
 * Removes what earlier BaseHalf versions wrote into workspaces. BaseHalf no
 * longer writes agent guides, the agent harness, focus files, or `.gitignore`
 * lines; opening a folder never creates `.bh/`.
 *
 *  - {@link cleanWorkspaceFolder} removes BaseHalf-owned `.bh/` artifacts
 *    automatically (after importing legacy folder viewports).
 *  - {@link findAgentGuides} / {@link removeAgentGuideSections} handle the
 *    user-owned root files, only after the user confirms.
 *
 * A folder whose root holds {@link BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER}
 * (or whose marker cannot be checked) is never changed.
 */
export interface IBaseHalfLegacyCleanupService {
	readonly _serviceBrand: undefined;

	cleanWorkspaceFolder(workspaceFolder: URI): Promise<IBaseHalfLegacyCleanupReport>;
	findAgentGuides(workspaceFolder: URI): Promise<IBaseHalfAgentGuideScan>;
	removeAgentGuideSections(guides: readonly IBaseHalfAgentGuide[]): Promise<IBaseHalfAgentGuideRemovalReport>;
}

interface IClassifiedEntry {
	readonly resource: URI;
	readonly stat: IFileStatWithPartialMetadata;
}

class BaseHalfLegacyCleanupRun {
	readonly removedFiles: string[] = [];
	readonly removedDirectories: string[] = [];
	readonly kept: IBaseHalfLegacyCleanupItem[] = [];
	readonly failed: IBaseHalfLegacyCleanupItem[] = [];
	/** Directories that lost an entry in this run: candidates for step 5. */
	readonly touchedDirectories: URI[] = [];
	importedViewports = 0;

	constructor(readonly workspaceFolder: URI) { }

	relative(resource: URI): string {
		return getRelativePath(this.workspaceFolder, resource) ?? resource.toString();
	}

	report(skipped?: IBaseHalfLegacyCleanupReport['skipped']): IBaseHalfLegacyCleanupReport {
		return {
			...(skipped ? { skipped } : {}),
			importedViewports: this.importedViewports,
			removedFiles: this.removedFiles,
			removedDirectories: this.removedDirectories,
			kept: this.kept,
			failed: this.failed
		};
	}
}

export class BaseHalfLegacyCleanupService implements IBaseHalfLegacyCleanupService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IBaseHalfCanvasViewportStateService private readonly viewportStateService: IBaseHalfCanvasViewportStateService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) { }

	async cleanWorkspaceFolder(workspaceFolder: URI): Promise<IBaseHalfLegacyCleanupReport> {
		try {
			if (await this.isMarked(workspaceFolder)) {
				this.logService.info(`[BaseHalf] legacy cleanup skipped ${workspaceFolder.toString()}: ${BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER} is present (or could not be checked)`);
				return new BaseHalfLegacyCleanupRun(workspaceFolder).report('marker');
			}
			return await this.workspaceMutationCoordinator.runExclusive(workspaceFolder, () => this.cleanLocked(workspaceFolder));
		} finally {
			this.viewportStateService.settleLegacyImport(workspaceFolder);
		}
	}

	async findAgentGuides(workspaceFolder: URI): Promise<IBaseHalfAgentGuideScan> {
		if (await this.isMarked(workspaceFolder)) {
			return { skipped: 'marker', guides: [] };
		}

		const guides: IBaseHalfAgentGuide[] = [];
		for (const file of BASEHALF_AGENT_GUIDE_FILES) {
			const resource = URI.joinPath(workspaceFolder, ...file.split('/'));
			try {
				const stat = await this.fileService.stat(resource);
				if (stat.isDirectory) {
					continue;
				}
				// Detection may read through a symbolic link; Remove never writes
				// through one and reports it instead.
				const decoded = baseHalfDecodeAgentGuide((await this.fileService.readFile(resource, { limits: { size: AGENT_GUIDE_MAX_BYTES } })).value);
				if (!decoded || !baseHalfHasAgentGuideSection(decoded.text)) {
					continue;
				}
				const removal = baseHalfRemoveAgentGuideSections(decoded.text, file);
				guides.push({
					workspaceFolder,
					resource,
					file,
					selection: removal.kind === 'removed' ? removal.selection : firstMarkerSelection(decoded.text),
					moveToTrash: removal.kind === 'removed' && removal.boilerplateOnly
				});
			} catch (error) {
				if (!isFileNotFound(error)) {
					this.logService.warn(`[BaseHalf] could not inspect ${resource.toString()} for old agent instructions`, error);
				}
			}
		}
		return { guides };
	}

	async removeAgentGuideSections(guides: readonly IBaseHalfAgentGuide[]): Promise<IBaseHalfAgentGuideRemovalReport> {
		const removed: IBaseHalfAgentGuide[] = [];
		const trashed: IBaseHalfAgentGuide[] = [];
		const skipped: { guide: IBaseHalfAgentGuide; reason: BaseHalfAgentGuideSkipReason }[] = [];
		const notTrashed: { guide: IBaseHalfAgentGuide; reason: BaseHalfAgentGuideNotTrashedReason }[] = [];

		const byFolder = new Map<string, { readonly workspaceFolder: URI; readonly guides: IBaseHalfAgentGuide[] }>();
		for (const guide of guides) {
			const key = guide.workspaceFolder.toString();
			let group = byFolder.get(key);
			if (!group) {
				group = { workspaceFolder: guide.workspaceFolder, guides: [] };
				byFolder.set(key, group);
			}
			group.guides.push(guide);
		}

		for (const { workspaceFolder, guides: folderGuides } of byFolder.values()) {
			if (await this.isMarked(workspaceFolder)) {
				skipped.push(...folderGuides.map(guide => ({ guide, reason: 'marker' as const })));
				continue;
			}
			await this.workspaceMutationCoordinator.runExclusive(workspaceFolder, async () => {
				for (const guide of folderGuides) {
					const outcome = await this.removeOne(guide);
					if (outcome.kind === 'skipped') {
						skipped.push({ guide, reason: outcome.reason });
						continue;
					}
					if (outcome.kind === 'unchanged') {
						continue;
					}
					removed.push(guide);
					if (outcome.kind === 'trashed') {
						trashed.push(guide);
					} else if (outcome.kind === 'notTrashed') {
						notTrashed.push({ guide, reason: outcome.reason });
					}
				}
			});
		}

		return { removed, trashed, skipped, notTrashed };
	}

	private async removeOne(guide: IBaseHalfAgentGuide): Promise<
		| { readonly kind: 'skipped'; readonly reason: BaseHalfAgentGuideSkipReason }
		| { readonly kind: 'unchanged' | 'removed' | 'trashed' }
		| { readonly kind: 'notTrashed'; readonly reason: BaseHalfAgentGuideNotTrashedReason }
	> {
		const resource = guide.resource;
		if (this.workingCopyService.isDirty(resource)) {
			return { kind: 'skipped', reason: 'dirty' };
		}

		let current: VSBuffer;
		try {
			// Never write through a link: neither the file nor a directory
			// between the workspace folder and it (`.github/`) may be one.
			const segments = guide.file.split('/');
			for (let depth = 1; depth <= segments.length; depth++) {
				if ((await this.fileService.stat(URI.joinPath(guide.workspaceFolder, ...segments.slice(0, depth)))).isSymbolicLink) {
					return { kind: 'skipped', reason: 'symbolicLink' };
				}
			}
			const stat = await this.fileService.stat(resource);
			if (!stat.isFile) {
				return { kind: 'skipped', reason: 'unreadable' };
			}
			current = (await this.fileService.readFile(resource, { limits: { size: AGENT_GUIDE_MAX_BYTES } })).value;
		} catch {
			return { kind: 'skipped', reason: 'unreadable' };
		}

		const decoded = baseHalfDecodeAgentGuide(current);
		if (!decoded) {
			return { kind: 'skipped', reason: 'notText' };
		}
		const removal = baseHalfRemoveAgentGuideSections(decoded.text, guide.file);
		if (removal.kind === 'none') {
			return { kind: 'unchanged' };
		}
		if (removal.kind === 'unrecognized') {
			return { kind: 'skipped', reason: 'unrecognized' };
		}

		const next = baseHalfEncodeAgentGuide(decoded.bom, removal.text);
		try {
			await this.fileService.writeFileWithExpectedContents(resource, next, current, {
				atomic: { postfix: '.basehalf-cleanup' }
			});
		} catch (error) {
			if (toFileOperationResult(error) === FileOperationResult.FILE_MODIFIED_SINCE) {
				return { kind: 'skipped', reason: 'changed' };
			}
			this.logService.error(`[BaseHalf] could not remove the BaseHalf section from ${resource.toString()}`, error);
			return { kind: 'skipped', reason: 'writeFailed' };
		}

		if (!removal.boilerplateOnly) {
			return { kind: 'removed' };
		}
		if (!this.fileService.hasCapability(resource, FileSystemProviderCapabilities.Trash) || this.configurationService.getValue<boolean>('files.enableTrash') === false) {
			return { kind: 'notTrashed', reason: 'trashUnavailable' };
		}
		try {
			const stat = await this.fileService.stat(resource);
			const written = (await this.fileService.readFile(resource, { limits: { size: AGENT_GUIDE_MAX_BYTES } })).value;
			if (stat.isSymbolicLink || !stat.isFile || !written.equals(next) || this.workingCopyService.isDirty(resource)) {
				return { kind: 'notTrashed', reason: 'changed' };
			}
			// Never a permanent delete: without the trash the base text stays.
			await this.fileService.del(resource, { useTrash: true, recursive: false });
			return { kind: 'trashed' };
		} catch (error) {
			this.logService.warn(`[BaseHalf] could not move ${resource.toString()} to the trash`, error);
			return { kind: 'notTrashed', reason: 'trashFailed' };
		}
	}

	private async cleanLocked(workspaceFolder: URI): Promise<IBaseHalfLegacyCleanupReport> {
		const run = new BaseHalfLegacyCleanupRun(workspaceFolder);
		const bh = URI.joinPath(workspaceFolder, '.bh');
		let bhStat: IFileStatWithPartialMetadata;
		try {
			bhStat = await this.fileService.stat(bh);
		} catch (error) {
			if (!isFileNotFound(error)) {
				run.failed.push({ path: '.bh', reason: errorReason(error) });
			}
			return run.report();
		}
		if (bhStat.isSymbolicLink) {
			this.logService.info(`[BaseHalf] legacy cleanup skipped ${workspaceFolder.toString()}: .bh is a symbolic link`);
			return run.report('symbolicLink');
		}
		if (!bhStat.isDirectory) {
			return run.report();
		}

		// 1. Import legacy folder viewports before anything is deleted.
		const focusFiles = await this.collectMirrorFocusFiles(run);
		await this.importFolderViewports(run, focusFiles);
		this.viewportStateService.settleLegacyImport(workspaceFolder);

		// 2. The current-focus symbolic link and its leftover temporary links.
		await this.removeCurrentFocus(run, bh);

		// 3. Every regular focus.yaml file under .bh/mirror/.
		for (const entry of focusFiles) {
			await this.deleteClassifiedFile(run, entry, 'mirror');
		}

		// 4. Sentinel-stamped agent-harness files.
		const harness = URI.joinPath(bh, 'agent-harness');
		await this.removeHarnessFiles(run, harness);
		await this.removeHarnessFiles(run, URI.joinPath(harness, 'scenarios'));

		// 5. Directories these deletions left empty.
		await this.removeEmptiedDirectories(run, harness);

		if (run.removedFiles.length > 0 || run.removedDirectories.length > 0) {
			this.logService.info(`[BaseHalf] legacy cleanup of ${workspaceFolder.toString()} removed ${run.removedFiles.length} files and ${run.removedDirectories.length} directories from .bh/`);
		}
		for (const item of run.kept) {
			this.logService.info(`[BaseHalf] legacy cleanup kept ${item.path}: ${item.reason}`);
		}
		for (const item of run.failed) {
			this.logService.warn(`[BaseHalf] legacy cleanup could not remove ${item.path}: ${item.reason}`);
		}
		return run.report();
	}

	/** Regular `focus.yaml` files under `.bh/mirror/`. The walk never descends
	 *  into or follows a symbolic link; a directory named `focus.yaml` (the
	 *  mirror directory of a user file of that name) is never a candidate. */
	private async collectMirrorFocusFiles(run: BaseHalfLegacyCleanupRun): Promise<Array<IClassifiedEntry & { readonly relativePath: string }>> {
		let entries;
		try {
			entries = await baseHalfWalkMirror(this.fileService, run.workspaceFolder, FOCUS_FILE_NAME);
		} catch (error) {
			run.failed.push({ path: '.bh/mirror', reason: errorReason(error) });
			return [];
		}

		const files: Array<IClassifiedEntry & { readonly relativePath: string }> = [];
		for (const entry of entries) {
			try {
				const stat = await this.fileService.stat(entry.resource);
				if (stat.isFile && !stat.isSymbolicLink) {
					files.push({ resource: entry.resource, stat, relativePath: entry.relativePath });
				}
			} catch (error) {
				if (!isFileNotFound(error)) {
					run.failed.push({ path: run.relative(entry.resource), reason: errorReason(error) });
				}
			}
		}
		return files;
	}

	private async importFolderViewports(run: BaseHalfLegacyCleanupRun, focusFiles: ReadonlyArray<IClassifiedEntry & { readonly relativePath: string }>): Promise<void> {
		const viewports: IBaseHalfLegacyCanvasViewport[] = [];
		for (const entry of focusFiles) {
			try {
				const document = parseBaseHalfLegacyFocusDocument((await this.fileService.readFile(entry.resource, { limits: { size: FOCUS_YAML_MAX_BYTES } })).value.toString());
				if (document?.kind !== 'folder' || !document.viewport || document.path !== entry.relativePath) {
					continue;
				}
				viewports.push({
					folder: URI.joinPath(run.workspaceFolder, ...baseHalfMirrorPathSegments(entry.relativePath)),
					...document.viewport
				});
			} catch (error) {
				this.logService.warn(`[BaseHalf] could not import the legacy viewport in ${entry.resource.toString()}`, error);
			}
		}
		run.importedViewports = this.viewportStateService.importLegacy(viewports).length;
	}

	private async removeCurrentFocus(run: BaseHalfLegacyCleanupRun, bh: URI): Promise<void> {
		const currentFocus = URI.joinPath(bh, CURRENT_FOCUS_FILE_NAME);
		try {
			const stat = await this.fileService.stat(currentFocus);
			if (stat.isSymbolicLink) {
				await this.deleteClassifiedLink(run, { resource: currentFocus, stat });
			} else if (stat.isFile) {
				const raw = (await this.fileService.readFile(currentFocus, { limits: { size: FOCUS_YAML_MAX_BYTES } })).value.toString();
				if (parseBaseHalfLegacyFocusDocument(raw)) {
					await this.deleteClassifiedFile(run, { resource: currentFocus, stat }, 'bh');
				} else {
					run.kept.push({ path: run.relative(currentFocus), reason: 'a regular file that is not a focus document' });
				}
			}
		} catch (error) {
			if (!isFileNotFound(error)) {
				run.failed.push({ path: run.relative(currentFocus), reason: errorReason(error) });
			}
		}

		let children;
		try {
			children = (await this.fileService.resolve(bh)).children ?? [];
		} catch (error) {
			run.failed.push({ path: '.bh', reason: errorReason(error) });
			return;
		}
		for (const child of children) {
			if (!child.isSymbolicLink || !child.name.startsWith(`${CURRENT_FOCUS_FILE_NAME}.`) || !child.name.endsWith('.tmp')) {
				continue;
			}
			try {
				await this.deleteClassifiedLink(run, { resource: child.resource, stat: await this.fileService.stat(child.resource) });
			} catch (error) {
				if (!isFileNotFound(error)) {
					run.failed.push({ path: run.relative(child.resource), reason: errorReason(error) });
				}
			}
		}
	}

	private async removeHarnessFiles(run: BaseHalfLegacyCleanupRun, directory: URI): Promise<void> {
		let children;
		try {
			const stat = await this.fileService.stat(directory);
			if (stat.isSymbolicLink) {
				run.kept.push({ path: run.relative(directory), reason: 'a symbolic link' });
				return;
			}
			if (!stat.isDirectory) {
				return;
			}
			await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, run.workspaceFolder, directory);
			children = (await this.fileService.resolve(directory)).children ?? [];
		} catch (error) {
			if (!isFileNotFound(error)) {
				run.failed.push({ path: run.relative(directory), reason: errorReason(error) });
			}
			return;
		}

		for (const child of children) {
			if (child.isSymbolicLink || !child.isFile) {
				continue;
			}
			try {
				const stat = await this.fileService.stat(child.resource);
				const head = (await this.fileService.readFile(child.resource, { length: VSBuffer.fromString(AGENT_HARNESS_SENTINEL_PREFIX).byteLength })).value.toString();
				if (head === AGENT_HARNESS_SENTINEL_PREFIX) {
					await this.deleteClassifiedFile(run, { resource: child.resource, stat }, 'bh');
				}
			} catch (error) {
				if (!isFileNotFound(error)) {
					run.failed.push({ path: run.relative(child.resource), reason: errorReason(error) });
				}
			}
		}
	}

	/** Remove empty, non-link directories under `.bh/mirror/` and the harness
	 *  that became empty through this run's deletions, deepest first. */
	private async removeEmptiedDirectories(run: BaseHalfLegacyCleanupRun, harness: URI): Promise<void> {
		const mirrorRoot = baseHalfMirrorRoot(run.workspaceFolder);
		const eligible = (directory: URI) => (isEqualOrParent(directory, mirrorRoot) && !isEqual(directory, mirrorRoot))
			|| isEqualOrParent(directory, harness);
		const pending = new Map<string, URI>();
		for (const directory of run.touchedDirectories) {
			if (eligible(directory)) {
				pending.set(directory.toString(), directory);
			}
		}

		while (pending.size > 0) {
			const deepest = [...pending.values()].sort((a, b) => b.path.length - a.path.length)[0];
			pending.delete(deepest.toString());
			try {
				await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, run.workspaceFolder, deepest);
				const stat = await this.fileService.resolve(deepest);
				if (!stat.isDirectory || stat.isSymbolicLink || (stat.children?.length ?? 0) > 0) {
					continue;
				}
				await this.fileService.del(deepest, { recursive: false, useTrash: false, atomic: false });
				run.removedDirectories.push(run.relative(deepest));
				const parent = dirname(deepest);
				if (eligible(parent)) {
					pending.set(parent.toString(), parent);
				}
			} catch (error) {
				if (!isFileNotFound(error)) {
					run.failed.push({ path: run.relative(deepest), reason: errorReason(error) });
				}
			}
		}
	}

	/** Delete a regular file after re-checking every component from `.bh` to
	 *  it, and that it is still the same regular file. Non-recursive. */
	private async deleteClassifiedFile(run: BaseHalfLegacyCleanupRun, entry: IClassifiedEntry, tree: 'mirror' | 'bh'): Promise<void> {
		try {
			if (tree === 'mirror') {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, run.workspaceFolder, entry.resource);
			} else {
				await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, run.workspaceFolder, entry.resource);
			}
			const current = await this.fileService.stat(entry.resource);
			if (!current.isFile || current.isSymbolicLink || !sameEntry(current, entry.stat)) {
				run.kept.push({ path: run.relative(entry.resource), reason: 'changed since it was classified' });
				return;
			}
			await this.fileService.del(entry.resource, { recursive: false, useTrash: false, atomic: false });
			run.removedFiles.push(run.relative(entry.resource));
			run.touchedDirectories.push(dirname(entry.resource));
		} catch (error) {
			if (!isFileNotFound(error)) {
				run.failed.push({ path: run.relative(entry.resource), reason: errorReason(error) });
			}
		}
	}

	/** Delete a symbolic link itself (never its target) after re-checking that
	 *  no component from `.bh` to its parent is a link and that it is still the
	 *  same link. Non-recursive. */
	private async deleteClassifiedLink(run: BaseHalfLegacyCleanupRun, entry: IClassifiedEntry): Promise<void> {
		try {
			await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, run.workspaceFolder, dirname(entry.resource));
			const current = await this.fileService.stat(entry.resource);
			if (!current.isSymbolicLink || !sameEntry(current, entry.stat)) {
				run.kept.push({ path: run.relative(entry.resource), reason: 'changed since it was classified' });
				return;
			}
			await this.fileService.del(entry.resource, { recursive: false, useTrash: false, atomic: false });
			run.removedFiles.push(run.relative(entry.resource));
		} catch (error) {
			if (!isFileNotFound(error)) {
				run.failed.push({ path: run.relative(entry.resource), reason: errorReason(error) });
			}
		}
	}

	private isMarked(workspaceFolder: URI): Promise<boolean> {
		return baseHalfIsWorkspaceFolderMarked(this.fileService, workspaceFolder);
	}
}

/**
 * Whether a workspace folder opts out of every BaseHalf write with
 * {@link BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER}. When the provider cannot
 * say whether the marker exists, this fails closed and reports it as marked.
 */
export async function baseHalfIsWorkspaceFolderMarked(fileService: IFileService, workspaceFolder: URI): Promise<boolean> {
	try {
		await fileService.stat(URI.joinPath(workspaceFolder, BASEHALF_WORKSPACE_SETUP_DISABLE_MARKER));
		return true;
	} catch (error) {
		return !isFileNotFound(error);
	}
}

function firstMarkerSelection(text: string): IBaseHalfAgentGuideSelection {
	const lines = text.split('\n');
	const index = Math.max(0, lines.findIndex(line => line.includes(WORKSPACE_HINT_MARKER) || line.includes(RECALL_HINT_MARKER)));
	const line = lines[index].replace(/\r$/, '');
	return { startLineNumber: index + 1, startColumn: 1, endLineNumber: index + 1, endColumn: line.length + 1 };
}

function sameEntry(a: IFileStatWithPartialMetadata, b: IFileStatWithPartialMetadata): boolean {
	return a.isFile === b.isFile
		&& a.isDirectory === b.isDirectory
		&& a.isSymbolicLink === b.isSymbolicLink
		&& a.mtime === b.mtime
		&& a.ctime === b.ctime
		&& a.size === b.size;
}

function isFileNotFound(error: unknown): boolean {
	return error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND;
}

function errorReason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

//#endregion

registerSingleton(IBaseHalfLegacyCleanupService, BaseHalfLegacyCleanupService, InstantiationType.Delayed);
