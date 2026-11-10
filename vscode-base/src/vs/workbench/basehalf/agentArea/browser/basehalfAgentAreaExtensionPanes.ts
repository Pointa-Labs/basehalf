/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { IBaseHalfAgentAreaSession, BaseHalfExtensionAgentSessionKind, baseHalfAgentSessionChoiceForKind } from '../common/basehalfAgentArea.js';
import { DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { agentTabForPane } from '../common/basehalfAgentTabsModel.js';
import { EXTENSION_INSTALL_SKIP_PUBLISHER_TRUST_CONTEXT } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { BaseHalfExtensionAgentUnavailableError } from './basehalfExtensionAgentProvider.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { areSameExtensions } from '../../../../platform/extensionManagement/common/extensionManagementUtil.js';
import { EnablementState } from '../../../services/extensionManagement/common/extensionManagement.js';
import { ProgressLocation } from '../../../../platform/progress/common/progress.js';
import type { BaseHalfAgentAreaService, IBaseHalfRuntimeAgentSession } from './basehalfAgentAreaService.js';

/**
 * The panes that an agent extension draws: making a session for an extension's view, waiting for the extension,
 * offering to install it, and taking its view into the pane.
 *
 * A part of the Agent Area (`basehalfAgentAreaService.ts`): it reaches the Agent Area's state as `area`.
 */
export class BaseHalfAgentAreaExtensionPanes {
	constructor(private readonly area: BaseHalfAgentAreaService) { }

	// ── Terminal + extension pane wiring ───────────────────────────────────────

	async createExtensionAgentSession(kind: BaseHalfExtensionAgentSessionKind): Promise<IBaseHalfAgentAreaSession> {
		const choice = baseHalfAgentSessionChoiceForKind(kind);
		const existing = [...this.area.runtime.values()].find(session => session.kind === kind && !session.closing && session.state !== 'disposed');
		if (existing && agentTabForPane(this.area.tabsState, existing.id)) {
			if (existing.state === 'failed' || existing.state === 'unavailable') {
				await this.initializeExtensionPane(existing);
			}
			await this.area.focusSession(existing.id);
			return this.area.snapshotSession(existing);
		}

		const session = this.area.createRuntimeSession(kind, choice.label, choice.description);
		this.area.openPaneInNewTab(session.id, true);
		await this.area.show(true);
		await this.initializeExtensionPane(session);
		return this.area.snapshotSession(session);
	}

	/**
	 * A canonical extension container briefly opened and closed again (its pane
	 * steals the single webview instance while visible). Cycle visibility on the
	 * Agent Area's ready extension panes so their view panes re-claim.
	 */
	reassertExtensionClaims(): void {
		for (const session of this.area.runtime.values()) {
			if (session.extensionSetVisible && session.state === 'ready' && session.host.classList.contains('active')) {
				session.extensionSetVisible(false);
				session.extensionSetVisible(true);
				session.extensionLayout?.();
			}
		}
	}

	async initializeExtensionPane(session: IBaseHalfRuntimeAgentSession): Promise<void> {
		const kind = session.kind as BaseHalfExtensionAgentSessionKind;
		const choice = baseHalfAgentSessionChoiceForKind(kind);

		if (session.extensionDispose) {
			const dispose = session.extensionDispose;
			session.extensionDispose = undefined;
			session.extensionSetVisible = undefined;
			session.extensionLayout = undefined;
			session.extensionFocus = undefined;
			await dispose();
		}
		session.state = 'starting';
		session.detail = undefined;
		this.area.surface.clearSessionStatePanel(session);
		this.area.render();

		// Curated agent extensions declare they do not support untrusted
		// workspaces, so in Restricted Mode they never register and the session
		// would fail with a confusing "not installed" message. Gate on trust and
		// offer the concrete next step instead.
		if (!this.area.workspaceTrustManagementService.isWorkspaceTrusted()) {
			session.state = 'unavailable';
			session.detail = `${choice.label} needs a trusted workspace. Trust this folder to let curated agent extensions run.`;
			this.area.surface.renderSessionStatePanel(session, {
				label: 'Trust Workspace',
				run: async () => {
					const trusted = await this.area.workspaceTrustRequestService.requestWorkspaceTrust({
						message: `${choice.label} runs as a workspace extension and requires you to trust this folder.`
					});
					if (trusted) {
						await this.initializeExtensionPane(session);
					}
				}
			});
			this.area.render();
			await this.area.focusSession(session.id);
			return;
		}

		// The curated agent extension must be installed, enabled, and registered
		// before the provider can adopt its view. Offer the concrete next step
		// (install, enable, or reload) instead of a dead-end message.
		if (choice.extensionId) {
			session.detail = `Checking ${choice.extensionId}…`;
			this.area.surface.renderSessionStatePanel(session);
			this.area.render();
			await this.area.extensionService.whenInstalledExtensionsRegistered();
			if (this.area.runtime.get(session.id) !== session) {
				return;
			}
			const registered = await this.area.extensionService.getExtension(choice.extensionId);
			if (this.area.runtime.get(session.id) !== session) {
				return;
			}
			if (!registered) {
				await this.presentExtensionSetupState(session, choice.extensionId);
				return;
			}
			session.detail = undefined;
			this.area.surface.clearSessionStatePanel(session);
		}

		const provider = this.area.extensionProviders.get(kind);
		if (!provider) {
			session.state = 'unavailable';
			const extensionClause = choice.extensionId ? ` Install or enable ${choice.extensionId}` : ' Enable the curated extension';
			const slotClause = choice.requiresExtensionSlot ? ` and have it register ${choice.requiresExtensionSlot}` : '';
			session.detail = `${choice.label} is unavailable.${extensionClause}${slotClause}; stock VS Code Chat/Copilot/Sessions UI stays hidden in BaseHalf.`;
			this.area.surface.renderSessionStatePanel(session);
			this.area.render();
			return;
		}

		try {
			const result = await provider.createSession(kind, session.surface);
			session.label = result.label ?? session.label;
			session.description = result.description ?? session.description;
			session.detail = result.detail;
			session.extensionSetVisible = result.setVisible;
			session.extensionLayout = result.layout;
			session.extensionFocus = result.focus;
			session.extensionDispose = result.dispose;
			session.state = 'ready';
			this.area.render();
			await this.area.surface.focusActivePane();
		} catch (error) {
			if (error instanceof BaseHalfExtensionAgentUnavailableError) {
				session.state = 'unavailable';
				session.detail = error.message;
				this.area.surface.renderSessionStatePanel(session);
				this.area.render();
			} else {
				this.area.markSessionFailed(session, error);
			}
		}
	}

	/**
	 * The session's extension is not registered with the extension host.
	 * Distinguish "not installed", "installed but disabled", and "installed but
	 * not yet scanned", and surface the matching primary action.
	 */
	private async presentExtensionSetupState(session: IBaseHalfRuntimeAgentSession, extensionId: string): Promise<void> {
		const choice = baseHalfAgentSessionChoiceForKind(session.kind);
		await this.area.extensionsWorkbenchService.whenInitialized;
		if (this.area.runtime.get(session.id) !== session) {
			return;
		}

		const local = this.area.extensionsWorkbenchService.installed.find(extension => areSameExtensions(extension.identifier, { id: extensionId }));
		if (local && (local.enablementState === EnablementState.DisabledGlobally || local.enablementState === EnablementState.DisabledWorkspace)) {
			session.state = 'unavailable';
			session.detail = `${extensionId} is installed but disabled. Enable it to start ${choice.label}.`;
			this.area.surface.renderSessionStatePanel(session, {
				label: 'Enable Extension',
				run: async () => {
					const enablementState = local.enablementState === EnablementState.DisabledWorkspace
						? EnablementState.EnabledWorkspace
						: EnablementState.EnabledGlobally;
					await this.area.extensionsWorkbenchService.setEnablement(local, enablementState);
					await this.finishExtensionSetup(session.id, extensionId);
				}
			});
			this.area.render();
			return;
		}

		if (local) {
			// Installed and enabled, but the extension host has not picked it up.
			session.state = 'unavailable';
			session.detail = `${extensionId} is installed but has not registered with the extension host yet. Reload the window to finish enabling it.`;
			this.area.surface.renderSessionStatePanel(session, {
				label: 'Reload Window',
				run: () => this.area.hostService.reload()
			});
			this.area.render();
			return;
		}

		if (!this.area.extensionGalleryService.isEnabled()) {
			session.state = 'unavailable';
			session.detail = `${choice.label} requires the ${extensionId} extension, and no extension gallery is available to install it from.`;
			this.area.surface.renderSessionStatePanel(session);
			this.area.render();
			return;
		}

		session.state = 'unavailable';
		session.detail = 'Not installed.';
		this.area.surface.renderSessionStatePanel(session, {
			label: `Install ${choice.label}`,
			run: () => this.installExtensionForSession(session.id, extensionId)
		});
		this.area.render();
	}

	private async installExtensionForSession(sessionId: string, extensionId: string): Promise<void> {
		const session = this.area.runtime.get(sessionId);
		if (!session) {
			return;
		}
		session.state = 'starting';
		session.detail = 'Installing…';
		session.statePrimaryAction = undefined;
		this.area.surface.renderSessionStatePanel(session);
		this.area.render();
		try {
			// One click installs it (D122): BaseHalf has chosen this extension by its identity, so
			// that the question whether to trust its publisher is not the user's. The publisher is
			// not named as trusted in the product, which would also take away the delay of its updates.
			await this.area.extensionsWorkbenchService.install(extensionId, { context: { [EXTENSION_INSTALL_SKIP_PUBLISHER_TRUST_CONTEXT]: true } }, ProgressLocation.Notification);
		} catch (error) {
			const current = this.area.runtime.get(sessionId);
			if (current !== session) {
				return;
			}
			current.state = 'unavailable';
			current.detail = `Installing ${extensionId} failed: ${error instanceof Error ? error.message : String(error)}`;
			this.area.surface.renderSessionStatePanel(current, {
				label: `Install ${baseHalfAgentSessionChoiceForKind(current.kind).label}`,
				run: () => this.installExtensionForSession(sessionId, extensionId)
			});
			this.area.render();
			return;
		}
		await this.finishExtensionSetup(sessionId, extensionId);
	}

	/** Wait for the extension host to register the extension, then remount. */
	private async finishExtensionSetup(sessionId: string, extensionId: string): Promise<void> {
		const registered = await this.whenExtensionRegistered(extensionId, 15_000);
		const session = this.area.runtime.get(sessionId);
		if (!session) {
			return;
		}
		if (!registered) {
			session.state = 'unavailable';
			session.detail = `${extensionId} is installed but has not registered with the extension host yet. Reload the window to finish enabling it.`;
			this.area.surface.renderSessionStatePanel(session, {
				label: 'Reload Window',
				run: () => this.area.hostService.reload()
			});
			this.area.render();
			return;
		}
		await this.initializeExtensionPane(session);
	}

	private async whenExtensionRegistered(extensionId: string, timeoutMs: number): Promise<boolean> {
		if (await this.area.extensionService.getExtension(extensionId)) {
			return true;
		}
		return new Promise<boolean>(resolve => {
			const disposables = new DisposableStore();
			const timer = mainWindow.setTimeout(() => {
				disposables.dispose();
				resolve(false);
			}, timeoutMs);
			disposables.add(toDisposable(() => mainWindow.clearTimeout(timer)));
			disposables.add(this.area.extensionService.onDidChangeExtensions(async () => {
				if (await this.area.extensionService.getExtension(extensionId)) {
					disposables.dispose();
					resolve(true);
				}
			}));
		});
	}
}
