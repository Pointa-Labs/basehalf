/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

export type AIProjectShotStatus = 'draft' | 'prepared' | 'running' | 'complete' | 'error';

export interface AIProjectCharacter {
	id: string;
	name: string;
	description: string;
}

export interface AIProjectScene {
	id: string;
	name: string;
	description: string;
}

export interface AIProjectShot {
	id: string;
	title: string;
	sceneId: string;
	prompt: string;
	dialogue: string;
	videoProvider: string;
	voiceProvider: string;
	status: AIProjectShotStatus;
	outputs: string[];
	error?: string;
}

export interface AIProject {
	version: 1;
	title: string;
	script: string;
	characters: AIProjectCharacter[];
	scenes: AIProjectScene[];
	shots: AIProjectShot[];
}

export function createAIProject(title = 'Untitled AI Video'): AIProject {
	const sceneId = createId('scene');
	return {
		version: 1,
		title,
		script: '',
		characters: [],
		scenes: [{ id: sceneId, name: 'Scene 1', description: '' }],
		shots: [{
			id: createId('shot'),
			title: 'Shot 1',
			sceneId,
			prompt: '',
			dialogue: '',
			videoProvider: 'prompt-package',
			voiceProvider: 'none',
			status: 'draft',
			outputs: []
		}]
	};
}

export function parseAIProject(value: string): AIProject {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new Error(`Invalid AI Video project JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!isRecord(parsed) || parsed.version !== 1) {
		throw new Error('Unsupported AI Video project. Expected version 1.');
	}
	return {
		version: 1,
		title: stringValue(parsed.title, 'Untitled AI Video'),
		script: stringValue(parsed.script),
		characters: arrayValue(parsed.characters).map((entry, index) => ({
			id: recordString(entry, 'id', createId('character')),
			name: recordString(entry, 'name', `Character ${index + 1}`),
			description: recordString(entry, 'description')
		})),
		scenes: arrayValue(parsed.scenes).map((entry, index) => ({
			id: recordString(entry, 'id', createId('scene')),
			name: recordString(entry, 'name', `Scene ${index + 1}`),
			description: recordString(entry, 'description')
		})),
		shots: arrayValue(parsed.shots).map((entry, index) => ({
			id: recordString(entry, 'id', createId('shot')),
			title: recordString(entry, 'title', `Shot ${index + 1}`),
			sceneId: recordString(entry, 'sceneId'),
			prompt: recordString(entry, 'prompt'),
			dialogue: recordString(entry, 'dialogue'),
			videoProvider: recordString(entry, 'videoProvider', 'prompt-package'),
			voiceProvider: recordString(entry, 'voiceProvider', 'none'),
			status: shotStatus(recordString(entry, 'status', 'draft')),
			outputs: arrayValue(isRecord(entry) ? entry.outputs : undefined).filter((output): output is string => typeof output === 'string'),
			error: optionalRecordString(entry, 'error')
		}))
	};
}

export function serializeAIProject(project: AIProject): Uint8Array {
	return new TextEncoder().encode(`${JSON.stringify(project, null, 2)}\n`);
}

export function createId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayValue(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function recordString(value: unknown, key: string, fallback = ''): string {
	return isRecord(value) ? stringValue(value[key], fallback) : fallback;
}

function optionalRecordString(value: unknown, key: string): string | undefined {
	const result = recordString(value, key);
	return result || undefined;
}

function shotStatus(value: string): AIProjectShotStatus {
	return value === 'prepared' || value === 'running' || value === 'complete' || value === 'error' ? value : 'draft';
}
