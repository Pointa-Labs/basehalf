/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AIProject, AIProjectShot } from './model';

export interface AIVideoGenerationContext {
	readonly projectUri: vscode.Uri;
	readonly project: AIProject;
	readonly shot: AIProjectShot;
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

export class AIVideoGenerationProviderRegistry implements vscode.Disposable {
	private readonly providers = new Map<string, AIVideoGenerationProvider>();
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeProviders = this.changeEmitter.event;

	register(provider: AIVideoGenerationProvider): vscode.Disposable {
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

	get(id: string): AIVideoGenerationProvider | undefined {
		return this.providers.get(id);
	}

	list(): readonly Pick<AIVideoGenerationProvider, 'id' | 'label'>[] {
		return [...this.providers.values()].map(({ id, label }) => ({ id, label }));
	}

	dispose(): void {
		this.providers.clear();
		this.changeEmitter.dispose();
	}
}

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
			const scene = context.project.scenes.find(candidate => candidate.id === context.shot.sceneId);
			const payload = {
				version: 1,
				project: context.project.title,
				shot: {
					id: context.shot.id,
					title: context.shot.title,
					scene: scene ? { id: scene.id, name: scene.name, description: scene.description } : undefined,
					prompt: context.shot.prompt,
					dialogue: context.shot.dialogue,
					videoProvider: context.shot.videoProvider,
					voiceProvider: context.shot.voiceProvider
				},
				characters: context.project.characters,
				createdAt: new Date().toISOString()
			};
			await vscode.workspace.fs.writeFile(output, new TextEncoder().encode(`${JSON.stringify(payload, null, 2)}\n`));
			return { outputs: [output], status: 'prepared' };
		}
	};
}
