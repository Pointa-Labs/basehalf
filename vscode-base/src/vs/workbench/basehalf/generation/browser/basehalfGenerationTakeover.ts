/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../base/common/async.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { BASEHALF_GENERATION_HEARTBEAT_MS, BASEHALF_GENERATION_STALE_MS, failBaseHalfGenerationTask, heartbeatBaseHalfGenerationTask, IBaseHalfGenerationTask, isBaseHalfGenerationTaskEnded, isBaseHalfGenerationTaskStale } from '../common/basehalfGenerationInfo.js';
import { FollowedGeneration, BASEHALF_VIDEO_FIRST_POLL_DELAY, BASEHALF_VIDEO_TASK_TIME_LIMIT } from './basehalfGenerationFollowed.js';
import { closedWhileAnsweringMessage, orphanedSubmissionMessage, unaskedMessage } from './basehalfVideoGenerationMessages.js';
import type { BaseHalfVideoGenerationService } from './basehalfVideoGenerationService.js';

/** Windows that find a record stale look again at different moments, up to this much later. */
const TAKEOVER_JITTER = 5_000;

/** Up to {@link TAKEOVER_JITTER} milliseconds, different in every window. */
function takeoverJitter(): number {
	return Math.floor(Math.random() * TAKEOVER_JITTER);
}

/**
 * The generations this window follows because of the task records: one that another window started and left,
 * which this window takes over, and the heartbeat that says this window still follows its own.
 *
 * A part of the generation service: it keeps its own state, and reaches the service's as `service`.
 */
export class BaseHalfGenerationTakeover {
	private heartbeatRunning = false;
	private readonly takingOver = new Set<string>();
	/** The records as last seen, to tell the cards whose generation changed. */
	private seen = new Map<string, string>();

	constructor(private readonly service: BaseHalfVideoGenerationService) { }

	// --- continuing ----------------------------------------------------------------------------

	/**
	 * The records changed, in this window or another one: the cards whose
	 * generation changed hear it; a generation this window follows and that
	 * another window stopped or took over is let go; and a record that no
	 * window has said for 90 seconds it follows is taken over, settled, or
	 * removed (generation cards, "Continuing after a reload or a restart").
	 */
	onDidChangeRecords(): void {
		if (this.service.store.isDisposed) {
			return;
		}
		const tasks = this.service.taskStore.list();
		const next = new Map(tasks.map(task => [task.id, JSON.stringify(task)]));
		for (const [id, text] of next) {
			if (this.seen.get(id) !== text) {
				this.service.fireTask(id, JSON.parse(text) as IBaseHalfGenerationTask);
				const previous = this.seen.get(id);
				if (previous) {
					this.service.fireTask(id, JSON.parse(previous) as IBaseHalfGenerationTask);
				}
			}
		}
		for (const [id, text] of this.seen) {
			if (!next.has(id)) {
				this.service.fireTask(id, JSON.parse(text) as IBaseHalfGenerationTask);
			}
		}
		this.seen = next;
		for (const follow of [...this.service.followed.values()]) {
			if (!follow.recorded || follow.ended) {
				continue;
			}
			const task = this.service.taskStore.get(follow.taskId);
			if (!task || isBaseHalfGenerationTaskEnded(task) || task.follower !== this.service.follower) {
				if (task?.state === 'failed' && follow.receiving) {
					// Ended by another window while this one waits for the provider's answer: the answer decides.
					continue;
				}
				// Stopped, removed, or taken over elsewhere: this window lets it go.
				follow.stopped = !task || task.state === 'stopped' || follow.stopped;
				this.service.untrack(follow);
			} else {
				follow.paths = task.cards.map(card => card.path);
			}
		}
		for (const task of tasks) {
			if (!isBaseHalfGenerationTaskEnded(task) && !this.service.followed.has(task.id)) {
				this.considerTakeover(task);
			}
		}
	}

	private considerTakeover(task: IBaseHalfGenerationTask): void {
		if (this.takingOver.has(task.id)) {
			return;
		}
		const alive = Date.parse(task.aliveAt);
		const wait = (Number.isFinite(alive) ? alive : 0) + BASEHALF_GENERATION_STALE_MS - Date.now();
		if (wait > 0) {
			// Windows look again at different moments, so that they rarely try at once.
			this.checkLater(task.id, wait + 1_000 + takeoverJitter());
			return;
		}
		this.takingOver.add(task.id);
		void this.takeOver(task.id)
			.catch(error => this.service.logService.warn(`[BaseHalf generation] Could not continue ${task.id}: ${getErrorMessage(error)}`))
			.finally(() => this.takingOver.delete(task.id));
	}

	private async takeOver(taskId: string): Promise<void> {
		const task = this.service.taskStore.get(taskId);
		const folder = this.service.taskStore.folderOf(taskId);
		const now = Date.now();
		if (!task || !folder || isBaseHalfGenerationTaskEnded(task) || !isBaseHalfGenerationTaskStale(task, now) || this.service.followed.has(taskId)) {
			return;
		}
		const nowText = new Date(now).toISOString();
		// Unchanged since it was found stale: the same window, said alive at the same moment.
		const stale = (current: IBaseHalfGenerationTask) => !isBaseHalfGenerationTaskEnded(current) && isBaseHalfGenerationTaskStale(current, Date.now())
			&& current.follower === task.follower && current.aliveAt === task.aliveAt;
		const access = task.state === 'running' || task.state === 'landing' ? await this.service.accessOfTask(task) : undefined;
		const unasked = !access && task.state === 'running';
		if (unasked && now - Date.parse(task.startedAt) < BASEHALF_VIDEO_TASK_TIME_LIMIT) {
			// The provider is not set up for this task on this computer: it waits
			// for a window that can follow it.
			this.checkLater(taskId, BASEHALF_GENERATION_STALE_MS + takeoverJitter());
			return;
		}
		// Of the windows that find the record stale, the one that claims it first
		// takes it over; the others leave it to that window.
		if (!await this.service.taskStore.claimTakeover(taskId, task.aliveAt)) {
			this.checkLater(taskId, BASEHALF_GENERATION_STALE_MS + takeoverJitter());
			return;
		}
		switch (task.state) {
			case 'preparing':
				// Nothing was sent.
				await this.service.taskStore.remove(taskId, current => stale(current) && current.state === 'preparing');
				return;
			case 'submitting':
				// Never sent again: whether the provider has it is unknown.
				await this.service.taskStore.update(taskId, current => stale(current) && current.state === 'submitting'
					? failBaseHalfGenerationTask(current, current.answersAtOnce ? closedWhileAnsweringMessage() : orphanedSubmissionMessage(), nowText)
					: current);
				return;
		}
		if (unasked) {
			// Two hours after its start, and nobody could ask the provider: it ends, and says why.
			await this.service.taskStore.update(taskId, current => stale(current) ? failBaseHalfGenerationTask(current, unaskedMessage(), nowText) : current);
			return;
		}
		const taken = await this.service.taskStore.update(taskId, current => stale(current) ? heartbeatBaseHalfGenerationTask(current, this.service.follower, nowText) : current);
		if (taken?.follower !== this.service.follower || this.service.followed.has(taskId)) {
			return;
		}
		const follow = new FollowedGeneration(taskId, folder, taken.kind, Date.parse(taken.startedAt) || now, taken.cards.map(card => card.path));
		follow.recorded = true;
		follow.access = access;
		follow.model = taken.request?.model;
		follow.remoteId = taken.remoteId;
		follow.lastUsed = taken.request ? { provider: taken.request.provider, model: taken.request.model, mode: taken.request.mode, params: taken.request.params } : undefined;
		this.service.track(follow);
		this.startHeartbeat();
		if (taken.state === 'running') {
			this.service.setPhase(follow, 'generating');
			this.service.schedulePoll(follow, BASEHALF_VIDEO_FIRST_POLL_DELAY);
		} else {
			void this.service.landing.land(follow, undefined).catch(error => this.service.logService.warn(`[BaseHalf generation] Could not land ${taskId}: ${getErrorMessage(error)}`));
		}
	}

	private checkLater(taskId: string, delay: number): void {
		this.service.laterChecks.get(taskId)?.dispose();
		const timer = disposableTimeout(() => {
			timer.dispose();
			if (this.service.laterChecks.get(taskId) === timer) {
				this.service.laterChecks.delete(taskId);
			}
			const task = this.service.taskStore.get(taskId);
			if (task && !isBaseHalfGenerationTaskEnded(task) && !this.service.followed.has(taskId)) {
				this.considerTakeover(task);
			}
		}, delay);
		this.service.laterChecks.set(taskId, timer);
	}

	/** Every 30 seconds, while it follows generations, this window says it is alive in their records. */
	startHeartbeat(): void {
		if (!this.heartbeatRunning) {
			this.heartbeatRunning = true;
			this.service.heartbeat.cancelAndSet(() => { void this.beat(); }, BASEHALF_GENERATION_HEARTBEAT_MS);
		}
	}

	private async beat(): Promise<void> {
		const follows = [...this.service.followed.values()].filter(follow => follow.recorded && !follow.ended);
		if (!follows.length) {
			this.heartbeatRunning = false;
			this.service.heartbeat.cancel();
			return;
		}
		const now = new Date(Date.now()).toISOString();
		for (const follow of follows) {
			try {
				const task = await this.service.taskStore.update(follow.taskId, current => current.follower === this.service.follower && !isBaseHalfGenerationTaskEnded(current)
					? heartbeatBaseHalfGenerationTask(current, this.service.follower, now)
					: current);
				if (!task || task.follower !== this.service.follower || isBaseHalfGenerationTaskEnded(task)) {
					if (task?.state === 'failed' && follow.receiving) {
						// Ended by another window while this one waits for the provider's answer: the answer decides.
						continue;
					}
					follow.stopped = follow.stopped || !task || task.state === 'stopped';
					this.service.untrack(follow);
				}
			} catch (error) {
				this.service.logService.warn(`[BaseHalf generation] Could not say that ${follow.taskId} is followed: ${getErrorMessage(error)}`);
			}
		}
	}

	/**
	 * Whether this window still follows the generation: its record names this
	 * window and has not ended. A record the user stopped takes its partial
	 * downloads with it; one that another window follows or ended keeps them,
	 * since they belong to the task and not to a window.
	 */
	async stillFollowed(follow: FollowedGeneration): Promise<boolean> {
		const task = await this.service.taskStore.update(follow.taskId, current => current).catch(() => undefined);
		if (!task || isBaseHalfGenerationTaskEnded(task) || task.follower !== this.service.follower) {
			follow.stopped = follow.stopped || !task || task.state === 'stopped';
			if (task?.state === 'stopped') {
				await this.service.deletePartsOf(task);
			}
			this.service.untrack(follow);
			return false;
		}
		return true;
	}
}
