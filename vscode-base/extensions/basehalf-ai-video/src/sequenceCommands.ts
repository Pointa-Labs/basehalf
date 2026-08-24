/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import * as vscode from 'vscode';
import {
	addAIVideoSequenceItem,
	inspectAIVideoSequence,
	isOrdinaryFilePathInside,
	isPlainLocalFileResource,
	moveAIVideoSequenceItem,
	parseAIVideoSequenceDocument,
	portableDescendantVideoNodePath,
	removeAIVideoSequenceItem,
	resolveAIVideoSequenceVideoResult,
	resolveAIVideoSequenceVideoNodePath,
	SEQUENCE_INSPECTION_CONCURRENCY,
	serializeAIVideoSequenceDocument,
	updateAIVideoSequenceItemPath,
	type AIVideoSequenceDocument,
	type AIVideoSequenceInspection,
	type AIVideoSequenceItem,
	type AIVideoSequenceItemInspection,
	type AIVideoSequenceNodeState,
	type AIVideoSequenceNodeRelocation
} from './domain';
import { readFileWithinLimit } from './boundedFileRead';
import { SequenceConcurrencyLimiter } from './sequenceConcurrency';

const MAX_SEQUENCE_NODE_RELOCATION_SCAN_RESULTS = 256;
const MAX_SEQUENCE_DOCUMENT_BYTES = 4 * 1024 * 1024;
const REPAIR_PATH_ACTION = 'Repair path';
const sequenceInspectionLimiter = new SequenceConcurrencyLimiter(SEQUENCE_INSPECTION_CONCURRENCY);

interface SequenceCommandArguments {
	readonly sequence?: vscode.Uri;
	readonly itemId?: string;
	readonly direction?: 'up' | 'down';
	readonly videoNode?: vscode.Uri;
	readonly title?: string;
}

export interface AIVideoSequenceEditCommandResult {
	readonly operation: 'added' | 'removed';
	readonly resource: vscode.Uri;
	readonly item: AIVideoSequenceItem;
	readonly document: AIVideoSequenceDocument;
	readonly inspection: AIVideoSequenceInspection;
}

export interface LoadedSequence {
	readonly resource: vscode.Uri;
	readonly source: string;
	readonly sequence: AIVideoSequenceDocument;
}

interface SequenceVideoCandidate {
	readonly resource: vscode.Uri;
	readonly videoNodePath: string;
	readonly nodeId: string;
	readonly suggestedTitle: string;
}

export async function inspectSequenceCommand(argument?: unknown, token?: vscode.CancellationToken): Promise<AIVideoSequenceInspection | undefined> {
	throwIfCommandCancelled(token);
	const args = commandArguments(argument);
	requireStructuredArguments(argument, args, ['sequence']);
	const resource = await resolveSequenceResource(args.sequence);
	if (!resource) {
		return undefined;
	}
	const loaded = await loadSequence(resource);
	const inspection = await inspectLoadedSequence(loaded, token);
	if (argument === undefined) {
		const selected = await showSequenceInspection(inspection);
		if (selected?.repairCandidatePath) {
			const choice = await vscode.window.showInformationMessage(
				`'${selected.item.title}' moved to '${selected.repairCandidatePath}'.`,
				REPAIR_PATH_ACTION
			);
			if (choice === REPAIR_PATH_ACTION) {
				const repaired = await repairSequenceItemPathCommand({ sequence: resource, itemId: selected.item.id });
				if (repaired) {
					void vscode.window.showInformationMessage(`Repaired the saved path for '${selected.item.title}'. Its sealed Video Result reference was kept.`);
				}
				return repaired;
			}
		}
	}
	return inspection;
}

export async function addSequenceItemFromVideoResultCommand(argument?: unknown, token?: vscode.CancellationToken): Promise<AIVideoSequenceEditCommandResult | undefined> {
	throwIfCommandCancelled(token);
	const args = commandArguments(argument);
	requireStructuredArguments(argument, args, ['sequence', 'videoNode', 'itemId']);
	return addSequenceItemFromVideoResult(args, argument === undefined, token);
}

export function addSequenceItemFromProjection(resource: vscode.Uri): Promise<AIVideoSequenceEditCommandResult | undefined> {
	return addSequenceItemFromVideoResult({ sequence: resource }, true);
}

async function addSequenceItemFromVideoResult(
	args: SequenceCommandArguments,
	interactive: boolean,
	token?: vscode.CancellationToken
): Promise<AIVideoSequenceEditCommandResult | undefined> {
	const resource = await resolveSequenceResource(args.sequence);
	if (!resource) {
		return undefined;
	}
	const workflowRoot = parentUri(resource);
	const selectedCandidate = args.videoNode
		? await loadVideoCandidate(workflowRoot, args.videoNode)
		: await pickVideoCandidate(workflowRoot);
	if (!selectedCandidate) {
		return undefined;
	}
	const title = args.title ?? (interactive
		? await promptForSequenceTitle(selectedCandidate.suggestedTitle)
		: selectedCandidate.suggestedTitle);
	if (title === undefined) {
		return undefined;
	}

	const loaded = await loadSequence(resource);
	const candidate = await loadVideoCandidate(workflowRoot, selectedCandidate.resource);
	const item = Object.freeze({
		id: args.itemId ?? uniqueSequenceItemId(loaded.sequence),
		title,
		nodeId: candidate.nodeId,
		videoNodePath: candidate.videoNodePath
	});
	const updated = addAIVideoSequenceItem(loaded.sequence, item);
	const saved = await saveSequence(loaded, updated, token);
	const inspection = await inspectLoadedSequence(saved);
	const addedItem = saved.sequence.items.find(candidate => candidate.id === item.id);
	if (!addedItem) {
		throw new Error(`Sequence item '${item.id}' was not saved.`);
	}
	if (interactive) {
		void vscode.window.showInformationMessage(`Added '${addedItem.title}' to the Video Sequence.`);
	}
	return Object.freeze({
		operation: 'added',
		resource,
		item: addedItem,
		document: saved.sequence,
		inspection
	});
}

export async function moveSequenceItemCommand(argument?: unknown, token?: vscode.CancellationToken): Promise<AIVideoSequenceDocument | undefined> {
	throwIfCommandCancelled(token);
	const args = commandArguments(argument);
	requireStructuredArguments(argument, args, ['sequence', 'itemId', 'direction']);
	const resource = await resolveSequenceResource(args.sequence);
	if (!resource) {
		return undefined;
	}
	const loaded = await loadSequence(resource);
	if (loaded.sequence.items.length < 2) {
		if (argument === undefined) {
			void vscode.window.showInformationMessage('Add at least two clips before changing playback order.');
		}
		return loaded.sequence;
	}
	const itemId = args.itemId ?? await pickSequenceItem(loaded.sequence, 'Choose a clip to move');
	if (!itemId) {
		return undefined;
	}
	const itemIndex = loaded.sequence.items.findIndex(item => item.id === itemId);
	if (itemIndex < 0) {
		throw new Error(`Sequence item '${itemId}' does not exist.`);
	}
	const direction = args.direction ?? await pickMoveDirection(itemIndex, loaded.sequence.items.length);
	if (!direction) {
		return undefined;
	}
	if ((direction === 'up' && itemIndex === 0) || (direction === 'down' && itemIndex === loaded.sequence.items.length - 1)) {
		return loaded.sequence;
	}
	const updated = moveAIVideoSequenceItem(loaded.sequence, itemId, direction);
	return (await saveSequence(loaded, updated, token)).sequence;
}

export async function removeSequenceItemCommand(argument?: unknown, token?: vscode.CancellationToken): Promise<AIVideoSequenceEditCommandResult | undefined> {
	throwIfCommandCancelled(token);
	const args = commandArguments(argument);
	requireStructuredArguments(argument, args, ['sequence', 'itemId']);
	const resource = await resolveSequenceResource(args.sequence);
	if (!resource) {
		return undefined;
	}
	const initial = await loadSequence(resource);
	if (initial.sequence.items.length === 0) {
		if (argument === undefined) {
			void vscode.window.showInformationMessage('Sequence has no clips to remove.');
		}
		return undefined;
	}
	const itemId = args.itemId ?? await pickSequenceItem(initial.sequence, 'Choose a clip to remove. Its Video node and results will be kept.');
	if (!itemId) {
		return undefined;
	}

	const loaded = await loadSequence(resource);
	const removedItem = loaded.sequence.items.find(item => item.id === itemId);
	if (!removedItem) {
		throw new Error(`Sequence item '${itemId}' no longer exists.`);
	}
	const updated = removeAIVideoSequenceItem(loaded.sequence, itemId);
	const saved = await saveSequence(loaded, updated, token);
	const inspection = await inspectLoadedSequence(saved);
	if (argument === undefined) {
		void vscode.window.showInformationMessage(`Removed '${removedItem.title}' from the Video Sequence. Its node and results were kept.`);
	}
	return Object.freeze({
		operation: 'removed',
		resource,
		item: removedItem,
		document: saved.sequence,
		inspection
	});
}

export async function repairSequenceItemPathCommand(argument?: unknown, token?: vscode.CancellationToken): Promise<AIVideoSequenceInspection | undefined> {
	throwIfCommandCancelled(token);
	const args = commandArguments(argument);
	requireStructuredArguments(argument, args, ['sequence', 'itemId']);
	const resource = await resolveSequenceResource(args.sequence);
	if (!resource) {
		return undefined;
	}
	const initial = await loadSequence(resource);
	const initialInspection = await inspectLoadedSequence(initial);
	const opportunities = initialInspection.items.filter(item => item.repairCandidatePath !== undefined);
	if (opportunities.length === 0) {
		if (argument === undefined) {
			void vscode.window.showInformationMessage('No Sequence item has a unique verified path repair available.');
		}
		return initialInspection;
	}
	const itemId = args.itemId ?? await pickSequenceInspection(opportunities, 'Choose a moved clip path to repair');
	if (!itemId) {
		return undefined;
	}

	// Re-read and re-verify the stable identity and sealed result immediately
	// before the compare-and-save edit. Discovery never edits Sequence by itself.
	const loaded = await loadSequence(resource);
	const inspection = await inspectLoadedSequence(loaded);
	const selected = inspection.items.find(item => item.item.id === itemId);
	if (!selected) {
		throw new Error(`Sequence item '${itemId}' no longer exists.`);
	}
	if (!selected.repairCandidatePath) {
		throw new Error(`Sequence item '${itemId}' no longer has a unique verified path repair.`);
	}
	const updated = updateAIVideoSequenceItemPath(loaded.sequence, itemId, selected.repairCandidatePath);
	const saved = await saveSequence(loaded, updated, token);
	const result = await inspectLoadedSequence(saved);
	if (argument === undefined) {
		void vscode.window.showInformationMessage(`Repaired the saved path for '${selected.item.title}'. Its sealed Video Result reference was kept.`);
	}
	return result;
}

function commandArguments(argument: unknown): SequenceCommandArguments {
	if (isUri(argument)) {
		return { sequence: argument };
	}
	if (!argument || typeof argument !== 'object' || Array.isArray(argument)) {
		return {};
	}
	const candidate = argument as Record<string, unknown>;
	const supportedKeys = new Set(['sequence', 'videoNode', 'itemId', 'title', 'direction']);
	for (const key of Object.keys(candidate)) {
		if (!supportedKeys.has(key)) {
			throw new Error(`Sequence command argument '${key}' is not supported.`);
		}
	}
	assertOptionalUri(candidate, 'sequence');
	assertOptionalUri(candidate, 'videoNode');
	assertOptionalString(candidate, 'itemId');
	assertOptionalString(candidate, 'title');
	if (candidate.direction !== undefined && candidate.direction !== 'up' && candidate.direction !== 'down') {
		throw new Error(`Sequence command argument 'direction' must be 'up' or 'down'.`);
	}
	return {
		...(isUri(candidate.sequence) ? { sequence: candidate.sequence } : {}),
		...(typeof candidate.itemId === 'string' ? { itemId: candidate.itemId } : {}),
		...(candidate.direction === 'up' || candidate.direction === 'down' ? { direction: candidate.direction } : {}),
		...(isUri(candidate.videoNode) ? { videoNode: candidate.videoNode } : {}),
		...(typeof candidate.title === 'string' ? { title: candidate.title } : {})
	};
}

function assertOptionalUri(candidate: Readonly<Record<string, unknown>>, key: string): void {
	if (candidate[key] !== undefined && !isUri(candidate[key])) {
		throw new Error(`Sequence command argument '${key}' must be a URI.`);
	}
}

function assertOptionalString(candidate: Readonly<Record<string, unknown>>, key: string): void {
	if (candidate[key] !== undefined && typeof candidate[key] !== 'string') {
		throw new Error(`Sequence command argument '${key}' must be text.`);
	}
}

function isUri(value: unknown): value is vscode.Uri {
	return value instanceof vscode.Uri;
}

function requireStructuredArguments(
	argument: unknown,
	args: SequenceCommandArguments,
	keys: readonly (keyof SequenceCommandArguments)[]
): void {
	if (argument === undefined) {
		return;
	}
	for (const key of keys) {
		if (args[key] === undefined || args[key] === '') {
			throw new Error(`Structured Sequence arguments must include '${key}'.`);
		}
	}
}

async function resolveSequenceResource(explicit: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
	if (explicit) {
		await assertSequenceResource(explicit);
		return explicit;
	}
	const active = vscode.window.activeTextEditor?.document;
	if (active) {
		let isSequence = false;
		try {
			parseAIVideoSequenceDocument(active.getText());
			isSequence = true;
		} catch {
			// Continue to project discovery when the active file is not a Sequence.
		}
		if (isSequence) {
			await assertSequenceResource(active.uri);
			return active.uri;
		}
	}
	const candidates = await vscode.workspace.findFiles('**/video-sequence.json', '**/.bh/**', 100);
	const sequences: vscode.Uri[] = [];
	for (const candidate of candidates) {
		try {
			await assertSequenceResource(candidate);
			parseAIVideoSequenceDocument(await readSequenceSource(candidate));
			sequences.push(candidate);
		} catch {
			// A same-named JSON file is not part of this domain unless it parses.
		}
	}
	if (sequences.length === 0) {
		void vscode.window.showInformationMessage('No video-sequence.json was found in this project.');
		return undefined;
	}
	if (sequences.length === 1) {
		return sequences[0];
	}
	const selected = await vscode.window.showQuickPick(sequences.map(resource => ({
		label: vscode.workspace.asRelativePath(resource, false),
		resource
	})), { placeHolder: 'Choose a video sequence' });
	return selected?.resource;
}

export async function loadSequence(resource: vscode.Uri): Promise<LoadedSequence> {
	await assertSequenceResource(resource);
	const source = await readSequenceSource(resource);
	return {
		resource,
		source,
		sequence: parseAIVideoSequenceDocument(source)
	};
}

async function readSequenceSource(resource: vscode.Uri): Promise<string> {
	const bytes = await readFileWithinLimit(resource, MAX_SEQUENCE_DOCUMENT_BYTES, {
		stat: candidate => vscode.workspace.fs.stat(candidate),
		readFile: candidate => vscode.workspace.fs.readFile(candidate)
	}, 'Video Sequence document');
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function inspectLoadedSequence(loaded: LoadedSequence, token?: vscode.CancellationToken): Promise<AIVideoSequenceInspection> {
	const workflowRoot = parentUri(loaded.resource);
	const inspectNode = (resource: vscode.Uri) => sequenceInspectionLimiter.run(async () => {
		throwIfCommandCancelled(token);
		const result = await inspectVideoResultNode(resource);
		throwIfCommandCancelled(token);
		return result;
	});
	return inspectAIVideoSequence(loaded.sequence, async videoNodePath => {
		const resource = vscode.Uri.file(resolveAIVideoSequenceVideoNodePath(loaded.resource.fsPath, videoNodePath));
		return inspectNode(resource);
	}, createMovedNodeLocator(workflowRoot, inspectNode, token), () => throwIfCommandCancelled(token));
}

function createMovedNodeLocator(
	workflowRoot: vscode.Uri,
	inspectNode: (resource: vscode.Uri) => Promise<AIVideoSequenceNodeState | undefined>,
	token?: vscode.CancellationToken
): (item: AIVideoSequenceItem) => Promise<AIVideoSequenceNodeRelocation | undefined> {
	let index: Promise<{ readonly truncated: boolean; readonly byId: ReadonlyMap<string, readonly vscode.Uri[]> }> | undefined;
	return async item => {
		throwIfCommandCancelled(token);
		index ??= buildSequenceNodeIdentityIndex(workflowRoot, inspectNode, token);
		const result = await index;
		throwIfCommandCancelled(token);
		if (result.truncated) {
			return { kind: 'scanLimit', maximum: MAX_SEQUENCE_NODE_RELOCATION_SCAN_RESULTS };
		}
		const matches = result.byId.get(item.nodeId) ?? [];
		if (matches.length === 0) {
			return undefined;
		}
		if (matches.length !== 1) {
			return { kind: 'ambiguous', matchCount: matches.length };
		}
		const resource = matches[0];
		const videoNodePath = portableDescendantVideoNodePath(workflowRoot.fsPath, resource.fsPath);
		const node = await inspectNode(resource);
		if (!node || node.id !== item.nodeId) {
			return undefined;
		}
		return { kind: 'unique', videoNodePath, node };
	};
}

async function buildSequenceNodeIdentityIndex(
	workflowRoot: vscode.Uri,
	inspectNode: (resource: vscode.Uri) => Promise<AIVideoSequenceNodeState | undefined>,
	token?: vscode.CancellationToken
): Promise<{ readonly truncated: boolean; readonly byId: ReadonlyMap<string, readonly vscode.Uri[]> }> {
	throwIfCommandCancelled(token);
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(workflowRoot);
	if (!workspaceFolder) {
		return { truncated: false, byId: new Map() };
	}
	const resources = await vscode.workspace.findFiles(
		new vscode.RelativePattern(workflowRoot, '**/*.bhnode'),
		new vscode.RelativePattern(workflowRoot, '**/.bh/**'),
		MAX_SEQUENCE_NODE_RELOCATION_SCAN_RESULTS + 1
	);
	throwIfCommandCancelled(token);
	if (resources.length > MAX_SEQUENCE_NODE_RELOCATION_SCAN_RESULTS) {
		return { truncated: true, byId: new Map() };
	}
	const byId = new Map<string, vscode.Uri[]>();
	let next = 0;
	const workers = Array.from({ length: Math.min(SEQUENCE_INSPECTION_CONCURRENCY, resources.length) }, async () => {
		while (next < resources.length) {
			throwIfCommandCancelled(token);
			const resource = resources[next++];
			try {
				const node = await inspectNode(resource);
				if (node) {
					const matches = byId.get(node.id) ?? [];
					matches.push(resource);
					byId.set(node.id, matches);
				}
			} catch {
				throwIfCommandCancelled(token);
				// Invalid, dirty, or inaccessible nodes cannot be safe repair candidates.
			}
		}
	});
	await Promise.all(workers);
	return { truncated: false, byId };
}

async function saveSequence(
	loaded: LoadedSequence,
	sequence: AIVideoSequenceDocument,
	token?: vscode.CancellationToken
): Promise<LoadedSequence> {
	const contents = serializeAIVideoSequenceDocument(sequence);
	// Reviewed Agent operations receive this token as their second command
	// argument. Mutating commands must observe it at the commit boundary so a
	// request that the host has already cancelled cannot write later.
	throwIfCommandCancelled(token);
	await vscode.basehalf.applyProjectFileTransition(
		loaded.resource,
		new TextEncoder().encode(loaded.source),
		new TextEncoder().encode(contents),
		'Edit video playback order'
	);
	const saved = await loadSequence(loaded.resource);
	if (serializeAIVideoSequenceDocument(saved.sequence) !== contents) {
		throw new Error('The saved Sequence no longer matches this action. Review the file and try again.');
	}
	return saved;
}

function throwIfCommandCancelled(token: vscode.CancellationToken | undefined): void {
	if (token?.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
}

async function pickVideoCandidate(workflowRoot: vscode.Uri): Promise<SequenceVideoCandidate | undefined> {
	const resources = await vscode.workspace.findFiles(
		new vscode.RelativePattern(workflowRoot, '**/*.bhnode'),
		new vscode.RelativePattern(workflowRoot, '**/.bh/**'),
		1_000
	);
	const candidates: SequenceVideoCandidate[] = [];
	for (const resource of resources) {
		try {
			candidates.push(await loadVideoCandidate(workflowRoot, resource));
		} catch {
			// Only sealed Video Result nodes can enter Sequence.
		}
	}
	candidates.sort((left, right) => left.videoNodePath.localeCompare(right.videoNodePath));
	if (candidates.length === 0) {
		void vscode.window.showInformationMessage('No sealed Video Result is available to add.');
		return undefined;
	}
	if (candidates.length === 1) {
		return candidates[0];
	}
	const selected = await vscode.window.showQuickPick(candidates.map(candidate => ({
		label: candidate.suggestedTitle,
		description: candidate.videoNodePath,
		candidate
	})), { placeHolder: 'Choose a Video Result to add to playback order' });
	return selected?.candidate;
}

async function loadVideoCandidate(workflowRoot: vscode.Uri, resource: vscode.Uri): Promise<SequenceVideoCandidate> {
	if (!isPlainLocalFileResource(resource.scheme, resource.query, resource.fragment)) {
		throw new Error('The Video node must be an ordinary local file inside the workflow root.');
	}
	const sequenceWorkspace = vscode.workspace.getWorkspaceFolder(workflowRoot);
	const candidateWorkspace = vscode.workspace.getWorkspaceFolder(resource);
	if (!sequenceWorkspace || !candidateWorkspace || sequenceWorkspace.uri.toString() !== candidateWorkspace.uri.toString()) {
		throw new Error('The Video node and Sequence must belong to the same open workspace folder.');
	}
	const videoNodePath = portableDescendantVideoNodePath(workflowRoot.fsPath, resource.fsPath);
	const node = await inspectVideoResultNode(resource);
	if (!node) {
		throw new Error(`'${videoNodePath}' is not a saved result node.`);
	}
	const result = resolveAIVideoSequenceVideoResult(node);
	return Object.freeze({
		resource,
		videoNodePath,
		nodeId: result.nodeId,
		suggestedTitle: suggestedSequenceTitle(videoNodePath)
	});
}

async function inspectVideoResultNode(resource: vscode.Uri): Promise<AIVideoSequenceNodeState | undefined> {
	return vscode.basehalf.inspectCanvasNode(resource);
}

async function promptForSequenceTitle(suggestedTitle: string): Promise<string | undefined> {
	return vscode.window.showInputBox({
		title: 'Add Video Result to Sequence',
		prompt: 'Name this clip in playback order',
		value: suggestedTitle,
		validateInput: value => {
			if (!value.trim()) {
				return 'Enter a clip name.';
			}
			if (value.includes('\u0000') || value.length > 240) {
				return 'Use no more than 240 characters.';
			}
			return undefined;
		}
	});
}

function suggestedSequenceTitle(videoNodePath: string): string {
	const segments = videoNodePath.split('/');
	const fileName = segments.at(-1)?.replace(/\.bhnode$/i, '') || 'Clip';
	const source = /^(clip|video)$/i.test(fileName) && segments.length > 1 ? segments[segments.length - 2] : fileName;
	const words = source.replace(/[-_]+/g, ' ').trim();
	return words ? words.replace(/^\p{Ll}/u, character => character.toUpperCase()) : 'Clip';
}

function uniqueSequenceItemId(sequence: AIVideoSequenceDocument): string {
	const ids = new Set(sequence.items.map(item => item.id));
	for (let attempt = 0; attempt < 10; attempt++) {
		const candidate = `sequence-item-${randomUUID()}`;
		if (!ids.has(candidate)) {
			return candidate;
		}
	}
	throw new Error('A unique Sequence item id could not be created. Try again.');
}

async function assertSequenceResource(resource: vscode.Uri): Promise<void> {
	if (!isPlainLocalFileResource(resource.scheme, resource.query, resource.fragment)) {
		throw new Error('Sequence must be an ordinary local file in an open workspace folder.');
	}
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(resource);
	if (!workspaceFolder || workspaceFolder.uri.scheme !== 'file') {
		throw new Error('Sequence must be inside an open local workspace folder.');
	}
	let entry: Awaited<ReturnType<typeof lstat>>;
	let workspaceRealPath: string;
	let sequenceRealPath: string;
	try {
		[entry, workspaceRealPath, sequenceRealPath] = await Promise.all([
			lstat(resource.fsPath),
			realpath(workspaceFolder.uri.fsPath),
			realpath(resource.fsPath)
		]);
	} catch {
		throw new Error('Sequence must be an existing ordinary local file in an open workspace folder.');
	}
	if (!isOrdinaryFilePathInside(workspaceRealPath, sequenceRealPath, entry.isFile(), entry.isSymbolicLink())) {
		throw new Error('Sequence must be an ordinary file contained by its open workspace folder.');
	}
}

async function showSequenceInspection(inspection: AIVideoSequenceInspection): Promise<AIVideoSequenceItemInspection | undefined> {
	if (inspection.items.length === 0) {
		void vscode.window.showInformationMessage('Sequence has no clips yet.');
		return undefined;
	}
	const selected = await vscode.window.showQuickPick(inspection.items.map((item, index) => ({
		label: `${sequenceStateIcon(item)} ${index + 1}. ${item.item.title}`,
		description: sequenceStateLabel(item),
		detail: item.message,
		item
	})), {
		placeHolder: inspection.valid
			? 'All Video Results are available'
			: 'One or more Video Results need attention'
	});
	return selected?.item;
}

async function pickSequenceItem(sequence: AIVideoSequenceDocument, placeHolder: string): Promise<string | undefined> {
	const selected = await vscode.window.showQuickPick(sequence.items.map((item, index) => ({
		label: `${index + 1}. ${item.title}`,
		description: item.videoNodePath,
		itemId: item.id
	})), { placeHolder });
	return selected?.itemId;
}

async function pickSequenceInspection(items: readonly AIVideoSequenceItemInspection[], placeHolder: string): Promise<string | undefined> {
	const selected = await vscode.window.showQuickPick(items.map(item => ({
		label: item.item.title,
		description: item.item.videoNodePath,
		detail: item.message,
		itemId: item.item.id
	})), { placeHolder });
	return selected?.itemId;
}

async function pickMoveDirection(index: number, total: number): Promise<'up' | 'down' | undefined> {
	const choices: { label: string; direction: 'up' | 'down' }[] = [];
	if (index > 0) {
		choices.push({ label: 'Move earlier', direction: 'up' });
	}
	if (index < total - 1) {
		choices.push({ label: 'Move later', direction: 'down' });
	}
	return (await vscode.window.showQuickPick(choices, { placeHolder: 'Choose playback order' }))?.direction;
}

function sequenceStateIcon(item: AIVideoSequenceItemInspection): string {
	switch (item.state) {
		case 'result': return '$(check)';
		case 'invalid': return '$(error)';
	}
}

function sequenceStateLabel(item: AIVideoSequenceItemInspection): string {
	switch (item.state) {
		case 'result': return 'Video Result';
		case 'invalid': return 'Unavailable';
	}
}

function parentUri(resource: vscode.Uri): vscode.Uri {
	const separator = resource.path.lastIndexOf('/');
	return resource.with({ path: separator > 0 ? resource.path.slice(0, separator) : '/' });
}
