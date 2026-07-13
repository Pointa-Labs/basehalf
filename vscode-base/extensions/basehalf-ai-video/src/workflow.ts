/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AIProject, AIProjectCharacter, AIProjectScene, AIProjectShot, AI_VIDEO_SCRIPT_NODE_ID, upstreamWorkflowNodeIds } from './model';

export interface AIVideoWorkflowInputs {
	readonly script?: string;
	readonly characters: readonly AIProjectCharacter[];
	readonly scenes: readonly AIProjectScene[];
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
		label: 'Prompt package (local)',
		async generate(context) {
			if (context.token.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			await vscode.workspace.fs.createDirectory(context.outputDirectory);
			const output = vscode.Uri.joinPath(context.outputDirectory, 'request.json');
			const payload = {
				version: 1,
				project: context.project.title,
				shot: {
					id: context.shot.id,
					title: context.shot.title,
					prompt: context.shot.prompt,
					dialogue: context.shot.dialogue,
					videoProvider: context.shot.videoProvider,
					voiceProvider: context.shot.voiceProvider
				},
				inputs: context.inputs,
				createdAt: new Date().toISOString()
			};
			await vscode.workspace.fs.writeFile(output, new TextEncoder().encode(`${JSON.stringify(payload, null, 2)}\n`));
			return { outputs: [output], status: 'prepared' };
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
	const upstream = upstreamWorkflowNodeIds(project, shotId);
	const characters = new Map(project.characters.map(character => [character.id, character]));
	const scenes = new Map(project.scenes.map(scene => [scene.id, scene]));
	const shots = new Map(project.shots.map(shot => [shot.id, shot]));
	return {
		script: upstream.includes(AI_VIDEO_SCRIPT_NODE_ID) ? project.script : undefined,
		characters: upstream.flatMap(id => characters.get(id) ?? []),
		scenes: upstream.flatMap(id => scenes.get(id) ?? []),
		priorShots: upstream.flatMap(id => id === shotId ? [] : (shots.get(id) ?? []))
	};
}
