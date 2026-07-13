/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { createAIVideoAgentBrief } from './agent';
import { AIProject, createAIProject, createId, invalidateDownstreamNodes, isExecutableNode, nodeById, nodePrompt, nodeReadiness, parseAIProject, runnableNodeIdsInWorkflowOrder, serializeAIProject } from './model';
import { renderProjectTextPrevisualization } from './preview';
import { aiProjectWebviewHtml } from './webview';
import { AIMediaGenerationProvider, AIMediaGenerationProviderRegistry, createLocalPreviewProvider, resolveMediaInputPaths, resolveMediaWorkflowInputs } from './workflow';

const PROJECTION_ID = 'pointa.basehalf-ai-video.project';

export interface BaseHalfAIVideoApi {
	registerMediaGenerationProvider(provider: AIMediaGenerationProvider): vscode.Disposable;
	listMediaGenerationProviders(): ReturnType<AIMediaGenerationProviderRegistry['list']>;
}

export function activate(context: vscode.ExtensionContext): BaseHalfAIVideoApi {
	const providers = new AIMediaGenerationProviderRegistry();
	context.subscriptions.push(providers, providers.register(createLocalPreviewProvider()));
	context.subscriptions.push(vscode.commands.registerCommand('basehalf.aiVideo.createProject', () => createProject()));
	context.subscriptions.push(vscode.basehalf.registerCardProjectionProvider(PROJECTION_ID, {
		async resolveCardProjection(resource, view, token) {
			const controller = new AIProjectController(resource, view, providers, context.extensionUri, token);
			await controller.open();
		}
	}, { retainContextWhenHidden: true }));
	return {
		registerMediaGenerationProvider: provider => {
			const registration = providers.register(provider);
			context.subscriptions.push(registration);
			return registration;
		},
		listMediaGenerationProviders: () => providers.list()
	};
}

async function createProject(): Promise<void> {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
	const defaultUri = workspaceRoot ? vscode.Uri.joinPath(workspaceRoot, 'Untitled.aivideo') : undefined;
	const resource = await vscode.window.showSaveDialog({
		defaultUri,
		filters: { 'AI Video project': ['aivideo'] },
		saveLabel: 'Create AI Video Project'
	});
	if (!resource) {
		return;
	}
	const title = path.posix.basename(resource.path, path.posix.extname(resource.path)) || 'Untitled AI Video';
	await vscode.workspace.fs.writeFile(resource, serializeAIProject(createAIProject(title)));
	await vscode.commands.executeCommand('basehalf.openResource', resource);
}

class AIProjectController implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private runCancellation = new vscode.CancellationTokenSource();
	private project: AIProject | undefined;
	private revision = '';
	private dirty = false;
	private running = false;
	private disposed = false;
	private ownWriteRevision: string | undefined;

	constructor(
		private readonly resource: vscode.Uri,
		private readonly view: vscode.basehalf.CardProjectionView,
		private readonly providers: AIMediaGenerationProviderRegistry,
		private readonly extensionUri: vscode.Uri,
		private readonly openingToken: vscode.CancellationToken
	) {
		this.disposables.push(view.onDidDispose(() => this.dispose()));
	}

	async open(): Promise<void> {
		this.throwIfCancelled();
		const state = await this.readProject();
		this.project = state.project;
		this.revision = state.revision;
		this.view.webview.options = { enableScripts: true, localResourceRoots: [parentUri(this.resource), this.extensionUri] };
		this.view.webview.html = aiProjectWebviewHtml(this.view.webview, this.extensionUri, {
			project: state.project,
			revision: state.revision,
			providers: this.providers.list(),
			mediaUris: this.mediaUris(state.project)
		});
		this.disposables.push(this.view.webview.onDidReceiveMessage(message => this.handleMessage(message)));
		this.disposables.push(this.providers.onDidChangeProviders(() => { void this.postProviders(); }));
		this.installWatcher();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.runCancellation.cancel();
		this.runCancellation.dispose();
		for (const disposable of this.disposables.splice(0)) {
			disposable.dispose();
		}
	}

	private async handleMessage(message: unknown): Promise<void> {
		if (!isRecord(message) || this.disposed) {
			return;
		}
		try {
			switch (message.type) {
				case 'dirty':
					this.dirty = message.dirty === true;
					this.view.setDirty(this.dirty);
					break;
				case 'save':
					await this.saveFromMessage(message);
					break;
				case 'reload':
					await this.reload();
					break;
				case 'prepareAgent':
					await this.prepareAgent(message);
					break;
				case 'runNode':
					await this.runFromMessage(message, typeof message.nodeId === 'string' ? [message.nodeId] : []);
					break;
				case 'runReady':
					await this.runFromMessage(message);
					break;
				case 'cancel':
					this.runCancellation.cancel();
					break;
				case 'openOutput':
					await this.openOutput(message.path);
					break;
				case 'importFiles':
					await this.importFiles(message);
					break;
			}
		} catch (error) {
			if (error instanceof vscode.CancellationError) {
				await this.post({ type: 'cancelled' });
				return;
			}
			await this.post({ type: 'error', message: errorMessage(error), running: this.running, revision: this.revision });
		}
	}

	private async saveFromMessage(message: Record<string, unknown>): Promise<void> {
		if (this.running) {
			throw new Error('Wait for the active workflow run to finish or cancel it before saving.');
		}
		const project = projectFromMessage(message);
		await this.writeProject(project, stringProperty(message, 'revision'));
		await this.post({ type: 'saved', revision: this.revision, mediaUris: this.mediaUris(project) });
	}

	private async prepareAgent(message: Record<string, unknown>): Promise<void> {
		if (this.running) {
			throw new Error('Wait for the active workflow run to finish or cancel it before handing the project to an Agent.');
		}
		const project = projectFromMessage(message);
		await this.writeProject(project, stringProperty(message, 'revision'));
		await vscode.env.clipboard.writeText(createAIVideoAgentBrief(this.resource.fsPath, project));
		let agentAreaOpened = true;
		try {
			await vscode.commands.executeCommand('basehalf.agentArea.newTab');
		} catch {
			agentAreaOpened = false;
		}
		await this.post({
			type: 'agentReady',
			revision: this.revision,
			message: agentAreaOpened ? 'Workflow brief copied. Tell the Agent what you want to make.' : 'Workflow brief copied. Paste it into your Agent.'
		});
	}

	private async importFiles(message: Record<string, unknown>): Promise<void> {
		if (this.running) {
			throw new Error('Wait for the active workflow run to finish or cancel it before importing files.');
		}
		const project = projectFromMessage(message);
		const nodeId = stringProperty(message, 'nodeId');
		const node = nodeById(project, nodeId);
		if (!node) {
			throw new Error(`Node '${nodeId}' no longer exists.`);
		}
		await this.writeProject(project, stringProperty(message, 'revision'));
		const sources = await vscode.window.showOpenDialog({
			defaultUri: parentUri(this.resource),
			canSelectFiles: true,
			canSelectFolders: false,
			canSelectMany: true,
			openLabel: node.kind === 'text' ? 'Import Text' : 'Import Media',
			...(node.kind === 'text' ? { filters: { 'Text files': ['md', 'markdown', 'txt', 'json', 'csv', 'srt', 'vtt'] } } : {})
		});
		if (!sources?.length) {
			await this.postProject();
			return;
		}
		if (node.kind === 'text') {
			for (const source of sources) {
				if ((await vscode.workspace.fs.stat(source)).size > 2 * 1024 * 1024) {
					throw new Error(`'${path.posix.basename(source.path)}' is too large to import into one Text node.`);
				}
			}
		}
		const imported: { readonly uri: vscode.Uri; readonly path: string }[] = [];
		for (const source of sources) {
			const uri = await importIntoProject(this.resource, source);
			imported.push({ uri, path: portableProjectFilePath(this.resource, uri) });
		}
		if (node.kind === 'text') {
			const sections: string[] = [];
			for (const item of imported) {
				const bytes = await vscode.workspace.fs.readFile(item.uri);
				sections.push(new TextDecoder().decode(bytes).trim());
			}
			node.content = [node.content.trim(), ...sections].filter(Boolean).join('\n\n');
			invalidateDownstreamNodes(project, [node.id], false);
		} else {
			node.inputFiles = [...new Set([...node.inputFiles, ...imported.map(item => item.path)])];
			invalidateDownstreamNodes(project, [node.id]);
		}
		await this.writeProject(project, this.revision);
		await this.postProject();
	}

	private async runFromMessage(message: Record<string, unknown>, requestedNodeIds?: readonly string[]): Promise<void> {
		if (this.running) {
			throw new Error('A workflow is already running for this project.');
		}
		const project = projectFromMessage(message);
		this.running = true;
		try {
			this.runCancellation.dispose();
			this.runCancellation = new vscode.CancellationTokenSource();
			await this.writeProject(project, stringProperty(message, 'revision'));
			const nodeIds = requestedNodeIds ?? runnableNodeIdsInWorkflowOrder(project);
			if (!nodeIds.length) {
				throw new Error('No media nodes are ready to run. Review the highlighted requirements first.');
			}
			for (const nodeId of nodeIds) {
				this.throwIfCancelled(true);
				await this.runMediaNode(nodeId);
			}
			await this.writeSequencePreview();
		} finally {
			this.running = false;
			await this.postProject();
		}
	}

	private async runMediaNode(nodeId: string): Promise<void> {
		const project = this.requireProject();
		const node = nodeById(project, nodeId);
		if (!node || !isExecutableNode(node)) {
			throw new Error(`Media node '${nodeId}' no longer exists.`);
		}
		if (node.source !== 'generate') {
			throw new Error(`Media node '${node.title}' uses local files and does not need to run.`);
		}
		const readiness = nodeReadiness(project, node.id);
		if (!readiness.ready) {
			throw new Error(`${node.title}: ${readiness.reason ?? readiness.label}`);
		}
		const provider = this.providers.get(node.provider, node.kind);
		if (!provider) {
			node.status = 'error';
			node.error = `Model service '${node.provider}' is not configured for ${node.kind}.`;
			await this.writeProject(project, this.revision);
			return;
		}
		if (node.kind === 'video' && node.audioMode === 'generate' && provider.supportsNativeAudio !== true) {
			node.status = 'error';
			node.error = `${provider.label} does not support native video audio.`;
			await this.writeProject(project, this.revision);
			return;
		}
		node.status = 'running';
		delete node.error;
		await this.writeProject(project, this.revision);
		await this.post({ type: 'running', nodeId: node.id, label: `Running ${node.title} with ${provider.label}` });
		const runId = createId('run');
		try {
			const outputDirectory = vscode.Uri.joinPath(outputRoot(this.resource), safeSegment(node.id), safeSegment(runId));
			const inputs = resolveMediaWorkflowInputs(project, node.id);
			const prompt = nodePrompt(project, node.id);
			const result = await provider.generate({ projectUri: this.resource, project, node, prompt, inputs, outputDirectory, token: this.runCancellation.token });
			this.throwIfCancelled(true);
			if (!result) {
				throw new Error(`Model service '${provider.label}' returned no result.`);
			}
			const outputPaths = await collectProviderOutputPaths(this.resource, outputDirectory, provider.label, result.outputs, true);
			node.runs.push({
				id: runId,
				createdAt: new Date().toISOString(),
				provider: provider.id,
				model: node.model,
				status: result.status === 'complete' ? 'complete' : 'prepared',
				prompt,
				inputPaths: [...resolveMediaInputPaths(inputs, node)],
				outputs: outputPaths
			});
			node.selectedRunId = runId;
			node.status = result.status === 'complete' ? 'complete' : 'prepared';
			delete node.error;
		} catch (error) {
			if (error instanceof vscode.CancellationError || this.runCancellation.token.isCancellationRequested) {
				node.status = node.runs.length ? 'stale' : 'draft';
				node.error = 'Cancelled before completion.';
				await this.writeProject(project, this.revision);
				throw new vscode.CancellationError();
			}
			node.status = 'error';
			node.error = errorMessage(error);
		}
		await this.writeProject(project, this.revision);
		await this.postProject();
	}

	private async writeSequencePreview(): Promise<void> {
		const project = this.requireProject();
		const root = outputRoot(this.resource);
		await vscode.workspace.fs.createDirectory(root);
		const output = vscode.Uri.joinPath(root, 'sequence-preview.md');
		await vscode.workspace.fs.writeFile(output, new TextEncoder().encode(renderProjectTextPrevisualization(project)));
		project.outputs = [portableOutputPath(this.resource, root, output)];
		await this.writeProject(project, this.revision);
	}

	private async reload(): Promise<void> {
		const state = await this.readProject();
		this.project = state.project;
		this.revision = state.revision;
		this.dirty = false;
		this.view.setDirty(false);
		await this.postProject();
	}

	private async writeProject(project: AIProject, expectedRevision: string): Promise<void> {
		const currentRevision = await revisionOf(this.resource);
		if (expectedRevision !== currentRevision) {
			throw new Error('The project changed on disk. Reload it before saving so external Agent edits are not overwritten.');
		}
		await vscode.workspace.fs.writeFile(this.resource, serializeAIProject(project));
		this.project = project;
		this.revision = await revisionOf(this.resource);
		this.ownWriteRevision = this.revision;
		this.dirty = false;
		this.view.setDirty(false);
	}

	private installWatcher(): void {
		const parent = parentUri(this.resource);
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(parent, path.posix.basename(this.resource.path)));
		const changed = () => { void this.handleExternalChange(); };
		this.disposables.push(watcher, watcher.onDidChange(changed), watcher.onDidCreate(changed), watcher.onDidDelete(changed));
	}

	private async handleExternalChange(): Promise<void> {
		if (this.disposed) {
			return;
		}
		let revision: string;
		try {
			revision = await revisionOf(this.resource);
		} catch {
			await this.post({ type: 'error', message: 'The AI Video project was removed from disk.' });
			return;
		}
		if (revision === this.ownWriteRevision) {
			this.ownWriteRevision = undefined;
			return;
		}
		if (revision === this.revision) {
			return;
		}
		if (this.dirty || this.running) {
			await this.post({ type: 'externalChange' });
			return;
		}
		await this.reload();
	}

	private async openOutput(value: unknown): Promise<void> {
		const output = resolveProjectOutput(this.resource, value);
		await vscode.workspace.fs.stat(output);
		await vscode.commands.executeCommand('basehalf.openResource', output);
	}

	private async readProject(): Promise<{ project: AIProject; revision: string }> {
		const bytes = await vscode.workspace.fs.readFile(this.resource);
		return { project: parseAIProject(new TextDecoder().decode(bytes)), revision: await revisionOf(this.resource) };
	}

	private mediaUris(project: AIProject): Record<string, string> {
		const result: Record<string, string> = {};
		for (const node of project.nodes) {
			if (!isExecutableNode(node)) {
				continue;
			}
			for (const value of [...node.inputFiles, ...node.runs.flatMap(run => run.outputs)]) {
				try {
					result[value] = this.view.webview.asWebviewUri(resolveProjectOutput(this.resource, value)).toString(true);
				} catch {
					// Invalid paths stay visible as text but are never exposed to the webview.
				}
			}
		}
		return result;
	}

	private async postProject(): Promise<void> {
		const project = this.requireProject();
		await this.post({ type: 'project', project, revision: this.revision, running: this.running, providers: this.providers.list(), mediaUris: this.mediaUris(project) });
	}

	private async postProviders(): Promise<void> {
		await this.post({ type: 'providers', providers: this.providers.list() });
	}

	private async post(message: unknown): Promise<void> {
		if (!this.disposed) {
			await this.view.webview.postMessage(message);
		}
	}

	private requireProject(): AIProject {
		if (!this.project) {
			throw new Error('The AI Video project is not loaded.');
		}
		return this.project;
	}

	private throwIfCancelled(includeRun = false): void {
		if (this.openingToken.isCancellationRequested || (includeRun && this.runCancellation.token.isCancellationRequested)) {
			throw new vscode.CancellationError();
		}
	}
}

function projectFromMessage(message: Record<string, unknown>): AIProject {
	return parseAIProject(JSON.stringify(message.project));
}

async function revisionOf(resource: vscode.Uri): Promise<string> {
	const stat = await vscode.workspace.fs.stat(resource);
	const bytes = await vscode.workspace.fs.readFile(resource);
	const digest = createHash('sha256').update(bytes).digest('hex');
	return `${stat.mtime}:${stat.size}:${digest}`;
}

function parentUri(resource: vscode.Uri): vscode.Uri {
	return resource.with({ path: path.posix.dirname(resource.path) });
}

function outputRoot(resource: vscode.Uri): vscode.Uri {
	const base = path.posix.basename(resource.path, path.posix.extname(resource.path));
	return vscode.Uri.joinPath(parentUri(resource), `${safeSegment(base)}.outputs`);
}

function assetRoot(resource: vscode.Uri): vscode.Uri {
	const base = path.posix.basename(resource.path, path.posix.extname(resource.path));
	return vscode.Uri.joinPath(parentUri(resource), `${safeSegment(base)}.assets`);
}

async function importIntoProject(project: vscode.Uri, source: vscode.Uri): Promise<vscode.Uri> {
	try {
		portableProjectFilePath(project, source);
		return source;
	} catch {
		// A user-selected external file is copied into the local project below.
	}
	const root = assetRoot(project);
	await vscode.workspace.fs.createDirectory(root);
	const extension = path.posix.extname(source.path).replace(/[^A-Za-z0-9.]/g, '-');
	const stem = safeSegment(path.posix.basename(source.path, extension));
	let candidate = vscode.Uri.joinPath(root, `${stem}${extension}`);
	for (let index = 2; await uriExists(candidate); index++) {
		candidate = vscode.Uri.joinPath(root, `${stem}-${index}${extension}`);
	}
	await vscode.workspace.fs.copy(source, candidate, { overwrite: false });
	return candidate;
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function collectProviderOutputPaths(project: vscode.Uri, outputDirectory: vscode.Uri, providerLabel: string, outputs: readonly vscode.Uri[], requireOutput: boolean): Promise<string[]> {
	if (requireOutput && !outputs.length) {
		throw new Error(`Model service '${providerLabel}' returned no local output files.`);
	}
	const outputPaths: string[] = [];
	for (const output of outputs) {
		const stat = await vscode.workspace.fs.stat(output);
		if ((stat.type & vscode.FileType.Directory) !== 0) {
			throw new Error(`Model service '${providerLabel}' returned a directory instead of an output file.`);
		}
		outputPaths.push(portableOutputPath(project, outputDirectory, output));
	}
	return outputPaths;
}

function portableOutputPath(project: vscode.Uri, outputDirectory: vscode.Uri, output: vscode.Uri): string {
	if (project.scheme !== output.scheme || project.authority !== output.authority) {
		throw new Error('Model services must write outputs beside the local project.');
	}
	const outputRelative = path.posix.relative(outputDirectory.path, output.path);
	if (!outputRelative || path.posix.isAbsolute(outputRelative) || outputRelative.split('/').includes('..')) {
		throw new Error('Model services must return files inside the assigned output directory.');
	}
	const relative = path.posix.relative(path.posix.dirname(project.path), output.path);
	if (!relative || path.posix.isAbsolute(relative) || relative.split('/').includes('..')) {
		throw new Error('Model services must return files inside the project folder.');
	}
	return relative;
}

function resolveProjectOutput(project: vscode.Uri, value: unknown): vscode.Uri {
	if (typeof value !== 'string' || !value || path.posix.isAbsolute(value) || value.split('/').includes('..')) {
		throw new Error('The requested media path is outside this project.');
	}
	return vscode.Uri.joinPath(parentUri(project), ...value.split('/'));
}

function portableProjectFilePath(project: vscode.Uri, file: vscode.Uri): string {
	if (project.scheme !== file.scheme || project.authority !== file.authority) {
		throw new Error('The selected file is outside this local project.');
	}
	const relative = path.posix.relative(path.posix.dirname(project.path), file.path);
	if (!relative || path.posix.isAbsolute(relative) || relative.split('/').includes('..')) {
		throw new Error('The selected file is outside this local project.');
	}
	return relative;
}

function safeSegment(value: string): string {
	const safe = value.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '').slice(0, 100);
	return safe || 'output';
}

function stringProperty(value: Record<string, unknown>, key: string): string {
	const result = value[key];
	if (typeof result !== 'string') {
		throw new Error(`Missing '${key}' in AI Video request.`);
	}
	return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
