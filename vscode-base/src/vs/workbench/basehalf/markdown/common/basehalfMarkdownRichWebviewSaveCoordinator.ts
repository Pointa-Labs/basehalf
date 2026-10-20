/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import {
	BaseHalfMarkdownRichHostMessage,
	BaseHalfMarkdownRichWebviewMessage
} from './basehalfMarkdownRichWebviewProtocol.js';
import {
	baseHalfMarkdownRichBody,
	composeBaseHalfMarkdownRichContent,
	IBaseHalfMarkdownRichDisk,
	writeBaseHalfMarkdownRichBody
} from './basehalfMarkdownRichSession.js';

export type BaseHalfMarkdownRichSaveRequestedMessage = Extract<BaseHalfMarkdownRichWebviewMessage, { readonly type: 'basehalf.markdownRich.saveRequested' }>;
export type BaseHalfMarkdownRichSaveResultMessage = Extract<BaseHalfMarkdownRichHostMessage, { readonly type: 'basehalf.markdownRich.saveResult' }>;
export type BaseHalfMarkdownRichSaveResultKind = BaseHalfMarkdownRichSaveResultMessage['result'];

export interface IBaseHalfMarkdownRichSaveSender {
	sendSaveResult(
		requestId: string,
		result: BaseHalfMarkdownRichSaveResultKind,
		options?: { readonly content?: string; readonly disk?: string; readonly message?: string }
	): Promise<boolean>;
}

export interface IBaseHalfMarkdownRichSaveOutcome {
	readonly result: BaseHalfMarkdownRichSaveResultKind;
	readonly okToLeave: boolean;
	/** The document text after a saved or no-op result. It carries the model's frontmatter. */
	readonly content?: string;
	readonly disk?: string;
	readonly message?: string;
}

/**
 * Host side of a rich save. The webview sends only its body; the text model
 * owns the frontmatter. Every save and force-write therefore writes the
 * model's current frontmatter with the rich body, and only a body divergence
 * blocks a save as a conflict.
 */
export class BaseHalfMarkdownRichWebviewSaveCoordinator {
	async handleSaveRequested(
		message: BaseHalfMarkdownRichSaveRequestedMessage,
		disk: IBaseHalfMarkdownRichDisk,
		sender: IBaseHalfMarkdownRichSaveSender
	): Promise<IBaseHalfMarkdownRichSaveOutcome> {
		const result = await writeBaseHalfMarkdownRichBody(disk, {
			body: message.body,
			previousContent: message.previousContent,
			forceWrite: message.forceWrite
		});

		let outcome: IBaseHalfMarkdownRichSaveOutcome;
		switch (result.kind) {
			case 'noop':
			case 'saved':
				outcome = { result: result.kind, okToLeave: true, content: result.content };
				await sender.sendSaveResult(message.requestId, outcome.result, { content: result.content });
				return outcome;
			case 'blockedByConflict':
				outcome = { result: 'blockedByConflict', okToLeave: false, disk: result.disk };
				await sender.sendSaveResult(message.requestId, outcome.result, { disk: result.disk });
				return outcome;
			case 'writeFailed':
				outcome = {
					result: 'writeFailed',
					okToLeave: false,
					message: result.error instanceof Error ? result.error.message : String(result.error)
				};
				await sender.sendSaveResult(message.requestId, outcome.result, { message: outcome.message });
				return outcome;
		}
	}
}

export type BaseHalfMarkdownRichProjectionHandoffPlan =
	| { readonly kind: 'conflict'; readonly disk: string }
	| { readonly kind: 'apply'; readonly content: string; readonly changed: boolean };

/**
 * Plans the synchronous projection handoff write. A handoff does not wait for
 * an earlier save round trip, so the webview's `previousContent` may lag a
 * save the host already applied. Bodies the host accepted from this editor,
 * or is still writing for it, therefore do not count as a divergence. The
 * written text is always the model's current frontmatter with the rich body.
 */
export function planBaseHalfMarkdownRichProjectionHandoff(
	current: string,
	message: Pick<BaseHalfMarkdownRichSaveRequestedMessage, 'body' | 'previousContent' | 'forceWrite'>,
	acceptedBodies: Iterable<string>
): BaseHalfMarkdownRichProjectionHandoffPlan {
	if (!message.forceWrite) {
		const currentBody = baseHalfMarkdownRichBody(current);
		if (currentBody !== message.body
			&& currentBody !== baseHalfMarkdownRichBody(message.previousContent)
			&& !includes(acceptedBodies, currentBody)) {
			return { kind: 'conflict', disk: current };
		}
	}

	const content = composeBaseHalfMarkdownRichContent(current, message.body);
	return { kind: 'apply', content, changed: content !== current };
}

function includes(values: Iterable<string>, value: string): boolean {
	for (const candidate of values) {
		if (candidate === value) {
			return true;
		}
	}
	return false;
}
