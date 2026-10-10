/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { dirname } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { parse as parseYaml, YamlMapNode, YamlParseError, YamlScalarNode } from '../../../base/common/yaml.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { IBaseHalfWorkspaceResource } from './basehalfCanvasNavigation.js';
import { createKeyedMutex } from './basehalfKeyedMutex.js';
import { baseHalfCommitMirrorFile } from './basehalfMirrorFileCommit.js';
import { baseHalfPreserveMirrorBytes, IBaseHalfMirrorPreservedEvent } from './basehalfMirrorRecovery.js';
import { baseHalfAssertMirrorPathComponentsNotSymbolicLink, baseHalfMirrorPathSegments, baseHalfMirrorResource, baseHalfWalkMirror } from './basehalfMirrorTree.js';
import { baseHalfPlainFailureReason } from './basehalfPlainFailureReason.js';
import {
	baseHalfMirrorPathNamesNode,
	BaseHalfMirrorWriteRejected,
	baseHalfMirrorYamlAbsent,
	baseHalfMirrorYamlBoolean,
	baseHalfMirrorYamlProperty,
	baseHalfMirrorYamlQuote,
	baseHalfMirrorYamlString,
	BaseHalfMirrorYamlUnreadable,
	baseHalfParseMirrorYaml,
	IBaseHalfMirrorYamlDocument
} from './basehalfMirrorYaml.js';

export const IBaseHalfBadgeMirrorService = createDecorator<IBaseHalfBadgeMirrorService>('baseHalfBadgeMirrorService');

const BADGE_YAML_MAX_BYTES = 128 * 1024;
const BADGE_PATCH_MAX_ATTEMPTS = 3;

export type BaseHalfBadgeKind = 'file' | 'folder';

export interface IBaseHalfBadgeNode extends IBaseHalfWorkspaceResource {
	readonly kind: BaseHalfBadgeKind;
}

/**
 * A parsed `badge.yaml`. Since D37 a badge holds `path`, `kind`,
 * `description`, and `orphan`, and never holds references. Legacy
 * `references` and `referenced_by` keys of earlier releases are not part of
 * this view: every write keeps their text verbatim until a migration removes
 * them (see {@link IBaseHalfBadgeMirrorService.readLegacyReferences}).
 */
export interface IBaseHalfBadgeFile {
	readonly path: string;
	readonly kind: BaseHalfBadgeKind;
	readonly description?: string;
	readonly orphan?: boolean;
}

/** The legacy reference keys of one `badge.yaml`, for migration. */
export interface IBaseHalfBadgeLegacyReferences {
	/** Workspace-relative path of the node that owns the badge. */
	readonly relativePath: string;
	/** The `badge.yaml` resource. */
	readonly resource: URI;
	/** The badge's stored kind, when its identity fields are readable. */
	readonly kind?: BaseHalfBadgeKind;
	/** Items of the legacy `references` key in file order (this node is
	 * upstream of each), or `undefined` when the key is absent or malformed. */
	readonly references?: readonly string[];
	/** Items of the legacy `referenced_by` key in file order (each is upstream
	 * of this node), or `undefined` when the key is absent or malformed. */
	readonly referencedBy?: readonly string[];
	/** Legacy keys present with a value that is not a list of strings. */
	readonly malformed: readonly BaseHalfBadgeLegacyKey[];
}

export type BaseHalfBadgeLegacyKey = 'references' | 'referenced_by';

/** Which legacy items a migration removes from one badge. */
export interface IBaseHalfBadgeLegacyRemoval {
	readonly references?: readonly string[];
	readonly referencedBy?: readonly string[];
	/** Also remove legacy keys whose value is malformed. */
	readonly malformed?: boolean;
}

export interface IBaseHalfBadgeLegacyListResult {
	readonly entries: readonly IBaseHalfBadgeLegacyReferences[];
	readonly problems: readonly IBaseHalfBadgeReadProblem[];
}

interface IBaseHalfBadgeAbsentReadState {
	readonly exists: false;
	readonly badge: null;
}

interface IBaseHalfBadgeExistingReadState {
	readonly exists: true;
	readonly badge: IBaseHalfBadgeFile | null;
	readonly storedKind?: BaseHalfBadgeKind;
	readonly contents: VSBuffer;
	/** The legacy key blocks of `contents`, verbatim, in file order. */
	readonly legacyText: string;
	/** Why the identity fields of `contents` could not be read. The badge then
	 * reads as absent, and a write keeps `contents` as a recovery copy. */
	readonly unreadable?: string;
}

type IBaseHalfBadgeReadState = IBaseHalfBadgeAbsentReadState | IBaseHalfBadgeExistingReadState;

/** A `badge.yaml` the file system refused to read. */
export interface IBaseHalfBadgeReadProblem {
	readonly relativePath: string;
	readonly resource: URI;
	/** Why the read failed, in plain words for the user. */
	readonly message: string;
	/** The error's own text, for the log. */
	readonly detail: string;
}

export interface IBaseHalfBadgeReadResult {
	readonly badges: ReadonlyMap<string, IBaseHalfBadgeFile>;
	readonly problems: readonly IBaseHalfBadgeReadProblem[];
}

/**
 * The badge FILE layer: maps a workspace node to its `.bh/mirror/<rel>/badge.yaml`
 * and owns parsing, validation, serialization, and per-file write atomicity.
 * Badges hold descriptions only; references live in the downstream node's own
 * store (D37, `IBaseHalfReferenceEditService`). The mirror cascade owns the
 * orphan lifecycle and relocation of badge files.
 */
export interface IBaseHalfBadgeMirrorService {
	readonly _serviceBrand: undefined;

	/** Fires after a badge write replaced a file whose content could not be read. */
	readonly onDidPreserveUnreadableBadge: Event<IBaseHalfMirrorPreservedEvent>;

	/** The badge, or `null` when it is absent or its content cannot be read.
	 *  It rejects only when the file system refuses the read (mirror file
	 *  resilience, "Annotation files"). */
	readBadge(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeFile | null>;
	readBadges(nodes: readonly IBaseHalfBadgeNode[]): Promise<IBaseHalfBadgeReadResult>;
	/** Every materialized badge.yaml in the workspace's mirror tree,
	 *  keyed by workspace-relative path. A file the file system refuses to
	 *  read is collected as a problem, never thrown — one bad badge must not
	 *  blank a listing. A canonical empty tombstone and a file whose content
	 *  cannot be read are logically absent and are not listed. */
	listBadges(workspaceFolder: URI): Promise<IBaseHalfBadgeReadResult>;
	/** Optimistic read-modify-write of one badge.yaml under the file's write
	 *  lock. Existing files use exact-byte guarded atomic replace; absent files
	 *  use provider-exclusive create. Either path replays on an external conflict.
	 *  `update` receives the current badge (or null when absent) and returns the
	 *  next value. Returning null from a materialized badge commits a canonical
	 *  empty tombstone; it never follows a guarded write with an unguarded
	 *  delete. Never-materialized empty badges remain absent. A file whose
	 *  content cannot be read counts as absent: a non-null update replaces it
	 *  after its bytes are kept as a recovery copy, and a null update leaves
	 *  it in place. */
	patchBadge(node: IBaseHalfBadgeNode, update: (current: IBaseHalfBadgeFile | null) => IBaseHalfBadgeFile | null): Promise<IBaseHalfBadgeFile | null>;
	badgeResource(node: IBaseHalfWorkspaceResource): URI;
	/** The legacy reference keys of one badge, or `undefined` when the badge
	 * is absent or has none. Malformed legacy values are reported, not thrown. */
	readLegacyReferences(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeLegacyReferences | undefined>;
	/** Every badge in the workspace's mirror tree that still has a legacy key. */
	listLegacyReferences(workspaceFolder: URI): Promise<IBaseHalfBadgeLegacyListResult>;
	/**
	 * Removes legacy items (and, on request, malformed legacy keys) from one
	 * badge with an exact-byte compare and swap, replaying on external edits.
	 * A key whose list becomes empty is removed. Returns the remaining legacy
	 * state. Only the migration calls this.
	 */
	removeLegacyReferences(node: IBaseHalfBadgeNode, removal: IBaseHalfBadgeLegacyRemoval): Promise<IBaseHalfBadgeLegacyReferences | undefined>;
	/**
	 * Renames legacy `references` and `referenced_by` items of one badge: each
	 * item for which `rename` returns a path is replaced by it. A workbench move
	 * calls this so a pair a migration has not moved yet stays complete. Only a
	 * legacy key that names a renamed item is rewritten; every other byte stays
	 * verbatim. Uses an exact-byte compare and swap that replays on external
	 * edits. Returns whether it wrote.
	 */
	renameLegacyReferences(node: IBaseHalfBadgeNode, rename: (item: string) => string | undefined): Promise<boolean>;
}

class BaseHalfBadgeMirrorCorrupt extends Error {
	override readonly name = 'BaseHalfBadgeMirrorCorrupt';

	constructor(
		readonly resource: URI,
		readonly reason: string,
		options?: { cause?: unknown }
	) {
		super(`Corrupt badge.yaml at ${resource.toString()}: ${reason}`, options);
	}
}

export class BaseHalfBadgeMirrorService extends Disposable implements IBaseHalfBadgeMirrorService {
	declare readonly _serviceBrand: undefined;
	private readonly mutex = createKeyedMutex();

	private readonly _onDidPreserveUnreadableBadge = this._register(new Emitter<IBaseHalfMirrorPreservedEvent>());
	readonly onDidPreserveUnreadableBadge = this._onDidPreserveUnreadableBadge.event;

	constructor(
		@IFileService private readonly fileService: IFileService
	) {
		super();
	}

	async readBadge(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeFile | null> {
		return this.readBadgeAt(node.workspaceFolder, this.badgeResource(node), node.relativePath);
	}

	async readBadges(nodes: readonly IBaseHalfBadgeNode[]): Promise<IBaseHalfBadgeReadResult> {
		const badges = new Map<string, IBaseHalfBadgeFile>();
		const problems: IBaseHalfBadgeReadProblem[] = [];
		for (const node of nodes) {
			try {
				const badge = await this.readBadge(node);
				if (badge) {
					badges.set(badge.path, badge);
				}
			} catch (error) {
				problems.push(this.toProblem(error, node.relativePath, this.badgeResource(node)));
			}
		}

		return { badges, problems };
	}

	async listBadges(workspaceFolder: URI): Promise<IBaseHalfBadgeReadResult> {
		const badges = new Map<string, IBaseHalfBadgeFile>();
		const problems: IBaseHalfBadgeReadProblem[] = [];
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, 'badge.yaml')) {
			try {
				const badge = await this.readBadgeAt(workspaceFolder, entry.resource, entry.relativePath);
				if (badge) {
					badges.set(badge.path, badge);
				}
			} catch (error) {
				problems.push(this.toProblem(error, entry.relativePath, entry.resource));
			}
		}

		return { badges, problems };
	}

	patchBadge(node: IBaseHalfBadgeNode, update: (current: IBaseHalfBadgeFile | null) => IBaseHalfBadgeFile | null): Promise<IBaseHalfBadgeFile | null> {
		const resource = this.badgeResource(node);
		return this.mutex.runExclusive(resource.toString(), async () => {
			for (let attempt = 0; attempt < BADGE_PATCH_MAX_ATTEMPTS; attempt++) {
				const current = await this.readBadgeStateAt(node.workspaceFolder, resource, node.relativePath);
				const next = update(current.badge);
				if (next === null && current.badge === null) {
					return null;
				}
				try {
					// Bytes that could not be read are kept before a write the
					// user asked for replaces them.
					const preserved = current.exists && current.unreadable !== undefined
						? { reason: current.unreadable, recoveryCopy: await baseHalfPreserveMirrorBytes(this.fileService, node.workspaceFolder, resource, current.contents) }
						: undefined;
					const committed = await this.commitBadgeUnlocked(node, resource, current, next);
					if (preserved) {
						this._onDidPreserveUnreadableBadge.fire({ workspaceFolder: node.workspaceFolder, relativePath: node.relativePath, ...preserved });
					}
					return committed;
				} catch (error) {
					if (!isBadgePatchConflict(error) || attempt === BADGE_PATCH_MAX_ATTEMPTS - 1) {
						throw error;
					}
				}
			}
			throw new Error(`Unable to update ${resource.toString()} after ${BADGE_PATCH_MAX_ATTEMPTS} attempts`);
		});
	}

	badgeResource(node: IBaseHalfWorkspaceResource): URI {
		return baseHalfMirrorResource(node.workspaceFolder, node.relativePath, 'badge.yaml');
	}

	async readLegacyReferences(node: IBaseHalfBadgeNode): Promise<IBaseHalfBadgeLegacyReferences | undefined> {
		return this.readLegacyAt(node.workspaceFolder, this.badgeResource(node), node.relativePath);
	}

	async listLegacyReferences(workspaceFolder: URI): Promise<IBaseHalfBadgeLegacyListResult> {
		const entries: IBaseHalfBadgeLegacyReferences[] = [];
		const problems: IBaseHalfBadgeReadProblem[] = [];
		for (const entry of await baseHalfWalkMirror(this.fileService, workspaceFolder, 'badge.yaml')) {
			try {
				const legacy = await this.readLegacyAt(workspaceFolder, entry.resource, entry.relativePath);
				if (legacy) {
					entries.push(legacy);
				}
			} catch (error) {
				problems.push(this.toProblem(error, entry.relativePath, entry.resource));
			}
		}
		return { entries, problems };
	}

	removeLegacyReferences(node: IBaseHalfBadgeNode, removal: IBaseHalfBadgeLegacyRemoval): Promise<IBaseHalfBadgeLegacyReferences | undefined> {
		const resource = this.badgeResource(node);
		return this.mutex.runExclusive(resource.toString(), async () => {
			for (let attempt = 0; attempt < BADGE_PATCH_MAX_ATTEMPTS; attempt++) {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
				let content;
				try {
					content = await this.fileService.readFile(resource, { limits: { size: BADGE_YAML_MAX_BYTES }, atomic: true });
				} catch (error) {
					if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
						return undefined;
					}
					throw error;
				}
				const raw = content.value.toString();
				const next = removeLegacyItems(raw, removal);
				if (next === raw) {
					return legacyReferencesOf(raw, resource, node.relativePath);
				}
				try {
					await baseHalfCommitMirrorFile(this.fileService, resource, VSBuffer.fromString(next), content.value);
					await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
					return legacyReferencesOf(next, resource, node.relativePath);
				} catch (error) {
					if (!isBadgePatchConflict(error) || attempt === BADGE_PATCH_MAX_ATTEMPTS - 1) {
						throw error;
					}
				}
			}
			throw new Error(`Unable to update ${resource.toString()} after ${BADGE_PATCH_MAX_ATTEMPTS} attempts`);
		});
	}

	renameLegacyReferences(node: IBaseHalfBadgeNode, rename: (item: string) => string | undefined): Promise<boolean> {
		const resource = this.badgeResource(node);
		return this.mutex.runExclusive(resource.toString(), async () => {
			for (let attempt = 0; attempt < BADGE_PATCH_MAX_ATTEMPTS; attempt++) {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
				let content;
				try {
					content = await this.fileService.readFile(resource, { limits: { size: BADGE_YAML_MAX_BYTES }, atomic: true });
				} catch (error) {
					if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
						return false;
					}
					throw error;
				}
				const raw = content.value.toString();
				const next = baseHalfRenameLegacyBadgeItems(raw, rename);
				if (next === raw) {
					return false;
				}
				try {
					await baseHalfCommitMirrorFile(this.fileService, resource, VSBuffer.fromString(next), content.value);
					await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
					return true;
				} catch (error) {
					if (!isBadgePatchConflict(error) || attempt === BADGE_PATCH_MAX_ATTEMPTS - 1) {
						throw error;
					}
				}
			}
			throw new Error(`Unable to update ${resource.toString()} after ${BADGE_PATCH_MAX_ATTEMPTS} attempts`);
		});
	}

	private async readLegacyAt(workspaceFolder: URI, resource: URI, relativePath: string): Promise<IBaseHalfBadgeLegacyReferences | undefined> {
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		let content;
		try {
			content = await this.fileService.readFile(resource, { limits: { size: BADGE_YAML_MAX_BYTES }, atomic: true });
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return undefined;
			}
			throw error;
		}
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		return legacyReferencesOf(content.value.toString(), resource, relativePath);
	}

	private async readBadgeAt(workspaceFolder: URI, resource: URI, relativePath: string): Promise<IBaseHalfBadgeFile | null> {
		return (await this.readBadgeStateAt(workspaceFolder, resource, relativePath)).badge;
	}

	/** Commits `updated` exactly once against the exact bytes of `expected`.
	 * An existing badge owns its stored kind. The legacy reference keys travel
	 * verbatim from the replaced bytes. */
	private async commitBadgeUnlocked(
		node: IBaseHalfBadgeNode,
		resource: URI,
		expected: IBaseHalfBadgeReadState,
		updated: IBaseHalfBadgeFile | null
	): Promise<IBaseHalfBadgeFile | null> {
		const storedKind = expected.exists ? expected.storedKind : undefined;
		const kind = storedKind ?? updated?.kind ?? node.kind;
		const badge: IBaseHalfBadgeFile = {
			path: node.relativePath,
			kind,
			...(updated?.description ? { description: updated.description } : {}),
			...(updated?.orphan ? { orphan: true } : {})
		};
		const legacyText = expected.exists ? expected.legacyText : '';
		const contents = encodeBadgeFile(badge, legacyText, resource);
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
		await this.fileService.createFolder(dirname(resource));
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, node.workspaceFolder, resource);
		await baseHalfCommitMirrorFile(
			this.fileService,
			resource,
			contents,
			expected.exists ? expected.contents : null
		);
		return isEmptyBadge(badge) ? null : badge;
	}

	private async readBadgeStateAt(workspaceFolder: URI, resource: URI, relativePath: string): Promise<IBaseHalfBadgeReadState> {
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		let content;
		try {
			content = await this.fileService.readFile(resource, {
				limits: { size: BADGE_YAML_MAX_BYTES },
				atomic: true
			});
		} catch (error) {
			if (error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
				return { exists: false, badge: null };
			}

			throw error;
		}
		await baseHalfAssertMirrorPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);

		const raw = content.value.toString();
		const split = splitLegacyBlocks(raw);
		try {
			const parsed = parseBadgeYaml(split.identityText, resource);
			if (parsed === null) {
				return { exists: true, badge: null, contents: content.value, legacyText: split.legacyText };
			}

			const badge = normalizeBadgeFile(parsed, resource, relativePath);
			return {
				exists: true,
				badge: isEmptyBadge(badge) ? null : badge,
				storedKind: badge.kind,
				contents: content.value,
				legacyText: split.legacyText
			};
		} catch (error) {
			if (!(error instanceof BaseHalfBadgeMirrorCorrupt)) {
				throw error;
			}
			// The user is never asked to repair a hidden file: the badge reads
			// as absent, and the legacy blocks, split out by line, still travel.
			return { exists: true, badge: null, contents: content.value, legacyText: split.legacyText, unreadable: error.reason };
		}
	}

	private toProblem(error: unknown, relativePath: string, resource: URI): IBaseHalfBadgeReadProblem {
		return {
			relativePath,
			resource,
			message: baseHalfPlainFailureReason(error),
			detail: error instanceof Error ? error.message : String(error)
		};
	}
}

function isBadgePatchConflict(error: unknown): boolean {
	return error instanceof FileOperationError && (
		error.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE
		|| error.fileOperationResult === FileOperationResult.FILE_MOVE_CONFLICT
		|| error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND
	);
}

function isEmptyBadge(badge: IBaseHalfBadgeFile): boolean {
	return !badge.description && badge.orphan !== true;
}

/**
 * Writes the D37 badge schema (`path`, `kind`, `description`, `orphan`). The
 * legacy reference blocks of the replaced bytes are appended verbatim, so a
 * badge write never changes them until a migration removes them.
 */
function serializeBadgeFile(badge: IBaseHalfBadgeFile, legacyText: string): string {
	const lines = [
		`path: ${baseHalfMirrorYamlQuote(badge.path)}`,
		`kind: ${badge.kind}`
	];

	if (badge.description) {
		lines.push(`description: ${baseHalfMirrorYamlQuote(badge.description)}`);
	}

	let text = lines.join('\n') + '\n';
	if (legacyText) {
		text += /(?:\r\n|\n|\r)$/.test(legacyText) ? legacyText : `${legacyText}\n`;
	}
	if (badge.orphan) {
		text += 'orphan: true\n';
	}
	return text;
}

/**
 * The bytes of a `badge.yaml` after the write check: the reader must return
 * the identity fields that were serialized, or nothing is written (mirror
 * file resilience, "Write check"). Legacy blocks travel verbatim and are not
 * part of the check.
 */
function encodeBadgeFile(badge: IBaseHalfBadgeFile, legacyText: string, resource: URI): VSBuffer {
	const text = serializeBadgeFile(badge, legacyText);
	let readBack: IBaseHalfBadgeFile | undefined;
	try {
		const root = parseBadgeYaml(splitLegacyBlocks(text).identityText, resource);
		readBack = root === null ? undefined : normalizeBadgeFile(root, resource, badge.path);
	} catch (error) {
		if (!(error instanceof BaseHalfBadgeMirrorCorrupt)) {
			throw error;
		}
		throw new BaseHalfMirrorWriteRejected(resource, error.reason);
	}
	if (readBack?.path !== badge.path || readBack.kind !== badge.kind
		|| (readBack.description ?? '') !== (badge.description ?? '')
		|| (readBack.orphan === true) !== (badge.orphan === true)) {
		throw new BaseHalfMirrorWriteRejected(resource, 'the badge changed when it was read back');
	}
	return VSBuffer.fromString(text);
}

interface ILegacyBlock {
	readonly key: BaseHalfBadgeLegacyKey;
	readonly text: string;
}

interface ILegacySplit {
	/** The file without its legacy blocks. */
	readonly identityText: string;
	/** Every legacy block, verbatim and in file order. */
	readonly legacyText: string;
	readonly blocks: readonly ILegacyBlock[];
}

const LEGACY_KEY_LINE = /^(references|referenced_by)[ \t]*:/;

/**
 * Splits the top-level `references` and `referenced_by` blocks out of a badge
 * by lines, so no legacy value, however malformed, can make the identity
 * fields unreadable. A block runs from its key line through every following
 * line that is blank, indented, a comment, or a column-0 sequence item.
 */
function splitLegacyBlocks(raw: string): ILegacySplit {
	const lines = raw.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(line => line !== '') ?? [];
	let identityText = '';
	const blocks: ILegacyBlock[] = [];
	let current: { key: BaseHalfBadgeLegacyKey; text: string } | undefined;
	for (const line of lines) {
		const content = line.replace(/(?:\r\n|\n|\r)$/, '');
		if (current && (content.trim() === '' || /^[ \t#]/.test(content) || /^-(?:[ \t]|$)/.test(content))) {
			current.text += line;
			continue;
		}
		const match = LEGACY_KEY_LINE.exec(content);
		if (match) {
			current = { key: match[1] as BaseHalfBadgeLegacyKey, text: line };
			blocks.push(current);
			continue;
		}
		current = undefined;
		identityText += line;
	}
	return { identityText, legacyText: blocks.map(block => block.text).join(''), blocks };
}

interface ILegacyValue {
	readonly items?: readonly string[];
	readonly malformed: boolean;
}

function legacyValue(blocks: readonly ILegacyBlock[], key: BaseHalfBadgeLegacyKey): ILegacyValue | undefined {
	const matching = blocks.filter(block => block.key === key);
	if (matching.length === 0) {
		return undefined;
	}
	if (matching.length > 1) {
		return { malformed: true };
	}
	const errors: YamlParseError[] = [];
	const node = parseYaml(matching[0].text, errors);
	const value = node?.type === 'map' ? node.properties.find(property => property.key.value === key)?.value : undefined;
	if (errors.length > 0 || !value) {
		return { malformed: true };
	}
	if (value.type === 'scalar' && value.format === 'none' && (value.value === '' || value.value === '~' || value.value === 'null')) {
		return { items: [], malformed: false };
	}
	if (value.type !== 'sequence' || value.items.some(item => item.type !== 'scalar' || (item.format === 'none' && /^-?\d+(?:\.\d+)?$|^(?:true|false|null|~)$/.test(item.value)))) {
		return { malformed: true };
	}
	return { items: value.items.map(item => (item as YamlScalarNode).value), malformed: false };
}

/** Whether the legacy badge grammar accepted an item: a canonical
 * workspace-relative path (the root is `''`) that is not the badge's own path. */
export function baseHalfLegacyBadgePathAccepted(item: string, relativePath: string): boolean {
	let canonical: string;
	try {
		canonical = baseHalfMirrorPathSegments(item).join('/');
	} catch {
		return false;
	}
	return !item.includes('\\') && canonical === item && item !== relativePath;
}

function legacyReferencesOf(raw: string, resource: URI, relativePath: string): IBaseHalfBadgeLegacyReferences | undefined {
	const split = splitLegacyBlocks(raw);
	if (split.blocks.length === 0) {
		return undefined;
	}
	const references = legacyValue(split.blocks, 'references');
	const referencedBy = legacyValue(split.blocks, 'referenced_by');
	let kind: BaseHalfBadgeKind | undefined;
	try {
		const root = parseBadgeYaml(split.identityText, resource);
		const stored = root ? baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(root, 'kind')) : undefined;
		kind = stored === 'file' || stored === 'folder' ? stored : undefined;
	} catch {
		kind = undefined;
	}
	const malformed: BaseHalfBadgeLegacyKey[] = [];
	if (references?.malformed) {
		malformed.push('references');
	}
	if (referencedBy?.malformed) {
		malformed.push('referenced_by');
	}
	return {
		relativePath,
		resource,
		...(kind ? { kind } : {}),
		...(references?.items ? { references: references.items } : {}),
		...(referencedBy?.items ? { referencedBy: referencedBy.items } : {}),
		malformed
	};
}

/** Rewrites only the legacy blocks: removed items disappear, a list that
 * becomes empty loses its key, and malformed keys go when requested. */
function removeLegacyItems(raw: string, removal: IBaseHalfBadgeLegacyRemoval): string {
	const split = splitLegacyBlocks(raw);
	if (split.blocks.length === 0) {
		return raw;
	}
	const rewrite = (key: BaseHalfBadgeLegacyKey, removed: readonly string[] | undefined): string | undefined => {
		const value = legacyValue(split.blocks, key);
		if (!value) {
			return undefined;
		}
		const original = split.blocks.filter(block => block.key === key).map(block => block.text).join('');
		if (value.malformed || !value.items) {
			return removal.malformed ? '' : original;
		}
		if (!removed || !value.items.some(item => removed.includes(item))) {
			return original;
		}
		const remaining = value.items.filter(item => !removed.includes(item));
		const eol = /\r\n/.test(raw) ? '\r\n' : '\n';
		return remaining.length === 0 ? '' : `${key}:${eol}${remaining.map(item => `  - ${baseHalfMirrorYamlQuote(item)}${eol}`).join('')}`;
	};
	const references = rewrite('references', removal.references);
	const referencedBy = rewrite('referenced_by', removal.referencedBy);
	let result = '';
	let referencesWritten = false;
	let referencedByWritten = false;
	const lines = raw.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(line => line !== '') ?? [];
	let skipping: BaseHalfBadgeLegacyKey | undefined;
	for (const line of lines) {
		const content = line.replace(/(?:\r\n|\n|\r)$/, '');
		if (skipping && (content.trim() === '' || /^[ \t#]/.test(content) || /^-(?:[ \t]|$)/.test(content))) {
			continue;
		}
		const match = LEGACY_KEY_LINE.exec(content);
		if (match) {
			skipping = match[1] as BaseHalfBadgeLegacyKey;
			if (skipping === 'references' && !referencesWritten) {
				result += references ?? '';
				referencesWritten = true;
			} else if (skipping === 'referenced_by' && !referencedByWritten) {
				result += referencedBy ?? '';
				referencedByWritten = true;
			}
			continue;
		}
		skipping = undefined;
		result += line;
	}
	return result;
}

/**
 * Renames items of the legacy `references` and `referenced_by` keys. A key
 * whose list names no renamed item, a malformed key, and every other line
 * stay byte-identical; a key that names one is written as a list in the
 * format of the legacy writer, keeping item order (a rename that repeats an
 * earlier item keeps the first).
 */
export function baseHalfRenameLegacyBadgeItems(raw: string, rename: (item: string) => string | undefined): string {
	const split = splitLegacyBlocks(raw);
	if (split.blocks.length === 0) {
		return raw;
	}
	const eol = /\r\n/.test(raw) ? '\r\n' : '\n';
	const rewritten = (key: BaseHalfBadgeLegacyKey): string | undefined => {
		const value = legacyValue(split.blocks, key);
		if (!value?.items || value.malformed) {
			return undefined;
		}
		let changed = false;
		const items: string[] = [];
		for (const item of value.items) {
			const next = rename(item) ?? item;
			changed = changed || next !== item;
			if (!items.includes(next)) {
				items.push(next);
			}
		}
		return changed ? `${key}:${eol}${items.map(item => `  - ${baseHalfMirrorYamlQuote(item)}${eol}`).join('')}` : undefined;
	};
	const replacements = new Map<BaseHalfBadgeLegacyKey, string>();
	for (const key of ['references', 'referenced_by'] as const) {
		const text = rewritten(key);
		if (text !== undefined) {
			replacements.set(key, text);
		}
	}
	if (replacements.size === 0) {
		return raw;
	}
	let result = '';
	let skipping: BaseHalfBadgeLegacyKey | undefined;
	const lines = raw.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(line => line !== '') ?? [];
	for (const line of lines) {
		const content = line.replace(/(?:\r\n|\n|\r)$/, '');
		if (skipping && (content.trim() === '' || /^[ \t#]/.test(content) || /^-(?:[ \t]|$)/.test(content))) {
			if (!replacements.has(skipping)) {
				result += line;
			}
			continue;
		}
		const match = LEGACY_KEY_LINE.exec(content);
		if (match) {
			skipping = match[1] as BaseHalfBadgeLegacyKey;
			const replacement = replacements.get(skipping);
			result += replacement ?? line;
			continue;
		}
		skipping = undefined;
		result += line;
	}
	return result;
}

function normalizeBadgeFile(root: YamlMapNode, resource: URI, expectedPath: string): IBaseHalfBadgeFile {
	if (!baseHalfMirrorPathNamesNode(stringField(root, 'path', resource), expectedPath)) {
		throw new BaseHalfBadgeMirrorCorrupt(resource, `path must be "${expectedPath}"`);
	}
	// A path that differs only in case or normalization is this node's.
	const path = expectedPath;

	// The kind is trusted from the FILE, not from the caller: a path cannot be
	// both a file and a folder on disk, so the stored kind is authoritative and a
	// caller's guess (e.g. a reference target defaulting to 'file') must not turn
	// a healthy folder badge into a "corrupt" read.
	const kind = stringField(root, 'kind', resource);
	if (kind !== 'file' && kind !== 'folder') {
		throw new BaseHalfBadgeMirrorCorrupt(resource, 'kind must be "file" or "folder"');
	}

	const descriptionNode = baseHalfMirrorYamlProperty(root, 'description');
	const description = baseHalfMirrorYamlString(descriptionNode);
	if (description === undefined && !baseHalfMirrorYamlAbsent(descriptionNode)) {
		throw new BaseHalfBadgeMirrorCorrupt(resource, 'description must be a string');
	}
	const orphanNode = baseHalfMirrorYamlProperty(root, 'orphan');
	const orphan = baseHalfMirrorYamlBoolean(orphanNode);
	if (orphan === undefined && !baseHalfMirrorYamlAbsent(orphanNode)) {
		throw new BaseHalfBadgeMirrorCorrupt(resource, 'orphan must be a boolean');
	}

	return {
		path,
		kind,
		...(description ? { description } : {}),
		...(orphan === true ? { orphan: true } : {})
	};
}

function parseBadgeYaml(raw: string, resource: URI): YamlMapNode | null {
	let document: IBaseHalfMirrorYamlDocument;
	try {
		document = baseHalfParseMirrorYaml(raw, 'badge');
	} catch (error) {
		if (error instanceof BaseHalfMirrorYamlUnreadable) {
			throw new BaseHalfBadgeMirrorCorrupt(resource, error.reason, { cause: error });
		}
		throw error;
	}
	if (document.unparsed) {
		// A description after that line would be lost on the next write.
		throw new BaseHalfBadgeMirrorCorrupt(resource, document.unparsed);
	}
	return document.root;
}

function stringField(root: YamlMapNode, key: string, resource: URI): string {
	const value = baseHalfMirrorYamlString(baseHalfMirrorYamlProperty(root, key));
	if (value === undefined) {
		throw new BaseHalfBadgeMirrorCorrupt(resource, `${key} must be a string`);
	}

	return value;
}

registerSingleton(IBaseHalfBadgeMirrorService, BaseHalfBadgeMirrorService, InstantiationType.Delayed);
