/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { localize } from '../../../nls.js';
import { IBaseHalfProviderService } from './basehalfProviders.js';
import type { CancelResult, Catalog, CheckPayload, CheckResult, DownloadRequest, DownloadResult, PlaceRequest, PlaceResult, PollState, ProviderResponse, SubmitPayload, SubmitResult, TaskRef, VoicePreviewRequest, VoicePreviewResult, VoicesRequest, VoicesResult } from './basehalfProviderTypes.js';

/**
 * A window's connection to the provider service of the shared process (D75;
 * providers, "Requests"). The application does not start a shared process
 * that stopped again, and a call to it would wait for an answer that never
 * comes. So once the window learns that it stopped, at once or when it opens
 * later, every call that waits for it fails, and so does every later call: as
 * a call that did not reach the service.
 */
export class BaseHalfProviderConnection extends Disposable implements IBaseHalfProviderService {
	declare readonly _serviceBrand: undefined;

	private stopped: Error | undefined;
	private readonly waiting = new Set<(error: Error) => void>();

	constructor(
		private readonly service: Omit<IBaseHalfProviderService, '_serviceBrand'>,
		onDidStop: Event<void>,
		hadStopped: Promise<boolean>
	) {
		super();
		this._register(onDidStop(() => this.stop()));
		hadStopped.then(stopped => {
			if (stopped) {
				this.stop();
			}
		}, () => undefined);
	}

	catalog(): Promise<ProviderResponse<Catalog>> {
		return this.call(service => service.catalog());
	}

	check(request: CheckPayload): Promise<ProviderResponse<CheckResult>> {
		return this.call(service => service.check(request));
	}

	submit(request: SubmitPayload): Promise<ProviderResponse<SubmitResult>> {
		return this.call(service => service.submit(request));
	}

	poll(task: TaskRef): Promise<ProviderResponse<PollState>> {
		return this.call(service => service.poll(task));
	}

	download(request: DownloadRequest): Promise<ProviderResponse<DownloadResult>> {
		return this.call(service => service.download(request));
	}

	cancel(task: TaskRef): Promise<ProviderResponse<CancelResult>> {
		return this.call(service => service.cancel(task));
	}

	place(request: PlaceRequest): Promise<ProviderResponse<PlaceResult>> {
		return this.call(service => service.place(request));
	}

	voices(request: VoicesRequest): Promise<ProviderResponse<VoicesResult>> {
		return this.call(service => service.voices(request));
	}

	voicePreview(request: VoicePreviewRequest): Promise<ProviderResponse<VoicePreviewResult>> {
		return this.call(service => service.voicePreview(request));
	}

	private call<T>(run: (service: Omit<IBaseHalfProviderService, '_serviceBrand'>) => Promise<T>): Promise<T> {
		if (this.stopped) {
			return Promise.reject(this.stopped);
		}
		return new Promise<T>((resolve, reject) => {
			this.waiting.add(reject);
			run(this.service).then(resolve, reject).finally(() => this.waiting.delete(reject));
		});
	}

	private stop(): void {
		if (this.stopped) {
			return;
		}
		this.stopped = new Error(localize('basehalfProviders.stopped', "BaseHalf's background process stopped. Restart BaseHalf to continue."));
		for (const reject of [...this.waiting]) {
			reject(this.stopped);
		}
		this.waiting.clear();
	}
}
