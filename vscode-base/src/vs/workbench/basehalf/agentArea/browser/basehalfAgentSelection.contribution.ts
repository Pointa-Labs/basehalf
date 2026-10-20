/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import './media/basehalfAgentSelection.css';
import { $, append, clearNode, scheduleAtNextAnimationFrame } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { RunOnceScheduler, Sequencer } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { dirname, isEqual } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { FileOperationError, FileOperationResult, IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import {
	BASEHALF_AGENT_SELECTION_SEGMENTS,
	BASEHALF_AGENT_SELECTION_WRITE_DELAY_MS,
	BaseHalfAgentSelection,
	baseHalfAgentSelectionFor,
	baseHalfAgentSelectionLabel,
	IBaseHalfAgentSelectionInput,
	IBaseHalfAgentSelectionService,
	serializeBaseHalfAgentSelection
} from '../common/basehalfAgentSelection.js';
import { IBaseHalfAgentSkillService } from '../common/basehalfAgentSkill.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { baseHalfEnsureMirrorIgnoreFile } from '../../workspace/common/basehalfMirrorIgnore.js';
import { baseHalfAssertBhPathComponentsNotSymbolicLink } from '../../workspace/common/basehalfMirrorTree.js';
import { renderBaseHalfItemGlyph } from '../../shell/browser/basehalfItemGlyph.js';

export function baseHalfAgentSelectionResource(workspaceFolder: URI): URI {
	return URI.joinPath(workspaceFolder, ...BASEHALF_AGENT_SELECTION_SEGMENTS);
}

/**
 * Keeps the record of what the user selected last in this window, in
 * `.bh/cache/selection.yaml` of the workspace folder (the selection agents can
 * see, "The record"). It writes the record only while the current BaseHalf
 * skill is installed for at least one agent, never in a marked folder, and
 * removes it when the window closes.
 */
export class BaseHalfAgentSelectionService extends Disposable implements IBaseHalfAgentSelectionService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<BaseHalfAgentSelection | undefined>());
	readonly onDidChange = this._onDidChange.event;

	private _current: BaseHalfAgentSelection | undefined;
	get current(): BaseHalfAgentSelection | undefined {
		return this._current;
	}

	private input: IBaseHalfAgentSelectionInput | undefined;
	/** `undefined` until the first check: until then nothing is written or removed. */
	private skillInstalled: boolean | undefined;
	/** The record this window wrote, as it wrote it. */
	private written: { readonly workspaceFolder: URI; readonly resource: URI; readonly content: string } | undefined;
	/** Write the record even when it did not change: this window was used last. */
	private rewrite = false;
	/** Records left in this window's folders are removed once each time the skill is found missing. */
	private leftoversRemoved = false;
	private skillChecks = 0;
	/** What the last write found of each workspace folder's marker. */
	private readonly markedFolders = new Map<string, boolean>();
	private readonly writes = new Sequencer();
	private readonly writer = this._register(new RunOnceScheduler(() => void this.sync(), BASEHALF_AGENT_SELECTION_WRITE_DELAY_MS));
	private closing = false;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfAgentSkillService private readonly skillService: IBaseHalfAgentSkillService,
		@IHostService hostService: IHostService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(skillService.onDidChange(() => void this.checkSkill()));
		this._register(hostService.onDidChangeFocus(focused => {
			if (focused) {
				// With two windows on one folder, the record is the one used
				// last: a window that gains focus writes its own again. The skill
				// may also have been installed or removed elsewhere meanwhile.
				this.rewrite = true;
				void this.checkSkill();
			}
		}));
		this._register(lifecycleService.onWillShutdown(event => {
			this.closing = true;
			this.writer.cancel();
			event.join(this.writes.queue(() => this.removeWritten()), { id: 'basehalf.agentSelection', label: localize('basehalf.agentSelection.removing', "Removing the record of the selection agents can see") });
		}));
		void this.checkSkill();
	}

	update(input: IBaseHalfAgentSelectionInput | undefined): void {
		this.input = input;
		if (this.closing) {
			return;
		}
		// The window shows a new selection at once; the record follows when
		// the selection settles.
		if (this.skillInstalled) {
			this.setCurrent(input && this.markedFolders.get(input.workspaceFolder.toString()) !== true ? baseHalfAgentSelectionFor(input) : undefined);
		}
		this.writer.schedule();
	}

	/** Writes or removes the record now. Resolves when it is done. */
	flush(): Promise<void> {
		this.writer.cancel();
		return this.sync();
	}

	private async checkSkill(): Promise<void> {
		const check = ++this.skillChecks;
		let installed = false;
		try {
			installed = this.skillService.available && (await this.skillService.inspect()).some(location => location.state === 'current');
		} catch (error) {
			this.logService.warn('[BaseHalf] could not check whether the agent skill is installed', error);
		}
		if (check !== this.skillChecks) {
			// A later check, after an install or a removal, decides.
			return;
		}
		this.skillInstalled = installed;
		if (!this.closing) {
			this.writer.schedule();
		}
	}

	private sync(): Promise<void> {
		return this.writes.queue(async () => {
			if (this.closing) {
				return;
			}
			const input = this.input;
			if (this.skillInstalled === undefined) {
				return;
			}
			if (!this.skillInstalled) {
				await this.removeWritten();
				if (!this.leftoversRemoved) {
					this.leftoversRemoved = true;
					await this.removeLeftovers();
				}
				this.setCurrent(undefined);
				return;
			}
			this.leftoversRemoved = false;
			const marked = input ? await baseHalfIsWorkspaceFolderMarked(this.fileService, input.workspaceFolder) : false;
			if (input) {
				this.markedFolders.set(input.workspaceFolder.toString(), marked);
			}
			if (!input || marked) {
				await this.removeWritten();
				this.setCurrent(undefined);
				return;
			}
			const selection = baseHalfAgentSelectionFor(input);
			const content = serializeBaseHalfAgentSelection(selection);
			const resource = baseHalfAgentSelectionResource(input.workspaceFolder);
			if (this.written && !isEqual(this.written.resource, resource)) {
				await this.removeWritten();
			}
			if (this.rewrite || this.written?.content !== content) {
				this.rewrite = false;
				try {
					await this.write(input.workspaceFolder, resource, content);
					this.written = { workspaceFolder: input.workspaceFolder, resource, content };
				} catch (error) {
					// What this window wrote before is still there: remove it, so
					// that nothing is stored that the window does not show.
					this.logService.error('[BaseHalf] could not write the record of the selection agents can see', error);
					await this.removeWritten();
					this.setCurrent(undefined);
					return;
				}
			}
			this.setCurrent(selection);
		});
	}

	/**
	 * Without the current skill no window of this machine keeps a record, so
	 * one in a folder of this window was left by a window that ended without
	 * closing, such as in a crash.
	 */
	private async removeLeftovers(): Promise<void> {
		for (const folder of this.contextService.getWorkspace().folders) {
			const resource = baseHalfAgentSelectionResource(folder.uri);
			try {
				if (await baseHalfIsWorkspaceFolderMarked(this.fileService, folder.uri) || !await this.fileService.exists(resource)) {
					continue;
				}
				await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, folder.uri, resource);
				await this.fileService.del(resource);
			} catch (error) {
				this.logService.warn('[BaseHalf] could not remove a record of the selection agents can see that a closed window left', error);
			}
		}
	}

	private async write(workspaceFolder: URI, resource: URI, content: string): Promise<void> {
		// The ignore file comes first, so that git never shows the record.
		await baseHalfEnsureMirrorIgnoreFile(this.fileService, workspaceFolder);
		await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		await this.fileService.createFolder(dirname(resource));
		await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, workspaceFolder, resource);
		// Written whole through a temporary file, so an agent never reads half
		// of it. BaseHalf's ignore file hides the temporary name too.
		await this.fileService.writeFile(resource, VSBuffer.fromString(content), { atomic: { postfix: '.basehalf-tmp' } });
	}

	/** Removes the record this window wrote, unless another window has written its own since. */
	private async removeWritten(): Promise<void> {
		const written = this.written;
		if (!written) {
			return;
		}
		this.written = undefined;
		try {
			await baseHalfAssertBhPathComponentsNotSymbolicLink(this.fileService, written.workspaceFolder, written.resource);
			const content = (await this.fileService.readFile(written.resource)).value.toString();
			if (content !== written.content) {
				return;
			}
			await this.fileService.del(written.resource);
		} catch (error) {
			if (!(error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND)) {
				this.logService.warn('[BaseHalf] could not remove the record of the selection agents can see', error);
			}
		}
	}

	private setCurrent(selection: BaseHalfAgentSelection | undefined): void {
		if (JSON.stringify(selection) === JSON.stringify(this._current)) {
			return;
		}
		this._current = selection;
		this._onDidChange.fire(selection);
	}
}

registerSingleton(IBaseHalfAgentSelectionService, BaseHalfAgentSelectionService, InstantiationType.Delayed);

/** The status bar entry's id; its element carries it too. */
export const BASEHALF_AGENT_SELECTION_STATUS_ID = 'basehalf.agentSelection';
/** The gap between the Agent Area's left edge and the room the entry can take. */
const STATUS_INSET = 8;
/** The share of the room under the Agent Area that the entry can take, from its right end. */
const STATUS_SHARE = 0.6;
/** The widest the entry is while the Agent Area is hidden. */
const STATUS_ALONE_MAX_WIDTH = 240;

/**
 * Shows at the right end of the status bar, under the Agent Area, what the
 * record holds, exactly while it exists (the selection agents can see, "What
 * the window shows"). It is a reminder: it has no command.
 */
export class BaseHalfAgentSelectionStatusContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.basehalfAgentSelectionStatus';

	private readonly entry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());
	private readonly element = $('span.basehalf-agent-selection');
	private readonly icon = append(this.element, $('span.basehalf-agent-selection-icon'));
	private readonly text = append(this.element, $('span.basehalf-agent-selection-text'));
	private readonly observer = this._register(new MutableDisposable<IDisposable>());
	private readonly pendingLayout = this._register(new MutableDisposable<IDisposable>());

	constructor(
		@IBaseHalfAgentSelectionService selectionService: IBaseHalfAgentSelectionService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super();
		this._register(selectionService.onDidChange(selection => this.show(selection)));
		this._register(layoutService.onDidChangePartVisibility(() => this.layout()));
		this.show(selectionService.current);
	}

	private show(selection: BaseHalfAgentSelection | undefined): void {
		if (!selection) {
			this.entry.clear();
			this.observer.clear();
			this.pendingLayout.clear();
			return;
		}
		const label = baseHalfAgentSelectionLabel(selection);
		const text = label.count !== undefined
			? localize('basehalf.agentSelection.cards', "{0} cards selected", label.count)
			: label.text;
		clearNode(this.icon);
		renderBaseHalfItemGlyph(this.icon, label.icon, 'currentColor', 14);
		this.text.textContent = text;
		const entry: IStatusbarEntry = {
			name: localize('basehalf.agentSelection.name', "Selection Agents Can See"),
			text: '',
			ariaLabel: localize('basehalf.agentSelection.ariaLabel', "Agents can see: {0}", text),
			tooltip: localize('basehalf.agentSelection.tooltip', "Agents that use the BaseHalf skill can see this."),
			content: this.element
		};
		if (this.entry.value) {
			this.entry.value.update(entry);
		} else {
			this.entry.value = this.statusbarService.addEntry(entry, BASEHALF_AGENT_SELECTION_STATUS_ID, StatusbarAlignment.RIGHT, Number.MAX_SAFE_INTEGER);
		}
		this.layout();
	}

	/** Lays the entry out at the next frame: after the status bar has put it in the window, or after a size changed. */
	private scheduleLayout(): void {
		this.pendingLayout.value = scheduleAtNextAnimationFrame(mainWindow, () => this.layout());
	}

	/** Lays the entry out again whenever the Agent Area or the entries of the status bar change size. */
	private observe(item: HTMLElement): void {
		const observer = new mainWindow.ResizeObserver(() => this.scheduleLayout());
		for (const target of [this.layoutService.getContainer(mainWindow, Parts.AUXILIARYBAR_PART), item, item.parentElement]) {
			if (target) {
				observer.observe(target);
			}
		}
		this.observer.value = toDisposable(() => observer.disconnect());
	}

	/**
	 * The entry is the leftmost of the right group, so its right edge is where
	 * the entries to its right end. It is as wide as its text, and at most
	 * the share of the room under the Agent Area, so that it stays to the right.
	 */
	private layout(): void {
		const item = this.element.parentElement;
		if (!item || !this.entry.value) {
			return;
		}
		if (!item.isConnected) {
			// The status bar puts a new entry into the window after it is added.
			this.scheduleLayout();
			return;
		}
		if (!this.observer.value) {
			this.observe(item);
		}
		item.classList.add('basehalf-agent-selection-item');
		const agentArea = this.layoutService.isVisible(Parts.AUXILIARYBAR_PART, mainWindow)
			? this.layoutService.getContainer(mainWindow, Parts.AUXILIARYBAR_PART)
			: undefined;
		item.style.width = '';
		if (!agentArea) {
			item.style.maxWidth = `${STATUS_ALONE_MAX_WIDTH}px`;
			return;
		}
		// The group of left entries stretches up to the right group, so the
		// bound is where its last shown entry ends, not where the group does.
		let leftEntriesEnd = 0;
		for (const leftEntry of item.parentElement?.previousElementSibling?.children ?? []) {
			const box = leftEntry.getBoundingClientRect();
			if (box.width > 0) {
				leftEntriesEnd = Math.max(leftEntriesEnd, box.right);
			}
		}
		const left = Math.max(agentArea.getBoundingClientRect().left + STATUS_INSET, leftEntriesEnd + STATUS_INSET);
		const right = item.getBoundingClientRect().right;
		item.style.maxWidth = `${Math.max(0, Math.floor((right - left) * STATUS_SHARE))}px`;
	}
}

registerWorkbenchContribution2(BaseHalfAgentSelectionStatusContribution.ID, BaseHalfAgentSelectionStatusContribution, WorkbenchPhase.AfterRestored);
