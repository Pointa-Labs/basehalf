/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { renderBaseHalfGenerationCardFace } from '../../browser/basehalfVideoCard.js';
import { createBaseHalfGenerationTask, failBaseHalfGenerationTask, IBaseHalfGenerationTask, stopBaseHalfGenerationTask } from '../../common/basehalfGenerationInfo.js';
import { IBaseHalfVideoPlannedMedia } from '../../common/basehalfVideoCatalog.js';
import { IBaseHalfGenerationTaskStore, IBaseHalfVideoGenerationProgress, IBaseHalfVideoGenerationService } from '../../common/basehalfVideoGeneration.js';

const CARD = URI.file('/workspace/shots/shot.mp4');
const PATH = 'shots/shot.mp4';

class FakeGenerationService extends Disposable implements IBaseHalfVideoGenerationService {
	declare readonly _serviceBrand: undefined;
	private readonly changed = this._register(new Emitter<URI>());
	readonly onDidChangeProgress = this.changed.event;
	progress: IBaseHalfVideoGenerationProgress | undefined;

	async generate(resource: URI): Promise<readonly URI[]> {
		return [resource];
	}
	async stop(): Promise<void> { }
	async releaseCard(): Promise<void> { }
	prepareInputMedia(): Promise<IBaseHalfVideoPlannedMedia> {
		throw new Error('Not used by the card.');
	}
	isGenerating(): boolean {
		return this.progress !== undefined;
	}
	getProgress(): IBaseHalfVideoGenerationProgress | undefined {
		return this.progress;
	}
	report(progress: IBaseHalfVideoGenerationProgress): void {
		this.progress = progress;
		this.changed.fire(CARD);
	}
}

/** The task records of a test: one record that names the card, or none. */
class FakeTaskStore extends Disposable {
	private readonly changed = this._register(new Emitter<void>());
	task: IBaseHalfGenerationTask | undefined;

	asService(): IBaseHalfGenerationTaskStore {
		const service: Partial<IBaseHalfGenerationTaskStore> = {
			onDidChange: this.changed.event,
			forCard: () => this.task
		};
		return service as IBaseHalfGenerationTaskStore;
	}

	write(task: IBaseHalfGenerationTask | undefined): void {
		this.task = task;
		this.changed.fire();
	}
}

suite('BaseHalfGenerationCardFace', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let container: HTMLElement;
	let hovers: Map<HTMLElement, () => string>;
	let hoverService: IHoverService;

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

	/** A generation of the card that started 42 seconds ago. */
	function running(): IBaseHalfGenerationTask {
		return { ...createBaseHalfGenerationTask({ id: '20261022T080000-1a2b3c4d', kind: 'video', cards: [PATH], follower: 'window-1', now: new Date(Date.now() - 42_000).toISOString() }), state: 'running' };
	}

	function render(generation: FakeGenerationService, tasks: FakeTaskStore, input: { readonly kind?: 'image' | 'video'; readonly hasFile?: boolean; readonly name?: string } = {}) {
		return disposables.add(renderBaseHalfGenerationCardFace(container, {
			resource: CARD,
			path: PATH,
			name: input.name ?? 'shot.mp4',
			kind: input.kind ?? 'video',
			hasFile: input.hasFile ?? false
		}, { hoverService, generationService: generation, taskStore: tasks.asService() }));
	}

	test('a draft shows the glyph of its kind alone, and says it is a draft', () => {
		const generation = disposables.add(new FakeGenerationService());
		const tasks = disposables.add(new FakeTaskStore());
		const video = render(generation, tasks);
		const videoFace = { state: video.element.dataset.state, kind: video.element.dataset.kind, glyph: !!video.element.querySelector('.bh-generation-card-glyph svg'), text: video.element.textContent, label: video.element.getAttribute('aria-label') };
		video.dispose();
		const image = render(generation, tasks, { kind: 'image', name: 'image.png' });
		assert.deepStrictEqual({
			videoFace,
			imageFace: { state: image.element.dataset.state, kind: image.element.dataset.kind, label: image.element.getAttribute('aria-label') }
		}, {
			videoFace: { state: 'draft', kind: 'video', glyph: true, text: '', label: 'shot.mp4, Video, draft' },
			imageFace: { state: 'draft', kind: 'image', label: 'image.png, Image, draft' }
		});
	});

	test('follows the task record: the phase, the time since the start, and a bar that is exact when the provider reports progress', () => {
		const generation = disposables.add(new FakeGenerationService());
		const tasks = disposables.add(new FakeTaskStore());
		const face = render(generation, tasks);
		tasks.write(running());
		const beforeProgress = {
			state: face.element.dataset.state,
			phase: text('.bh-generation-card-phase'),
			elapsed: text('.bh-generation-card-elapsed'),
			indeterminate: container.querySelector('.bh-generation-card-progress')?.classList.contains('indeterminate')
		};
		generation.report({ phase: 'generating', startedAt: Date.parse(tasks.task!.startedAt), fraction: 0.42 });
		const bar = container.querySelector<HTMLElement>('.bh-generation-card-progress');
		const exact = {
			now: bar?.getAttribute('aria-valuenow'),
			width: container.querySelector<HTMLElement>('.bh-generation-card-progress-value')?.style.width,
			label: face.element.getAttribute('aria-label')
		};
		generation.progress = undefined;
		tasks.write(undefined);
		assert.deepStrictEqual({ beforeProgress, exact, ended: face.element.dataset.state }, {
			beforeProgress: { state: 'generating', phase: 'Generating', elapsed: '0:42', indeterminate: true },
			exact: { now: '42', width: '42%', label: 'shot.mp4, Video, Generating, 42 percent' },
			ended: 'draft'
		});
	});

	test('shows the error in at most two lines with the whole text in its tooltip, and Stopped', () => {
		const generation = disposables.add(new FakeGenerationService());
		const tasks = disposables.add(new FakeTaskStore());
		const error = 'The provider refused the request because the prompt broke its content rules. '.repeat(6).trim();
		const face = render(generation, tasks);
		tasks.write(failBaseHalfGenerationTask(running(), error, new Date().toISOString()));
		const failed = { state: face.element.dataset.state, message: text('.bh-generation-card-message'), tooltip: hovers.get(face.element)?.() };
		tasks.write(stopBaseHalfGenerationTask(running(), new Date().toISOString()));
		assert.deepStrictEqual({ failed, stopped: { state: face.element.dataset.state, message: text('.bh-generation-card-message'), tooltip: hovers.has(face.element) } }, {
			failed: { state: 'failed', message: `${error.slice(0, 299)}…`, tooltip: error },
			stopped: { state: 'stopped', message: 'Stopped', tooltip: false }
		});
	});

	test('a file that cannot be shown says so, with its path in the tooltip', () => {
		const generation = disposables.add(new FakeGenerationService());
		const tasks = disposables.add(new FakeTaskStore());
		const video = render(generation, tasks, { hasFile: true });
		const videoFace = { state: video.element.dataset.state, message: text('.bh-generation-card-message'), tooltip: hovers.get(video.element)?.() };
		video.dispose();
		const image = render(generation, tasks, { kind: 'image', hasFile: true, name: 'still.png' });
		assert.deepStrictEqual({ videoFace, image: text('.bh-generation-card-message') }, {
			videoFace: { state: 'unshowable', message: 'This video cannot be played here', tooltip: PATH },
			image: 'This image cannot be shown here'
		});
		image.dispose();
	});
});
