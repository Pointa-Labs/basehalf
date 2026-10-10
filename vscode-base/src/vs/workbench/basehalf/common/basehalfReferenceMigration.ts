/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IUriIdentityService } from '../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { BaseHalfBadgeLegacyKey, baseHalfLegacyBadgePathAccepted, IBaseHalfBadgeLegacyReferences, IBaseHalfBadgeMirrorService } from './basehalfBadgeMirror.js';
import { IBaseHalfWorkspaceResource } from './basehalfCanvasNavigation.js';
import { baseHalfIsWorkspaceFolderMarked } from './basehalfLegacyCleanup.js';
import { baseHalfAssertBhPathComponentsNotSymbolicLink } from './basehalfMirrorTree.js';
import { BASEHALF_NODE_DOCUMENT_MAX_BYTES, extractBaseHalfNodeUpstreamLenient } from './basehalfNodeDocument.js';
import { BaseHalfReferenceEditFailure, BaseHalfReferenceEditRefusal, BaseHalfReferenceRefusalReason, IBaseHalfReferenceEditService } from './basehalfReferenceEdit.js';
import { baseHalfUpstreamEntryGrammarProblem, baseHalfUpstreamEntryProblem, baseHalfUpstreamIdentity, IBaseHalfUpstreamIdentity } from './basehalfReferenceEntries.js';
import { IBaseHalfReferenceIndexService, IBaseHalfUpstreamView } from './basehalfReferenceIndex.js';
import { BaseHalfUpstreamStoreKind, isBaseHalfUpstreamReservedOutput } from './basehalfReferenceStore.js';
import { IBaseHalfWorkspaceMutationCoordinator } from './basehalfWorkspaceMutation.js';

/**
 * Migration from legacy badge pairs (reference graph, D37).
 *
 * Before D37 a reference `A → B` was stored twice: A's `badge.yaml` listed B
 * in `references`, and B's listed A in `referenced_by`. A pair is complete
 * when both sides are present. The migration writes each complete pair into
 * B's upstream list through the reference edit service after the user
 * confirms, records every processed pair in the append-only
 * `.bh/legacy-references.yaml`, and removes the legacy keys only on a later
 * detection.
 */

/** The append-only migration record, directly under `.bh/`. */
export const BASEHALF_LEGACY_REFERENCES_RECORD_FILE_NAME = 'legacy-references.yaml';

export function baseHalfLegacyReferencesRecordResource(workspaceFolder: URI): URI {
	return URI.joinPath(workspaceFolder, '.bh', BASEHALF_LEGACY_REFERENCES_RECORD_FILE_NAME);
}

//#region Pairs

/** One legacy pair `upstream → downstream`, complete or one-sided. */
export interface IBaseHalfLegacyPair {
	readonly upstream: string;
	readonly downstream: string;
	/** The upstream's badge lists the downstream under `references`. */
	readonly inReferences: boolean;
	/** The downstream's badge lists the upstream under `referenced_by`. */
	readonly inReferencedBy: boolean;
}

/** A legacy key whose value is not a list of strings. It holds no pair. */
export interface IBaseHalfLegacyMalformedKey {
	/** The node path of the badge that holds the key. */
	readonly badge: string;
	readonly key: BaseHalfBadgeLegacyKey;
}

/**
 * Why a pair can never be represented. A pair is never dropped for a path
 * the legacy badge grammar accepted, other than these endpoints.
 * - `oneSided`: only one badge recorded the pair.
 * - `self`: the pair names one node twice.
 * - `rootOrMetadata`: an endpoint is the workspace root or under `.bh/`.
 * - `invalidPath`: an endpoint the legacy grammar never accepted, or that no
 *   upstream entry can name (a control character).
 * - `cannotBeDownstream`: the downstream is in the reserved outputs tree or a
 *   sealed or imported Result artifact.
 * - `malformedKey`: a legacy key whose value is not a list of paths.
 */
export type BaseHalfLegacyDropReason = 'oneSided' | 'self' | 'rootOrMetadata' | 'invalidPath' | 'cannotBeDownstream' | 'malformedKey';

/**
 * Why a pair was not written this time, for a reason the user can fix. Its
 * legacy keys stay and it is offered again.
 * - `otherWorkspaceFolder`: an endpoint belongs to a nested workspace folder.
 *   The pair stays in this folder's badges, so opening this folder alone
 *   migrates it.
 */
export type BaseHalfLegacyDeferReason =
	| 'otherWorkspaceFolder'
	| 'symbolicLink'
	| 'running'
	| 'unsaved'
	| 'conflict'
	| 'readonly'
	| 'unreadable'
	| 'foreign'
	| 'notWritable'
	| 'saveFailed'
	| 'missingDownstream'
	| 'recipeFrozen'
	| 'limit'
	| 'beingMoved'
	| 'indexLoading'
	| 'failed';

export type BaseHalfLegacyPairStatus =
	/** Needs a downstream write ("Will be added"). */
	| { readonly kind: 'write' }
	/** The downstream store already lists the upstream ("Already present"). */
	| { readonly kind: 'present' }
	| { readonly kind: 'dropped'; readonly reason: BaseHalfLegacyDropReason }
	| { readonly kind: 'deferred'; readonly reason: BaseHalfLegacyDeferReason };

export interface IBaseHalfLegacyPlannedPair extends IBaseHalfLegacyPair {
	readonly status: BaseHalfLegacyPairStatus;
	/** The downstream's store kind, when the downstream exists. */
	readonly storeKind?: BaseHalfUpstreamStoreKind;
}

/** The legacy pairs of one workspace folder and what a migration would do. */
export interface IBaseHalfLegacyFolderPlan {
	readonly workspaceFolder: URI;
	readonly pairs: readonly IBaseHalfLegacyPlannedPair[];
	readonly malformed: readonly IBaseHalfLegacyMalformedKey[];
}

export type BaseHalfLegacyOutcome = 'migrated' | 'deferred' | 'dropped';

/** What one migration run did with one pair. */
export interface IBaseHalfLegacyPairOutcome extends IBaseHalfLegacyPair {
	readonly outcome: BaseHalfLegacyOutcome;
	/** `alreadyPresent` for a migrated pair this run did not write. */
	readonly reason?: BaseHalfLegacyDropReason | BaseHalfLegacyDeferReason | 'alreadyPresent';
	/** The error text of a `failed` pair. */
	readonly message?: string;
	readonly storeKind?: BaseHalfUpstreamStoreKind;
}

export interface IBaseHalfLegacyFolderResult {
	readonly workspaceFolder: URI;
	readonly pairs: readonly IBaseHalfLegacyPairOutcome[];
	readonly malformed: readonly IBaseHalfLegacyMalformedKey[];
	/** Store resources this run changed. */
	readonly changedStores: readonly URI[];
	/** Whether every processed pair was appended to the record and read back. */
	readonly recorded: boolean;
}

export interface IBaseHalfLegacyMigrationResult {
	readonly folders: readonly IBaseHalfLegacyFolderResult[];
	/** Pairs this run wrote into a downstream store. */
	readonly moved: number;
	/** Distinct store files this run changed. */
	readonly files: number;
	/** Pairs that were dropped or deferred, plus malformed keys. */
	readonly notMoved: number;
}

/**
 * Derives every pair from the legacy keys of a folder's badges, sorted by
 * downstream then upstream. Items are compared exactly, as the legacy graph
 * did.
 */
export function baseHalfDeriveLegacyPairs(entries: readonly IBaseHalfBadgeLegacyReferences[]): { readonly pairs: IBaseHalfLegacyPair[]; readonly malformed: IBaseHalfLegacyMalformedKey[] } {
	const pairs = new Map<string, { upstream: string; downstream: string; inReferences: boolean; inReferencedBy: boolean }>();
	const pair = (upstream: string, downstream: string) => {
		const key = legacyPairKey({ upstream, downstream });
		let existing = pairs.get(key);
		if (!existing) {
			existing = { upstream, downstream, inReferences: false, inReferencedBy: false };
			pairs.set(key, existing);
		}
		return existing;
	};
	const malformed: IBaseHalfLegacyMalformedKey[] = [];
	for (const entry of entries) {
		for (const downstream of entry.references ?? []) {
			pair(entry.relativePath, downstream).inReferences = true;
		}
		for (const upstream of entry.referencedBy ?? []) {
			pair(upstream, entry.relativePath).inReferencedBy = true;
		}
		for (const key of entry.malformed) {
			malformed.push({ badge: entry.relativePath, key });
		}
	}
	return {
		pairs: [...pairs.values()].sort((left, right) => compareStrings(left.downstream, right.downstream) || compareStrings(left.upstream, right.upstream)),
		malformed: malformed.sort((left, right) => compareStrings(left.badge, right.badge) || compareStrings(left.key, right.key))
	};
}

/** The drop reasons that follow from a pair's paths alone. */
export function baseHalfLegacyPairDropReason(pair: IBaseHalfLegacyPair): BaseHalfLegacyDropReason | undefined {
	if (isRootOrMetadata(pair.upstream) || isRootOrMetadata(pair.downstream)) {
		return 'rootOrMetadata';
	}
	if (pair.upstream === pair.downstream) {
		return 'self';
	}
	if (!baseHalfLegacyBadgePathAccepted(pair.upstream, pair.downstream)
		|| !baseHalfLegacyBadgePathAccepted(pair.downstream, pair.upstream)
		|| baseHalfUpstreamEntryGrammarProblem(pair.upstream) !== undefined
		|| baseHalfUpstreamEntryGrammarProblem(pair.downstream) !== undefined) {
		return 'invalidPath';
	}
	if (!pair.inReferences || !pair.inReferencedBy) {
		return 'oneSided';
	}
	return undefined;
}

function isRootOrMetadata(path: string): boolean {
	return path === '' || path.split('/')[0].toLowerCase() === '.bh';
}

export function legacyPairKey(pair: Pick<IBaseHalfLegacyPair, 'upstream' | 'downstream'>): string {
	return `pair\0${pair.upstream}\0${pair.downstream}`;
}

function malformedKeyKey(key: IBaseHalfLegacyMalformedKey): string {
	return `key\0${key.badge}\0${key.key}`;
}

//#endregion

//#region Prompt and report

export interface IBaseHalfLegacyPromptCounts {
	/** Pairs that need a downstream write. */
	readonly connections: number;
	/** Markdown notes that receive entries in their frontmatter. */
	readonly notes: number;
	/** `.bhnode` documents that receive entries. */
	readonly nodeDocuments: number;
	/** `upstream.yaml` files in `.bh/` that receive entries. */
	readonly metadataItems: number;
}

/** The numbers of the migration prompt, over every folder. */
export function baseHalfLegacyPromptCounts(plans: readonly IBaseHalfLegacyFolderPlan[]): IBaseHalfLegacyPromptCounts {
	let connections = 0;
	const stores: Record<BaseHalfUpstreamStoreKind, Set<string>> = { markdown: new Set(), node: new Set(), sidecar: new Set() };
	for (const plan of plans) {
		for (const pair of plan.pairs) {
			if (pair.status.kind === 'write') {
				connections++;
				stores[pair.storeKind ?? 'markdown'].add(`${plan.workspaceFolder.toString()}\0${pair.downstream}`);
			}
		}
	}
	return { connections, notes: stores.markdown.size, nodeDocuments: stores.node.size, metadataItems: stores.sidecar.size };
}

export type BaseHalfLegacyReportSection = 'add' | 'present' | 'cannot';

/** One row of the read-only report: the pairs of one downstream node in one section. */
export interface IBaseHalfLegacyReportRow {
	readonly section: BaseHalfLegacyReportSection;
	readonly workspaceFolder: URI;
	/** The downstream node (for a malformed key, the badge's node). */
	readonly downstream: string;
	readonly upstreams: readonly string[];
	/** Why the pairs in a `cannot` row were not moved. */
	readonly reason?: BaseHalfLegacyDropReason | BaseHalfLegacyDeferReason;
	/** The malformed key of a `malformedKey` row. */
	readonly key?: BaseHalfBadgeLegacyKey;
	readonly message?: string;
}

/**
 * The report of a plan (Preview) or of a finished run (Show), grouped by
 * section, then by downstream node. Every pair is in exactly one row.
 */
export function baseHalfLegacyReportRows(folders: readonly (IBaseHalfLegacyFolderPlan | IBaseHalfLegacyFolderResult)[]): IBaseHalfLegacyReportRow[] {
	const rows = new Map<string, { section: BaseHalfLegacyReportSection; workspaceFolder: URI; downstream: string; upstreams: string[]; reason?: BaseHalfLegacyDropReason | BaseHalfLegacyDeferReason; key?: BaseHalfBadgeLegacyKey; message?: string }>();
	const add = (row: Omit<IBaseHalfLegacyReportRow, 'upstreams'>, upstream: string | undefined) => {
		const id = [row.section, row.workspaceFolder.toString(), row.downstream, row.reason ?? '', row.key ?? '', row.message ?? ''].join('\0');
		let existing = rows.get(id);
		if (!existing) {
			existing = { ...row, upstreams: [] };
			rows.set(id, existing);
		}
		if (upstream !== undefined) {
			existing.upstreams.push(upstream);
		}
	};
	for (const folder of folders) {
		for (const pair of folder.pairs) {
			const base = { workspaceFolder: folder.workspaceFolder, downstream: pair.downstream };
			if (isPlannedPair(pair)) {
				const status = pair.status;
				if (status.kind === 'write') {
					add({ ...base, section: 'add' }, pair.upstream);
				} else if (status.kind === 'present') {
					add({ ...base, section: 'present' }, pair.upstream);
				} else {
					add({ ...base, section: 'cannot', reason: status.reason }, pair.upstream);
				}
			} else if (pair.outcome === 'migrated') {
				add({ ...base, section: pair.reason === 'alreadyPresent' ? 'present' : 'add' }, pair.upstream);
			} else {
				const reason = pair.reason === 'alreadyPresent' || pair.reason === undefined ? 'failed' : pair.reason;
				add({ ...base, section: 'cannot', reason, ...(pair.message ? { message: pair.message } : {}) }, pair.upstream);
			}
		}
		for (const key of folder.malformed) {
			add({ section: 'cannot', workspaceFolder: folder.workspaceFolder, downstream: key.badge, reason: 'malformedKey', key: key.key }, undefined);
		}
	}
	const order: Record<BaseHalfLegacyReportSection, number> = { add: 0, present: 1, cannot: 2 };
	return [...rows.values()].sort((left, right) => order[left.section] - order[right.section]
		|| compareStrings(left.workspaceFolder.toString(), right.workspaceFolder.toString())
		|| compareStrings(left.downstream, right.downstream)
		|| compareStrings(left.reason ?? '', right.reason ?? ''));
}

function isPlannedPair(pair: IBaseHalfLegacyPlannedPair | IBaseHalfLegacyPairOutcome): pair is IBaseHalfLegacyPlannedPair {
	return (pair as IBaseHalfLegacyPlannedPair).status !== undefined;
}

/** A short, user-facing explanation of why a pair can't be moved. */
export function baseHalfLegacyReasonLabel(reason: BaseHalfLegacyDropReason | BaseHalfLegacyDeferReason): string {
	switch (reason) {
		case 'oneSided': return localize('basehalf.migration.reason.oneSided', "Only one side was recorded");
		case 'self': return localize('basehalf.migration.reason.self', "It points to itself");
		case 'rootOrMetadata': return localize('basehalf.migration.reason.rootOrMetadata', "It points to the workspace folder or into BaseHalf's own files");
		case 'invalidPath': return localize('basehalf.migration.reason.invalidPath', "The recorded path isn't valid");
		case 'otherWorkspaceFolder': return localize('basehalf.migration.reason.otherWorkspaceFolder', "It points into another workspace folder");
		case 'symbolicLink': return localize('basehalf.migration.reason.symbolicLink', "It is a symbolic link or inside one");
		case 'cannotBeDownstream': return localize('basehalf.migration.reason.cannotBeDownstream', "This file can't receive upstream context");
		case 'malformedKey': return localize('basehalf.migration.reason.malformedKey', "The earlier connection list can't be read");
		case 'running': return localize('basehalf.migration.reason.running', "The node is running");
		case 'unsaved': return localize('basehalf.migration.reason.unsaved', "It has unsaved changes and auto-save is off");
		case 'conflict': return localize('basehalf.migration.reason.conflict', "It has a save conflict");
		case 'readonly': return localize('basehalf.migration.reason.readonly', "It is read-only");
		case 'unreadable': return localize('basehalf.migration.reason.unreadable', "Its upstream list can't be read");
		case 'foreign': return localize('basehalf.migration.reason.foreign', "Another tool keeps something else where its upstream list goes");
		case 'notWritable': return localize('basehalf.migration.reason.notWritable', "BaseHalf can't save connections into it because of how the file begins");
		case 'saveFailed': return localize('basehalf.migration.reason.saveFailed', "The change could not be saved");
		case 'missingDownstream': return localize('basehalf.migration.reason.missingDownstream', "The file no longer exists");
		case 'recipeFrozen': return localize('basehalf.migration.reason.recipeFrozen', "The node already has an attempt or a result");
		case 'limit': return localize('basehalf.migration.reason.limit', "The node already has 64 upstream entries");
		case 'beingMoved': return localize('basehalf.migration.reason.beingMoved', "It was being moved");
		case 'indexLoading': return localize('basehalf.migration.reason.indexLoading', "Connections were still loading");
		// The recorded error text names files and system error codes; it stays in the record.
		case 'failed': return localize('basehalf.migration.reason.failed', "It could not be written");
	}
}

//#endregion

//#region Record file

/** One entry of `.bh/legacy-references.yaml`. */
export interface IBaseHalfLegacyRecord {
	/** A pair record. */
	readonly upstream?: string;
	readonly downstream?: string;
	/** A malformed-key record. */
	readonly badge?: string;
	readonly key?: BaseHalfBadgeLegacyKey;
	readonly outcome: BaseHalfLegacyOutcome;
	readonly reason?: string;
	/** `YYYY-MM-DD`. */
	readonly date: string;
}

const RECORD_HEADER = [
	'# Connections from an earlier BaseHalf version, moved into upstream lists.',
	'# BaseHalf only appends to this file. Legacy badge keys are removed after',
	'# their pair is recorded here.'
];
const RECORD_OUTCOMES = new Set<string>(['migrated', 'deferred', 'dropped']);

/** The identity of the pair or malformed key a record is about. */
export function baseHalfLegacyRecordSubject(record: IBaseHalfLegacyRecord): string | undefined {
	if (record.upstream !== undefined && record.downstream !== undefined) {
		return legacyPairKey({ upstream: record.upstream, downstream: record.downstream });
	}
	if (record.badge !== undefined && record.key !== undefined) {
		return malformedKeyKey({ badge: record.badge, key: record.key });
	}
	return undefined;
}

/**
 * Parses the record file tolerantly: each `- ` item at column 0 starts a
 * record, its `key: value` lines follow indented; string values are JSON
 * quoted. Lines that do not fit are ignored, and so are incomplete records.
 */
export function parseBaseHalfLegacyRecords(text: string): IBaseHalfLegacyRecord[] {
	const records: IBaseHalfLegacyRecord[] = [];
	let current: Record<string, string> | undefined;
	const finish = () => {
		const record = current && toRecord(current);
		if (record) {
			records.push(record);
		}
		current = undefined;
	};
	for (const rawLine of text.replace(/^﻿/, '').split(/\r\n|\n|\r/)) {
		if (/^\s*(?:#.*)?$/.test(rawLine)) {
			continue;
		}
		let line = rawLine;
		if (/^- /.test(line)) {
			finish();
			current = {};
			line = line.slice(2);
		} else if (/^[ \t]+\S/.test(line) && current) {
			line = line.trim();
		} else {
			finish();
			continue;
		}
		const match = /^(?<name>[a-z]+):[ \t]*(?<value>.*)$/.exec(line.trim());
		if (!match?.groups) {
			continue;
		}
		const value = parseRecordValue(match.groups.value);
		if (value !== undefined) {
			current![match.groups.name] = value;
		}
	}
	finish();
	return records;
}

function parseRecordValue(raw: string): string | undefined {
	const value = raw.trim();
	if (value.startsWith('"')) {
		try {
			const parsed: unknown = JSON.parse(value);
			return typeof parsed === 'string' ? parsed : undefined;
		} catch {
			return undefined;
		}
	}
	return value;
}

function toRecord(fields: Record<string, string>): IBaseHalfLegacyRecord | undefined {
	if (!RECORD_OUTCOMES.has(fields.outcome ?? '') || typeof fields.date !== 'string') {
		return undefined;
	}
	const record: IBaseHalfLegacyRecord = {
		...(fields.upstream !== undefined ? { upstream: fields.upstream } : {}),
		...(fields.downstream !== undefined ? { downstream: fields.downstream } : {}),
		...(fields.badge !== undefined ? { badge: fields.badge } : {}),
		...(fields.key === 'references' || fields.key === 'referenced_by' ? { key: fields.key } : {}),
		outcome: fields.outcome as BaseHalfLegacyOutcome,
		...(fields.reason !== undefined ? { reason: fields.reason } : {}),
		date: fields.date
	};
	return baseHalfLegacyRecordSubject(record) === undefined ? undefined : record;
}

/** The text of one record, in the file's line ending. */
function serializeRecord(record: IBaseHalfLegacyRecord, eol: string): string {
	const lines: string[] = [];
	if (record.upstream !== undefined && record.downstream !== undefined) {
		lines.push(`upstream: ${JSON.stringify(record.upstream)}`, `downstream: ${JSON.stringify(record.downstream)}`);
	} else {
		lines.push(`badge: ${JSON.stringify(record.badge ?? '')}`, `key: ${record.key}`);
	}
	lines.push(`outcome: ${record.outcome}`);
	if (record.reason) {
		lines.push(`reason: ${record.reason}`);
	}
	lines.push(`date: ${JSON.stringify(record.date)}`);
	return lines.map((line, index) => `${index === 0 ? '- ' : '  '}${line}${eol}`).join('');
}

/**
 * Appends records to the current text of the record file (`undefined` when
 * it does not exist). Existing bytes are never changed: the new records
 * follow them, after a line break when the text does not end with one.
 */
export function appendBaseHalfLegacyRecords(current: string | undefined, records: readonly IBaseHalfLegacyRecord[]): string {
	const eol = current && /\r\n/.test(current) ? '\r\n' : '\n';
	let text = current ?? RECORD_HEADER.map(line => `${line}${eol}`).join('');
	if (text.length > 0 && !/(?:\r\n|\n|\r)$/.test(text)) {
		text += eol;
	}
	for (const record of records) {
		text += serializeRecord(record, eol);
	}
	return text;
}

/** The latest record of every pair and malformed key, in file order. */
export function baseHalfLatestLegacyRecords(records: readonly IBaseHalfLegacyRecord[]): Map<string, IBaseHalfLegacyRecord> {
	const latest = new Map<string, IBaseHalfLegacyRecord>();
	for (const record of records) {
		const subject = baseHalfLegacyRecordSubject(record);
		if (subject !== undefined) {
			latest.set(subject, record);
		}
	}
	return latest;
}

//#endregion

//#region Service

export const IBaseHalfReferenceMigrationService = createDecorator<IBaseHalfReferenceMigrationService>('baseHalfReferenceMigrationService');

export interface IBaseHalfReferenceMigrationService {
	readonly _serviceBrand: undefined;

	/**
	 * Detection for one workspace folder. It skips folders marked with the
	 * source-tree marker and waits until the folder's index is ready. It
	 * first removes the legacy keys of pairs recorded by an earlier detection
	 * (a Dropped record whose pair is still unrepresentable, or a Migrated
	 * record whose downstream store on disk still lists the upstream), then
	 * plans the remaining pairs. When no pair
	 * needs a downstream write it settles the rest without a prompt, which
	 * writes only `.bh/`. Returns `undefined` when the folder has no legacy
	 * keys or was skipped.
	 */
	detect(workspaceFolder: URI): Promise<IBaseHalfLegacyFolderPlan | undefined>;

	/**
	 * Re-scans one folder and plans its pairs, including the reference edit
	 * service's preflight of every downstream that needs a write: a store it
	 * would refuse is Deferred before the user confirms. Writes nothing.
	 */
	plan(workspaceFolder: URI): Promise<IBaseHalfLegacyFolderPlan | undefined>;

	/**
	 * **Move Connections**: re-scans every given folder, writes the pairs that
	 * need it into their downstream stores through the reference edit service
	 * as one operation per folder (one `append` per store, every Markdown edit
	 * in one bulk edit, no canvas undo source), re-reads every written store
	 * from disk to decide Migrated or Deferred, and appends every processed
	 * pair to the record. Legacy keys are never removed here. Runs one at a
	 * time.
	 */
	migrate(workspaceFolders: readonly URI[], onProgress?: (completed: number, total: number) => void): Promise<IBaseHalfLegacyMigrationResult>;
}

interface IDownstreamInfo {
	readonly exists: boolean;
	readonly node?: IBaseHalfWorkspaceResource;
	readonly upstreamOnly?: boolean;
	readonly view?: IBaseHalfUpstreamView;
	/** A `.bhnode` with a recipe and an Attempt or Result. */
	readonly frozen?: boolean;
}

interface IPendingRecord {
	readonly subject: string;
	readonly record: Omit<IBaseHalfLegacyRecord, 'date'>;
}

const EDIT_LABEL = localize('basehalf.migration.editLabel', "Move Earlier Connection");
const RECORD_TEMP_POSTFIX = '.basehalf-tmp';
const utf8Decoder = new TextDecoder('utf-8', { ignoreBOM: true });

export class BaseHalfReferenceMigrationService implements IBaseHalfReferenceMigrationService {
	declare readonly _serviceBrand: undefined;

	private readonly sequencer = new Sequencer();
	/** Subjects this session recorded, per folder: their keys stay until a later session. */
	private readonly recordedThisSession = new Set<string>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IBaseHalfBadgeMirrorService private readonly badgeMirrorService: IBaseHalfBadgeMirrorService,
		@IBaseHalfReferenceIndexService private readonly referenceIndexService: IBaseHalfReferenceIndexService,
		@IBaseHalfReferenceEditService private readonly referenceEditService: IBaseHalfReferenceEditService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@ILogService private readonly logService: ILogService
	) { }

	detect(workspaceFolder: URI): Promise<IBaseHalfLegacyFolderPlan | undefined> {
		return this.sequencer.queue(() => this.doDetect(workspaceFolder));
	}

	plan(workspaceFolder: URI): Promise<IBaseHalfLegacyFolderPlan | undefined> {
		return this.sequencer.queue(async () => await this.prepareFolder(workspaceFolder) ? this.doPlan(workspaceFolder) : undefined);
	}

	migrate(workspaceFolders: readonly URI[], onProgress?: (completed: number, total: number) => void): Promise<IBaseHalfLegacyMigrationResult> {
		return this.sequencer.queue(() => this.doMigrate(workspaceFolders, onProgress));
	}

	//#region Detection

	private async doDetect(workspaceFolder: URI): Promise<IBaseHalfLegacyFolderPlan | undefined> {
		if (!await this.prepareFolder(workspaceFolder)) {
			return undefined;
		}
		const records = await this.readRecords(workspaceFolder);
		if (records && records.length > 0) {
			await this.removeRecordedKeys(workspaceFolder, records);
		}
		const plan = await this.doPlan(workspaceFolder);
		if (plan && !plan.pairs.some(pair => pair.status.kind === 'write')) {
			await this.settle(workspaceFolder, plan, records ?? []);
		}
		return plan;
	}

	/** Whether the folder is an unmarked workspace folder whose index finished its scan. */
	private async prepareFolder(workspaceFolder: URI): Promise<boolean> {
		if (!this.isWorkspaceFolder(workspaceFolder)) {
			return false;
		}
		if (await baseHalfIsWorkspaceFolderMarked(this.fileService, workspaceFolder)) {
			this.logService.info(`[BaseHalf] skipped the connection migration of ${workspaceFolder.toString()}: the folder is marked with .basehalf-no-workspace-setup`);
			return false;
		}
		await this.referenceIndexService.whenReady(workspaceFolder);
		return this.isWorkspaceFolder(workspaceFolder);
	}

	/**
	 * Removes the legacy keys of every pair whose latest record was written by
	 * an earlier detection: a Dropped record whose pair is still permanently
	 * unrepresentable, or a Migrated record whose downstream store on disk
	 * still lists the upstream. Deferred pairs keep their keys, and so does a
	 * migrated pair whose entry was removed since, and a dropped pair that
	 * could now be represented (for example one an earlier build dropped for
	 * a reason that is no longer permanent).
	 */
	private async removeRecordedKeys(workspaceFolder: URI, records: readonly IBaseHalfLegacyRecord[]): Promise<void> {
		const latest = baseHalfLatestLegacyRecords(records);
		const legacy = await this.badgeMirrorService.listLegacyReferences(workspaceFolder);
		const { pairs, malformed } = baseHalfDeriveLegacyPairs(legacy.entries);
		const identity = this.identity(workspaceFolder);
		const removals = new Map<string, { references: string[]; referencedBy: string[]; malformed: boolean }>();
		const removal = (badge: string) => {
			let existing = removals.get(badge);
			if (!existing) {
				existing = { references: [], referencedBy: [], malformed: false };
				removals.set(badge, existing);
			}
			return existing;
		};
		const eligible = (subject: string) => !this.recordedThisSession.has(this.sessionKey(workspaceFolder, subject));
		const views = new Map<string, Promise<IBaseHalfUpstreamView | undefined>>();
		for (const pair of pairs) {
			const subject = legacyPairKey(pair);
			const record = latest.get(subject);
			if (!record || !eligible(subject)) {
				continue;
			}
			const remove = record.outcome === 'dropped'
				? this.permanentDropReason(workspaceFolder, pair, identity) !== undefined
				: record.outcome === 'migrated' && await this.downstreamLists(workspaceFolder, pair, identity, views);
			if (!remove) {
				continue;
			}
			if (pair.inReferences) {
				removal(pair.upstream).references.push(pair.downstream);
			}
			if (pair.inReferencedBy) {
				removal(pair.downstream).referencedBy.push(pair.upstream);
			}
		}
		const malformedByBadge = new Map<string, IBaseHalfLegacyMalformedKey[]>();
		for (const key of malformed) {
			malformedByBadge.set(key.badge, [...(malformedByBadge.get(key.badge) ?? []), key]);
		}
		for (const [badge, keys] of malformedByBadge) {
			// The badge mirror removes every malformed key of a badge at once, so
			// only when each of them has an eligible Dropped record.
			if (keys.every(key => latest.get(malformedKeyKey(key))?.outcome === 'dropped' && eligible(malformedKeyKey(key)))) {
				removal(badge).malformed = true;
			}
		}
		if (removals.size === 0) {
			return;
		}
		await this.workspaceMutationCoordinator.runExclusive(workspaceFolder, async () => {
			if (await baseHalfIsWorkspaceFolderMarked(this.fileService, workspaceFolder)) {
				return;
			}
			const kinds = new Map(legacy.entries.map(entry => [entry.relativePath, entry.kind ?? 'file'] as const));
			for (const [badge, items] of removals) {
				try {
					await this.badgeMirrorService.removeLegacyReferences(
						{ ...this.node(workspaceFolder, badge), kind: kinds.get(badge) ?? 'file' },
						{
							...(items.references.length ? { references: items.references } : {}),
							...(items.referencedBy.length ? { referencedBy: items.referencedBy } : {}),
							...(items.malformed ? { malformed: true } : {})
						}
					);
				} catch (error) {
					this.logService.warn(`[BaseHalf] could not remove earlier connection keys from the badge of ${badge}`, error);
				}
			}
		});
	}

	/** Records the already-present and dropped pairs of a plan that needs no write. */
	private async settle(workspaceFolder: URI, plan: IBaseHalfLegacyFolderPlan, records: readonly IBaseHalfLegacyRecord[]): Promise<void> {
		const pending: IPendingRecord[] = [];
		for (const pair of plan.pairs) {
			if (pair.status.kind === 'present') {
				pending.push(pairRecord(pair, 'migrated', 'alreadyPresent'));
			} else if (pair.status.kind === 'dropped') {
				pending.push(pairRecord(pair, 'dropped', pair.status.reason));
			}
		}
		for (const key of plan.malformed) {
			pending.push(keyRecord(key));
		}
		await this.appendRecords(workspaceFolder, pending, records);
	}

	//#endregion

	//#region Planning

	private async doPlan(workspaceFolder: URI): Promise<IBaseHalfLegacyFolderPlan | undefined> {
		const legacy = await this.badgeMirrorService.listLegacyReferences(workspaceFolder);
		for (const problem of legacy.problems) {
			this.logService.warn(`[BaseHalf] could not read the earlier connections in ${problem.resource.toString()}: ${problem.message}`);
		}
		const { pairs, malformed } = baseHalfDeriveLegacyPairs(legacy.entries);
		if (pairs.length === 0 && malformed.length === 0) {
			return undefined;
		}
		const identity = this.identity(workspaceFolder);
		const downstreams = new Map<string, Promise<IDownstreamInfo>>();
		const planned: IBaseHalfLegacyPlannedPair[] = [];
		for (const pair of pairs) {
			planned.push(await this.classify(workspaceFolder, pair, identity, downstreams));
		}
		return { workspaceFolder, pairs: await this.preflight(workspaceFolder, planned), malformed };
	}

	/**
	 * Runs the edit service's preflight for every downstream that needs a
	 * write, with all of its pairs in one operation, the way Move Connections
	 * writes them. A store that would be refused (a running node, unsaved text
	 * with auto-save off, a conflict, a read-only file, a symbolic link, …) is
	 * excluded before the user confirms: its pairs are Deferred, so Preview
	 * and the prompt counts match the files the migration writes.
	 */
	private async preflight(workspaceFolder: URI, planned: readonly IBaseHalfLegacyPlannedPair[]): Promise<IBaseHalfLegacyPlannedPair[]> {
		const blocked = new Map<string, BaseHalfLegacyDeferReason>();
		for (const [downstream, upstreams] of writeGroups(planned)) {
			try {
				const blocking = await this.referenceEditService.check([{ node: this.node(workspaceFolder, downstream), operation: { kind: 'append', entries: upstreams } }]);
				if (blocking.length > 0) {
					blocked.set(downstream, refusalDeferral(blocking[0].reason));
				}
			} catch (error) {
				this.logService.warn(`[BaseHalf] could not check the upstream list of ${downstream}`, error);
				blocked.set(downstream, 'failed');
			}
		}
		return planned.map(pair => {
			const reason = pair.status.kind === 'write' ? blocked.get(pair.downstream) : undefined;
			return reason ? { ...pair, status: { kind: 'deferred', reason } } : pair;
		});
	}

	/**
	 * Why a pair is still permanently unrepresentable, re-derived from its
	 * paths and the current workspace. Only these reasons let a Dropped
	 * record remove its legacy keys.
	 */
	private permanentDropReason(workspaceFolder: URI, pair: IBaseHalfLegacyPair, identity: IBaseHalfUpstreamIdentity): BaseHalfLegacyDropReason | undefined {
		const drop = baseHalfLegacyPairDropReason(pair);
		if (drop) {
			return drop;
		}
		if (baseHalfUpstreamEntryProblem(pair.upstream, pair.downstream, identity) === 'self') {
			return 'self';
		}
		if (isBaseHalfUpstreamReservedOutput(pair.downstream) || this.referenceIndexService.getUpstreamOnlyReason(this.node(workspaceFolder, pair.downstream))) {
			return 'cannotBeDownstream';
		}
		return undefined;
	}

	private async classify(workspaceFolder: URI, pair: IBaseHalfLegacyPair, identity: IBaseHalfUpstreamIdentity, downstreams: Map<string, Promise<IDownstreamInfo>>): Promise<IBaseHalfLegacyPlannedPair> {
		const dropped = (reason: BaseHalfLegacyDropReason): IBaseHalfLegacyPlannedPair => ({ ...pair, status: { kind: 'dropped', reason } });
		const deferred = (reason: BaseHalfLegacyDeferReason, storeKind?: BaseHalfUpstreamStoreKind): IBaseHalfLegacyPlannedPair => ({ ...pair, status: { kind: 'deferred', reason }, ...(storeKind ? { storeKind } : {}) });
		const drop = baseHalfLegacyPairDropReason(pair);
		if (drop) {
			return dropped(drop);
		}
		// A case-only or Unicode-form difference still names the node itself.
		if (baseHalfUpstreamEntryProblem(pair.upstream, pair.downstream, identity) === 'self') {
			return dropped('self');
		}
		// Not dropped: the nested folder reads its own mirror, so this folder
		// keeps the keys, and opening it alone migrates the pair.
		if (!this.ownedBy(workspaceFolder, pair.upstream) || !this.ownedBy(workspaceFolder, pair.downstream)) {
			return deferred('otherWorkspaceFolder');
		}
		if (isBaseHalfUpstreamReservedOutput(pair.downstream)) {
			return dropped('cannotBeDownstream');
		}
		let info = downstreams.get(pair.downstream);
		if (!info) {
			info = this.downstreamInfo(workspaceFolder, pair.downstream);
			downstreams.set(pair.downstream, info);
		}
		const downstream = await info;
		if (!downstream.exists) {
			return deferred('missingDownstream');
		}
		if (downstream.upstreamOnly) {
			return dropped('cannotBeDownstream');
		}
		const view = downstream.view;
		const storeKind = view?.storeKind;
		if (!view || view.readError !== undefined) {
			return deferred('unreadable', storeKind);
		}
		if (!view.readable) {
			return deferred(view.problem === 'foreignValue' ? 'foreign' : 'unreadable', storeKind);
		}
		if (listsEntry(view, pair.upstream, identity)) {
			return { ...pair, status: { kind: 'present' }, ...(storeKind ? { storeKind } : {}) };
		}
		if (!view.writable) {
			return deferred('notWritable', storeKind);
		}
		if (downstream.frozen) {
			return deferred('recipeFrozen', storeKind);
		}
		return { ...pair, status: { kind: 'write' }, ...(storeKind ? { storeKind } : {}) };
	}

	private async downstreamInfo(workspaceFolder: URI, path: string): Promise<IDownstreamInfo> {
		const node = this.node(workspaceFolder, path);
		try {
			await this.fileService.stat(node.resource);
		} catch {
			return { exists: false };
		}
		if (this.referenceIndexService.getUpstreamOnlyReason(node)) {
			return { exists: true, node, upstreamOnly: true };
		}
		let view: IBaseHalfUpstreamView;
		try {
			view = await this.referenceIndexService.readUpstream(node);
		} catch (error) {
			this.logService.warn(`[BaseHalf] could not read the upstream list of ${node.resource.toString()}`, error);
			return { exists: true, node };
		}
		let frozen = false;
		if (view.storeKind === 'node' && view.readable) {
			try {
				const bytes = await this.fileService.readFile(node.resource, { limits: { size: BASEHALF_NODE_DOCUMENT_MAX_BYTES } });
				const extract = extractBaseHalfNodeUpstreamLenient(utf8Decoder.decode(bytes.value.buffer));
				frozen = extract.readable && extract.hasRecipe && extract.lifecycle !== 'draft';
			} catch (error) {
				this.logService.warn(`[BaseHalf] could not read ${node.resource.toString()}`, error);
			}
		}
		return { exists: true, node, view, frozen };
	}

	/** Whether the downstream store on disk lists the pair's upstream. */
	private async downstreamLists(workspaceFolder: URI, pair: IBaseHalfLegacyPair, identity: IBaseHalfUpstreamIdentity, views: Map<string, Promise<IBaseHalfUpstreamView | undefined>>): Promise<boolean> {
		let view = views.get(pair.downstream);
		if (!view) {
			view = this.readDownstream(workspaceFolder, pair.downstream);
			views.set(pair.downstream, view);
		}
		const read = await view;
		return !!read && listsEntry(read, pair.upstream, identity);
	}

	/** The downstream's own store read from disk, or `undefined` when it is missing or unreadable. */
	private async readDownstream(workspaceFolder: URI, path: string): Promise<IBaseHalfUpstreamView | undefined> {
		const node = this.node(workspaceFolder, path);
		try {
			await this.fileService.stat(node.resource);
			const view = await this.referenceIndexService.readUpstream(node);
			return view.readError === undefined && view.readable ? view : undefined;
		} catch {
			return undefined;
		}
	}

	//#endregion

	//#region Migration

	private async doMigrate(workspaceFolders: readonly URI[], onProgress: ((completed: number, total: number) => void) | undefined): Promise<IBaseHalfLegacyMigrationResult> {
		const plans: IBaseHalfLegacyFolderPlan[] = [];
		for (const workspaceFolder of workspaceFolders) {
			if (!await this.prepareFolder(workspaceFolder)) {
				continue;
			}
			// Move Connections re-scans before writing.
			const plan = await this.doPlan(workspaceFolder);
			if (plan) {
				plans.push(plan);
			}
		}
		const total = plans.reduce((sum, plan) => sum + plan.pairs.filter(pair => pair.status.kind === 'write').length, 0);
		let completed = 0;
		onProgress?.(completed, total);
		const folders: IBaseHalfLegacyFolderResult[] = [];
		for (const plan of plans) {
			folders.push(await this.migrateFolder(plan, () => onProgress?.(++completed, total)));
		}
		let moved = 0;
		let notMoved = 0;
		let files = 0;
		for (const folder of folders) {
			moved += folder.pairs.filter(pair => pair.outcome === 'migrated' && pair.reason !== 'alreadyPresent').length;
			notMoved += folder.pairs.filter(pair => pair.outcome !== 'migrated').length + folder.malformed.length;
			files += folder.changedStores.length;
		}
		return { folders, moved, files, notMoved };
	}

	/**
	 * Writes every downstream that needs it in one reference operation: one
	 * `append` per store, every Markdown edit in one bulk edit, then node
	 * documents and sidecars. A store the preflight refuses (for example one
	 * that started running since the plan) is excluded and its pairs are
	 * Deferred; the others are written.
	 */
	private async migrateFolder(plan: IBaseHalfLegacyFolderPlan, onPairDone: () => void): Promise<IBaseHalfLegacyFolderResult> {
		const workspaceFolder = plan.workspaceFolder;
		const identity = this.identity(workspaceFolder);
		const failures = new Map<string, { readonly reason: BaseHalfLegacyDeferReason; readonly message?: string }>();
		const changedStores = new Map<string, URI>();
		const groups = writeGroups(plan.pairs);
		const written = new Set(groups.keys());
		const collectChanged = (stores: readonly { readonly outcome: string; readonly storeResource: URI }[]) => {
			for (const store of stores) {
				if (store.outcome === 'changed') {
					changedStores.set(store.storeResource.toString(), store.storeResource);
				}
			}
		};
		let toWrite = [...groups].map(([downstream, upstreams]) => ({ downstream, node: this.node(workspaceFolder, downstream), upstreams }));
		while (toWrite.length > 0) {
			try {
				// Migration writes carry no canvas undo source: nothing is pushed.
				const result = await this.referenceEditService.apply(toWrite.map(group => ({ node: group.node, operation: { kind: 'append', entries: group.upstreams } })), { label: EDIT_LABEL });
				collectChanged(result.stores);
				break;
			} catch (error) {
				this.logService.warn(`[BaseHalf] could not move every earlier connection in ${workspaceFolder.toString()}`, error);
				if (error instanceof BaseHalfReferenceEditRefusal) {
					const blocked = new Map(error.blocking.map(store => [store.node.relativePath, store] as const));
					const remaining = toWrite.filter(group => !blocked.has(group.downstream));
					for (const group of toWrite) {
						const store = blocked.get(group.downstream);
						if (store) {
							const reason = refusalDeferral(store.reason);
							failures.set(group.downstream, reason === 'failed' ? { reason, message: store.message } : { reason });
						}
					}
					if (remaining.length < toWrite.length) {
						toWrite = remaining;
						continue;
					}
				} else if (error instanceof BaseHalfReferenceEditFailure) {
					collectChanged(error.result.stores);
				}
				for (const group of toWrite) {
					if (!failures.has(group.downstream)) {
						failures.set(group.downstream, deferral(error));
					}
				}
				break;
			}
		}
		for (const upstreams of groups.values()) {
			for (let index = 0; index < upstreams.length; index++) {
				onPairDone();
			}
		}

		// A pair is Migrated when its downstream store, re-read from disk after
		// the write, lists the upstream entry.
		const listed = new Map<string, IBaseHalfUpstreamView | undefined>();
		for (const downstream of written) {
			listed.set(downstream, await this.readDownstream(workspaceFolder, downstream));
		}
		const pairs: IBaseHalfLegacyPairOutcome[] = plan.pairs.map(pair => {
			const base = { upstream: pair.upstream, downstream: pair.downstream, inReferences: pair.inReferences, inReferencedBy: pair.inReferencedBy, ...(pair.storeKind ? { storeKind: pair.storeKind } : {}) };
			switch (pair.status.kind) {
				case 'write': {
					const view = listed.get(pair.downstream);
					if (view && listsEntry(view, pair.upstream, identity)) {
						return { ...base, outcome: 'migrated' };
					}
					const failure = failures.get(pair.downstream) ?? { reason: 'saveFailed' as const };
					return { ...base, outcome: 'deferred', reason: failure.reason, ...(failure.message ? { message: failure.message } : {}) };
				}
				case 'present':
					return { ...base, outcome: 'migrated', reason: 'alreadyPresent' };
				case 'dropped':
					return { ...base, outcome: 'dropped', reason: pair.status.reason };
				case 'deferred':
					return { ...base, outcome: 'deferred', reason: pair.status.reason };
			}
		});

		const pending: IPendingRecord[] = [
			...pairs.map(pair => pairRecord(pair, pair.outcome, pair.reason)),
			...plan.malformed.map(keyRecord)
		];
		const recorded = await this.appendRecords(workspaceFolder, pending, await this.readRecords(workspaceFolder) ?? []);
		return { workspaceFolder, pairs, malformed: plan.malformed, changedStores: [...changedStores.values()], recorded };
	}

	//#endregion

	//#region Record file

	/** The records on disk; `undefined` when the file does not exist or can't be read. */
	private async readRecords(workspaceFolder: URI): Promise<IBaseHalfLegacyRecord[] | undefined> {
		const text = await this.readRecordText(workspaceFolder).catch(error => {
			this.logService.warn(`[BaseHalf] could not read ${baseHalfLegacyReferencesRecordResource(workspaceFolder).toString()}`, error);
			return undefined;
		});
		return text === undefined ? undefined : parseBaseHalfLegacyRecords(text);
	}

	private async readRecordText(workspaceFolder: URI): Promise<string | undefined> {
		const bytes = await this.readRecordBytes(workspaceFolder);
		return bytes === null ? undefined : utf8Decoder.decode(bytes.buffer);
	}

	private async readRecordBytes(workspaceFolder: URI): Promise<VSBuffer | null> {
		const resource = baseHalfLegacyReferencesRecordResource(workspaceFolder);
		await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		try {
			return (await this.fileService.readFile(resource, { atomic: true })).value;
		} catch (error) {
			if (toFileOperationResult(error as Error) === FileOperationResult.FILE_NOT_FOUND) {
				return null;
			}
			throw error;
		}
	}

	/**
	 * Appends the records whose subject's latest record differs, then re-reads
	 * the file and checks every appended record is there. Returns whether the
	 * record on disk now holds every pending record.
	 */
	private async appendRecords(workspaceFolder: URI, pending: readonly IPendingRecord[], existing: readonly IBaseHalfLegacyRecord[]): Promise<boolean> {
		const latest = baseHalfLatestLegacyRecords(existing);
		const date = new Date().toISOString().slice(0, 10);
		// A subject whose latest record already has this outcome is not recorded
		// again (for a deferred pair: this outcome and reason), so repeated
		// detections do not grow the file.
		const records = pending
			.filter(entry => {
				const previous = latest.get(entry.subject);
				return !previous
					|| previous.outcome !== entry.record.outcome
					|| (entry.record.outcome === 'deferred' && (previous.reason ?? '') !== (entry.record.reason ?? ''));
			})
			.map(entry => ({ subject: entry.subject, record: { ...entry.record, date } }));
		if (records.length === 0) {
			return true;
		}
		// The keys of a pair are removed only by a later detection than the one
		// that recorded it, at the next open or later.
		for (const { subject } of records) {
			this.recordedThisSession.add(this.sessionKey(workspaceFolder, subject));
		}
		try {
			return await this.workspaceMutationCoordinator.runExclusive(workspaceFolder, async () => {
				if (await baseHalfIsWorkspaceFolderMarked(this.fileService, workspaceFolder)) {
					return false;
				}
				const resource = baseHalfLegacyReferencesRecordResource(workspaceFolder);
				const current = await this.readRecordBytes(workspaceFolder);
				const next = appendBaseHalfLegacyRecords(current === null ? undefined : utf8Decoder.decode(current.buffer), records.map(({ record }) => record));
				await this.fileService.createFolder(URI.joinPath(workspaceFolder, '.bh'));
				await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
				await this.fileService.writeFileWithExpectedContents(resource, VSBuffer.fromString(next), current, { atomic: { postfix: RECORD_TEMP_POSTFIX } });
				// Re-read before any later detection may rely on these records.
				const reread = parseBaseHalfLegacyRecords(await this.readRecordText(workspaceFolder) ?? '');
				const onDisk = new Set(reread.map(record => JSON.stringify(record)));
				return records.every(({ record }) => onDisk.has(JSON.stringify(parseBaseHalfLegacyRecords(appendBaseHalfLegacyRecords('', [record]))[0])));
			});
		} catch (error) {
			this.logService.error(`[BaseHalf] could not record earlier connections in ${baseHalfLegacyReferencesRecordResource(workspaceFolder).toString()}`, error);
			return false;
		}
	}

	//#endregion

	//#region Helpers

	private isWorkspaceFolder(workspaceFolder: URI): boolean {
		return this.contextService.getWorkspace().folders.some(folder => this.uriIdentityService.extUri.isEqual(folder.uri, workspaceFolder));
	}

	/** Whether the path belongs to this folder and not to a nested workspace folder. */
	private ownedBy(workspaceFolder: URI, path: string): boolean {
		const owner = this.contextService.getWorkspaceFolder(this.node(workspaceFolder, path).resource);
		return !owner || this.uriIdentityService.extUri.isEqual(owner.uri, workspaceFolder);
	}

	private node(workspaceFolder: URI, path: string): IBaseHalfWorkspaceResource {
		return { resource: URI.joinPath(workspaceFolder, ...path.split('/')), workspaceFolder, relativePath: path };
	}

	private identity(workspaceFolder: URI): IBaseHalfUpstreamIdentity {
		return baseHalfUpstreamIdentity(workspaceFolder, this.uriIdentityService.extUri);
	}

	private sessionKey(workspaceFolder: URI, subject: string): string {
		return `${this.uriIdentityService.extUri.getComparisonKey(workspaceFolder)}\0${subject}`;
	}

	//#endregion
}

/** The upstreams of every pair that needs a write, grouped by downstream, in plan order. */
function writeGroups(pairs: readonly IBaseHalfLegacyPlannedPair[]): Map<string, string[]> {
	const groups = new Map<string, string[]>();
	for (const pair of pairs) {
		if (pair.status.kind !== 'write') {
			continue;
		}
		let upstreams = groups.get(pair.downstream);
		if (!upstreams) {
			upstreams = [];
			groups.set(pair.downstream, upstreams);
		}
		upstreams.push(pair.upstream);
	}
	return groups;
}

function listsEntry(view: IBaseHalfUpstreamView, upstream: string, identity: IBaseHalfUpstreamIdentity): boolean {
	const key = identity.key(upstream);
	return view.entries.some(entry => entry.path !== undefined && identity.key(entry.path) === key);
}

function pairRecord(pair: IBaseHalfLegacyPair, outcome: BaseHalfLegacyOutcome, reason: string | undefined): IPendingRecord {
	return {
		subject: legacyPairKey(pair),
		record: { upstream: pair.upstream, downstream: pair.downstream, outcome, ...(reason ? { reason } : {}) }
	};
}

function keyRecord(key: IBaseHalfLegacyMalformedKey): IPendingRecord {
	return {
		subject: malformedKeyKey(key),
		record: { badge: key.badge, key: key.key, outcome: 'dropped', reason: 'malformedKey' }
	};
}

/** Why a refused or failed write is deferred. */
function deferral(error: unknown): { readonly reason: BaseHalfLegacyDeferReason; readonly message?: string } {
	if (error instanceof BaseHalfReferenceEditFailure) {
		return { reason: 'saveFailed' };
	}
	if (error instanceof BaseHalfReferenceEditRefusal) {
		const reason = refusalDeferral(error.reason);
		return reason === 'failed' ? { reason, message: error.message } : { reason };
	}
	return { reason: 'failed', message: error instanceof Error ? error.message : String(error) };
}

function refusalDeferral(reason: BaseHalfReferenceRefusalReason): BaseHalfLegacyDeferReason {
	switch (reason) {
		case 'running': return 'running';
		case 'unsaved': return 'unsaved';
		case 'conflict': return 'conflict';
		case 'readonly': return 'readonly';
		case 'unreadable': return 'unreadable';
		case 'foreign': return 'foreign';
		case 'notWritable':
		case 'frontmatterTooLarge':
		case 'upstreamOnly':
			return 'notWritable';
		case 'orphaned':
		case 'missingNode':
			return 'missingDownstream';
		case 'recipeFrozen': return 'recipeFrozen';
		case 'limit': return 'limit';
		case 'beingMoved': return 'beingMoved';
		case 'indexLoading': return 'indexLoading';
		case 'symbolicLink': return 'symbolicLink';
		case 'error': return 'saveFailed';
		default: return 'failed';
	}
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

registerSingleton(IBaseHalfReferenceMigrationService, BaseHalfReferenceMigrationService, InstantiationType.Delayed);

//#endregion
