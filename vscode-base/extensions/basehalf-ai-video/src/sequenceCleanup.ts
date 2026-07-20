/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { basename, dirname } from 'node:path';
import * as vscode from 'vscode';
import { portableDescendantVideoNodePath, removeAIVideoSequenceItemsForNodeIdentity, serializeAIVideoSequenceDocument } from './domain';
import { SequenceDiscoveryCache } from './sequenceDiscoveryCache';
import { loadSequenceForStructuralCleanup } from './sequenceCleanupLoad';
import { loadSequence } from './sequenceCommands';

const MAX_SEQUENCE_FILES_PER_DELETE = 256;

export class SequenceCleanupService implements vscode.Disposable {
	private readonly discovery = new SequenceDiscoveryCache<vscode.Uri>();
	private readonly watcher = vscode.workspace.createFileSystemWatcher('**/video-sequence.json', false, true, false);
	private readonly subscriptions: readonly vscode.Disposable[];

	constructor() {
		this.subscriptions = Object.freeze([
			this.watcher,
			this.watcher.onDidCreate(resource => this.invalidateResource(resource)),
			this.watcher.onDidDelete(resource => this.invalidateResource(resource)),
			vscode.workspace.onDidCreateFiles(event => this.invalidateResources(event.files)),
			vscode.workspace.onDidDeleteFiles(event => this.invalidateResources(event.files)),
			vscode.workspace.onDidRenameFiles(event => this.invalidateResources(event.files.flatMap(entry => [entry.oldUri, entry.newUri]))),
			vscode.workspace.onDidChangeWorkspaceFolders(() => this.discovery.clear())
		]);
	}

	readonly prepareDelete = async (
		resource: vscode.Uri,
		token: vscode.CancellationToken
	): Promise<readonly vscode.basehalf.ProjectFileTransition[]> => {
		if (resource.scheme !== 'file' || resource.query || resource.fragment || !resource.path.toLowerCase().endsWith('.bhnode')) {
			return [];
		}
		const workspace = vscode.workspace.getWorkspaceFolder(resource);
		if (!workspace || workspace.uri.scheme !== 'file') {
			return [];
		}
		const node = await vscode.basehalf.inspectCanvasNode(resource, { versionIds: [], includeCurrent: false });
		if (!node || node.kind !== 'video') {
			return [];
		}
		const candidates = await this.discovery.get(workspace.uri.toString(), async () => vscode.workspace.findFiles(
			new vscode.RelativePattern(workspace, '**/video-sequence.json'),
			new vscode.RelativePattern(workspace, '**/.bh/**'),
			MAX_SEQUENCE_FILES_PER_DELETE + 1
		));
		if (candidates.length > MAX_SEQUENCE_FILES_PER_DELETE) {
			throw new Error(`Deletion cleanup found more than ${MAX_SEQUENCE_FILES_PER_DELETE} Sequence files. Narrow the workspace before deleting this Video node.`);
		}
		const transitions: vscode.basehalf.ProjectFileTransition[] = [];
		for (const candidate of [...candidates].sort((left, right) => left.fsPath.localeCompare(right.fsPath))) {
			if (token.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			let videoNodePath: string;
			try {
				videoNodePath = portableDescendantVideoNodePath(dirname(candidate.fsPath), resource.fsPath);
			} catch {
				continue;
			}
			const loaded = await loadSequenceForStructuralCleanup(
				vscode.workspace.asRelativePath(candidate, false),
				() => loadSequence(candidate)
			);
			const nextSequence = removeAIVideoSequenceItemsForNodeIdentity(loaded.sequence, node.id, videoNodePath);
			if (nextSequence.items.length === loaded.sequence.items.length) {
				continue;
			}
			const next = serializeAIVideoSequenceDocument(nextSequence);
			transitions.push(Object.freeze({
				resource: candidate,
				expected: new TextEncoder().encode(loaded.source),
				next: new TextEncoder().encode(next),
				label: 'Remove deleted video from Sequence'
			}));
		}
		return Object.freeze(transitions);
	};

	dispose(): void {
		for (const subscription of this.subscriptions) {
			subscription.dispose();
		}
		this.discovery.clear();
	}

	private invalidateResources(resources: readonly vscode.Uri[]): void {
		for (const resource of resources) {
			if (resource.scheme === 'file' && basename(resource.fsPath).toLowerCase() === 'video-sequence.json') {
				this.invalidateResource(resource);
			}
		}
	}

	private invalidateResource(resource: vscode.Uri): void {
		const workspace = vscode.workspace.getWorkspaceFolder(resource);
		if (!workspace) {
			this.discovery.clear();
			return;
		}
		this.discovery.invalidate(workspace.uri.toString());
	}
}
