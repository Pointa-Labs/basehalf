/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, isHTMLElement } from '../../../../../base/browser/dom.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { IBaseHalfCanvasBadgeMetadata, IBaseHalfCanvasItem } from '../../common/basehalfCanvasModel.js';
import { IBaseHalfBadgeFile, IBaseHalfBadgeNode, IBaseHalfBadgeReadProblem } from '../../../references/common/basehalfBadgeMirror.js';
import { baseHalfCanvasConnectionSummary } from '../../../references/common/basehalfCanvasUpstream.js';
import { BaseHalfReferenceIndexState, IBaseHalfIndexedDownstream, IBaseHalfUpstreamView } from '../../../references/common/basehalfReferenceIndex.js';
import { BaseHalfBadgeConnectionsFocusTarget } from '../../../references/browser/basehalfUpstreamActions.js';
import { IBaseHalfCardDetailState } from '../../../navigation/common/basehalfCanvasNavigation.js';
import {
	baseHalfBadgeDraftFailureDisposition,
	baseHalfCopyRetainedBadgeDraft,
	baseHalfDiscardRetainedBadgeDraft,
	baseHalfResourceMutationStampsEqual,
	baseHalfShouldVetoForBadgeDrafts,
	baseHalfTransitionBadgeDraftIdentity
} from '../basehalfCanvasConnectionTransaction.js';
import { BASEHALF_AUTO_SAVE_DELAY_MS } from '../../../shell/common/basehalfWorkbenchProfile.js';
import type { BaseHalfCanvasWorkbenchContribution } from '../basehalfCanvasWorkbench.contribution.js';
import { IBaseHalfBadgeDescriptionDraft, IBaseHalfBadgeDescriptionPending, IBaseHalfCanvasMutationGuard, baseHalfBadgeResourceIdentity } from './basehalfCanvasViewShared.js';

type BaseHalfBadgeEditorFocusTarget = 'prompt' | BaseHalfBadgeConnectionsFocusTarget;

type BaseHalfCanvasBadgeFocusTarget = BaseHalfBadgeEditorFocusTarget | 'toggle';

interface IBaseHalfBadgeEditorControls {
	readonly prompt?: HTMLTextAreaElement;
	readonly addUpstream?: HTMLButtonElement;
	readonly addDownstream?: HTMLButtonElement;
}

/** A node's connections as the badge editor shows them (D37). */
interface IBaseHalfBadgeEditorConnections {
	/** The node's own Upstream list, or `undefined` when it could not be read. */
	readonly upstream: IBaseHalfUpstreamView | undefined;
	readonly downstream: readonly IBaseHalfIndexedDownstream[];
	readonly indexState: BaseHalfReferenceIndexState | undefined;
}

type BaseHalfBadgeDescriptionSaveState = 'pending' | 'saved' | 'retrying' | 'error';

/**
 * The badge editor of a card and of Card Detail: its face, its upstream and
 * downstream, and the description that is saved as the user types, with drafts
 * and recovery when a save fails.
 *
 * A part of the canvas view (README.md in this folder): it keeps its own state,
 * and reaches the state the view shares and the other parts through `view`.
 */
export class BaseHalfCanvasBadgeEditor {
	private readonly badgeDescriptionDrafts = new Map<string, IBaseHalfBadgeDescriptionDraft>();
	private readonly badgeDescriptionRecoveryDrafts = new Map<string, IBaseHalfBadgeDescriptionDraft[]>();
	private readonly badgeDescriptionSaveStates = new Map<string, BaseHalfBadgeDescriptionSaveState>();
	private canvasBadgeRefreshAfterFocusLeaves = false;
	private pendingCanvasBadgeFocus: { readonly path: string; readonly target: BaseHalfCanvasBadgeFocusTarget } | undefined;

	constructor(private readonly view: BaseHalfCanvasWorkbenchContribution) { }

	deferCanvasBadgeRefreshWhileFocused(): boolean {
		const active = this.view.cards.ownerDocument.activeElement;
		if (!isHTMLElement(active) || !this.view.cards.contains(active)) {
			return false;
		}
		const face = active.closest<HTMLElement>('.basehalf-canvas-card-badge-face');
		if (!face) {
			return false;
		}
		if (this.canvasBadgeRefreshAfterFocusLeaves) {
			return true;
		}

		this.canvasBadgeRefreshAfterFocusLeaves = true;
		this.view.canvasBadgeFocusRefresh.value = this.view.addDisposableListener(face, 'focusout', () => {
			mainWindow.setTimeout(() => {
				if (!this.canvasBadgeRefreshAfterFocusLeaves) {
					return;
				}
				const nextActive = this.view.cards.ownerDocument.activeElement;
				if (isHTMLElement(nextActive) && face.contains(nextActive)) {
					return;
				}
				this.resetCanvasBadgeDeferredRefresh();
				if (!this.view.disposed) {
					this.view.requestRender();
				}
			}, 0);
		});
		return true;
	}

	resetCanvasBadgeDeferredRefresh(): void {
		this.canvasBadgeRefreshAfterFocusLeaves = false;
		this.view.canvasBadgeFocusRefresh.clear();
	}

	restorePendingCanvasBadgeFocus(card: HTMLElement, path: string): void {
		const pending = this.pendingCanvasBadgeFocus;
		if (!pending || pending.path !== path) {
			return;
		}

		let attempts = 0;
		const focus = () => {
			if (this.view.disposed || this.pendingCanvasBadgeFocus !== pending) {
				return;
			}
			if (!card.isConnected) {
				if (attempts++ < 8) {
					mainWindow.requestAnimationFrame(focus);
				}
				return;
			}
			let target: HTMLElement | null | undefined;
			switch (pending.target) {
				case 'prompt':
					target = card.dataset.previewLevel !== 'shell'
						? card.querySelector<HTMLTextAreaElement>('.basehalf-canvas-card-badge-prompt')
						: undefined;
					break;
				case 'add-upstream':
					// Read-only upstream-only cards have no Add Upstream: fall back to Add Downstream.
					target = card.dataset.previewLevel !== 'shell'
						? card.querySelector<HTMLButtonElement>('.basehalf-canvas-card-add-reference') ?? card.querySelector<HTMLButtonElement>('.basehalf-canvas-card-add-downstream')
						: undefined;
					break;
				case 'add-downstream':
					target = card.dataset.previewLevel !== 'shell'
						? card.querySelector<HTMLButtonElement>('.basehalf-canvas-card-add-downstream')
						: undefined;
					break;
				case 'toggle':
					target = card.querySelector<HTMLButtonElement>('.basehalf-canvas-card-caption .basehalf-canvas-card-badge-toggle');
					break;
			}
			if (!target) {
				if (attempts++ < 8) {
					mainWindow.requestAnimationFrame(focus);
				}
				return;
			}
			target.focus();
			if (card.ownerDocument.activeElement === target) {
				this.pendingCanvasBadgeFocus = undefined;
			} else if (attempts++ < 8) {
				mainWindow.requestAnimationFrame(focus);
			}
		};
		mainWindow.requestAnimationFrame(focus);
	}

	renderCardBadgeToggle(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		badgeIssueCount: number,
		listeners: DisposableStore
	): void {
		const badgeOpen = this.view.openBadgeFaces.has(item.path);
		const relationships = item.relationships;
		const connected = !!relationships && (relationships.upstream.length > 0 || relationships.downstream.length > 0);
		const upstreamIssues = relationships?.issueCount ?? 0;
		const summary = connected || upstreamIssues > 0
			? baseHalfCanvasConnectionSummary({
				upstream: relationships?.upstream.length ?? 0,
				downstream: this.view.renderedIndexState === 'building' ? undefined : relationships?.downstream.length ?? 0,
				issues: upstreamIssues,
				incomplete: this.view.renderedIndexState === 'partial'
			})
			: undefined;
		const badgeToggle = append(container, $('button.basehalf-canvas-card-badge-toggle')) as HTMLButtonElement;
		badgeToggle.classList.add('nodrag', 'nopan', 'nowheel');
		badgeToggle.type = 'button';
		const action = badgeOpen
			? localize('basehalf.canvas.badge.hide', "Hide the badge - back to the preview")
			: item.badge?.description ? localize('basehalf.canvas.badge.edit', "Has a badge - edit it") : localize('basehalf.canvas.badge.show', "Edit Badge");
		badgeToggle.title = summary ? `${summary} - ${action}` : action;
		badgeToggle.setAttribute('aria-label', summary
			? localize('basehalf.canvas.badge.ariaSummary', "{0} badge for {1}, {2}", badgeOpen ? localize('basehalf.canvas.badge.hideVerb', "Hide") : localize('basehalf.canvas.badge.showVerb', "Show"), item.path, summary)
			: localize('basehalf.canvas.badge.aria', "{0} badge for {1}", badgeOpen ? localize('basehalf.canvas.badge.hideVerb', "Hide") : localize('basehalf.canvas.badge.showVerb', "Show"), item.path));
		badgeToggle.setAttribute('aria-pressed', String(badgeOpen));
		badgeToggle.classList.toggle('lit', !!item.badge?.description || badgeIssueCount > 0);
		badgeToggle.classList.toggle('issue', badgeIssueCount > 0);
		badgeToggle.classList.toggle('pressed', badgeOpen);
		this.view.cardRenderer.renderGlyph(badgeToggle, 'badge', badgeIssueCount > 0 ? 'var(--bh-card-warning)' : item.badge?.description ? 'var(--bh-card-accent)' : 'var(--bh-card-text-tertiary)', 15);
		if (badgeIssueCount > 0) {
			const marker = append(badgeToggle, $('.basehalf-canvas-card-badge-dot.issue'));
			marker.setAttribute('data-testid', 'card-reference-issue-marker');
			marker.setAttribute('data-reference-issue-count', String(badgeIssueCount));
			marker.setAttribute('aria-hidden', 'true');
		} else if (item.badge?.description && connected) {
			append(badgeToggle, $('.basehalf-canvas-card-badge-dot'));
		}
		listeners.add(this.view.addDisposableListener(badgeToggle, 'pointerdown', event => {
			event.stopPropagation();
		}));
		listeners.add(this.view.addDisposableListener(badgeToggle, 'dblclick', event => {
			event.preventDefault();
			event.stopPropagation();
		}));
		listeners.add(this.view.addDisposableListener(badgeToggle, 'click', event => {
			event.preventDefault();
			event.stopPropagation();
			void (async () => {
				if (this.view.activeCanvasNoteEditor?.path === item.path && !await this.view.noteEditing.closeActiveCanvasNoteEditorAfterFormats(false)) {
					return;
				}
				this.view.selectionActions.selectCard(item.path);
				this.toggleBadgeFace(item.path);
			})();
		}));
	}

	renderCardBadgeFace(
		container: HTMLElement,
		item: IBaseHalfCanvasItem,
		listeners: DisposableStore
	): void {
		const face = append(container, $('.basehalf-canvas-card-badge-face'));
		face.classList.add('nowheel', 'nodrag');
		face.setAttribute('data-testid', `card-badge-face-${item.path}`);
		listeners.add(this.view.addDisposableListener(face, 'pointerdown', event => event.stopPropagation()));
		listeners.add(this.view.addDisposableListener(face, 'mousedown', event => event.stopPropagation()));
		listeners.add(this.view.addDisposableListener(face, 'dblclick', event => event.stopPropagation()));
		listeners.add(this.view.addDisposableListener(face, 'wheel', event => event.stopPropagation()));
		listeners.add(this.view.addDisposableListener(face, 'keydown', event => {
			if (event.key !== 'Escape' || event.isComposing) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.toggleBadgeFace(item.path);
		}, true));

		const body = append(face, $('.basehalf-canvas-card-badge-scroll'));
		const folder = this.view.getCurrentFolder();
		if (!folder) {
			return;
		}
		const saveState = this.badgeDescriptionSaveStates.get(this.badgeDescriptionKey(folder.workspaceFolder, item.path));
		if (saveState) {
			face.setAttribute('data-badge-save-state', saveState);
			face.setAttribute('aria-busy', String(saveState === 'pending' || saveState === 'retrying'));
		}
		const mutationGuard = this.view.resourceMutationGuard(
			folder.workspaceFolder,
			this.view.workspaceMutationCoordinator.captureResource(folder.workspaceFolder, item.path),
			baseHalfBadgeResourceIdentity(item.stat)
		);
		const node: IBaseHalfBadgeNode = {
			resource: item.stat.resource,
			workspaceFolder: folder.workspaceFolder,
			relativePath: item.path,
			kind: item.kind
		};

		this.renderBadgeEditorContent(body, node, item.badge, this.view.renderedBadgeProblems.get(item.path), {
			upstream: this.view.renderedUpstreamViews.get(item.path),
			downstream: this.view.renderedIndexState === 'building' ? [] : this.view.referenceIndexService.getDownstream(node),
			indexState: this.view.renderedIndexState
		}, mutationGuard,
		disposable => listeners.add(disposable),
		focusTarget => {
			this.pendingCanvasBadgeFocus = { path: item.path, target: focusTarget };
			this.view.requestRender();
		});
	}

	/**
	 * The shared badge editor — description, Upstream, Downstream — used by
	 * both the canvas card's flip face and the card detail's badge zone. The two
	 * surfaces differ only in their container chrome and listener lifetime, so
	 * they hand in a listener sink and a refresh callback. The node's own
	 * Upstream list is editable; the Downstream list is derived from the other
	 * nodes' stores (D37).
	 */
	private renderBadgeEditorContent(
		body: HTMLElement,
		node: IBaseHalfBadgeNode,
		badge: IBaseHalfCanvasBadgeMetadata | undefined,
		ownProblem: IBaseHalfBadgeReadProblem | undefined,
		connections: IBaseHalfBadgeEditorConnections,
		mutationGuard: IBaseHalfCanvasMutationGuard,
		addListener: (disposable: IDisposable) => void,
		refresh: (focusTarget: BaseHalfBadgeEditorFocusTarget) => void
	): IBaseHalfBadgeEditorControls {
		let prompt: HTMLTextAreaElement | undefined;
		if (ownProblem) {
			// The file system refuses to read the description's own storage, so
			// there is no description to edit. Say why in place of the field and
			// offer nothing that leads into `.bh/`: users are never sent to a
			// hidden file. A badge whose content cannot be read never gets
			// here: it reads as absent and the description field stays usable.
			const issueSection = append(body, $('.basehalf-canvas-card-badge-section.reference-issues'));
			issueSection.setAttribute('data-testid', 'badge-metadata-issue');
			const heading = append(issueSection, $('.basehalf-canvas-card-badge-issues-title'));
			heading.textContent = localize('basehalf.canvas.badge.descriptionIssue', "Description can't be read");
			const row = append(issueSection, $('.basehalf-canvas-card-badge-issue-row'));
			const message = append(row, $('span.basehalf-canvas-card-badge-issue-message'));
			message.textContent = localize('basehalf.canvas.badge.descriptionUnavailable', "BaseHalf could not load it: {0}", ownProblem.message);
		} else {
			prompt = this.renderBadgeDescriptionPrompt(body, node, badge, mutationGuard, addListener);
			this.renderBadgeDescriptionRecovery(body, node, addListener, refresh);
		}

		const context = this.view.connections.upstreamActionContext(this.view.getCurrentFolder(), () => this.view.renderer.scheduleBackgroundRender());
		const controls = this.view.upstreamActions.renderConnections(body, {
			node,
			upstream: connections.upstream,
			downstream: connections.downstream,
			indexState: connections.indexState,
			context,
			addListener,
			openNode: relativePath => this.view.cardRenderer.openWorkspaceRelative(node.workspaceFolder, relativePath),
			refresh: focus => {
				this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath);
				refresh(focus);
			}
		});
		return { ...(prompt ? { prompt } : {}), ...controls };
	}

	private renderBadgeDescriptionPrompt(
		body: HTMLElement,
		node: IBaseHalfBadgeNode,
		badge: IBaseHalfCanvasBadgeMetadata | undefined,
		mutationGuard: IBaseHalfCanvasMutationGuard,
		addListener: (disposable: IDisposable) => void
	): HTMLTextAreaElement {
		const prompt = append(body, $('textarea.basehalf-canvas-card-badge-prompt')) as HTMLTextAreaElement;
		prompt.value = badge?.description ?? '';
		prompt.placeholder = node.kind === 'folder'
			? localize('basehalf.canvas.badge.descriptionPlaceholderFolder', "One line about this folder…")
			: localize('basehalf.canvas.badge.descriptionPlaceholderFile', "One line about this file…");
		prompt.rows = 1;
		prompt.spellcheck = false;
		prompt.setAttribute('aria-label', localize('basehalf.canvas.badge.descriptionLabel', "Description of {0}", node.relativePath));
		this.fitBadgePrompt(prompt);
		let composing = false;
		const flushPrompt = () => {
			composing = false;
			const key = this.badgeDescriptionKey(node.workspaceFolder, node.relativePath);
			if (this.badgeDescriptionDrafts.has(key) || prompt.value !== (badge?.description ?? '')) {
				this.scheduleBadgeDescriptionWrite(node, prompt.value, mutationGuard);
			}
			this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath);
		};
		addListener(this.view.addDisposableListener(prompt, 'compositionstart', () => {
			composing = true;
		}));
		addListener(this.view.addDisposableListener(prompt, 'compositionend', () => {
			composing = false;
			this.fitBadgePrompt(prompt);
			this.scheduleBadgeDescriptionWrite(node, prompt.value, mutationGuard);
		}));
		addListener(this.view.addDisposableListener(prompt, 'input', event => {
			this.fitBadgePrompt(prompt);
			if (!composing && !(event instanceof InputEvent && event.isComposing)) {
				this.scheduleBadgeDescriptionWrite(node, prompt.value, mutationGuard);
			}
		}));
		addListener(this.view.addDisposableListener(prompt, 'blur', () => {
			flushPrompt();
			this.view.renderer.scheduleBackgroundRender();
		}));
		addListener(this.view.addDisposableListener(prompt, 'keydown', event => {
			if (event.isComposing) {
				event.stopPropagation();
				return;
			}
			if (event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}
			event.stopPropagation();
		}));
		return prompt;
	}

	private renderBadgeDescriptionRecovery(
		body: HTMLElement,
		node: IBaseHalfBadgeNode,
		addListener: (disposable: IDisposable) => void,
		refresh: (focusTarget: BaseHalfBadgeEditorFocusTarget) => void
	): void {
		const key = this.badgeDescriptionKey(node.workspaceFolder, node.relativePath);
		const active = this.badgeDescriptionDrafts.get(key);
		const retained = [
			...(this.badgeDescriptionRecoveryDrafts.get(key) ?? []),
			...(active?.recovery === 'retry-exhausted' ? [active] : [])
		];
		if (retained.length === 0) {
			return;
		}

		const section = append(body, $('.basehalf-canvas-card-badge-section.reference-issues.badge-save-recovery'));
		section.setAttribute('data-testid', 'badge-save-recovery');
		const heading = append(section, $('.basehalf-canvas-card-badge-issues-title'));
		heading.textContent = retained.length === 1 ? 'Badge draft not saved' : `${retained.length} Badge drafts not saved`;

		for (const draft of retained) {
			const row = append(section, $('.basehalf-canvas-card-badge-issue-row'));
			row.setAttribute('data-recovery-reason', draft.recovery ?? 'retry-exhausted');
			const message = append(row, $('span.basehalf-canvas-card-badge-issue-message'));
			message.textContent = draft.recovery === 'identity-changed'
				? 'The file at this path was replaced. This retained draft will not be written to the new file.'
				: draft.recovery === 'resource-missing'
					? 'The original file is missing. This retained draft will not be written unless you copy it yourself.'
					: 'The draft is retained locally. Retry saving or discard it.';

			if (draft.recovery === 'retry-exhausted') {
				const retry = append(row, $('button.basehalf-canvas-card-badge-issue-action')) as HTMLButtonElement;
				retry.type = 'button';
				retry.textContent = 'Retry';
				retry.setAttribute('data-testid', 'badge-save-retry');
				addListener(this.view.addDisposableListener(retry, 'click', event => {
					event.preventDefault();
					event.stopPropagation();
					const current = this.badgeDescriptionDrafts.get(key);
					if (current !== draft || current.recovery !== 'retry-exhausted') {
						return;
					}
					if (!this.view.workspaceMutationCoordinator.isResourceStampCurrent(current.node.workspaceFolder, current.identityStamp)) {
						current.recovery = 'identity-changed';
						this.archiveBadgeDescriptionDraft(key, current);
						this.badgeDescriptionDrafts.delete(key);
						this.setBadgeDescriptionSaveState(current.node, 'error');
						refresh('prompt');
						return;
					}
					current.recovery = undefined;
					this.scheduleBadgeDescriptionWrite(current.node, current.value, current.guard);
					this.flushBadgeDescriptionWrite(current.node.workspaceFolder, current.node.relativePath);
				}));
			} else {
				const copy = append(row, $('button.basehalf-canvas-card-badge-issue-action')) as HTMLButtonElement;
				copy.type = 'button';
				copy.textContent = 'Copy draft';
				copy.setAttribute('data-testid', 'badge-save-copy');
				addListener(this.view.addDisposableListener(copy, 'click', event => {
					event.preventDefault();
					event.stopPropagation();
					void this.copyBadgeDescriptionRecovery(draft.value);
				}));
			}

			const discard = append(row, $('button.basehalf-canvas-card-badge-issue-action.subtle')) as HTMLButtonElement;
			discard.type = 'button';
			discard.textContent = 'Discard';
			discard.setAttribute('data-testid', 'badge-save-discard');
			addListener(this.view.addDisposableListener(discard, 'click', event => {
				event.preventDefault();
				event.stopPropagation();
				this.discardBadgeDescriptionRecovery(key, draft);
				refresh('prompt');
			}));
		}
	}

	private fitBadgePrompt(prompt: HTMLTextAreaElement, mountAttempt = 0): void {
		if (!prompt.isConnected) {
			if (mountAttempt < 8) {
				mainWindow.requestAnimationFrame(() => this.fitBadgePrompt(prompt, mountAttempt + 1));
			}
			return;
		}
		prompt.style.height = 'auto';
		prompt.style.height = `${prompt.scrollHeight}px`;
		prompt.classList.toggle('scrollable', prompt.scrollHeight > prompt.clientHeight + 1);
	}

	private toggleBadgeFace(path: string): void {
		if (this.view.openBadgeFaces.has(path)) {
			const folder = this.view.getCurrentFolder();
			if (folder) {
				this.flushBadgeDescriptionWrite(folder.workspaceFolder, path);
			}
			this.view.openBadgeFaces.delete(path);
			this.pendingCanvasBadgeFocus = { path, target: 'toggle' };
		} else {
			this.view.openBadgeFaces.add(path);
			this.pendingCanvasBadgeFocus = { path, target: 'prompt' };
		}
		this.view.requestRender();
	}

	private badgeDescriptionKey(workspaceFolder: URI, relativePath: string): string {
		return `${workspaceFolder.toString()}\0${relativePath}`;
	}

	/**
	 * Writes a node's one-line description to its `badge.yaml` (under the
	 * caller's workspace mutation lease). `badge.yaml` holds no references
	 * (D37); the mirror keeps any legacy reference keys verbatim. An empty
	 * description on an otherwise-empty badge retires it.
	 */
	private writeBadgeDescription(node: IBaseHalfBadgeNode, description: string): Promise<IBaseHalfBadgeFile | null> {
		const trimmed = description.trim();
		return this.view.badgeMirrorService.patchBadge(node, current => {
			if (current === null && !trimmed) {
				return null;
			}
			const base: IBaseHalfBadgeFile = current ?? { path: node.relativePath, kind: node.kind };
			const next: IBaseHalfBadgeFile = { ...base, description: trimmed || undefined };
			return !next.description && next.orphan !== true ? null : next;
		});
	}

	badgeMetadataWithDraft(
		workspaceFolder: URI,
		relativePath: string,
		badge: IBaseHalfCanvasBadgeMetadata | undefined,
		resourceIdentity: string
	): IBaseHalfCanvasBadgeMetadata | undefined {
		const key = this.badgeDescriptionKey(workspaceFolder, relativePath);
		const draft = this.badgeDescriptionDrafts.get(key);
		if (!draft) {
			return badge;
		}
		const identityTransition = baseHalfTransitionBadgeDraftIdentity(
			draft,
			this.badgeDescriptionRecoveryDrafts.get(key) ?? [],
			this.view.workspaceMutationCoordinator.captureResource(workspaceFolder, relativePath),
			resourceIdentity
		);
		if (identityTransition.identityChanged) {
			draft.recovery = 'identity-changed';
			this.badgeDescriptionRecoveryDrafts.set(key, [...identityTransition.retained]);
			this.badgeDescriptionDrafts.delete(key);
			this.setBadgeDescriptionSaveState(draft.node, 'error');
			return badge;
		}
		return {
			description: draft.value,
			orphan: badge?.orphan
		};
	}

	private setBadgeDescriptionSaveState(node: IBaseHalfBadgeNode, state: BaseHalfBadgeDescriptionSaveState): void {
		const key = this.badgeDescriptionKey(node.workspaceFolder, node.relativePath);
		this.badgeDescriptionSaveStates.set(key, state);
		const face = this.view.renderedCardElementsByPath.get(node.relativePath)
			?.querySelector<HTMLElement>('.basehalf-canvas-card-badge-face');
		if (face) {
			face.setAttribute('data-badge-save-state', state);
			face.setAttribute('aria-busy', String(state === 'pending' || state === 'retrying'));
		}
	}

	private scheduleBadgeDescriptionWrite(
		node: IBaseHalfBadgeNode,
		value: string,
		guard: IBaseHalfCanvasMutationGuard,
		retryAttempt = 0
	): void {
		const key = this.badgeDescriptionKey(node.workspaceFolder, node.relativePath);
		if (guard.workspaceKey !== node.workspaceFolder.toString()) {
			return;
		}
		const existingDraft = this.badgeDescriptionDrafts.get(key);
		const identityTransition = baseHalfTransitionBadgeDraftIdentity(
			existingDraft,
			this.badgeDescriptionRecoveryDrafts.get(key) ?? [],
			guard.resourceStamp,
			guard.resourceIdentity
		);
		if (identityTransition.identityChanged) {
			// A path can disappear and later be recreated. Keep the original draft
			// recoverable, but never retarget it to the new resource identity.
			// The incoming value was edited in the old draft surface, so retain that
			// latest keystroke as part of the archived draft before showing the new
			// resource's canonical value.
			existingDraft!.value = value;
			existingDraft!.recovery = 'identity-changed';
			this.badgeDescriptionRecoveryDrafts.set(key, [...identityTransition.retained]);
			this.badgeDescriptionDrafts.delete(key);
			this.setBadgeDescriptionSaveState(existingDraft!.node, 'error');
			this.view.renderer.scheduleBackgroundRender();
			return;
		}
		if (existingDraft?.recovery === 'identity-changed') {
			this.setBadgeDescriptionSaveState(existingDraft.node, 'error');
			return;
		}
		this.badgeDescriptionDrafts.set(key, {
			node,
			guard,
			identityStamp: guard.resourceStamp,
			resourceIdentity: guard.resourceIdentity,
			value
		});
		this.setBadgeDescriptionSaveState(node, retryAttempt > 0 ? 'retrying' : 'pending');
		const existing = this.view.badgeDescriptionTimers.get(key);
		if (existing !== undefined) {
			mainWindow.clearTimeout(existing);
			this.view.badgeDescriptionTimers.delete(key);
		}
		const current = this.view.badgeDescriptionPending.get(key);
		if (current) {
			if (!baseHalfResourceMutationStampsEqual(current.identityStamp, guard.resourceStamp)
				|| current.resourceIdentity !== guard.resourceIdentity) {
				return;
			}
			current.value = value;
			if (retryAttempt === 0) {
				current.retryAttempt = 0;
			}
			if (!current.delayReleased) {
				this.view.badgeDescriptionTimers.set(key, mainWindow.setTimeout(() => this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath), BASEHALF_AUTO_SAVE_DELAY_MS));
			}
			return;
		}

		let releaseDelay!: () => void;
		const delay = new Promise<void>(resolve => releaseDelay = resolve);
		const pending: IBaseHalfBadgeDescriptionPending = {
			node,
			guard,
			identityStamp: guard.resourceStamp,
			resourceIdentity: guard.resourceIdentity,
			value,
			retryAttempt,
			delayReleased: false,
			delay,
			releaseDelay
		};
		this.view.badgeDescriptionPending.set(key, pending);
		// Badge notes debounce at the same cadence as file auto-save so every
		// user edit reaches disk with one perceived delay. The workspace FIFO is
		// reserved NOW, so a later rename waits for this authored note and then
		// carries it instead of letting a timer recreate the old path afterwards.
		this.view.badgeDescriptionTimers.set(key, mainWindow.setTimeout(() => this.flushBadgeDescriptionWrite(node.workspaceFolder, node.relativePath), BASEHALF_AUTO_SAVE_DELAY_MS));
		let writtenValue: string | undefined;
		pending.write = guard.run(async lease => {
			await delay;
			if (this.view.badgeDescriptionPending.get(key) !== pending) {
				return;
			}
			writtenValue = pending.value;
			const live = await this.view.resolveLiveWorkspaceNodes(node.workspaceFolder, [{ path: node.relativePath, kind: node.kind }]);
			await this.writeBadgeDescription(live.get(node.relativePath)!, writtenValue);
		}).then(() => {
			if (this.view.badgeDescriptionPending.get(key) === pending) {
				this.view.badgeDescriptionPending.delete(key);
			}
			this.clearBadgeDescriptionTimer(key);
			const draft = this.badgeDescriptionDrafts.get(key);
			if (writtenValue !== undefined && draft?.value === writtenValue) {
				this.badgeDescriptionDrafts.delete(key);
				this.setBadgeDescriptionSaveState(node, this.badgeDescriptionRecoveryDrafts.has(key) ? 'error' : 'saved');
			} else if (draft) {
				this.scheduleBadgeDescriptionWrite(draft.node, draft.value, draft.guard);
			}
			this.view.renderer.scheduleBackgroundRender();
		}).catch(async error => {
			if (this.view.badgeDescriptionPending.get(key) === pending) {
				this.view.badgeDescriptionPending.delete(key);
			}
			this.clearBadgeDescriptionTimer(key);
			this.view.logService.error(error);
			await this.recoverBadgeDescriptionWrite(key, pending, error);
		});
	}

	private async recoverBadgeDescriptionWrite(
		key: string,
		failed: IBaseHalfBadgeDescriptionPending,
		error: unknown
	): Promise<void> {
		const draft = this.badgeDescriptionDrafts.get(key);
		if (!draft) {
			return;
		}
		if (!baseHalfResourceMutationStampsEqual(draft.identityStamp, failed.identityStamp)
			|| draft.resourceIdentity !== failed.resourceIdentity) {
			// The failed write belongs to an older path identity. The active draft
			// was authored against the replacement and can start its own guarded
			// transaction now that the old pending slot has settled.
			if (!draft.recovery) {
				this.scheduleBadgeDescriptionWrite(draft.node, draft.value, draft.guard);
				this.flushBadgeDescriptionWrite(draft.node.workspaceFolder, draft.node.relativePath);
			}
			return;
		}
		let live = false;
		let liveResourceIdentity: string | undefined;
		try {
			const stat = await this.view.fileService.stat(draft.node.resource);
			live = draft.node.kind === 'folder' ? stat.isDirectory : stat.isFile;
			if (live) {
				liveResourceIdentity = baseHalfBadgeResourceIdentity(stat);
			}
		} catch {
			live = false;
		}
		const identityCurrent = this.view.workspaceMutationCoordinator.isResourceStampCurrent(
			draft.node.workspaceFolder,
			draft.identityStamp
		) && draft.resourceIdentity === liveResourceIdentity;
		const disposition = baseHalfBadgeDraftFailureDisposition(live, identityCurrent, failed.retryAttempt);
		if (disposition === 'archive-missing') {
			draft.recovery = 'resource-missing';
			this.archiveBadgeDescriptionDraft(key, draft);
			if (this.badgeDescriptionDrafts.get(key) === draft) {
				this.badgeDescriptionDrafts.delete(key);
			}
			this.setBadgeDescriptionSaveState(draft.node, 'error');
			this.view.queueCanvasWarning(`Badge prompt was not saved because '${draft.node.relativePath}' no longer exists. Recreate the path to copy or discard the retained draft.`);
			const recoveryAction = await this.view.dialogService.prompt<'copy' | 'discard'>({
				type: 'warning',
				message: `Badge draft retained for missing '${draft.node.relativePath}'`,
				detail: 'The draft was not written anywhere. You can copy it now, keep it until this path is restored, or explicitly discard it.',
				buttons: [
					{ label: 'Copy draft', run: () => 'copy' },
					{ label: 'Discard draft', run: () => 'discard' }
				],
				cancelButton: 'Keep draft'
			});
			if (recoveryAction.result === 'copy') {
				await this.copyBadgeDescriptionRecovery(draft.value);
			} else if (recoveryAction.result === 'discard') {
				this.discardBadgeDescriptionRecovery(key, draft);
			}
			this.view.renderer.scheduleBackgroundRender();
			return;
		}
		if (disposition === 'archive-replaced') {
			draft.recovery = 'identity-changed';
			this.archiveBadgeDescriptionDraft(key, draft);
			if (this.badgeDescriptionDrafts.get(key) === draft) {
				this.badgeDescriptionDrafts.delete(key);
			}
			this.setBadgeDescriptionSaveState(draft.node, 'error');
			this.view.queueCanvasWarning(`Badge prompt was not saved because '${draft.node.relativePath}' was replaced. The draft is still available to copy or discard.`);
			this.view.renderer.scheduleBackgroundRender();
			return;
		}

		if (disposition === 'retry') {
			await new Promise<void>(resolve => mainWindow.setTimeout(resolve, 50 * (failed.retryAttempt + 1)));
			const latest = this.badgeDescriptionDrafts.get(key);
			if (latest
				&& !latest.recovery
				&& baseHalfResourceMutationStampsEqual(latest.identityStamp, failed.identityStamp)
				&& latest.resourceIdentity === failed.resourceIdentity) {
				this.scheduleBadgeDescriptionWrite(
					latest.node,
					latest.value,
					latest.guard,
					failed.retryAttempt + 1
				);
				this.flushBadgeDescriptionWrite(latest.node.workspaceFolder, latest.node.relativePath);
				return;
			}
		}

		draft.recovery = 'retry-exhausted';
		this.setBadgeDescriptionSaveState(draft.node, 'error');
		this.view.queueCanvasWarning(`Badge prompt could not be saved after retrying. The draft is still available: ${error instanceof Error ? error.message : String(error)}`);
		this.view.renderer.scheduleBackgroundRender();
	}

	private archiveBadgeDescriptionDraft(key: string, draft: IBaseHalfBadgeDescriptionDraft): void {
		let archived = this.badgeDescriptionRecoveryDrafts.get(key);
		if (!archived) {
			archived = [];
			this.badgeDescriptionRecoveryDrafts.set(key, archived);
		}
		if (!archived.includes(draft)) {
			archived.push(draft);
		}
	}

	private discardBadgeDescriptionRecovery(key: string, draft: IBaseHalfBadgeDescriptionDraft): void {
		if (this.badgeDescriptionDrafts.get(key) === draft) {
			this.badgeDescriptionDrafts.delete(key);
		}
		const archived = this.badgeDescriptionRecoveryDrafts.get(key);
		if (archived?.includes(draft)) {
			const remaining = baseHalfDiscardRetainedBadgeDraft(archived, draft);
			if (remaining.length > 0) {
				this.badgeDescriptionRecoveryDrafts.set(key, [...remaining]);
			} else {
				this.badgeDescriptionRecoveryDrafts.delete(key);
			}
		}
		if (!this.badgeDescriptionDrafts.has(key) && !this.badgeDescriptionRecoveryDrafts.has(key)) {
			this.badgeDescriptionSaveStates.delete(key);
		}
		this.clearBadgeDescriptionTimer(key);
	}

	private clearBadgeDescriptionTimer(key: string): void {
		const timer = this.view.badgeDescriptionTimers.get(key);
		if (timer !== undefined) {
			mainWindow.clearTimeout(timer);
			this.view.badgeDescriptionTimers.delete(key);
		}
	}

	flushBadgeDescriptionWrite(workspaceFolder: URI, path: string): void {
		const key = this.badgeDescriptionKey(workspaceFolder, path);
		let pending = this.view.badgeDescriptionPending.get(key);
		if (!pending) {
			const draft = this.badgeDescriptionDrafts.get(key);
			if (draft && !draft.recovery) {
				this.scheduleBadgeDescriptionWrite(draft.node, draft.value, draft.guard);
				pending = this.view.badgeDescriptionPending.get(key);
			}
		}
		if (!pending) {
			return;
		}
		this.clearBadgeDescriptionTimer(key);
		pending.delayReleased = true;
		pending.releaseDelay();
	}

	async flushAllBadgeDescriptionWrites(): Promise<void> {
		for (const [key, draft] of this.badgeDescriptionDrafts) {
			if (!draft.recovery && !this.view.badgeDescriptionPending.has(key)) {
				this.scheduleBadgeDescriptionWrite(draft.node, draft.value, draft.guard);
			}
		}
		while (this.view.badgeDescriptionPending.size > 0) {
			const pending = [...this.view.badgeDescriptionPending.values()];
			for (const write of pending) {
				this.flushBadgeDescriptionWrite(write.node.workspaceFolder, write.node.relativePath);
			}
			await Promise.all(pending.map(write => write.write).filter((write): write is Promise<void> => !!write));
			if (pending.every(write => this.view.badgeDescriptionPending.get(this.badgeDescriptionKey(write.node.workspaceFolder, write.node.relativePath)) === write)) {
				break;
			}
		}
	}

	async vetoShutdownForUnsavedCanvasDrafts(): Promise<boolean> {
		if (!await this.view.canvasNavigationService.flushActiveEditor()) {
			return true;
		}
		return this.vetoShutdownForUnsavedBadgeDrafts();
	}

	private async vetoShutdownForUnsavedBadgeDrafts(): Promise<boolean> {
		await this.flushAllBadgeDescriptionWrites();
		const activeRecoveries = [...this.badgeDescriptionDrafts.values()].filter(draft => !!draft.recovery);
		const archivedRecoveries = [...this.badgeDescriptionRecoveryDrafts.values()].flat();
		const recoveries = [...activeRecoveries, ...archivedRecoveries];
		const count = recoveries.length;
		if (count === 0) {
			return false;
		}

		const result = await this.view.dialogService.prompt<'stay' | 'discard'>({
			type: 'warning',
			message: count === 1 ? 'A Badge draft is not saved' : `${count} Badge drafts are not saved`,
			detail: 'Stay to retry visible drafts or restore missing paths. You can also copy every retained draft with its path. Closing now requires explicitly discarding them.',
			buttons: [
				{ label: 'Stay and review', run: () => 'stay' },
				{
					label: count === 1 ? 'Copy draft' : 'Copy drafts',
					run: async () => {
						await this.copyBadgeDescriptionRecovery(recoveries.map(draft => (
							`# ${draft.node.relativePath}\n\n${draft.value}`
						)).join('\n\n---\n\n'));
						return 'stay' as const;
					}
				},
				{ label: count === 1 ? 'Discard draft and close' : 'Discard drafts and close', run: () => 'discard' }
			],
			cancelButton: true
		});
		if (baseHalfShouldVetoForBadgeDrafts(count, result.result)) {
			return true;
		}

		for (const [key, draft] of this.badgeDescriptionDrafts) {
			if (draft.recovery) {
				this.badgeDescriptionDrafts.delete(key);
				this.badgeDescriptionSaveStates.delete(key);
			}
		}
		for (const key of this.badgeDescriptionRecoveryDrafts.keys()) {
			this.badgeDescriptionSaveStates.delete(key);
		}
		this.badgeDescriptionRecoveryDrafts.clear();
		return false;
	}

	private copyBadgeDescriptionRecovery(value: string): Promise<boolean> {
		return baseHalfCopyRetainedBadgeDraft(
			() => this.view.clipboardService.writeText(value),
			error => {
				this.view.logService.error(error instanceof Error ? error : String(error));
				this.view.queueCanvasWarning(`Could not copy the retained Badge draft. It is still available: ${error instanceof Error ? error.message : String(error)}`);
				this.view.renderer.scheduleBackgroundRender();
			}
		);
	}

	/**
	 * The card detail's Badge zone: the SAME badge that flips on the canvas
	 * card, editable from the detail header while reading the file. This is
	 * where "this file has a human note" stays visible without pushing the
	 * document down, including who points at it.
	 */
	async renderDetailBadge(
		cardDetail: IBaseHalfCardDetailState,
		openOverride?: boolean,
		focusToggle = false,
		focusEditorControl?: BaseHalfBadgeEditorFocusTarget
	): Promise<void> {
		const seq = ++this.view.detailBadgeSeq;
		const structuralStamp = this.view.detailResourceMutationStamp;
		if (!structuralStamp || structuralStamp.relativePath !== cardDetail.relativePath
			|| !this.view.workspaceMutationCoordinator.isResourceStampCurrent(cardDetail.workspaceFolder, structuralStamp)) {
			return;
		}
		const bodyId = `basehalf-card-detail-badge-popover-${seq}`;
		const node: IBaseHalfBadgeNode = {
			resource: cardDetail.resource,
			workspaceFolder: cardDetail.workspaceFolder,
			relativePath: cardDetail.relativePath,
			kind: 'file'
		};
		let resourceIdentity: string;
		try {
			const stat = await this.view.fileService.stat(node.resource);
			if (!stat.isFile) {
				return;
			}
			resourceIdentity = baseHalfBadgeResourceIdentity(stat);
		} catch {
			return;
		}

		let badge: IBaseHalfBadgeFile | null;
		let ownProblem: IBaseHalfBadgeReadProblem | undefined;
		let upstream: IBaseHalfUpstreamView | undefined;
		try {
			// The description lives in badge.yaml; the connections come from the
			// node's own store, read directly so the Upstream list never depends
			// on enumeration (D37).
			const badgeRead = await this.view.badgeMirrorService.readBadges([node]);
			badge = badgeRead.badges.get(node.relativePath) ?? null;
			ownProblem = badgeRead.problems.find(problem => problem.relativePath === node.relativePath);
			if (ownProblem) {
				this.view.logService.warn(`BaseHalf badge metadata issue for ${ownProblem.relativePath}: ${ownProblem.detail}`);
			}
			try {
				upstream = await this.view.referenceIndexService.readUpstream(node);
			} catch (error) {
				this.view.logService.warn(`BaseHalf card detail upstream list unreadable for ${node.relativePath}`, error);
			}
		} catch (error) {
			this.view.logService.warn(`BaseHalf card detail badge graph unreadable for ${node.relativePath}`, error);
			// Keep the last rendered Badge intact. A transient provider failure
			// must not turn a known-good graph snapshot into an empty UI.
			if (!this.view.disposed && seq === this.view.detailBadgeSeq && !this.view.detailBadgeZone.hasChildNodes()
				&& this.view.workspaceMutationCoordinator.isResourceStampCurrent(cardDetail.workspaceFolder, structuralStamp)) {
				this.view.detailBadgeDisposables.clear();
				this.view.detailBadgeOpen = false;
				this.view.detailBadgeZone.classList.remove('open');
				const retry = append(this.view.detailBadgeZone, $('button.basehalf-card-detail-badge-toggle.issue')) as HTMLButtonElement;
				retry.type = 'button';
				retry.title = localize('basehalf.cardDetail.badge.unavailable', "Badge unavailable - retry");
				retry.setAttribute('aria-label', localize('basehalf.cardDetail.badge.unavailableAria', "Badge unavailable. Retry"));
				retry.setAttribute('aria-expanded', 'false');
				retry.setAttribute('data-testid', 'card-detail-badge-toggle');
				retry.setAttribute('data-badge-unavailable', 'true');
				this.view.cardRenderer.renderGlyph(retry, 'badge', 'var(--vscode-editorWarning-foreground)', 15);
				this.view.detailBadgeDisposables.add(this.view.addDisposableListener(retry, 'click', () => void this.renderDetailBadge(cardDetail, false, true)));
			}
			return;
		}
		if (this.view.disposed || seq !== this.view.detailBadgeSeq
			|| !this.view.workspaceMutationCoordinator.isResourceStampCurrent(cardDetail.workspaceFolder, structuralStamp)) {
			return;
		}
		try {
			if (baseHalfBadgeResourceIdentity(await this.view.fileService.stat(node.resource)) !== resourceIdentity) {
				this.view.renderer.scheduleBackgroundRender();
				return;
			}
		} catch {
			return;
		}
		const badgeForDisplay = this.badgeMetadataWithDraft(cardDetail.workspaceFolder, node.relativePath, badge ?? undefined, resourceIdentity);
		// Never rebuild under the user's cursor during a background refresh. This
		// protects textarea edits AND keyboard navigation among Badge controls.
		// The collapsed toggle is the exception: it has no editable state, so its
		// summary may refresh in place while keyboard focus is restored to the new
		// toggle. Explicit open/close renders pass openOverride and may rebuild.
		const active = this.view.detailBadgeZone.ownerDocument.activeElement;
		const restoreCollapsedToggleFocus = openOverride === undefined
			&& !this.view.detailBadgeOpen
			&& isHTMLElement(active)
			&& active.getAttribute('data-testid') === 'card-detail-badge-toggle';
		if (openOverride === undefined && active && this.view.detailBadgeZone.contains(active) && !restoreCollapsedToggleFocus) {
			this.refreshDetailBadgeAfterFocusLeaves(cardDetail);
			return;
		}
		this.view.detailBadgeRefreshAfterFocusLeaves = false;

		this.view.detailBadgeDisposables.clear();
		clearNode(this.view.detailBadgeZone);
		const open = openOverride ?? this.view.detailBadgeOpen;
		this.view.detailBadgeOpen = open;
		this.view.detailBadgeZone.classList.toggle('open', open);

		const toggle = append(this.view.detailBadgeZone, $('button.basehalf-card-detail-badge-toggle')) as HTMLButtonElement;
		toggle.type = 'button';
		toggle.title = open ? 'Hide Badge' : 'Show Badge';
		toggle.setAttribute('aria-label', open ? 'Hide Badge' : 'Show Badge');
		toggle.setAttribute('aria-expanded', String(open));
		toggle.setAttribute('aria-haspopup', 'dialog');
		toggle.setAttribute('data-testid', 'card-detail-badge-toggle');
		if (open) {
			toggle.setAttribute('aria-controls', bodyId);
		}
		// The badge glyph is the toolbar action's identity: accent-toned once
		// the file carries a note or connections, ghost while empty.
		const indexState = this.view.referenceIndexService.getState(node.workspaceFolder);
		const downstream = indexState === 'building' ? [] : this.view.referenceIndexService.getDownstream(node);
		const upstreamCount = upstream?.entries.filter(entry => entry.status === 'valid').length ?? 0;
		const upstreamIssueCount = upstream?.issueCount ?? 0;
		const badgeIssueCount = upstreamIssueCount + (ownProblem ? 1 : 0);
		const hasRelationships = upstreamCount > 0 || downstream.length > 0;
		const hasContent = !!badgeForDisplay?.description?.trim() || hasRelationships || badgeIssueCount > 0;
		const connectionSummary = hasRelationships || upstreamIssueCount > 0 || indexState === 'building'
			? this.view.upstreamActions.summary(upstream, downstream, indexState)
			: undefined;
		toggle.classList.toggle('issue', badgeIssueCount > 0);
		toggle.setAttribute('data-reference-issue-count', String(badgeIssueCount));
		const toggleAction = open ? localize('basehalf.cardDetail.badge.hide', "Hide Badge") : localize('basehalf.cardDetail.badge.show', "Show Badge");
		toggle.title = connectionSummary ? `${connectionSummary} - ${toggleAction}` : toggleAction;
		toggle.setAttribute('aria-label', connectionSummary ? `${toggleAction}, ${connectionSummary}` : toggleAction);
		this.view.cardRenderer.renderGlyph(toggle, 'badge', badgeIssueCount > 0 ? 'var(--vscode-editorWarning-foreground)' : hasContent ? 'var(--vscode-textLink-foreground)' : 'var(--basehalf-detail-badge-ghost)', 15);
		if (badgeIssueCount > 0) {
			const marker = append(toggle, $('.basehalf-reference-issue-marker.detail'));
			marker.setAttribute('data-testid', 'card-detail-reference-issue-marker');
			marker.setAttribute('data-reference-issue-count', String(badgeIssueCount));
			marker.setAttribute('aria-hidden', 'true');
		}
		const title = append(toggle, $('span.basehalf-card-detail-badge-title'));
		title.textContent = 'Badge';
		const chevron = append(toggle, $('span.basehalf-card-detail-badge-chevron.codicon.codicon-chevron-down'));
		chevron.setAttribute('aria-hidden', 'true');
		const summary = append(toggle, $('span.basehalf-card-detail-badge-summary'));
		if (!open) {
			// "↑N upstream · ↓M downstream · K issues", after the description.
			const description = badgeForDisplay?.description;
			summary.textContent = description && connectionSummary
				? `${description} · ${connectionSummary}`
				: description ?? connectionSummary ?? localize('basehalf.cardDetail.badge.descriptionPlaceholder', "One line about this file…");
			summary.classList.toggle('empty', !description && !connectionSummary);
		}
		this.view.detailBadgeDisposables.add(this.view.addDisposableListener(toggle, 'click', () => {
			if (open) {
				this.closeDetailBadgePopover(cardDetail, true);
				return;
			}

			this.view.detailBadgeOpen = true;
			void this.renderDetailBadge(cardDetail, true, false, 'prompt');
		}));
		if (focusToggle || restoreCollapsedToggleFocus) {
			mainWindow.setTimeout(() => {
				if (!this.view.disposed && seq === this.view.detailBadgeSeq && this.view.detailBadgeZone.contains(toggle)) {
					toggle.focus();
				}
			}, 0);
		}

		if (!open) {
			return;
		}

		const body = append(this.view.detailBadgeZone, $('.basehalf-card-detail-badge-body'));
		body.id = bodyId;
		body.tabIndex = -1;
		body.setAttribute('role', 'dialog');
		body.setAttribute('aria-label', 'Badge');
		const editorControls = this.renderBadgeEditorContent(
			body,
			node,
			badgeForDisplay,
			ownProblem,
			{ upstream, downstream, indexState },
			this.view.resourceMutationGuard(cardDetail.workspaceFolder, structuralStamp, resourceIdentity),
			disposable => this.view.detailBadgeDisposables.add(disposable),
			focusTarget => {
				const current = this.view.canvasNavigationService.state.cardDetail;
				if (!current || current.resource.toString() !== cardDetail.resource.toString()) {
					this.view.requestRender();
					return;
				}
				const open = this.view.detailBadgeOpen;
				void this.renderDetailBadge(current, open, false, open ? focusTarget : undefined);
			}
		);
		if (focusEditorControl) {
			mainWindow.setTimeout(() => {
				if (this.view.disposed || seq !== this.view.detailBadgeSeq) {
					return;
				}
				const target = focusEditorControl === 'prompt'
					? editorControls.prompt
					: focusEditorControl === 'add-upstream'
						? editorControls.addUpstream ?? editorControls.addDownstream
						: editorControls.addDownstream;
				(target ?? toggle).focus();
			}, 0);
		}
		this.view.detailBadgeDisposables.add(this.view.addDisposableListener(body.ownerDocument, 'pointerdown', event => {
			const target = event.target;
			if (target instanceof Node && this.view.detailBadgeZone.contains(target)) {
				return;
			}
			this.closeDetailBadgePopover(cardDetail, false);
		}, true));
		this.view.detailBadgeDisposables.add(this.view.addDisposableListener(mainWindow, 'keydown', event => {
			if (event.key !== 'Escape' || event.isComposing) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			this.closeDetailBadgePopover(cardDetail, true);
		}, true));
	}

	/** A disk refresh never replaces a focused control inside the Badge zone.
	 * Keep one deferred refresh while the user Tabs between its controls, then
	 * apply the latest graph snapshot once focus leaves the zone. If that exit
	 * releases an authored description write, its completion already schedules
	 * the canonical refresh. */
	private refreshDetailBadgeAfterFocusLeaves(cardDetail: IBaseHalfCardDetailState): void {
		if (this.view.detailBadgeRefreshAfterFocusLeaves) {
			return;
		}
		this.view.detailBadgeRefreshAfterFocusLeaves = true;
		const listener = this.view.addDisposableListener(this.view.detailBadgeZone, 'focusout', () => {
			mainWindow.setTimeout(() => {
				if (!this.view.detailBadgeRefreshAfterFocusLeaves) {
					return;
				}
				const active = this.view.detailBadgeZone.ownerDocument.activeElement;
				if (active && this.view.detailBadgeZone.contains(active)) {
					return;
				}
				listener?.dispose();
				this.view.detailBadgeRefreshAfterFocusLeaves = false;
				if (this.view.badgeDescriptionPending.has(this.badgeDescriptionKey(cardDetail.workspaceFolder, cardDetail.relativePath))) {
					return;
				}
				const current = this.view.canvasNavigationService.state.cardDetail;
				if (!this.view.disposed && current
					&& current.workspaceFolder.toString() === cardDetail.workspaceFolder.toString()
					&& current.relativePath === cardDetail.relativePath) {
					void this.renderDetailBadge(current);
				}
			}, 0);
		});
		this.view.detailBadgeDisposables.add(listener);
	}

	closeDetailBadgePopover(cardDetail: IBaseHalfCardDetailState, restoreFocus: boolean): void {
		if (!this.view.detailBadgeOpen) {
			return;
		}

		const key = this.badgeDescriptionKey(cardDetail.workspaceFolder, cardDetail.relativePath);
		const draft = this.badgeDescriptionDrafts.get(key);
		const prompt = this.view.detailBadgeZone.querySelector<HTMLTextAreaElement>('.basehalf-canvas-card-badge-prompt');
		if (draft && prompt) {
			this.scheduleBadgeDescriptionWrite(draft.node, prompt.value, draft.guard);
		}
		this.flushBadgeDescriptionWrite(cardDetail.workspaceFolder, cardDetail.relativePath);
		this.view.detailBadgeOpen = false;
		this.hideDetailBadgePopoverNow();
		void this.renderDetailBadge(cardDetail, false, restoreFocus);
	}

	private hideDetailBadgePopoverNow(): void {
		this.view.detailBadgeZone.classList.remove('open');
		this.view.detailBadgeZone.querySelector('.basehalf-card-detail-badge-body')?.remove();
		const toggle = this.view.detailBadgeZone.querySelector<HTMLButtonElement>('[data-testid="card-detail-badge-toggle"]');
		if (!toggle) {
			return;
		}

		toggle.title = 'Show Badge';
		toggle.setAttribute('aria-label', 'Show Badge');
		toggle.setAttribute('aria-expanded', 'false');
		toggle.removeAttribute('aria-controls');
	}
}
