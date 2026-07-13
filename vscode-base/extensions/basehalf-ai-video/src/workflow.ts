/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AIProject, AIProjectBrief, AIProjectCharacter, AIProjectScene, AIProjectShot, AIProjectStyle, AI_VIDEO_BRIEF_NODE_ID, AI_VIDEO_SCRIPT_NODE_ID, priorShotIds, upstreamContextNodeIds } from './model';
import { renderShotTextPrevisualization } from './preview';

export interface AIVideoWorkflowInputs {
	readonly brief?: AIProjectBrief;
	readonly script?: string;
	readonly characters: readonly AIProjectCharacter[];
	readonly scenes: readonly AIProjectScene[];
	readonly styles: readonly AIProjectStyle[];
	readonly priorShots: readonly AIProjectShot[];
}

export interface AIVideoGenerationContext {
	readonly projectUri: vscode.Uri;
	readonly project: AIProject;
	readonly shot: AIProjectShot;
	readonly inputs: AIVideoWorkflowInputs;
	readonly outputDirectory: vscode.Uri;
	readonly token: vscode.CancellationToken;
}

export interface AIVideoGenerationResult {
	readonly outputs: readonly vscode.Uri[];
	readonly status?: 'prepared' | 'complete';
}

export interface AIVideoGenerationProvider {
	readonly id: string;
	readonly label: string;
	generate(context: AIVideoGenerationContext): vscode.ProviderResult<AIVideoGenerationResult>;
}

export interface AIVideoVoiceGenerationContext extends AIVideoGenerationContext {
	readonly videoOutputs: readonly vscode.Uri[];
}

export interface AIVideoVoiceGenerationResult {
	readonly outputs: readonly vscode.Uri[];
	readonly status?: 'prepared' | 'complete';
}

export interface AIVideoVoiceGenerationProvider {
	readonly id: string;
	readonly label: string;
	generate(context: AIVideoVoiceGenerationContext): vscode.ProviderResult<AIVideoVoiceGenerationResult>;
}

interface AIVideoProviderIdentity {
	readonly id: string;
	readonly label: string;
}

class AIVideoProviderRegistry<T extends AIVideoProviderIdentity> implements vscode.Disposable {
	private readonly providers = new Map<string, T>();
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeProviders = this.changeEmitter.event;

	register(provider: T): vscode.Disposable {
		if (!/^[a-z][a-z0-9.-]*$/.test(provider.id)) {
			throw new Error(`Invalid AI Video generation provider id '${provider.id}'.`);
		}
		if (this.providers.has(provider.id)) {
			throw new Error(`AI Video generation provider '${provider.id}' is already registered.`);
		}
		this.providers.set(provider.id, provider);
		this.changeEmitter.fire();
		return new vscode.Disposable(() => {
			if (this.providers.get(provider.id) === provider) {
				this.providers.delete(provider.id);
				this.changeEmitter.fire();
			}
		});
	}

	get(id: string): T | undefined {
		return this.providers.get(id);
	}

	list(): readonly Pick<T, 'id' | 'label'>[] {
		return [...this.providers.values()].map(({ id, label }) => ({ id, label }));
	}

	dispose(): void {
		this.providers.clear();
		this.changeEmitter.dispose();
	}
}

export class AIVideoGenerationProviderRegistry extends AIVideoProviderRegistry<AIVideoGenerationProvider> { }

export class AIVideoVoiceGenerationProviderRegistry extends AIVideoProviderRegistry<AIVideoVoiceGenerationProvider> { }

export function createPromptPackageProvider(): AIVideoGenerationProvider {
	return {
		id: 'prompt-package',
		label: 'Text previsualization (local)',
		async generate(context) {
			if (context.token.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			await vscode.workspace.fs.createDirectory(context.outputDirectory);
			const requestOutput = vscode.Uri.joinPath(context.outputDirectory, 'request.json');
			const previewOutput = vscode.Uri.joinPath(context.outputDirectory, 'shot.md');
			const payload = {
				version: 2,
				project: context.project.title,
				brief: context.project.brief,
				shot: {
					id: context.shot.id,
					title: context.shot.title,
					storyboard: context.shot.storyboard,
					camera: context.shot.camera,
					motion: context.shot.motion,
					prompt: context.shot.prompt,
					negativePrompt: context.shot.negativePrompt,
					dialogue: context.shot.dialogue,
					audio: context.shot.audio,
					durationSeconds: context.shot.durationSeconds,
					startFrame: context.shot.startFrame,
					endFrame: context.shot.endFrame,
					videoProvider: context.shot.videoProvider,
					voiceProvider: context.shot.voiceProvider
				},
				inputs: context.inputs,
				createdAt: new Date().toISOString()
			};
			await vscode.workspace.fs.writeFile(requestOutput, new TextEncoder().encode(`${JSON.stringify(payload, null, 2)}\n`));
			await vscode.workspace.fs.writeFile(previewOutput, new TextEncoder().encode(renderShotTextPrevisualization(context.project, context.shot, context.inputs)));
			return { outputs: [requestOutput, previewOutput], status: 'prepared' };
		}
	};
}

export function createNoVoiceProvider(): AIVideoVoiceGenerationProvider {
	return {
		id: 'none',
		label: 'No voice generation',
		generate() {
			return { outputs: [] };
		}
	};
}

export function resolveAIVideoWorkflowInputs(project: AIProject, shotId: string): AIVideoWorkflowInputs {
	const upstream = upstreamContextNodeIds(project, shotId);
	const prior = priorShotIds(project, shotId);
	const characters = new Map(project.characters.map(character => [character.id, character]));
	const scenes = new Map(project.scenes.map(scene => [scene.id, scene]));
	const styles = new Map(project.styles.map(style => [style.id, style]));
	const shots = new Map(project.shots.map(shot => [shot.id, shot]));
	return {
		brief: upstream.includes(AI_VIDEO_BRIEF_NODE_ID) ? project.brief : undefined,
		script: upstream.includes(AI_VIDEO_SCRIPT_NODE_ID) ? project.script : undefined,
		characters: upstream.flatMap(id => characters.get(id) ?? []),
		scenes: upstream.flatMap(id => scenes.get(id) ?? []),
		styles: upstream.flatMap(id => styles.get(id) ?? []),
		priorShots: prior.flatMap(id => shots.get(id) ?? [])
	};
}
