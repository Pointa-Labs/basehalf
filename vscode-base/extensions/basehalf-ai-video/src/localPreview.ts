/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import {
	AUDIO_BRIEF_RECIPE_ID,
	CLIP_BRIEF_RECIPE_ID,
	STORYBOARD_FRAME_RECIPE_ID,
	type AIVideoLocalRecipeId,
	type AIVideoRecipeInput,
	parseAudioBriefParameters,
	parseClipBriefParameters,
	parseStoryboardFrameParameters
} from './domain';

type RecipeValue = null | boolean | number | string | readonly RecipeValue[] | { readonly [key: string]: RecipeValue };

export interface LocalPreviewRequest {
	readonly recipeId: AIVideoLocalRecipeId;
	readonly nodeTitle: string;
	readonly nodePath: string;
	readonly prompt: string;
	readonly parameters: Readonly<Record<string, RecipeValue>>;
	readonly inputs: readonly AIVideoRecipeInput[];
}

export interface LocalPreviewArtifact {
	readonly artifactId: string;
	readonly outputId: 'storyboard' | 'brief';
	readonly kind: 'image' | 'file';
	readonly fileName: string;
	readonly label: string;
	readonly bytes: Uint8Array;
}

export function createLocalPreviewArtifact(request: LocalPreviewRequest): LocalPreviewArtifact {
	switch (request.recipeId) {
		case STORYBOARD_FRAME_RECIPE_ID: {
			const parameters = parseStoryboardFrameParameters(request.parameters);
			return Object.freeze({
				artifactId: 'storyboard',
				outputId: 'storyboard',
				kind: 'image',
				fileName: 'storyboard-planning-frame.svg',
				label: 'Local storyboard planning frame',
				bytes: encode(renderStoryboardPlanningFrame(request, parameters))
			});
		}
		case CLIP_BRIEF_RECIPE_ID: {
			const parameters = parseClipBriefParameters(request.parameters);
			return Object.freeze({
				artifactId: 'clip-brief',
				outputId: 'brief',
				kind: 'file',
				fileName: 'clip-previsualization.md',
				label: 'Local clip previsualization',
				bytes: encode(renderClipBrief(request, parameters))
			});
		}
		case AUDIO_BRIEF_RECIPE_ID: {
			const parameters = parseAudioBriefParameters(request.parameters);
			return Object.freeze({
				artifactId: 'audio-brief',
				outputId: 'brief',
				kind: 'file',
				fileName: 'audio-previsualization.md',
				label: 'Local audio previsualization',
				bytes: encode(renderAudioBrief(request, parameters))
			});
		}
	}
}

function renderStoryboardPlanningFrame(request: LocalPreviewRequest, parameters: ReturnType<typeof parseStoryboardFrameParameters>): string {
	const size = parameters.aspectRatio === '16:9'
		? { width: 1_600, height: 900 }
		: parameters.aspectRatio === '1:1'
			? { width: 1_200, height: 1_200 }
			: { width: 900, height: 1_600 };
	const margin = Math.round(Math.min(size.width, size.height) * 0.055);
	const promptText = request.inputs.map(input => input.source.text?.trim()).filter((value): value is string => Boolean(value)).join('\n\n');
	const lines = wrapText([request.prompt.trim(), promptText].filter(Boolean).join('. ') || 'No shot prompt supplied.', parameters.aspectRatio === '9:16' ? 38 : 62).slice(0, 8);
	const inputLines = request.inputs.slice(0, 6).map(input => `${input.slotId}: ${input.source.path}`);
	const fontSize = Math.max(20, Math.round(Math.min(size.width, size.height) * 0.026));
	const lineHeight = Math.round(fontSize * 1.45);
	const startY = margin + fontSize * 5;
	const inputStartY = Math.min(size.height - margin - (inputLines.length + 2) * lineHeight, startY + (lines.length + 3) * lineHeight);

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">
<rect width="${size.width}" height="${size.height}" fill="#16181c"/>
<rect x="${margin}" y="${margin}" width="${size.width - margin * 2}" height="${size.height - margin * 2}" rx="18" fill="#1d2025" stroke="#59606b" stroke-width="2"/>
<line x1="${size.width / 2}" y1="${margin}" x2="${size.width / 2}" y2="${size.height - margin}" stroke="#343942" stroke-width="1"/>
<line x1="${margin}" y1="${size.height / 2}" x2="${size.width - margin}" y2="${size.height / 2}" stroke="#343942" stroke-width="1"/>
<text x="${margin * 1.5}" y="${margin * 1.8}" fill="#f2f3f5" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${fontSize * 1.35}" font-weight="650">${escapeXml(parameters.shotLabel)}</text>
<text x="${margin * 1.5}" y="${margin * 2.75}" fill="#9aa4b2" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${fontSize * 0.78}" letter-spacing="1.5">LOCAL STORYBOARD PLANNING FRAME · ${parameters.aspectRatio}</text>
${lines.map((line, index) => `<text x="${margin * 1.5}" y="${startY + index * lineHeight}" fill="#d5d9df" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${fontSize}">${escapeXml(line)}</text>`).join('\n')}
<text x="${margin * 1.5}" y="${inputStartY}" fill="#9aa4b2" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${fontSize * 0.78}" font-weight="600">DIRECT INPUTS</text>
${(inputLines.length ? inputLines : ['None']).map((line, index) => `<text x="${margin * 1.5}" y="${inputStartY + (index + 1) * lineHeight}" fill="#aeb5c0" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${fontSize * 0.82}">${escapeXml(line)}</text>`).join('\n')}
<text x="${margin * 1.5}" y="${size.height - margin * 1.45}" fill="#7e8794" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="${fontSize * 0.72}">Planning asset only · no image model was called</text>
</svg>
`;
}

function renderClipBrief(request: LocalPreviewRequest, parameters: ReturnType<typeof parseClipBriefParameters>): string {
	return `# Clip previsualization: ${request.nodeTitle}

> This is a local text production brief. It is not generated video, and no video model was called.

## Run

- Node: \`${request.nodePath}\`
- Duration: ${parameters.durationSeconds} seconds
- Aspect ratio: ${parameters.aspectRatio}
- Audio mode: ${parameters.audioMode}

## Motion prompt

${request.prompt.trim() || '_No motion prompt supplied._'}

## Direct inputs

${renderInputs(request.inputs)}
`;
}

function renderAudioBrief(request: LocalPreviewRequest, parameters: ReturnType<typeof parseAudioBriefParameters>): string {
	return `# Audio previsualization: ${request.nodeTitle}

> This is a local text production brief. It is not generated audio, and no audio model was called.

## Run

- Node: \`${request.nodePath}\`
- Purpose: ${parameters.purpose}
- Duration: ${parameters.durationSeconds} seconds
- Voice: ${parameters.voice}

## Audio prompt

${request.prompt.trim() || '_No audio prompt supplied._'}

## Direct inputs

${renderInputs(request.inputs)}
`;
}

function renderInputs(inputs: readonly AIVideoRecipeInput[]): string {
	if (!inputs.length) {
		return '_No direct inputs connected._';
	}
	return inputs.map(input => {
		const heading = `- ${input.slotId}: \`${input.source.path}\` (${input.source.kind})`;
		const text = input.source.text?.trim();
		return text ? `${heading}\n\n  ${text.replace(/\n/g, '\n  ')}` : heading;
	}).join('\n');
}

function wrapText(value: string, maximum: number): string[] {
	const words = value.split(/\s+/).filter(Boolean);
	if (words.length === 1 && words[0].length > maximum) {
		return words[0].match(new RegExp(`.{1,${maximum}}`, 'gu')) ?? [words[0]];
	}
	const lines: string[] = [];
	let current = '';
	for (const word of words) {
		if (current && `${current} ${word}`.length > maximum) {
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
	// eslint-disable-next-line local/code-no-unexternalized-strings -- XML entities are protocol data.
	return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}

function encode(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}
