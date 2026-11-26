/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/**
 * DashScope's speech call and the list of the account's voices, as the local
 * test provider (`mockVideoProvider.ts`) answers them under `/alibaba` for the
 * speech models of the Alibaba module (docs/specs/providers/alibaba.md,
 * "Speech models"), with `Authorization: Bearer <key>`:
 *
 * - `POST /api/v1/services/audio/tts/SpeechSynthesizer` checks the request as
 *   DashScope does (a model it has, a text, a voice of that model, MP3) and
 *   answers at once with the address of an MP3, which it serves itself under
 *   `/alibaba/files/` without the key, as the OSS host serves a signed link.
 *   A voice the model does not have is refused with DashScope's Engine error
 *   411.
 * - `POST /api/v1/services/audio/tts/customization` with `list_voice` lists
 *   the account's voices: one of 3.1 TTS Flash that is ready, and one still
 *   under review.
 *
 * It never talks to Alibaba Cloud.
 */

import { randomBytes } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { QWEN_AUDIO_30_FLASH_VOICES, QWEN_AUDIO_30_PLUS_VOICES, QWEN_AUDIO_31_FLASH_VOICES, QWEN_AUDIO_31_PLUS_VOICES } from '../../node/alibabaVoices.js';
import type { MockVideoProviderFailure, MockVideoProviderRequest } from './mockVideoProvider.js';

/** What the local test provider lends its Alibaba part: its key, its address, its failure, and how it records, answers, and makes sounds. */
export interface MockAlibabaContext {
	readonly key: string;
	/** `http://127.0.0.1:<port>` */
	origin(): string;
	fail(): MockVideoProviderFailure;
	record(request: MockVideoProviderRequest): void;
	/** An MP3 of a few seconds; its own bytes, named by `tag`, when the files are unique. */
	sound(tag: string): Buffer;
	/** Answers after the time a task takes. */
	later(answer: () => void): void;
	json(response: ServerResponse, status: number, value: unknown): void;
	sendSound(response: ServerResponse, sound: Buffer): void;
}

/** The voices of the account that the local Alibaba lists (`list_voice`): a ready voice of 3.1 TTS Flash, and one still under review. */
export const MOCK_ALIBABA_ACCOUNT_VOICES: readonly Readonly<Record<string, string>>[] = Object.freeze([
	{ voice_id: 'qwen-audio-3.1-tts-flash-coast-a1b2c3d4', gmt_create: '2026-11-11 09:30:00', gmt_modified: '2026-11-11 09:30:00', status: 'OK' },
	{ voice_id: 'qwen-audio-3.1-tts-flash-pending-e5f6a7b8', gmt_create: '2026-11-11 10:00:00', gmt_modified: '2026-11-11 10:00:00', status: 'DEPLOYING' }
]);

/** The voices each model speaks in: those of Alibaba's list, and the account's ready voice of its model. */
const MODEL_VOICES: ReadonlyMap<string, ReadonlySet<string>> = new Map(([
	['qwen-audio-3.1-tts-plus', QWEN_AUDIO_31_PLUS_VOICES],
	['qwen-audio-3.1-tts-flash', QWEN_AUDIO_31_FLASH_VOICES],
	['qwen-audio-3.0-tts-plus', QWEN_AUDIO_30_PLUS_VOICES],
	['qwen-audio-3.0-tts-flash', QWEN_AUDIO_30_FLASH_VOICES]
] as const).map(([model, voices]) => [model, new Set([
	...voices.map(voice => voice.value),
	...MOCK_ALIBABA_ACCOUNT_VOICES.filter(voice => voice.status === 'OK' && voice.voice_id.startsWith(`${model}-`)).map(voice => voice.voice_id)
])]));

const SPEECH_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer';
const VOICES_PATH = '/api/v1/services/audio/tts/customization';

/** The handler of the paths under `/alibaba`, which `path` follows. */
export function createMockAlibaba(context: MockAlibabaContext): (request: IncomingMessage, response: ServerResponse, path: string, body: Buffer) => void {
	/** The sounds answered, by their file names under `/alibaba/files/`. */
	const sounds = new Map<string, Buffer>();

	const requestId = () => randomBytes(16).toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
	const refuse = (response: ServerResponse, status: number, code: string, message: string) => context.json(response, status, { request_id: requestId(), code, message });

	function speak(request: IncomingMessage, response: ServerResponse, payload: Record<string, unknown> | undefined): void {
		const model = typeof payload?.model === 'string' ? payload.model : undefined;
		const voices = model === undefined ? undefined : MODEL_VOICES.get(model);
		if (!voices) {
			refuse(response, 400, 'InvalidParameter', 'Model not exist.');
			return;
		}
		const input = isRecord(payload?.input) ? payload.input : {};
		const text = typeof input.text === 'string' ? input.text : '';
		const voice = typeof input.voice === 'string' ? input.voice : undefined;
		context.record({ kind: 'speech', taskId: undefined, model, prompt: text, ...(voice !== undefined ? { voice } : {}), parts: [], body: payload });
		if (!text.trim()) {
			refuse(response, 400, 'InvalidParameter', 'Please ensure input text is valid.');
			return;
		}
		if (voice === undefined || !voices.has(voice)) {
			refuse(response, 400, 'InvalidParameter', '[cosyvoice:]Engine error [411]: TTS speak operation failed');
			return;
		}
		if (input.format !== 'mp3') {
			refuse(response, 400, 'InvalidParameter', 'The local test provider makes MP3 alone.');
			return;
		}
		const marker = (name: string) => text.includes(`[mock:${name}]`);
		const fail = context.fail();
		if (fail === 'reject' || marker('reject')) {
			refuse(response, 400, 'DataInspectionFailed', 'Input data may contain inappropriate content.');
			return;
		}
		if (fail === 'drop' || marker('drop')) {
			// The sound was made, but the answer never arrives.
			request.socket.destroy();
			return;
		}
		const id = requestId();
		const name = `${id}.mp3`;
		sounds.set(name, fail === 'task' || marker('fail') ? Buffer.from('<html><body>The sound could not be made.</body></html>', 'utf8') : context.sound(`speech-${id}`));
		const answer = () => context.json(response, 200, {
			output: { audio: { data: '', expires_at: Math.floor(Date.now() / 1000) + 86_400, id: `audio_${id}`, url: `${context.origin()}/alibaba/files/${name}?Expires=1794493539&OSSAccessKeyId=LTAI-local&Signature=bG9jYWw%3D` }, finish_reason: 'stop' },
			usage: { characters: [...text].length, input_tokens: 10, output_tokens: 40, total_tokens: 50 },
			request_id: id
		});
		if (fail === 'slow' || marker('slow')) {
			context.later(answer);
			return;
		}
		answer();
	}

	function listVoices(response: ServerResponse, payload: Record<string, unknown> | undefined): void {
		const input = isRecord(payload?.input) ? payload.input : {};
		if (payload?.model !== 'voice-enrollment' || input.action !== 'list_voice') {
			refuse(response, 400, 'InvalidParameter', 'The local test provider lists voices with voice-enrollment and list_voice alone.');
			return;
		}
		const index = typeof input.page_index === 'number' ? input.page_index : 0;
		const size = typeof input.page_size === 'number' ? input.page_size : 10;
		context.json(response, 200, {
			output: { page_index: index, page_size: size, total_count: MOCK_ALIBABA_ACCOUNT_VOICES.length, voice_list: MOCK_ALIBABA_ACCOUNT_VOICES.slice(index * size, (index + 1) * size) },
			usage: { count: 1 },
			request_id: requestId()
		});
	}

	return (request, response, path, body) => {
		if (path.startsWith('/files/') && request.method === 'GET') {
			// A sound's address on the OSS host: no key, like a signed link.
			const sound = sounds.get(decodeURIComponent(path.slice('/files/'.length)));
			if (!sound) {
				context.json(response, 404, { Code: 'NoSuchKey', Message: 'The specified key does not exist.' });
				return;
			}
			context.sendSound(response, sound);
			return;
		}
		if (context.fail() === 'key' || request.headers.authorization !== `Bearer ${context.key}`) {
			refuse(response, 401, 'InvalidApiKey', 'Invalid API-key provided.');
			return;
		}
		const payload = parseJson(body);
		if (request.method === 'POST' && path === SPEECH_PATH) {
			speak(request, response, payload);
			return;
		}
		if (request.method === 'POST' && path === VOICES_PATH) {
			listVoices(response, payload);
			return;
		}
		refuse(response, 404, 'NotFound', 'Not found!');
	};
}

function parseJson(body: Buffer): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(body.toString('utf8'));
		return isRecord(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
