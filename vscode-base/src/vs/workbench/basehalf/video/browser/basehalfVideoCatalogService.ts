/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from '../../../../base/common/async.js';
import { getErrorMessage } from '../../../../base/common/errors.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import {
	BASEHALF_VIDEO_PROVIDER_COMMANDS,
	BaseHalfVideoCatalogState,
	IBaseHalfVideoCatalog,
	IBaseHalfVideoCheckRequest,
	IBaseHalfVideoCheckResult,
	parseBaseHalfVideoCatalog,
	parseBaseHalfVideoCheckResult
} from '../common/basehalfVideoCatalog.js';
import { IBaseHalfVideoCatalogService } from '../common/basehalfVideoGeneration.js';

/** How long a failed request for the catalog waits before it is tried once more. */
export const BASEHALF_VIDEO_CATALOG_RETRY_DELAY = 1_000;
/** How long `whenReady` waits by default while the catalog loads. */
const READY_TIMEOUT = 30_000;

/**
 * The model catalog of this window (D59, video providers, "The catalog"). It
 * asks AI Video through the command service the first time anyone needs it,
 * keeps the answer for the life of the window, and tries a failed request
 * once more a second later; a later {@link load} asks again after a failure.
 */
export class BaseHalfVideoCatalogService extends Disposable implements IBaseHalfVideoCatalogService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private current: BaseHalfVideoCatalogState = { kind: 'loading' };
	private request: Promise<void> | undefined;
	private disposed = false;

	constructor(
		private readonly retryDelay: number,
		@ICommandService private readonly commandService: ICommandService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
	}

	get state(): BaseHalfVideoCatalogState {
		if (!this.request && this.current.kind === 'loading') {
			this.load();
		}
		return this.current;
	}

	load(): void {
		if (this.request || this.current.kind === 'ready' || this.disposed) {
			return;
		}
		if (this.current.kind === 'failed') {
			this.setState({ kind: 'loading' });
		}
		this.request = this.fetch().finally(() => this.request = undefined);
	}

	async whenReady(timeoutMs = READY_TIMEOUT): Promise<IBaseHalfVideoCatalog> {
		this.load();
		if (this.current.kind === 'loading' && !this.disposed) {
			const changed = Event.toPromise(Event.filter(this.onDidChange, () => this.current.kind !== 'loading'));
			const timer = timeout(timeoutMs);
			try {
				await Promise.race([changed, timer]);
			} finally {
				changed.cancel();
				timer.cancel();
			}
		}
		const state = this.current;
		if (state.kind === 'ready') {
			return state.catalog;
		}
		throw new Error(state.kind === 'failed'
			? state.message
			: localize('basehalf.video.catalog.stillLoading', "AI Video did not answer with the video models in time."));
	}

	async check(request: IBaseHalfVideoCheckRequest): Promise<IBaseHalfVideoCheckResult | undefined> {
		try {
			const answer = await this.commandService.executeCommand(BASEHALF_VIDEO_PROVIDER_COMMANDS.check, request);
			return isRecord(answer) && answer.ok === true ? parseBaseHalfVideoCheckResult(answer.value) : undefined;
		} catch (error) {
			this.logService.trace(`[BaseHalf video] check did not answer: ${getErrorMessage(error)}`);
			return undefined;
		}
	}

	private async fetch(): Promise<void> {
		let message = '';
		for (let attempt = 1; attempt <= 2 && !this.disposed; attempt++) {
			try {
				let answer: unknown;
				try {
					answer = await this.commandService.executeCommand(BASEHALF_VIDEO_PROVIDER_COMMANDS.catalog);
				} catch (error) {
					throw new Error(this.unansweredMessage(error));
				}
				const { catalog, problems } = parseBaseHalfVideoCatalog(this.unwrap(answer));
				for (const problem of problems) {
					this.logService.warn(`[BaseHalf video] The model catalog leaves out what it cannot read: ${problem}`);
				}
				if (!this.disposed) {
					this.setState({ kind: 'ready', catalog });
				}
				return;
			} catch (error) {
				message = plainMessage(error);
				this.logService.warn(`[BaseHalf video] The model catalog could not be loaded (attempt ${attempt}): ${message}`);
			}
			if (attempt === 1) {
				await timeout(this.retryDelay);
			}
		}
		if (!this.disposed) {
			this.setState({ kind: 'failed', message });
		}
	}

	/** The catalog out of AI Video's answer: `{ ok: true, value }`, or an error with its message. */
	private unwrap(answer: unknown): unknown {
		if (isRecord(answer) && answer.ok === true) {
			return answer.value;
		}
		if (isRecord(answer) && answer.ok === false && isRecord(answer.error) && typeof answer.error.message === 'string' && answer.error.message.trim()) {
			throw new Error(answer.error.message.trim());
		}
		throw new Error(localize('basehalf.video.catalog.unreadable', "AI Video answered in a form BaseHalf cannot read."));
	}

	/** Why the command did not answer: AI Video never registered it, or it failed while it ran. */
	private unansweredMessage(error: unknown): string {
		if (!CommandsRegistry.getCommand(BASEHALF_VIDEO_PROVIDER_COMMANDS.catalog)) {
			return localize('basehalf.video.catalog.notRunning', "AI Video, which provides the video models, is not running.");
		}
		return plainMessage(error) || localize('basehalf.video.catalog.unknownFailure', "AI Video did not answer.");
	}

	private setState(state: BaseHalfVideoCatalogState): void {
		this.current = state;
		this._onDidChange.fire();
	}
}

/** An error as plain text of at most 1,000 characters, on one line. */
function plainMessage(error: unknown): string {
	const text = getErrorMessage(error).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
	return text.length > 1000 ? `${text.slice(0, 999)}…` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

registerSingleton(IBaseHalfVideoCatalogService, new SyncDescriptor(BaseHalfVideoCatalogService, [BASEHALF_VIDEO_CATALOG_RETRY_DELAY], true));
