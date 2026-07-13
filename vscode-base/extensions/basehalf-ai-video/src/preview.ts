/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { AIProject, AIProjectCharacter, AIProjectScene, AIProjectShot, AIProjectStyle, topologicalWorkflowNodeIds } from './model';

export interface AIProjectPreviewInputs {
	readonly characters: readonly AIProjectCharacter[];
	readonly scenes: readonly AIProjectScene[];
	readonly styles: readonly AIProjectStyle[];
}

export function renderProjectTextPrevisualization(project: AIProject): string {
	const orderedShotIds = topologicalWorkflowNodeIds(project).filter(id => project.shots.some(shot => shot.id === id));
	const orderedShots = orderedShotIds.map(id => project.shots.find(shot => shot.id === id)!);
	const lines = [
		`# Text previsualization: ${project.title}`,
		'',
		'> This is a local textual stand-in for generated video. It preserves the intended sequence, prompts, sound, and provider handoff without claiming that media was generated.',
		'',
		'## Creative brief',
		'',
		`- Objective: ${project.brief.objective || 'Not set'}`,
		`- Audience: ${project.brief.audience || 'Not set'}`,
		`- Format: ${project.brief.format || 'Not set'}`,
		`- Frame: ${project.brief.aspectRatio || 'Not set'}`,
		`- Target duration: ${project.brief.targetDurationSeconds} seconds`,
		`- Language: ${project.brief.language || 'Not set'}`,
		'',
		'## Script',
		'',
		project.script.trim() || 'No script supplied.',
		'',
		'## Shot sequence',
		''
	];
	for (const [index, shot] of orderedShots.entries()) {
		lines.push(
			`### ${index + 1}. ${shot.title}`,
			'',
			`**On screen:** ${shot.storyboard || 'Not described.'}`,
			'',
			`**Camera:** ${shot.camera || 'Not specified.'}`,
			'',
			`**Motion:** ${shot.motion || 'Not specified.'}`,
			'',
			`**Duration:** ${shot.durationSeconds} seconds`,
			'',
			`**Dialogue:** ${shot.dialogue || 'None.'}`,
			'',
			`**Sound:** ${shot.audio || 'None specified.'}`,
			'',
			'**Execution prompt**',
			'',
			shot.prompt.trim() || 'No execution prompt supplied.',
			'',
			`**Avoid:** ${shot.negativePrompt || 'No negative guidance.'}`,
			'',
			`**Local state:** ${shot.status}; provider ${shot.videoProvider}`,
			''
		);
	}
	return `${lines.join('\n').trimEnd()}\n`;
}

export function renderShotTextPrevisualization(project: AIProject, shot: AIProjectShot, inputs: AIProjectPreviewInputs): string {
	const lines = [
		`# ${shot.title}`,
		'',
		'> Text previsualization for one executable shot.',
		'',
		'## Project frame',
		'',
		`- Aspect ratio: ${project.brief.aspectRatio}`,
		`- Language: ${project.brief.language}`,
		'',
		'## On screen',
		'',
		shot.storyboard || 'Not described.',
		'',
		'## Camera and motion',
		'',
		`- Camera: ${shot.camera || 'Not specified'}`,
		`- Motion: ${shot.motion || 'Not specified'}`,
		`- Duration: ${shot.durationSeconds} seconds`,
		`- First frame: ${shot.startFrame || 'Not supplied'}`,
		`- Last frame: ${shot.endFrame || 'Not supplied'}`,
		'',
		'## Continuity context',
		'',
		...renderContextList('Character', inputs.characters.map(item => `${item.name}: ${item.description}`)),
		...renderContextList('Scene', inputs.scenes.map(item => `${item.name}: ${item.description}${item.continuity ? ` Continuity: ${item.continuity}` : ''}`)),
		...renderContextList('Visual direction', inputs.styles.map(item => `${item.name}: ${item.prompt || item.description}`)),
		'',
		'## Dialogue and sound',
		'',
		`- Dialogue or narration: ${shot.dialogue || 'None'}`,
		`- Sound direction: ${shot.audio || 'None specified'}`,
		'',
		'## Execution prompt',
		'',
		shot.prompt || 'No execution prompt supplied.',
		'',
		`Avoid: ${shot.negativePrompt || 'No negative guidance.'}`,
		''
	];
	return `${lines.join('\n').trimEnd()}\n`;
}

function renderContextList(label: string, values: readonly string[]): string[] {
	return values.length ? values.map(value => `- ${label}: ${value}`) : [`- ${label}: none connected`];
}
