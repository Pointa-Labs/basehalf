/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { runWithFakedTimers } from '../../../../../base/test/common/timeTravelScheduler.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BaseHalfCanvasVideoSound, BaseHalfVideoSoundGraph, IBaseHalfVideoSoundContext, IBaseHalfVideoSoundLevel } from '../../browser/basehalfCanvasVideoSound.js';

/** The volume of a test's graph: what it was asked to do, with times in milliseconds of the graph's clock. */
class FakeLevel implements IBaseHalfVideoSoundLevel {
	value = 1;
	readonly steps: string[] = [];
	cancelScheduledValues(time: number): void {
		this.steps.push(`cancel ${Math.round(time * 1000)}`);
	}
	setValueAtTime(value: number, time: number): void {
		this.steps.push(`set ${value} at ${Math.round(time * 1000)}`);
	}
	linearRampToValueAtTime(value: number, time: number): void {
		this.steps.push(`ramp to ${value} at ${Math.round(time * 1000)}`);
	}
}

class FakeContext implements IBaseHalfVideoSoundContext {
	currentTime = 10;
	state = 'running';
	readonly level = new FakeLevel();
	readonly calls: string[] = [];
	async resume(): Promise<void> {
		this.state = 'running';
		this.calls.push('resume');
	}
	async suspend(): Promise<void> {
		this.state = 'suspended';
		this.calls.push('suspend');
	}
	route(): IDisposable & { readonly level: IBaseHalfVideoSoundLevel } {
		this.calls.push('route');
		return { level: this.level, dispose: () => this.calls.push('unroute') };
	}
}

suite('BaseHalfCanvasVideoSound', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	interface ISoundFixture {
		readonly sound: BaseHalfCanvasVideoSound;
		readonly video: HTMLVideoElement;
		readonly context: FakeContext;
		readonly graph: BaseHalfVideoSoundGraph;
		/** What the video was asked to do. */
		readonly media: string[];
		/** The video starts to play: the media pipeline says so. */
		readonly started: () => void;
	}

	/** A sound over a video of 10 s that stands at 2 s, and a graph of its own. */
	function createSound(): ISoundFixture {
		const video = mainWindow.document.createElement('video');
		let paused = true;
		let time = 2;
		Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
		Object.defineProperty(video, 'duration', { configurable: true, get: () => 10 });
		Object.defineProperty(video, 'currentTime', { configurable: true, get: () => time, set: (value: number) => { time = value; } });
		const media: string[] = [];
		video.play = () => {
			media.push(video.muted ? 'play muted' : 'play');
			paused = false;
			video.dispatchEvent(new Event('play'));
			return Promise.resolve();
		};
		video.pause = () => {
			media.push('pause');
			if (!paused) {
				paused = true;
				video.dispatchEvent(new Event('pause'));
			}
		};
		const context = new FakeContext();
		const graph = new BaseHalfVideoSoundGraph(context);
		const sound = store.add(new BaseHalfCanvasVideoSound(video, () => graph));
		return { sound, video, context, graph, media, started: () => video.dispatchEvent(new Event('playing')) };
	}

	test('a video whose sound was never on plays and pauses at once, outside the graph', () => {
		const { sound, video, context, media, started } = createSound();
		void sound.play(true);
		started();
		sound.pause();
		assert.deepStrictEqual({ media, muted: video.muted, calls: context.calls, steps: context.level.steps }, {
			media: ['play muted', 'pause'],
			muted: true,
			calls: [],
			steps: []
		});
	});

	test('with its sound on, the sound comes up from silence over 40 ms when the video plays, and goes down over the last 100 ms of the video', () => {
		const { sound, context, media, started } = createSound();
		void sound.play(false);
		const beforePlaying = [...context.level.steps];
		context.currentTime = 10.05;
		started();
		assert.deepStrictEqual({ media, calls: context.calls, beforePlaying, playing: context.level.steps.slice(beforePlaying.length) }, {
			media: ['play'],
			calls: ['route'],
			beforePlaying: ['cancel 10000', 'set 0 at 10000'],
			// 8 s are left: the sound is gone 20 ms before the end.
			playing: ['cancel 10050', 'set 0 at 10050', 'ramp to 1 at 10090', 'set 1 at 17930', 'ramp to 0 at 18030']
		});
	});

	test('a pause takes the sound down over 60 ms and then pauses; Play shows at once, and playing again during it goes on and comes up', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { sound, context, media, started } = createSound();
		void sound.play(false);
		started();
		context.level.steps.length = 0;
		context.currentTime = 11;
		sound.pause();
		const going = { pausing: sound.pausing, media: [...media], steps: [...context.level.steps] };
		await new Promise(resolve => setTimeout(resolve, 100));
		const paused = { pausing: sound.pausing, media: [...media] };

		void sound.play(false);
		started();
		context.level.steps.length = 0;
		context.currentTime = 12;
		sound.pause();
		context.level.value = 0.4;
		context.currentTime = 12.03;
		void sound.play(false);
		await new Promise(resolve => setTimeout(resolve, 100));
		assert.deepStrictEqual({ going, paused, again: { pausing: sound.pausing, media, steps: context.level.steps } }, {
			going: { pausing: true, media: ['play'], steps: ['cancel 11000', 'set 1 at 11000', 'ramp to 0 at 11060'] },
			paused: { pausing: false, media: ['play', 'pause'] },
			again: {
				pausing: false,
				media: ['play', 'pause', 'play'],
				steps: ['cancel 12000', 'set 1 at 12000', 'ramp to 0 at 12060', 'cancel 12030', 'set 0.4 at 12030', 'ramp to 1 at 12070', 'set 1 at 19910', 'ramp to 0 at 20010']
			}
		});
	}));

	test('the sound turned off goes down and then mutes the video, which plays on; turned on, it comes up from silence', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { sound, video, context, media, started } = createSound();
		void sound.play(false);
		started();
		context.level.steps.length = 0;
		context.currentTime = 11;
		sound.setMuted(true);
		const going = { muted: video.muted, steps: [...context.level.steps] };
		await new Promise(resolve => setTimeout(resolve, 100));
		const off = { muted: video.muted, media: [...media] };
		context.level.steps.length = 0;
		context.currentTime = 12;
		sound.setMuted(false);
		assert.deepStrictEqual({ going, off, on: { muted: video.muted, steps: context.level.steps } }, {
			going: { muted: false, steps: ['cancel 11000', 'set 1 at 11000', 'ramp to 0 at 11060'] },
			off: { muted: true, media: ['play'] },
			on: { muted: false, steps: ['cancel 12000', 'set 0 at 12000', 'ramp to 1 at 12040', 'set 1 at 19880', 'ramp to 0 at 19980'] }
		});
	}));

	test('a jump of the position dips the sound to silence and brings it up again after the jump', () => {
		const { sound, video, context, started } = createSound();
		void sound.play(false);
		started();
		context.level.steps.length = 0;
		context.currentTime = 11;
		video.currentTime = 6;
		video.dispatchEvent(new Event('seeking'));
		context.currentTime = 11.02;
		video.dispatchEvent(new Event('seeked'));
		assert.deepStrictEqual(context.level.steps, ['cancel 11000', 'set 1 at 11000', 'ramp to 0 at 11008', 'cancel 11020', 'set 0 at 11020', 'ramp to 1 at 11060', 'set 1 at 14900', 'ramp to 0 at 15000']);
	});

	test('the graph runs while a video with sound plays, and stops 5 s after the last one stopped', () => runWithFakedTimers({ useFakeTimers: true }, async () => {
		const { sound, video, context, graph, started } = createSound();
		context.state = 'suspended';
		void sound.play(false);
		started();
		const playing = [...context.calls];
		sound.pause();
		await new Promise(resolve => setTimeout(resolve, 100));
		await new Promise(resolve => setTimeout(resolve, 3000));
		const shortly = [...context.calls];
		await new Promise(resolve => setTimeout(resolve, 2500));
		const idle = [...context.calls];
		// The graph pulls a video routed through it: muted, it still plays only while the graph runs.
		void sound.play(true);
		assert.deepStrictEqual({ playing, shortly, idle, again: context.calls, muted: video.muted, graphRuns: context.state }, {
			playing: ['route', 'resume'],
			shortly: ['route', 'resume'],
			idle: ['route', 'resume', 'suspend'],
			again: ['route', 'resume', 'suspend', 'resume'],
			muted: true,
			graphRuns: 'running'
		});
		graph.didStop(video);
	}));
});
