/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { BaseHalfSetting } from '../../shell/common/basehalfConfiguration.js';
import { baseHalfAgentSessionChoiceForKind } from '../common/basehalfAgentArea.js';
import { baseHalfAgentSessionFolderToKeep, baseHalfAgentSessionIsKept, baseHalfAgentSessionsToStart, baseHalfKeepAgentArrangement, baseHalfReadAgentArrangement, baseHalfRestoreAgentArrangement, baseHalfWriteAgentArrangement, IBaseHalfKeptAgentSession } from '../common/basehalfAgentArrangement.js';
import type { BaseHalfAgentAreaService, IBaseHalfRuntimeAgentSession } from './basehalfAgentAreaService.js';

/** Where the arrangement of a folder is kept: the workspace's storage, on this machine. */
export const BASEHALF_AGENT_ARRANGEMENT_STORAGE_KEY = 'basehalf.agentArea.arrangement';

/** The arrangement is written this long after it changed, so that a divider that is dragged is one write. */
const WRITE_DELAY_MS = 100;

/**
 * The arrangement a folder opens with (docs/specs/agent-area-terminal.md, The sessions a folder opens with): the
 * tabs and panes are read from the workspace's storage when the Agent Area is made, written as they change, and
 * the session of a restored pane starts when it is first in view.
 *
 * A part of the Agent Area (`basehalfAgentAreaService.ts`): it keeps its own state, and reaches the
 * Agent Area's as `area`.
 */
export class BaseHalfAgentAreaArrangement implements IDisposable {
	/** What the storage holds, as this window read or wrote it. */
	private written: string | undefined;
	/** The window closes: the sessions that end with it stay in what is kept. */
	private closing = false;
	/** The restored sessions that were started. */
	private readonly started = new Set<string>();
	private readonly writer = new RunOnceScheduler(() => this.write(), WRITE_DELAY_MS);

	constructor(private readonly area: BaseHalfAgentAreaService) { }

	dispose(): void {
		this.writer.dispose();
	}

	private get keeps(): boolean {
		return this.area.configurationService.getValue<boolean>(BaseHalfSetting.AgentRestoreSessions) !== false;
	}

	/**
	 * Gives the Agent Area the tabs the folder was closed with, each pane with a session that waits to start.
	 * Called once, when the Agent Area is made and has no tab yet.
	 */
	restore(): void {
		this.written = this.area.storageService.get(BASEHALF_AGENT_ARRANGEMENT_STORAGE_KEY, StorageScope.WORKSPACE);
		if (!this.keeps) {
			this.write();
			return;
		}
		const arrangement = baseHalfReadAgentArrangement(this.written);
		if (!arrangement) {
			return;
		}
		const restored = baseHalfRestoreAgentArrangement(arrangement, what => this.area.mintId(what));
		for (const kept of restored.sessions) {
			const choice = baseHalfAgentSessionChoiceForKind(kept.kind);
			const session = this.area.createRuntimeSession(kept.kind, choice.label, choice.description, kept.id);
			session.state = 'waiting';
			session.folder = kept.folder;
		}
		this.area.tabsState = restored.state;
	}

	/**
	 * Starts the sessions that are in view for the first time. A session keeps waiting, with no word of a
	 * state on its tab, until its terminal or its extension's view is there: a shell is there within a few
	 * frames, and a word that shows for that long is a flash.
	 */
	startSessionsInView(): void {
		const paneIds = baseHalfAgentSessionsToStart(this.area.tabsState, this.area.visible, paneId => this.area.runtime.get(paneId)?.state === 'waiting' && !this.started.has(paneId));
		for (const paneId of paneIds) {
			const session = this.area.runtime.get(paneId);
			if (session) {
				this.started.add(paneId);
				session.disposables.add({ dispose: () => this.started.delete(paneId) });
				void this.start(session);
			}
		}
	}

	private async start(session: IBaseHalfRuntimeAgentSession): Promise<void> {
		// A window that opens keeps the keyboard where it is. A session takes it when the keyboard is in the
		// Agent Area, or was sent to the session while it waited, as by choosing its tab, and the session is
		// still the one in front.
		const takesKeyboard = () => this.area.focused || (!!session.takesKeyboard && this.area.activeSessionId === session.id);
		if (session.kind === 'extension-codex' || session.kind === 'extension-claude') {
			await this.area.extensionPanes.initializeExtensionPane(session, takesKeyboard);
			return;
		}
		const folder = await this.existingFolder(session.folder);
		if (this.area.runtime.get(session.id) !== session || session.closing) {
			return;
		}
		const choice = baseHalfAgentSessionChoiceForKind(session.kind);
		await this.area.terminalPanes.initializeTerminalPane(session, {
			label: session.label,
			command: choice.terminalCommand,
			rawTerminalOptions: folder ? { cwd: folder } : undefined
		}, takesKeyboard);
	}

	/** The folder of a session when it is still a folder; none is the workspace folder, where a new session starts. */
	private async existingFolder(folder: string | undefined): Promise<string | undefined> {
		if (!folder) {
			return undefined;
		}
		try {
			const stat = await this.area.fileService.stat(await this.area.pathService.fileURI(folder));
			return stat.isDirectory ? folder : undefined;
		} catch {
			return undefined;
		}
	}

	/** The arrangement may have changed: it is written shortly. */
	changed(): void {
		if (!this.closing) {
			this.writer.schedule();
		}
	}

	/** `basehalf.agent.restoreSessions` changed: what is kept follows at once. */
	settingChanged(): void {
		if (!this.closing) {
			this.writer.cancel();
			this.write();
		}
	}

	/**
	 * The window is about to close. What is kept is the arrangement of this moment: the terminals that the
	 * window ends as it closes do not leave it.
	 */
	windowCloses(): void {
		if (!this.closing) {
			this.writer.cancel();
			this.write();
			this.closing = true;
		}
	}

	/** The window stays after all. */
	windowStays(): void {
		if (this.closing) {
			this.closing = false;
			this.changed();
		}
	}

	private write(): void {
		const text = this.keeps ? this.keptText() : undefined;
		if (text === this.written) {
			return;
		}
		this.written = text;
		if (text === undefined) {
			this.area.storageService.remove(BASEHALF_AGENT_ARRANGEMENT_STORAGE_KEY, StorageScope.WORKSPACE);
		} else {
			this.area.storageService.store(BASEHALF_AGENT_ARRANGEMENT_STORAGE_KEY, text, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
	}

	private keptText(): string | undefined {
		const workspaceFolder = this.area.workspaceContextService.getWorkspace().folders[0]?.uri.fsPath;
		const arrangement = baseHalfKeepAgentArrangement(this.area.tabsState, paneId => this.keptSession(paneId, workspaceFolder));
		return arrangement ? baseHalfWriteAgentArrangement(arrangement) : undefined;
	}

	private keptSession(paneId: string, workspaceFolder: string | undefined): IBaseHalfKeptAgentSession | undefined {
		const session = this.area.runtime.get(paneId);
		if (!session || session.closing || !baseHalfAgentSessionIsKept(session.state, !!session.createdByExtension)) {
			return undefined;
		}
		// The folder a terminal is in now, as the base follows it; until the terminal knows, the folder the
		// session was given.
		const terminal = session.terminal && !session.terminal.isDisposed ? session.terminal : undefined;
		return { kind: session.kind, folder: baseHalfAgentSessionFolderToKeep(terminal?.cwd || session.folder, workspaceFolder) };
	}
}
