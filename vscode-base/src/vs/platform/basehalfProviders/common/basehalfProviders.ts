/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from '../../../base/common/cancellation.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { CancelResult, Catalog, CheckPayload, CheckResult, DownloadRequest, DownloadResult, PlaceRequest, PlaceResult, PollState, ProviderResponse, SubmitPayload, SubmitResult, TaskRef } from './basehalfProviderTypes.js';

/** The channel of the provider service in the shared process. */
export const BASEHALF_PROVIDERS_CHANNEL = 'basehalfProviders';

/**
 * What the main process tells every window when the shared process stopped,
 * and answers a window that opens later (providers, "Requests").
 */
export const BASEHALF_SHARED_PROCESS_STOPPED_CHANNEL = 'vscode:basehalfSharedProcessStopped';

export const IBaseHalfProviderService = createDecorator<IBaseHalfProviderService>('baseHalfProviderService');

/**
 * The provider modules of generation cards and the requests they send (D59,
 * D64, D75, providers, "Requests"). The service runs in the shared process,
 * and every window calls it directly. Each call answers `{ ok: true, value }`
 * or `{ ok: false, error }` and keeps nothing between calls: the window passes
 * the credentials with every call that needs them. The service checks what it
 * is given, since it comes from another process. A call that sends requests
 * ends with its token: in the shared process, when the window that made it
 * closes or reloads.
 */
export interface IBaseHalfProviderService {
	readonly _serviceBrand: undefined;

	/** The catalog built from the provider modules. */
	catalog(): Promise<ProviderResponse<Catalog>>;
	/** Writes the prompt for its model and checks the planned generation. Nothing is sent. */
	check(request: CheckPayload): Promise<ProviderResponse<CheckResult>>;
	/** Sends the request once: the provider's task, or the outputs where it answers with them at once. */
	submit(request: SubmitPayload, token?: CancellationToken): Promise<ProviderResponse<SubmitResult>>;
	/** Asks the provider about a task once. */
	poll(task: TaskRef, token?: CancellationToken): Promise<ProviderResponse<PollState>>;
	/** Downloads one output to a file of its own. */
	download(request: DownloadRequest, token?: CancellationToken): Promise<ProviderResponse<DownloadResult>>;
	/** Asks the provider to cancel a task, where it can. */
	cancel(task: TaskRef, token?: CancellationToken): Promise<ProviderResponse<CancelResult>>;
	/** Puts a received file into its card's place, never replacing anything. */
	place(request: PlaceRequest): Promise<ProviderResponse<PlaceResult>>;
}
