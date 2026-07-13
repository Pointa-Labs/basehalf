/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { AIProject, AIProjectExecutableNode, nodePrompt, orderedSequenceVideoNodes, selectedOutputPaths, selectedRun } from './model';
import type { AIMediaWorkflowInputs } from './workflow';

export function renderProjectTextPrevisualization(project: AIProject): string {
	const sequence = orderedSequenceVideoNodes(project);
	const lines = [
		`# Production sequence: ${project.title}`,
		'',
		'> This local document previews clip order and generation handoffs. It does not claim that a final edited movie was rendered.',
		'',
		`- Workflow nodes: ${project.nodes.length}`,
		`- Shot groups: ${project.groups.length}`,
		`- Ordered clips: ${sequence.length}`,
		'',
		'## Clip order',
		''
	];
	for (const [index, node] of sequence.entries()) {
		const group = node.groupId ? project.groups.find(candidate => candidate.id === node.groupId) : undefined;
		const run = selectedRun(node);
		lines.push(
			`### ${index + 1}. ${group?.title ?? node.title}`,
			'',
			`- Video node: ${node.title}`,
			`- Duration: ${node.durationSeconds} seconds`,
			`- Frame: ${node.aspectRatio}`,
			`- Audio: ${node.audioMode}`,
			`- Provider: ${node.provider}; model ${node.model}`,
			`- Selected result: ${run?.id ?? 'none'}`,
			`- Local outputs: ${selectedOutputPaths(node).join(', ') || 'none'}`,
			'',
			'**Prompt**',
			'',
			nodePrompt(project, node.id) || 'No video prompt supplied.',
			''
		);
	}
	return `${lines.join('\n').trimEnd()}\n`;
}

export function renderMediaNodeTextPrevisualization(project: AIProject, node: AIProjectExecutableNode, inputs: AIMediaWorkflowInputs): string {
	const lines = [
		`# ${node.title}`,
		'',
		`> Local ${node.kind} previsualization for one workflow node.`,
		'',
		'## Prompt',
		'',
		nodePrompt(project, node.id) || 'No prompt supplied.',
		'',
		`Avoid: ${node.negativePrompt || 'No negative guidance.'}`,
		'',
		'## Connected text',
		'',
		...renderList(inputs.text.map(item => `${item.title}: ${item.content}`)),
		'',
		'## Connected media',
		'',
		`- Images: ${inputs.image.join(', ') || 'none'}`,
		`- Videos: ${inputs.video.join(', ') || 'none'}`,
		`- Audio: ${inputs.audio.join(', ') || 'none'}`,
		'',
		'## Model handoff',
		'',
		`- Provider: ${node.provider}`,
		`- Model: ${node.model}`
	];
	if (node.kind === 'video') {
		lines.push(`- Duration: ${node.durationSeconds} seconds`, `- Frame: ${node.aspectRatio}`, `- Audio mode: ${node.audioMode}`);
	} else if (node.kind === 'image') {
		lines.push(`- Frame: ${node.aspectRatio}`, `- Requested results: ${node.count}`);
	} else {
		lines.push(`- Duration: ${node.durationSeconds} seconds`, `- Voice: ${node.voice}`);
	}
	return `${lines.join('\n').trimEnd()}\n`;
}

function renderList(values: readonly string[]): string[] {
	return values.length ? values.map(value => `- ${value}`) : ['- none'];
}
