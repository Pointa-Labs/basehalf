/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AIProject, AIProjectExecutableNode, AIProjectMediaKind, AIMediaProviderOption, selectedOutputPaths, upstreamWorkflowNodeIds, nodeById, isExecutableNode } from './model';
import { renderMediaNodeTextPrevisualization } from './preview';

export interface AIMediaWorkflowInputs {
	readonly text: readonly { readonly nodeId: string; readonly title: string; readonly content: string }[];
	readonly image: readonly string[];
	readonly video: readonly string[];
	readonly audio: readonly string[];
}

export interface AIMediaGenerationContext {
	readonly projectUri: vscode.Uri;
	readonly project: AIProject;
	readonly node: AIProjectExecutableNode;
	readonly prompt: string;
	readonly inputs: AIMediaWorkflowInputs;
	readonly outputDirectory: vscode.Uri;
	readonly token: vscode.CancellationToken;
}

export interface AIMediaGenerationResult {
	readonly outputs: readonly vscode.Uri[];
	readonly status?: 'prepared' | 'complete';
}

export interface AIMediaGenerationProvider {
	readonly id: string;
	readonly label: string;
	readonly kinds: readonly Exclude<AIProjectMediaKind, 'text'>[];
	readonly supportsNativeAudio?: boolean;
	generate(context: AIMediaGenerationContext): vscode.ProviderResult<AIMediaGenerationResult>;
}

export class AIMediaGenerationProviderRegistry implements vscode.Disposable {
	private readonly providers = new Map<string, AIMediaGenerationProvider>();
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeProviders = this.changeEmitter.event;

	register(provider: AIMediaGenerationProvider): vscode.Disposable {
		if (!/^[a-z][a-z0-9.-]*$/.test(provider.id)) {
			throw new Error(`Invalid AI Video media provider id '${provider.id}'.`);
		}
		if (!provider.kinds.length || provider.kinds.some(kind => kind !== 'image' && kind !== 'video' && kind !== 'audio')) {
			throw new Error(`AI Video media provider '${provider.id}' must declare at least one supported media kind.`);
		}
		if (this.providers.has(provider.id)) {
			throw new Error(`AI Video media provider '${provider.id}' is already registered.`);
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

	get(id: string, kind: Exclude<AIProjectMediaKind, 'text'>): AIMediaGenerationProvider | undefined {
		const provider = this.providers.get(id);
		return provider?.kinds.includes(kind) ? provider : undefined;
	}

	list(): readonly AIMediaProviderOption[] {
		return [...this.providers.values()].map(provider => ({
			id: provider.id,
			label: provider.label,
			kinds: provider.kinds,
			supportsNativeAudio: provider.supportsNativeAudio === true
		}));
	}

	dispose(): void {
		this.providers.clear();
		this.changeEmitter.dispose();
	}
}

export function createLocalPreviewProvider(): AIMediaGenerationProvider {
	return {
		id: 'local-preview',
		label: 'Local previsualization',
		kinds: ['image', 'video', 'audio'],
		supportsNativeAudio: false,
		async generate(context) {
			if (context.token.isCancellationRequested) {
				throw new vscode.CancellationError();
			}
			await vscode.workspace.fs.createDirectory(context.outputDirectory);
			const requestOutput = vscode.Uri.joinPath(context.outputDirectory, 'request.json');
			await vscode.workspace.fs.writeFile(requestOutput, new TextEncoder().encode(`${JSON.stringify({
				kind: context.node.kind,
				nodeId: context.node.id,
				prompt: context.prompt,
				provider: context.node.provider,
				model: context.node.model,
				inputs: context.inputs,
				createdAt: new Date().toISOString()
			}, null, 2)}\n`));
			if (context.node.kind === 'image') {
				const preview = vscode.Uri.joinPath(context.outputDirectory, 'storyboard.svg');
				await vscode.workspace.fs.writeFile(preview, new TextEncoder().encode(renderStoryboardPlaceholder(context.node.title, context.prompt)));
				return { outputs: [preview, requestOutput], status: 'prepared' };
			}
			const preview = vscode.Uri.joinPath(context.outputDirectory, `${context.node.kind}-preview.md`);
			await vscode.workspace.fs.writeFile(preview, new TextEncoder().encode(renderMediaNodeTextPrevisualization(context.project, context.node, context.inputs)));
			return { outputs: [preview, requestOutput], status: 'prepared' };
		}
	};
}

export function resolveMediaWorkflowInputs(project: AIProject, nodeId: string): AIMediaWorkflowInputs {
	const upstream = upstreamWorkflowNodeIds(project, nodeId).map(id => nodeById(project, id)).filter((node): node is NonNullable<typeof node> => !!node);
	const text = upstream.filter((node): node is Extract<typeof node, { kind: 'text' }> => node.kind === 'text').map(node => ({ nodeId: node.id, title: node.title, content: node.content }));
	const paths = (kind: 'image' | 'video' | 'audio'): string[] => upstream
		.filter((node): node is AIProjectExecutableNode => node.kind === kind && isExecutableNode(node))
		.flatMap(node => selectedOutputPaths(node));
	return { text, image: paths('image'), video: paths('video'), audio: paths('audio') };
}

export function resolveMediaInputPaths(inputs: AIMediaWorkflowInputs, node: AIProjectExecutableNode): readonly string[] {
	return [...inputs.image, ...inputs.video, ...inputs.audio, ...node.inputFiles];
}

function renderStoryboardPlaceholder(title: string, prompt: string): string {
	const lines = wrapText(prompt.trim() || 'No image prompt supplied.', 54).slice(0, 8);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
<rect width="900" height="1200" fill="#17191d"/>
<rect x="48" y="48" width="804" height="1104" rx="24" fill="#202329" stroke="#4a505b"/>
<text x="84" y="126" fill="#d7dbe2" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="32" font-weight="600">${escapeXml(title)}</text>
<text x="84" y="180" fill="#7dc4ff" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="20">LOCAL STORYBOARD PLACEHOLDER</text>
${lines.map((line, index) => `<text x="84" y="${260 + index * 46}" fill="#b9bec8" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="24">${escapeXml(line)}</text>`).join('\n')}
<text x="84" y="1090" fill="#777e8a" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="20">Configure an image model service for generated media.</text>
</svg>\n`;
}

function wrapText(value: string, width: number): string[] {
	const words = value.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let current = '';
	for (const word of words) {
		if (current && `${current} ${word}`.length > width) {
			lines.push(current);
			current = word;
		} else {
			current = current ? `${current} ${word}` : word;
		}
	}
	if (current) {
		lines.push(current);
	}
	return lines;
}

function escapeXml(value: string): string {
	// eslint-disable-next-line local/code-no-unexternalized-strings -- XML entities are data, not user-visible strings.
	return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}
