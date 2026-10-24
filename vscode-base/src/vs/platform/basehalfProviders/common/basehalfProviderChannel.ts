/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { Event } from '../../../base/common/event.js';
import { IChannel, IServerChannel } from '../../../base/parts/ipc/common/ipc.js';
import { localize } from '../../../nls.js';
import { IBaseHalfProviderService } from './basehalfProviders.js';
import type { CancelResult, Catalog, CheckPayload, CheckResult, DownloadRequest, DownloadResult, PlaceRequest, PlaceResult, PollState, ProviderResponse, SubmitPayload, SubmitResult, TaskRef, VoicePreviewRequest, VoicePreviewResult, VoicesRequest, VoicesResult } from './basehalfProviderTypes.js';

/**
 * The answer of `voicePreview` as the channel sends it (D78): the answer
 * without the sample, then the sample's bytes. The channel sends a VSBuffer as
 * bytes only on its own or in an array, and anything else as JSON, which
 * would turn the bytes into a list of numbers.
 */
type VoicePreviewOnChannel = readonly [ProviderResponse<Omit<VoicePreviewResult, 'bytes'>>, VSBuffer?];

/**
 * The channel of the provider service in the shared process (D75). Unlike one
 * made with `ProxyChannel.fromService`, it gives a call that sends requests
 * its cancellation, which ends when the window that made the call closes or
 * reloads: a call belongs to its window (providers, "Requests"). A window
 * calls it through {@link BaseHalfProviderChannelClient}, with the call's
 * arguments as an array.
 */
export class BaseHalfProviderChannel implements IServerChannel<string> {

	constructor(private readonly service: IBaseHalfProviderService) { }

	listen<T>(_context: string, event: string): Event<T> {
		throw new Error(`The provider service has no event '${event}'.`);
	}

	async call<T>(_context: string, command: string, args?: unknown, token: CancellationToken = CancellationToken.None): Promise<T> {
		const argument: unknown = Array.isArray(args) ? args[0] : undefined;
		switch (command) {
			case 'catalog': return await this.service.catalog() as T;
			case 'check': return await this.service.check(argument as CheckPayload) as T;
			case 'submit': return await this.service.submit(argument as SubmitPayload, token) as T;
			case 'poll': return await this.service.poll(argument as TaskRef, token) as T;
			case 'download': return await this.service.download(argument as DownloadRequest, token) as T;
			case 'cancel': return await this.service.cancel(argument as TaskRef, token) as T;
			case 'place': return await this.service.place(argument as PlaceRequest) as T;
			case 'voices': return await this.service.voices(argument as VoicesRequest, token) as T;
			case 'voicePreview': return voicePreviewOnChannel(await this.service.voicePreview(argument as VoicePreviewRequest, token)) as T;
		}
		throw new Error(`The provider service has no call '${command}'.`);
	}
}

/**
 * The provider service as a window calls it over its channel (D75): each call
 * with its arguments as an array, as `ProxyChannel.toService` sends them, and
 * the sample of a voice put back together from its answer and its bytes.
 */
export class BaseHalfProviderChannelClient implements Omit<IBaseHalfProviderService, '_serviceBrand'> {

	constructor(private readonly channel: IChannel) { }

	catalog(): Promise<ProviderResponse<Catalog>> {
		return this.channel.call('catalog', []);
	}

	check(request: CheckPayload): Promise<ProviderResponse<CheckResult>> {
		return this.channel.call('check', [request]);
	}

	submit(request: SubmitPayload): Promise<ProviderResponse<SubmitResult>> {
		return this.channel.call('submit', [request]);
	}

	poll(task: TaskRef): Promise<ProviderResponse<PollState>> {
		return this.channel.call('poll', [task]);
	}

	download(request: DownloadRequest): Promise<ProviderResponse<DownloadResult>> {
		return this.channel.call('download', [request]);
	}

	cancel(task: TaskRef): Promise<ProviderResponse<CancelResult>> {
		return this.channel.call('cancel', [task]);
	}

	place(request: PlaceRequest): Promise<ProviderResponse<PlaceResult>> {
		return this.channel.call('place', [request]);
	}

	voices(request: VoicesRequest): Promise<ProviderResponse<VoicesResult>> {
		return this.channel.call('voices', [request]);
	}

	async voicePreview(request: VoicePreviewRequest): Promise<ProviderResponse<VoicePreviewResult>> {
		return voicePreviewOfChannel(await this.channel.call<unknown>('voicePreview', [request]));
	}
}

function voicePreviewOnChannel(response: ProviderResponse<VoicePreviewResult>): VoicePreviewOnChannel {
	return response.ok ? [{ ok: true, value: { format: response.value.format } }, response.value.bytes] : [response];
}

function voicePreviewOfChannel(answer: unknown): ProviderResponse<VoicePreviewResult> {
	const [first, bytes]: readonly unknown[] = Array.isArray(answer) ? answer : [];
	// The shared process's own answer, as every other call of the channel takes it.
	const response = first as VoicePreviewOnChannel[0] | undefined;
	if (response?.ok === true && bytes instanceof VSBuffer) {
		return { ok: true, value: { ...response.value, bytes } };
	}
	if (response?.ok === false) {
		return response;
	}
	return { ok: false, error: { code: 'invalidResponse', message: localize('basehalfProviders.unreadableSample', "BaseHalf could not read the sample of this voice.") } };
}
