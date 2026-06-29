/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import {
	BaseHalfMarkdownRichHostMessage,
	BaseHalfMarkdownRichWebviewMessage
} from './basehalfMarkdownRichWebviewProtocol.js';
import { IBaseHalfMarkdownRichDisk } from './basehalfMarkdownRichSession.js';

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
	readonly content?: string;
	readonly disk?: string;
	readonly message?: string;
}

export class BaseHalfMarkdownRichWebviewSaveCoordinator {
	async handleSaveRequested(
		message: BaseHalfMarkdownRichSaveRequestedMessage,
		disk: IBaseHalfMarkdownRichDisk,
		sender: IBaseHalfMarkdownRichSaveSender
	): Promise<IBaseHalfMarkdownRichSaveOutcome> {
		let current: string;
		try {
			current = await disk.read();
		} catch (error) {
			const outcome = this.writeFailed(error);
			await sender.sendSaveResult(message.requestId, outcome.result, { message: outcome.message });
			return outcome;
		}

		if (!message.forceWrite && current !== message.previousContent) {
			const outcome: IBaseHalfMarkdownRichSaveOutcome = {
				result: 'blockedByConflict',
				okToLeave: false,
				disk: current
			};
			await sender.sendSaveResult(message.requestId, outcome.result, { disk: current });
			return outcome;
		}

		if (!message.forceWrite && message.content === current) {
			const outcome: IBaseHalfMarkdownRichSaveOutcome = {
				result: 'noop',
				okToLeave: true,
				content: current
			};
			await sender.sendSaveResult(message.requestId, outcome.result, { content: current });
			return outcome;
		}

		try {
			await disk.write(message.content);
			const outcome: IBaseHalfMarkdownRichSaveOutcome = {
				result: 'saved',
				okToLeave: true,
				content: message.content
			};
			await sender.sendSaveResult(message.requestId, outcome.result, { content: message.content });
			return outcome;
		} catch (error) {
			const outcome = this.writeFailed(error);
			await sender.sendSaveResult(message.requestId, outcome.result, { message: outcome.message });
			return outcome;
		}
	}

	private writeFailed(error: unknown): IBaseHalfMarkdownRichSaveOutcome {
		return {
			result: 'writeFailed',
			okToLeave: false,
			message: error instanceof Error ? error.message : String(error)
		};
	}
}
