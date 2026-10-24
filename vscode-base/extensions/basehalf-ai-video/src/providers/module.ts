/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import type { ProviderErrorReading } from './failure.ts';
import type { ProviderHttp } from './http.ts';
import type { MediaInspector } from './media.ts';
import type { PromptContext } from './prompt.ts';
import type { CatalogProvider, CheckRequest, CheckResult, OutputFormat, PollState, PromptPart, SubmitRequest, TaskRef } from './types.ts';

/**
 * One provider on its own API, with its image and video models (D59, D64,
 * providers and the model catalog). A module declares the provider's catalog
 * entry and calls its API; the commands of `commands.ts` do everything that
 * is the same for every provider: they parse and validate the window's
 * payloads, check requests against the declarations, make the HTTP of each
 * call, keep the credentials out of every message, write the files a provider
 * answers inline, and download the files.
 *
 * A module keeps no state between calls, never logs, and never writes a file.
 * It throws a `ProviderFailure` (`failure.ts`) for everything it refuses or
 * cannot read; any other exception before a task was created answers
 * `rejected`, and after it `unknownOutcome`.
 *
 * **Outputs.** A request makes one file, or for an image model as many as its
 * `count`. A module answers where they are as {@link OutputLocation}s, one per
 * file in the provider's order: from `submit` when the provider answers the
 * request with the files ({@link AnsweredAtOnce}), and from `poll` when a task
 * succeeded ({@link TaskSucceeded}). The commands turn them into the outputs of
 * the contract (`Output` of `types.ts`), each on its own:
 *
 * - an address without headers stays an address, which the window downloads
 *   through the `download` command;
 * - an address with headers of its own, and inline bytes, are written to the
 *   output's target, the n-th file the request names (`SubmitRequest.targets`,
 *   or `TaskRef.targets` for a poll), under the checks of a download: an image
 *   starts like a PNG, JPEG, or WebP and is at most 64 MiB, a video starts like
 *   an MP4 and is at most 512 MiB. The answer names the target with its size
 *   and the format its bytes start like;
 * - a refusal stays a refusal, with the provider's reason made plain.
 *
 * An output that cannot be kept (not a file of the model's kind, too large, an
 * address AI Video does not download from, a target that cannot be written) is
 * answered as refused with the reason, and the others land. Outputs beyond the
 * targets are dropped, and the extension's log says how many. A module of a
 * video model whose poll gives one address may still answer it as `videoUrl`,
 * and `videoLocation` stays where the video of such a task is found.
 */
export interface ProviderModule {
	/**
	 * The provider's entry of the catalog: its regions, the credentials it
	 * needs, and every model with its modes, inputs, limits, and parameters.
	 * `buildCatalog` validates it. Labels are
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
	 * Writes the prompt as the provider's model reads it (D74; providers,
	 * "Names in the prompt"): the text as it is, and each mention of a planned
	 * input as the name its documentation gives that input, for the model and
	 * the mode. The commands have made sure that every mention names an input
	 * the request sends. What it writes is the prompt that the declarations,
	 * `check`, and `submit` see, and that `check` answers. Without it, the
	 * commands write the shared names (`writeSharedPromptNames` of
	 * `prompt.ts`).
	 */
	writePrompt?(prompt: readonly PromptPart[], request: PromptContext): string;

	/**
	 * The problems of a planned generation that the declarations cannot
	 * express, in order, as plain sentences. The commands have
	 * already checked the request against the model's declarations (the inputs
	 * the mode takes, the prompt rule, each parameter's value, and the mode's
	 * limits); `request.params` arrive with every default filled in. This adds
	 * the rules between parameters and the provider's own input rules (formats,
	 * the size of the whole request), reading the files through `media`.
	 */
	check(request: CheckRequest, media: MediaInspector): Promise<ModuleCheckResult>;

	/**
	 * Sends the request once through `http.create` and answers the provider's
	 * task id, or, when the provider answers the request with the files
	 * themselves, those outputs ({@link AnsweredAtOnce}). Never retried. Uploads
	 * the inputs first where the provider takes them that way (`http.request`).
	 * Its parameters arrive checked and with their defaults; it maps them to the
	 * provider's fields exactly.
	 *
	 * For a model that declares `answersAtOnce`, `http.create` waits up to ten
	 * minutes for the whole answer and reads up to 256 MiB of it unless the call
	 * sets `maxAnswerBytes`, and the commands have made sure that the request
	 * names a target for each output it may make before anything is sent.
	 */
	submit(request: SubmitRequest, http: ProviderHttp): Promise<string | AnsweredAtOnce>;

	/**
	 * Asks the provider about a task once (`http.request`) and maps its state:
	 * `pending` and `running` with the progress when the provider gives it,
	 * `failed` and `cancelled` with the provider's message, and `succeeded`
	 * with where the files are: `outputs` ({@link TaskSucceeded}), or for a video
	 * model whose poll gives one address, `videoUrl`. The contract's `PollState`
	 * is one of these states, so a module may answer it as it is; an output of a
	 * module is never a file already `written`.
	 */
	poll(ref: TaskRef, http: ProviderHttp): Promise<ModulePollState>;

	/**
	 * Where the video of a succeeded task is, when its poll gave no address,
	 * and the headers it needs; or the video itself, for a provider that
	 * answers it inside the task's answer. The headers go only to the
	 * endpoint's own origin; without them, the credential headers do. A module
	 * whose polls always give the address, or one of image models only, leaves
	 * it out: a download without an address then fails as unreadable.
	 */
	videoLocation?(ref: TaskRef, http: ProviderHttp): Promise<VideoLocation>;

	/**
	 * Asks the provider to stop a task, best effort. Answers false when the
	 * provider cannot stop it (for example, because it already runs), true when
	 * it took the cancellation.
	 */
	cancel(ref: TaskRef, http: ProviderHttp): Promise<boolean>;
}

/** What a module's `check` answers: the contract's answer without the prompt, which the commands wrote. */
export type ModuleCheckResult = Omit<CheckResult, 'prompt'>;

/** The answer of `submit` when the provider answers the request with its files instead of a task. */
export interface AnsweredAtOnce {
	/** One per file the provider made or refused, in the provider's order. */
	readonly outputs: readonly OutputLocation[];
}

/** A task that succeeded, with its files as the module finds them in the provider's answer. */
export interface TaskSucceeded {
	readonly state: 'succeeded';
	/** For a video model: the address of the video, as a poll of the contract gives it. */
	readonly videoUrl?: string;
	/** One per file the task made or refused, in the provider's order. */
	readonly outputs: readonly OutputLocation[];
}

/** What a module's `poll` answers: a state of the contract, or a success with outputs. */
export type ModulePollState = PollState | TaskSucceeded;

/** Where one file of a generation is: an address, the bytes themselves, or why the provider refused it alone. */
export type OutputLocation = OutputAddress | InlineOutput | RefusedOutput;

/** An address a file is downloaded from. */
export interface OutputAddress {
	/** `https://`, or `http://` on this computer. */
	readonly url: string;
	/**
	 * Sent while the address is on the endpoint's origin, instead of the
	 * credential headers. They never leave the extension: an output address
	 * with headers is downloaded into its target while the command runs.
	 */
	readonly headers?: Readonly<Record<string, string>>;
}

/**
 * A file the provider answered inline, such as base64 inside its JSON. It is
 * written to its target under the checks of a download.
 */
export interface InlineOutput {
	readonly bytes: Uint8Array;
	/**
	 * The format the provider says the bytes have, when it says one. The bytes
	 * decide: the file is kept when they start like a file of the model's kind,
	 * and the answer gives the format they start like, so that a file in
	 * another format than the provider said still lands under its own.
	 */
	readonly format?: OutputFormat;
}

/** A file the provider refused on its own, such as one image of four that its content check stopped. */
export interface RefusedOutput {
	/** The provider's reason, in its words; the commands make it plain. */
	readonly refused: string;
}

/** Where a video is downloaded from, or the video itself. */
export type VideoLocation = VideoAddress | InlineVideo;

/** An address a video is downloaded from. */
export type VideoAddress = OutputAddress;

/**
 * A video the provider answered inline, such as base64 inside its JSON. It is
 * written under the checks of a download: at most 512 MiB, and only a file
 * that starts like an MP4.
 */
export interface InlineVideo {
	readonly bytes: Uint8Array;
}
