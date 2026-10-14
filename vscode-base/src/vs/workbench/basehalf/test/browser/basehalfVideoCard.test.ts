/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../base/browser/window.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../platform/hover/test/browser/nullHoverService.js';
import { renderBaseHalfVideoCard } from '../../browser/basehalfVideoCard.js';
import { IBaseHalfVideoGenerationProgress, IBaseHalfVideoGenerationService } from '../../common/basehalfVideoGeneration.js';
import { IBaseHalfVideoGenerationRecord, IBaseHalfVideoNodeFields } from '../../common/basehalfVideoNode.js';

const NODE = URI.file('/workspace/shots/Shot 1.bhnode');
const VIDEO = URI.file('/workspace/outputs/node-1/task-1.mp4');

class FakeGenerationService extends Disposable implements IBaseHalfVideoGenerationService {
	declare readonly _serviceBrand: undefined;
	private readonly changed = this._register(new Emitter<URI>());
	readonly onDidChangeProgress = this.changed.event;
	progress: IBaseHalfVideoGenerationProgress | undefined;
	readonly resumed: string[] = [];

	async generate(resource: URI): Promise<URI> {
		return resource;
	}
	async stop(): Promise<void> { }
	resume(resource: URI): void {
		this.resumed.push(resource.path);
	}
	isGenerating(): boolean {
		return this.progress !== undefined;
	}
	getProgress(): IBaseHalfVideoGenerationProgress | undefined {
		return this.progress;
	}
	report(progress: IBaseHalfVideoGenerationProgress): void {
		this.progress = progress;
		this.changed.fire(NODE);
	}
}

suite('BaseHalfVideoCard', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let container: HTMLElement;
	let hovers: Map<HTMLElement, () => string>;
	let hoverService: IHoverService;

	const request: IBaseHalfVideoGenerationRecord = {
		provider: 'ark',
		model: 'doubao-seedance-2-5-260628',
		prompt: 'Rain on the window.',
		inputs: [],
		mode: 'frames',
		ratio: '16:9',
		resolution: '720p',
		duration: 5,
		audio: true
	};
	const startedAt = '2026-10-15T08:00:00.000Z';
	/** A generation that started 42 seconds ago. */
	const running = (): IBaseHalfVideoNodeFields => ({
		task: { id: 'task-1', state: 'running', startedAt: new Date(Date.now() - 42_000).toISOString(), channel: 'ark-1', remoteId: 'cgt-1', request }
	});
	const withVideo: IBaseHalfVideoNodeFields = {
		result: {
			source: 'generated',
			artifact: { kind: 'video', path: 'outputs/node-1/task-1.mp4', size: 10 },
			generation: { taskId: 'task-1', remoteId: 'cgt-1', startedAt, completedAt: startedAt, request }
		}
	};

	setup(() => {
		container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		hovers = new Map();
		hoverService = {
			...NullHoverService,
			setupDelayedHover: (target, options) => {
				hovers.set(target, () => {
					const resolved = typeof options === 'function' ? options() : options;
					return typeof resolved.content === 'string' ? resolved.content : '';
				});
				return toDisposable(() => hovers.delete(target));
			}
		};
	});

	teardown(() => container.remove());

	function text(selector: string): string | undefined {
		return container.querySelector(selector)?.textContent ?? undefined;
	}

	test('shows the phase, the time since the start, and an exact bar while the node generates', () => {
		const generation = disposables.add(new FakeGenerationService());
		const fields = running();
		const card = disposables.add(renderBaseHalfVideoCard(container, { resource: NODE, title: 'Shot 1', fields, interactive: false }, { hoverService, generationService: generation }));
		const beforeProgress = {
			state: card.element.dataset.state,
			phase: text('.bh-video-card-phase'),
			elapsed: text('.bh-video-card-elapsed'),
			indeterminate: container.querySelector('.bh-video-card-progress')?.classList.contains('indeterminate')
		};
		generation.report({ phase: 'generating', startedAt: Date.parse(fields.task!.startedAt), fraction: 0.42 });
		const bar = container.querySelector<HTMLElement>('.bh-video-card-progress');
		assert.deepStrictEqual({
			beforeProgress,
			generating: {
				phase: text('.bh-video-card-phase'),
				now: bar?.getAttribute('aria-valuenow'),
				width: container.querySelector<HTMLElement>('.bh-video-card-progress-value')?.style.width,
				label: card.element.getAttribute('aria-label')
			}
		}, {
			beforeProgress: { state: 'generating', phase: 'Generating', elapsed: '0:42', indeterminate: true },
			generating: { phase: 'Generating', now: '42', width: '42%', label: 'Shot 1, Video, Generating, 42 percent' }
		});
	});

	test('shows the error in at most two lines with the whole text in its tooltip, and Stopped', () => {
		const error = 'The provider refused the request because the prompt broke its content rules. '.repeat(6).trim();
		const card = disposables.add(renderBaseHalfVideoCard(container, {
			resource: NODE,
			title: 'Shot 1',
			fields: { task: { ...running().task!, state: 'failed', endedAt: startedAt, error } },
			interactive: false
		}, { hoverService }));
		const face = container.querySelector<HTMLElement>('.bh-video-card-face')!;
		const failed = { state: card.element.dataset.state, message: text('.bh-video-card-message'), tooltip: hovers.get(face)?.() };
		card.update({ resource: NODE, title: 'Shot 1', fields: { task: { ...running().task!, state: 'stopped', endedAt: startedAt } }, interactive: false });
		assert.deepStrictEqual({ failed, stopped: { state: card.element.dataset.state, message: text('.bh-video-card-message'), tooltip: hovers.has(face) } }, {
			failed: { state: 'failed', message: error, tooltip: error },
			stopped: { state: 'stopped', message: 'Stopped', tooltip: false }
		});
	});

	test('shows the video with its controls only while selected, keeps the player across updates, pauses it when deselected, and says when the file is missing', () => {
		const card = disposables.add(renderBaseHalfVideoCard(container, { resource: NODE, title: 'Shot 1', fields: withVideo, video: VIDEO, videoExists: true, interactive: false }, { hoverService }));
		const player = container.querySelector<HTMLVideoElement>('video')!;
		const resting = { controls: player.controls, hidden: player.getAttribute('aria-hidden'), face: container.querySelector<HTMLElement>('.bh-video-card-face')?.hidden };
		card.update({ resource: NODE, title: 'Shot 1', fields: withVideo, video: VIDEO, videoExists: true, interactive: true });
		const selected = { same: container.querySelector('video') === player, controls: player.controls, label: player.getAttribute('aria-label'), time: card.currentTime };
		// The video plays; the node changes while the card stays selected, and then the card is deselected.
		let playing = true;
		let pauses = 0;
		Object.defineProperty(player, 'paused', { configurable: true, get: () => !playing });
		player.pause = () => {
			playing = false;
			pauses++;
		};
		card.update({ resource: NODE, title: 'Shot 1', fields: { ...withVideo, prompt: 'Rain at dusk' }, video: VIDEO, videoExists: true, interactive: true });
		const edited = { same: container.querySelector('video') === player, playing };
		card.update({ resource: NODE, title: 'Shot 1', fields: withVideo, video: VIDEO, videoExists: true, interactive: false });
		const deselected = { same: container.querySelector('video') === player, controls: player.controls, pauses };
		card.update({ resource: NODE, title: 'Shot 1', fields: withVideo, video: VIDEO, videoExists: false, interactive: true });
		const face = container.querySelector<HTMLElement>('.bh-video-card-face')!;
		assert.deepStrictEqual({
			resting,
			selected,
			edited,
			deselected,
			missing: { state: card.element.dataset.state, player: container.querySelector('video'), message: text('.bh-video-card-message'), tooltip: hovers.get(face)?.() }
		}, {
			resting: { controls: false, hidden: 'true', face: true },
			selected: { same: true, controls: true, label: 'Video player for Shot 1', time: 0 },
			edited: { same: true, playing: true },
			deselected: { same: true, controls: false, pauses: 1 },
			missing: { state: 'missing', player: null, message: 'The video file is missing', tooltip: 'outputs/node-1/task-1.mp4' }
		});
	});

	test('continues a generation that its node records and that no generation in this window follows', () => {
		const generation = disposables.add(new FakeGenerationService());
		disposables.add(renderBaseHalfVideoCard(container, { resource: NODE, title: 'Shot 1', fields: running(), interactive: false }, { hoverService, generationService: generation }));
		const followed = [...generation.resumed];
		generation.report({ phase: 'generating', startedAt: Date.now() });
		const card = disposables.add(renderBaseHalfVideoCard(container, { resource: NODE, title: 'Shot 1', fields: running(), interactive: false }, { hoverService, generationService: generation }));
		card.update({ resource: NODE, title: 'Shot 1', fields: { prompt: 'Rain' }, interactive: false });
		assert.deepStrictEqual({ followed, afterwards: generation.resumed }, { followed: [NODE.path], afterwards: [NODE.path] });
	});

	test('an empty node shows the glyph alone', () => {
		const card = disposables.add(renderBaseHalfVideoCard(container, { resource: NODE, title: 'Shot 1', fields: { prompt: 'Rain' }, interactive: false }, { hoverService }));
		assert.deepStrictEqual({
			state: card.element.dataset.state,
			glyph: !!container.querySelector('.bh-video-card-glyph svg'),
			text: container.querySelector('.bh-video-card-face')?.textContent,
			label: card.element.getAttribute('aria-label')
		}, { state: 'empty', glyph: true, text: '', label: 'Shot 1, Video' });
	});
});
