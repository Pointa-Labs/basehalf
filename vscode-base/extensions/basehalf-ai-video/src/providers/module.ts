/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { ProviderErrorReading } from './failure.ts';
import type { ProviderHttp } from './http.ts';
import type { MediaInspector } from './media.ts';
import type { CatalogProvider, CheckRequest, CheckResult, PollState, SubmitRequest, TaskRef } from './types.ts';

/**
 * One video provider on its own API (D59, video providers and the model
 * catalog). A module declares the provider's catalog entry and calls its API;
 * the commands of `commands.ts` do everything that is the same for every
 * provider: they parse and validate the window's payloads, check requests
 * against the declarations, make the HTTP of each call, keep the credentials
 * out of every message, and download the video.
 *
 * A module keeps no state between calls and never logs. It throws a
 * `ProviderFailure` (`failure.ts`) for everything it refuses or cannot read;
 * any other exception before a task was created answers `rejected`, and after
 * it `unknownOutcome`.
 */
export interface ProviderModule {
	/**
	 * The provider's entry of the catalog: its regions, the credentials it
	 * needs, and every model with its modes, inputs, limits, parameters, and
	 * whether it has an estimate. `buildCatalog` validates it. Labels are
	 * English for now; keep them in one table per module so they can be
	 * translated later.
	 */
	describe(): CatalogProvider;

	/**
	 * The headers that carry the credentials, by the ids the entry declares.
	 * Called for every request to the endpoint's origin, so a header may change
	 * per request (a request id, a signed token); never sent to another origin,
	 * and every value is kept out of messages.
	 */
	headers(credentials: Readonly<Record<string, string>>): Readonly<Record<string, string>>;

	/**
	 * Reads an error answer of the provider (any status that is not 2xx): its
	 * message and, when the provider's own code says more than the status (an
	 * empty balance, a model that is not activated), the contract's code.
	 * Without it, the commands read the shapes most APIs use.
	 */
	readError?(status: number, body: unknown): ProviderErrorReading | undefined;

	/**
	 * The problems of a planned generation that the declarations cannot
	 * express, in order, as plain sentences, and the estimate. The commands have
	 * already checked the request against the model's declarations (the inputs
	 * the mode takes, the prompt rule, each parameter's value, and the mode's
	 * limits); `request.params` arrive with every default filled in. This adds
	 * the rules between parameters and the provider's own input rules (formats,
	 * the size of the whole request), reading the files through `media`.
	 */
	check(request: CheckRequest, media: MediaInspector): Promise<CheckResult>;

	/**
	 * Sends the request once through `http.create` and answers the provider's
	 * task id. Never retried. Uploads the inputs first where the provider takes
	 * them that way (`http.request`). Its parameters arrive checked and with
	 * their defaults; it maps them to the provider's fields exactly.
	 */
	submit(request: SubmitRequest, http: ProviderHttp): Promise<string>;

	/** Asks the provider about a task once (`http.request`) and maps its state. */
	poll(ref: TaskRef, http: ProviderHttp): Promise<PollState>;

	/**
	 * Where the video of a succeeded task is, when its poll gave no address,
	 * and the headers it needs; or the video itself, for a provider that
	 * answers it inside the task's answer. The headers go only to the
	 * endpoint's own origin; without them, the credential headers do.
	 */
	videoLocation(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation>;

	/**
	 * Asks the provider to stop a task, best effort. Answers false when the
	 * provider cannot stop it (for example, because it already runs), true when
	 * it took the cancellation.
	 */
	cancel(ref: TaskRef, http: ProviderHttp): Promise<boolean>;
}

/** Where a video is downloaded from, or the video itself. */
export type VideoLocation = VideoAddress | InlineVideo;

/** An address a video is downloaded from. */
export interface VideoAddress {
	/** `https://`, or `http://` on this computer. */
	readonly url: string;
	/** Sent while the address is on the endpoint's origin, instead of the credential headers. */
	readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A video the provider answered inline, such as base64 inside its JSON. It is
 * written under the checks of a download: at most 512 MiB, and only a file
 * that starts like an MP4.
 */
export interface InlineVideo {
	readonly bytes: Uint8Array;
}
