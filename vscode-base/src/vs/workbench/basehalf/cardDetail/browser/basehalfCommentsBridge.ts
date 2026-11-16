/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { BaseHalfAgentSelectionDetail } from '../../agentArea/common/basehalfAgentSelection.js';
import { IBaseHalfCommentService, IBaseHalfCommentsTarget } from '../../comments/browser/basehalfCommentService.js';
import { baseHalfCommentsPageMessage, IBaseHalfCommentsSetMessage } from '../../comments/common/basehalfCommentProtocol.js';
import { IBaseHalfComment } from '../../comments/common/basehalfComments.js';
import { IBaseHalfDocumentSelection } from '../../documents/common/basehalfDocumentBranch.js';

export interface IBaseHalfCommentsBridgeOptions {
	readonly target: IBaseHalfCommentsTarget;
	/** Sends a message to the page that shows the comments. */
	readonly post: (message: unknown) => void;
	/** What agents can see of the page: the comment whose note is open, or else the selected text. */
	readonly onSelection: (selected: BaseHalfAgentSelectionDetail | undefined) => void;
	/** Grow branch of a comment; a page without it offers none. */
	readonly growBranch?: (selection: IBaseHalfDocumentSelection) => void;
}

/**
 * What Card Detail does for a page that shows the comments of its file, a
 * reader of a PDF or a book or the Rich view of a note (comments): it sends
 * the page the comments once it is ready and after every change, keeps what
 * the user changes as steps of undo, follows changes from outside, and tells
 * agents which comment is open.
 */
export class BaseHalfCommentsBridge extends Disposable {
	private comments: readonly IBaseHalfComment[] = [];
	private ready = false;
	/** The text selected in the page, and the comment whose note is open, which wins (comments, rule 25). */
	private selectedText: BaseHalfAgentSelectionDetail | undefined;
	private focusedComment: string | undefined;

	constructor(
		private readonly options: IBaseHalfCommentsBridgeOptions,
		@IBaseHalfCommentService private readonly commentService: IBaseHalfCommentService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(commentService.watch(options.target));
		this._register(commentService.onDidChange(resource => {
			if (resource.toString() === options.target.resource.toString()) {
				void this.sendComments();
			}
		}));
		void this.sendComments();
	}

	/** The text selected in the page, or none; an open comment wins over it. */
	setSelectedText(selected: BaseHalfAgentSelectionDetail | undefined): void {
		this.selectedText = selected;
		this.reportSelection();
	}

	/** Handles a message of the page about comments; false for any other. */
	handleMessage(value: unknown): boolean {
		if ((value as { type?: unknown } | undefined)?.type === 'basehalf.comments.ready') {
			this.ready = true;
			void this.sendComments();
			return true;
		}
		const message = baseHalfCommentsPageMessage(value);
		switch (message?.type) {
			case 'basehalf.comments.change':
				if (message.comment) {
					// The words of the comment that is open are what agents see of it, also before the file has them.
					this.comments = [...this.comments.filter(comment => comment.id !== message.comment!.id), message.comment];
					if (message.comment.id === this.focusedComment) {
						this.reportSelection();
					}
				}
				void this.commentService.change(this.options.target, message.step, message.comment ? { comment: message.comment } : { remove: message.remove! }).catch(error => {
					this.logService.error('[BaseHalf] a comment could not be kept', error);
					this.notificationService.error(localize('basehalf.comments.writeFailed', "BaseHalf could not save the comment: {0}", error instanceof Error ? error.message : String(error)));
					void this.sendComments();
				});
				return true;
			case 'basehalf.comments.focus':
				this.focusedComment = message.id;
				this.reportSelection();
				return true;
			case 'basehalf.comments.grow': {
				const comment = this.comments.find(candidate => candidate.id === message.id);
				if (comment?.quote && this.options.growBranch) {
					this.options.growBranch({
						text: comment.quote,
						...(comment.page !== undefined ? { pages: [comment.page] } : {}),
						...(comment.chapter ? { chapter: comment.chapter } : {}),
						comment: { text: comment.text, replies: comment.replies }
					});
				}
				return true;
			}
		}
		return false;
	}

	private reportSelection(): void {
		const id = this.focusedComment;
		if (!id) {
			this.options.onSelection(this.selectedText);
			return;
		}
		const comment = this.comments.find(candidate => candidate.id === id);
		this.options.onSelection({
			path: this.options.target.relativePath,
			comment: id,
			...(comment?.quote ? { quote: comment.quote } : {}),
			text: comment?.text ?? ''
		});
	}

	private async sendComments(): Promise<void> {
		try {
			const read = await this.commentService.read(this.options.target);
			if (this._store.isDisposed) {
				return;
			}
			this.comments = read.comments;
			if (this.focusedComment) {
				this.reportSelection();
			}
			if (!this.ready) {
				return;
			}
			const message: IBaseHalfCommentsSetMessage = { type: 'basehalf.comments.set', comments: read.comments, unreadable: read.unreadable, color: this.commentService.color };
			this.options.post(message);
		} catch (error) {
			this.logService.warn(`[BaseHalf] the comments of ${this.options.target.resource.toString()} could not be read`, error);
		}
	}
}
