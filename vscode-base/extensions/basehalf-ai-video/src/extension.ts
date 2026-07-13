/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { AIProject, createAIProject, parseAIProject, pendingShotIdsInWorkflowOrder, serializeAIProject } from './model';
import { aiProjectWebviewHtml } from './webview';
import { AIVideoGenerationProvider, AIVideoGenerationProviderRegistry, AIVideoVoiceGenerationProvider, AIVideoVoiceGenerationProviderRegistry, createNoVoiceProvider, createPromptPackageProvider, resolveAIVideoWorkflowInputs } from './workflow';

const PROJECTION_ID = 'pointa.basehalf-ai-video.project';

export interface BaseHalfAIVideoApi {
	registerGenerationProvider(provider: AIVideoGenerationProvider): vscode.Disposable;
	listGenerationProviders(): readonly Pick<AIVideoGenerationProvider, 'id' | 'label'>[];
	registerVoiceGenerationProvider(provider: AIVideoVoiceGenerationProvider): vscode.Disposable;
	listVoiceGenerationProviders(): readonly Pick<AIVideoVoiceGenerationProvider, 'id' | 'label'>[];
}

export function activate(context: vscode.ExtensionContext): BaseHalfAIVideoApi {
	const videoProviders = new AIVideoGenerationProviderRegistry();
	const voiceProviders = new AIVideoVoiceGenerationProviderRegistry();
	context.subscriptions.push(
		videoProviders,
		videoProviders.register(createPromptPackageProvider()),
		voiceProviders,
		voiceProviders.register(createNoVoiceProvider())
	);
	context.subscriptions.push(vscode.commands.registerCommand('basehalf.aiVideo.createProject', () => createProject()));
	context.subscriptions.push(vscode.basehalf.registerCardProjectionProvider(PROJECTION_ID, {
		async resolveCardProjection(resource, view, token) {
			const controller = new AIProjectController(resource, view, videoProviders, voiceProviders, context.extensionUri, token);
			await controller.open();
		}
	}, { retainContextWhenHidden: true }));

	return {
		registerGenerationProvider: provider => {
			const registration = videoProviders.register(provider);
			context.subscriptions.push(registration);
			return registration;
		},
		listGenerationProviders: () => videoProviders.list(),
		registerVoiceGenerationProvider: provider => {
			const registration = voiceProviders.register(provider);
			context.subscriptions.push(registration);
			return registration;
		},
		listVoiceGenerationProviders: () => voiceProviders.list()
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
		private readonly videoProviders: AIVideoGenerationProviderRegistry,
		private readonly voiceProviders: AIVideoVoiceGenerationProviderRegistry,
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
		this.view.webview.options = {
			enableScripts: true,
			localResourceRoots: [parentUri(this.resource), this.extensionUri]
		};
		this.view.webview.html = aiProjectWebviewHtml(this.view.webview, this.extensionUri, {
			project: state.project,
			revision: state.revision,
			videoProviders: this.videoProviders.list(),
			voiceProviders: this.voiceProviders.list()
		});
		this.disposables.push(this.view.webview.onDidReceiveMessage(message => this.handleMessage(message)));
		this.disposables.push(this.videoProviders.onDidChangeProviders(() => { void this.postProviders(); }));
		this.disposables.push(this.voiceProviders.onDidChangeProviders(() => { void this.postProviders(); }));
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
				case 'runShot':
					await this.runFromMessage(message, typeof message.shotId === 'string' ? [message.shotId] : []);
					break;
				case 'runPending':
					await this.runFromMessage(message);
					break;
				case 'cancel':
					this.runCancellation.cancel();
					break;
				case 'openOutput':
					await this.openOutput(message.path);
					break;
			}
		} catch (error) {
			if (error instanceof vscode.CancellationError) {
				await this.post({ type: 'cancelled' });
				return;
			}
			await this.post({ type: 'error', message: errorMessage(error), running: this.running });
		}
	}

	private async saveFromMessage(message: Record<string, unknown>): Promise<void> {
		if (this.running) {
			throw new Error('Wait for the active workflow run to finish or cancel it before saving.');
		}
		const project = projectFromMessage(message);
		const expectedRevision = stringProperty(message, 'revision');
		await this.writeProject(project, expectedRevision);
		await this.post({ type: 'saved', revision: this.revision });
	}

	private async runFromMessage(message: Record<string, unknown>, requestedShotIds?: readonly string[]): Promise<void> {
		if (this.running) {
			throw new Error('A workflow is already running for this project.');
		}
		const project = projectFromMessage(message);
		this.running = true;
		try {
			this.runCancellation.dispose();
			this.runCancellation = new vscode.CancellationTokenSource();
			await this.writeProject(project, stringProperty(message, 'revision'));
			const shotIds = requestedShotIds ?? pendingShotIdsInWorkflowOrder(project);
			if (!shotIds.length) {
				await this.post({ type: 'error', message: 'There are no pending shots to run.', running: true });
				return;
			}
			for (const shotId of shotIds) {
				this.throwIfCancelled(true);
				await this.runShot(shotId);
			}
		} finally {
			this.running = false;
			await this.postProject();
		}
	}

	private async runShot(shotId: string): Promise<void> {
		const project = this.requireProject();
		const shot = project.shots.find(candidate => candidate.id === shotId);
		if (!shot) {
			throw new Error(`Shot '${shotId}' no longer exists.`);
		}
		const videoProvider = this.videoProviders.get(shot.videoProvider);
		if (!videoProvider) {
			shot.status = 'error';
			shot.error = `Video provider '${shot.videoProvider}' is not installed or active.`;
			await this.writeProject(project, this.revision);
			return;
		}
		const voiceProvider = this.voiceProviders.get(shot.voiceProvider);
		if (!voiceProvider) {
			shot.status = 'error';
			shot.error = `Voice provider '${shot.voiceProvider}' is not installed or active.`;
			await this.writeProject(project, this.revision);
			return;
		}

		shot.status = 'running';
		delete shot.error;
		await this.writeProject(project, this.revision);
		await this.post({ type: 'running', shotId: shot.id, label: `Running ${shot.title} with ${videoProvider.label}…` });

		try {
			const outputDirectory = vscode.Uri.joinPath(outputRoot(this.resource), safeSegment(shot.id));
			const inputs = resolveAIVideoWorkflowInputs(project, shot.id);
			const videoResult = await videoProvider.generate({
				projectUri: this.resource,
				project,
				shot,
				inputs,
				outputDirectory,
				token: this.runCancellation.token
			});
			this.throwIfCancelled(true);
			if (!videoResult) {
				throw new Error(`Video provider '${videoProvider.label}' returned no result.`);
			}
			const videoOutputPaths = await collectProviderOutputPaths(this.resource, outputDirectory, videoProvider.label, videoResult.outputs, true);

			const voiceOutputDirectory = vscode.Uri.joinPath(outputDirectory, 'voice');
			if (voiceProvider.id !== 'none') {
				await this.post({ type: 'running', shotId: shot.id, label: `Generating voice for ${shot.title} with ${voiceProvider.label}…` });
			}
			const voiceResult = await voiceProvider.generate({
				projectUri: this.resource,
				project,
				shot,
				inputs,
				outputDirectory: voiceOutputDirectory,
				videoOutputs: videoResult.outputs,
				token: this.runCancellation.token
			});
			this.throwIfCancelled(true);
			if (!voiceResult) {
				throw new Error(`Voice provider '${voiceProvider.label}' returned no result.`);
			}
			const voiceOutputPaths = await collectProviderOutputPaths(this.resource, voiceOutputDirectory, voiceProvider.label, voiceResult.outputs, voiceProvider.id !== 'none');
			shot.outputs = [...videoOutputPaths, ...voiceOutputPaths];
			shot.status = videoResult.status === 'prepared' || voiceResult.status === 'prepared' ? 'prepared' : 'complete';
			delete shot.error;
		} catch (error) {
			if (error instanceof vscode.CancellationError || this.runCancellation.token.isCancellationRequested) {
				shot.status = 'draft';
				shot.error = 'Cancelled before completion.';
				await this.writeProject(project, this.revision);
				throw new vscode.CancellationError();
			}
			shot.status = 'error';
			shot.error = errorMessage(error);
		}
		await this.writeProject(project, this.revision);
		await this.postProject();
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
		if (typeof value !== 'string' || !value || path.posix.isAbsolute(value) || value.split('/').includes('..')) {
			throw new Error('The requested output path is outside this project.');
		}
		const output = vscode.Uri.joinPath(parentUri(this.resource), ...value.split('/'));
		await vscode.workspace.fs.stat(output);
		await vscode.commands.executeCommand('basehalf.openResource', output);
	}

	private async readProject(): Promise<{ project: AIProject; revision: string }> {
		const bytes = await vscode.workspace.fs.readFile(this.resource);
		return { project: parseAIProject(new TextDecoder().decode(bytes)), revision: await revisionOf(this.resource) };
	}

	private async postProject(): Promise<void> {
		await this.post({
			type: 'project',
			project: this.requireProject(),
			revision: this.revision,
			videoProviders: this.videoProviders.list(),
			voiceProviders: this.voiceProviders.list()
		});
	}

	private async postProviders(): Promise<void> {
		await this.post({
			type: 'providers',
			videoProviders: this.videoProviders.list(),
			voiceProviders: this.voiceProviders.list()
		});
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

async function collectProviderOutputPaths(
	project: vscode.Uri,
	outputDirectory: vscode.Uri,
	providerLabel: string,
	outputs: readonly vscode.Uri[],
	requireOutput: boolean
): Promise<string[]> {
	if (requireOutput && !outputs.length) {
		throw new Error(`Provider '${providerLabel}' returned no local output files.`);
	}
	const outputPaths: string[] = [];
	for (const output of outputs) {
		const stat = await vscode.workspace.fs.stat(output);
		if ((stat.type & vscode.FileType.Directory) !== 0) {
			throw new Error(`Provider '${providerLabel}' returned a directory instead of an output file.`);
		}
		outputPaths.push(portableOutputPath(project, outputDirectory, output));
	}
	return outputPaths;
}

function portableOutputPath(project: vscode.Uri, outputDirectory: vscode.Uri, output: vscode.Uri): string {
	if (project.scheme !== output.scheme || project.authority !== output.authority) {
		throw new Error('Generation providers must write outputs beside the local project.');
	}
	const outputRelative = path.posix.relative(outputDirectory.path, output.path);
	if (!outputRelative || path.posix.isAbsolute(outputRelative) || outputRelative.split('/').includes('..')) {
		throw new Error('Generation providers must return files inside the assigned output directory.');
	}
	const relative = path.posix.relative(path.posix.dirname(project.path), output.path);
	if (!relative || path.posix.isAbsolute(relative) || relative.split('/').includes('..')) {
		throw new Error('Generation providers must return files inside the project folder.');
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
