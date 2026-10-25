/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { env } from '../../../../base/common/process.js';
import { dirname, isEqual, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IBaseHalfFileLinksService } from '../../../../platform/basehalfFiles/common/basehalfFileLinks.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationHandle, INotificationService, NotificationPriority, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import {
	BASEHALF_AGENT_SKILL_COPY_SEGMENTS,
	BASEHALF_AGENT_SKILL_FILE_NAME,
	BASEHALF_AGENT_SKILL_MARKDOWN,
	BASEHALF_AGENT_SKILL_TARGETS,
	BaseHalfAgentSkillAgent,
	baseHalfAgentSkillCopyTakesBundledText,
	BaseHalfAgentSkillOffer,
	baseHalfAgentSkillOffer,
	BaseHalfAgentSkillState,
	baseHalfAgentSkillState,
	baseHalfIsAgentSkillText,
	IBaseHalfAgentSkillInstallResult,
	IBaseHalfAgentSkillLocation,
	IBaseHalfAgentSkillService,
	IBaseHalfAgentSkillTarget
} from '../common/basehalfAgentSkill.js';
import { BaseHalfSetting } from '../../shell/common/basehalfConfiguration.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { baseHalfPlainFailureReason } from '../../shell/common/basehalfPlainFailureReason.js';

/** Set once the user answered the offer with Don't Ask Again or removed the skill (this machine). */
export const BASEHALF_AGENT_SKILL_DECLINED_STORAGE_KEY = 'basehalf.agentSkill.declined';
export const BASEHALF_INSTALL_AGENT_SKILL_COMMAND_ID = 'basehalf.agentSkill.install';
export const BASEHALF_REMOVE_AGENT_SKILL_COMMAND_ID = 'basehalf.agentSkill.remove';
/** What the status bar entry runs while the offer is unanswered. It is not in the Command Palette. */
export const BASEHALF_SHOW_AGENT_SKILL_OFFER_COMMAND_ID = 'basehalf.agentSkill.showOffer';

/** Why a location was left as it is, in BaseHalf's own words: something of the user's is there. */
class BaseHalfAgentSkillInTheWay extends Error { }

export class BaseHalfAgentSkillService extends Disposable implements IBaseHalfAgentSkillService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	/** Installing, removing, and keeping the copy current happen one at a time. */
	private readonly changes = new Sequencer();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IBaseHalfFileLinksService private readonly linksService: IBaseHalfFileLinksService,
		@IPathService private readonly pathService: IPathService,
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	get available(): boolean {
		// The agents' skill folders are in the home folder of the machine the
		// agents run on, which only a local desktop window can write.
		return !isWeb && !this.remoteAgentService.getConnection();
	}

	async inspect(): Promise<readonly IBaseHalfAgentSkillLocation[]> {
		const home = await this.home();
		const copy = joinPath(home, ...BASEHALF_AGENT_SKILL_COPY_SEGMENTS);
		return Promise.all(BASEHALF_AGENT_SKILL_TARGETS.map(async target => {
			const resource = joinPath(home, ...target.segments);
			let state: BaseHalfAgentSkillState;
			try {
				state = baseHalfAgentSkillState(await this.linksService.inspect(resource), copy);
			} catch (error) {
				// A location that cannot be read decides nothing for the other.
				this.logService.warn(`[BaseHalf] could not look at the agent skill for ${target.label}`, error);
				state = 'other';
			}
			return { ...target, resource, state };
		}));
	}

	async isInstalledFor(agent: BaseHalfAgentSkillAgent): Promise<boolean> {
		const locations = await this.inspect();
		return locations.some(location => location.agent === agent && location.state !== 'missing');
	}

	refresh(): Promise<void> {
		return this.changes.queue(async () => {
			if (!this.available || !(await this.inspect()).some(location => location.state === 'linked')) {
				return;
			}
			await this.writeCopy(joinPath(await this.home(), ...BASEHALF_AGENT_SKILL_COPY_SEGMENTS));
		});
	}

	install(): Promise<IBaseHalfAgentSkillInstallResult> {
		return this.changes.queue(async () => {
			const home = await this.home();
			const copy = joinPath(home, ...BASEHALF_AGENT_SKILL_COPY_SEGMENTS);
			const installed: IBaseHalfAgentSkillTarget[] = [];
			const failed: { target: IBaseHalfAgentSkillTarget; reason: string }[] = [];
			try {
				await this.writeCopy(copy);
			} catch (error) {
				// Without the copy a link would show the agents nothing.
				this.logService.error('[BaseHalf] BaseHalf\'s own copy of the agent skill could not be written', error);
				const reason = baseHalfPlainFailureReason(error);
				return { installed, failed: BASEHALF_AGENT_SKILL_TARGETS.map(target => ({ target, reason })) };
			}
			for (const target of BASEHALF_AGENT_SKILL_TARGETS) {
				// Each location is made on its own: one that fails does not
				// stop the other.
				try {
					const resource = joinPath(home, ...target.segments);
					const entry = await this.linksService.inspect(resource);
					if (entry.kind === 'file') {
						throw new BaseHalfAgentSkillInTheWay(localize('basehalf.agentSkill.fileInTheWay', "a file of that name is in the way"));
					}
					if (entry.kind === 'folder') {
						await this.removeEarlierCopy(resource);
					}
					await this.linksService.link(resource, copy);
					installed.push(target);
				} catch (error) {
					this.logService.error(`[BaseHalf] the agent skill could not be installed for ${target.label}`, error);
					failed.push({ target, reason: error instanceof BaseHalfAgentSkillInTheWay ? error.message : baseHalfPlainFailureReason(error) });
				}
			}
			this._onDidChange.fire();
			return { installed, failed };
		});
	}

	remove(): Promise<boolean> {
		return this.changes.queue(async () => {
			const home = await this.home();
			const copy = joinPath(home, ...BASEHALF_AGENT_SKILL_COPY_SEGMENTS);
			let removed = false;
			try {
				for (const target of BASEHALF_AGENT_SKILL_TARGETS) {
					const resource = joinPath(home, ...target.segments);
					const entry = await this.linksService.inspect(resource);
					// A link to anywhere else is not BaseHalf's.
					if (entry.kind === 'link' && isEqual(entry.target, copy)) {
						removed = await this.linksService.unlink(resource) || removed;
					} else if (entry.kind === 'folder') {
						removed = await this.removeEarlierSkillFile(resource) || removed;
					}
				}
				// BaseHalf's own copy goes whole, after the links that point at it.
				if (await this.fileService.exists(copy)) {
					await this.fileService.del(copy, { recursive: true });
				}
				await this.removeIfEmpty(dirname(copy));
			} finally {
				// Also after a failure: what was removed before it is gone.
				this._onDidChange.fire();
			}
			return removed;
		});
	}

	private async home(): Promise<URI> {
		// The smoke points the skill at a folder of its own run, so that it
		// never reads or changes the agents' settings of the machine it runs
		// on. Moving the whole window's home folder instead would lose the
		// keychain. The product never sets it.
		const smokeHome = env['BASEHALF_SMOKE_AGENT_SKILL_HOME'];
		return smokeHome ? URI.file(smokeHome) : this.pathService.userHome({ preferLocal: true });
	}

	/** Writes the bundled text into BaseHalf's own copy, unless the copy holds it or a higher version. */
	private async writeCopy(copy: URI): Promise<void> {
		const resource = joinPath(copy, BASEHALF_AGENT_SKILL_FILE_NAME);
		if (!baseHalfAgentSkillCopyTakesBundledText(await this.read(resource))) {
			return;
		}
		await this.fileService.createFolder(copy);
		// Written whole through a temporary file of its own, so that an agent
		// never reads half of it, also while another BaseHalf writes it.
		await this.fileService.writeFile(resource, VSBuffer.fromString(BASEHALF_AGENT_SKILL_MARKDOWN), { atomic: { postfix: `.basehalf-tmp-${generateUuid()}` } });
	}

	/**
	 * A copy that an earlier release left in an agent's folder goes only when
	 * it holds nothing but its `SKILL.md`, and that file is BaseHalf's skill.
	 */
	private async removeEarlierCopy(folder: URI): Promise<void> {
		const children = (await this.fileService.resolve(folder)).children ?? [];
		const text = await this.read(joinPath(folder, BASEHALF_AGENT_SKILL_FILE_NAME));
		if (children.some(child => child.name !== BASEHALF_AGENT_SKILL_FILE_NAME) || text === undefined || !baseHalfIsAgentSkillText(text)) {
			throw new BaseHalfAgentSkillInTheWay(localize('basehalf.agentSkill.folderInTheWay', "a folder of that name holds files of your own"));
		}
		await this.fileService.del(folder, { recursive: true });
	}

	/**
	 * Deletes the `SKILL.md` that an earlier release left in an agent's folder,
	 * and the folder when it is then empty. A file of another skill stays.
	 * Resolves whether there was one.
	 */
	private async removeEarlierSkillFile(folder: URI): Promise<boolean> {
		const resource = joinPath(folder, BASEHALF_AGENT_SKILL_FILE_NAME);
		const text = await this.read(resource);
		if (text === undefined || !baseHalfIsAgentSkillText(text)) {
			return false;
		}
		await this.fileService.del(resource);
		// The folder goes with it, unless the user put something else there.
		await this.removeIfEmpty(folder);
		return true;
	}

	private async removeIfEmpty(folder: URI): Promise<void> {
		if (await this.fileService.exists(folder) && ((await this.fileService.resolve(folder)).children ?? []).length === 0) {
			await this.fileService.del(folder);
		}
	}

	/** The text of a file, or `undefined` when it does not exist. A file that
	 * cannot be read counts as other content, which the bundled text
	 * replaces. */
	private async read(resource: URI): Promise<string | undefined> {
		try {
			return (await this.fileService.readFile(resource)).value.toString();
		} catch (error) {
			return error instanceof Error && toFileOperationResult(error) === FileOperationResult.FILE_NOT_FOUND ? undefined : '';
		}
	}
}

registerSingleton(IBaseHalfAgentSkillService, BaseHalfAgentSkillService, InstantiationType.Delayed);

export const IBaseHalfAgentSkillNotifier = createDecorator<IBaseHalfAgentSkillNotifier>('baseHalfAgentSkillNotifier');

/** The user-facing half of the agent skill: the offer and the two commands. */
export interface IBaseHalfAgentSkillNotifier {
	readonly _serviceBrand: undefined;

	/**
	 * The offer while it applies and the user has not answered it (agent
	 * skill, "Offer"), whether or not this window has shown it: what the
	 * status bar entry of the selection shows while agents can see nothing.
	 */
	readonly pendingOffer: BaseHalfAgentSkillOffer | undefined;
	readonly onDidChangePendingOffer: Event<void>;
	/** Offers the skill at most once per window, in a notification that stays until it is answered. */
	offer(): Promise<void>;
	/** Shows the offer again when it applies, as the status bar entry asks, also while Do Not Disturb is on. */
	showOffer(): Promise<void>;
	/** **BaseHalf: Install Agent Skill**. */
	install(): Promise<void>;
	/** **BaseHalf: Remove Agent Skill**. */
	remove(): Promise<void>;
}

export class BaseHalfAgentSkillNotifier extends Disposable implements IBaseHalfAgentSkillNotifier {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangePendingOffer = this._register(new Emitter<void>());
	readonly onDidChangePendingOffer = this._onDidChangePendingOffer.event;

	private _pendingOffer: BaseHalfAgentSkillOffer | undefined;
	get pendingOffer(): BaseHalfAgentSkillOffer | undefined {
		return this._pendingOffer;
	}

	private offered = false;
	private checks = 0;
	/** The offer's notification while it is open. */
	private openOffer: INotificationHandle | undefined;
	private readonly openOfferListener = this._register(new MutableDisposable());

	constructor(
		@IBaseHalfAgentSkillService private readonly skillService: IBaseHalfAgentSkillService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileService private readonly fileService: IFileService,
		@IHostService hostService: IHostService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._register(skillService.onDidChange(() => void this.check()));
		this._register(contextService.onDidChangeWorkspaceFolders(() => void this.check()));
		this._register(configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(BaseHalfSetting.AgentsOfferSkill)) {
				void this.check();
			}
		}));
		this._register(hostService.onDidChangeFocus(focused => {
			if (focused) {
				// Another window may have installed or removed the skill meanwhile.
				void this.check();
			}
		}));
		// The answer of another window counts here at once.
		this._register(storageService.onDidChangeValue(StorageScope.APPLICATION, BASEHALF_AGENT_SKILL_DECLINED_STORAGE_KEY, this._store)(() => void this.check()));
		void this.check();
	}

	async offer(): Promise<void> {
		if (this.offered || this.contextService.getWorkspace().folders.length === 0 || !this.skillService.available) {
			return;
		}
		// Once per window, whatever the checks below decide.
		this.offered = true;
		await this.check();
		if (this._pendingOffer) {
			this.show(this._pendingOffer, false);
		}
	}

	async showOffer(): Promise<void> {
		await this.check();
		if (this._pendingOffer) {
			this.show(this._pendingOffer, true);
		}
	}

	async install(): Promise<void> {
		// Asking for the skill takes back an earlier Don't Ask Again.
		this.storageService.remove(BASEHALF_AGENT_SKILL_DECLINED_STORAGE_KEY, StorageScope.APPLICATION);
		const result = await this.skillService.install();
		for (const failure of result.failed) {
			this.notificationService.error(localize('basehalf.agentSkill.installFailed', "The BaseHalf skill could not be installed for {0}: {1}", failure.target.label, failure.reason));
		}
		if (result.failed.length === 0) {
			this.notificationService.info(localize('basehalf.agentSkill.installed', "The BaseHalf skill is installed for Claude Code and Codex, and BaseHalf keeps it up to date. Agent sessions you start from now on can use it. To take it away, use Remove Agent Skill in the Command Palette."));
		}
		// Also when nothing could be made, the answer was taken back.
		void this.check();
	}

	async remove(): Promise<void> {
		// A removal answers the offer: BaseHalf does not offer the skill again.
		this.storageService.store(BASEHALF_AGENT_SKILL_DECLINED_STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
		let removed: boolean;
		try {
			removed = await this.skillService.remove();
		} catch (error) {
			this.logService.error('[BaseHalf] the agent skill could not be removed', error);
			this.notificationService.error(localize('basehalf.agentSkill.removeFailed', "The BaseHalf skill could not be removed: {0}", baseHalfPlainFailureReason(error)));
			return;
		}
		this.notificationService.info(removed
			? localize('basehalf.agentSkill.removed', "The BaseHalf skill was removed. BaseHalf won't offer it again; Install Agent Skill brings it back.")
			: localize('basehalf.agentSkill.notInstalled', "The BaseHalf skill is not installed."));
	}

	/**
	 * Works out the offer that applies now. It becomes the pending offer unless
	 * a later check began meanwhile, which decides instead.
	 */
	private async check(): Promise<void> {
		const check = ++this.checks;
		let offer: BaseHalfAgentSkillOffer | undefined;
		try {
			offer = await this.applicableOffer();
		} catch (error) {
			// Nobody answered: what is pending stays.
			this.logService.warn('[BaseHalf] could not look for the agent skill', error);
			return;
		}
		if (check !== this.checks || offer === this._pendingOffer) {
			return;
		}
		this._pendingOffer = offer;
		if (!offer) {
			// Answered, in this window or another: an open offer has nothing
			// left to ask.
			this.openOffer?.close();
		}
		this._onDidChangePendingOffer.fire();
	}

	private async applicableOffer(): Promise<BaseHalfAgentSkillOffer | undefined> {
		const folders = this.contextService.getWorkspace().folders;
		if (folders.length === 0 || !this.skillService.available
			|| this.configurationService.getValue(BaseHalfSetting.AgentsOfferSkill) === false
			|| this.storageService.getBoolean(BASEHALF_AGENT_SKILL_DECLINED_STORAGE_KEY, StorageScope.APPLICATION, false)) {
			return undefined;
		}
		// Development sessions on the BaseHalf source tree get no product offer.
		const marked = await Promise.all(folders.map(folder => baseHalfIsWorkspaceFolderMarked(this.fileService, folder.uri)));
		if (marked.some(isMarked => isMarked)) {
			return undefined;
		}
		return baseHalfAgentSkillOffer((await this.skillService.inspect()).map(location => location.state));
	}

	private show(offer: BaseHalfAgentSkillOffer, asked: boolean): void {
		// One offer at a time: a new one replaces one that is still open.
		this.openOffer?.close();
		const purpose = localize('basehalf.agentSkill.purpose', "It tells Claude Code and Codex what you select and where a card's description and connections are.");
		const handle = this.notificationService.prompt(
			Severity.Info,
			offer === 'update'
				? localize('basehalf.agentSkill.offerUpdate', "Update the BaseHalf skill for your agents? {0} After this update, BaseHalf keeps it up to date by itself.", purpose)
				: localize('basehalf.agentSkill.offerInstall', "Install the BaseHalf skill for your agents? {0} It is added to your agents' own settings on this computer, not to this folder, and BaseHalf keeps it up to date.", purpose),
			[
				{
					label: offer === 'update' ? localize('basehalf.agentSkill.update', "Update") : localize('basehalf.agentSkill.install', "Install"),
					run: () => { void this.install(); }
				},
				{ label: localize('basehalf.agentSkill.notNow', "Not Now"), run: () => { } },
				{
					label: localize('basehalf.agentSkill.dontAskAgain', "Don't Ask Again"),
					run: () => {
						this.storageService.store(BASEHALF_AGENT_SKILL_DECLINED_STORAGE_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE);
						void this.check();
					}
				}
			],
			// It stays until it is answered. Asked for from the status bar, it
			// shows also while Do Not Disturb is on.
			{ sticky: true, priority: asked ? NotificationPriority.URGENT : undefined }
		);
		this.openOffer = handle;
		this.openOfferListener.value = handle.onDidClose(() => {
			if (this.openOffer === handle) {
				this.openOffer = undefined;
			}
		});
	}
}

registerSingleton(IBaseHalfAgentSkillNotifier, BaseHalfAgentSkillNotifier, InstantiationType.Delayed);

/**
 * Offers the agent skill when a workspace folder is open or is added, and
 * keeps BaseHalf's own copy at the bundled text when the window starts and
 * whenever it gains focus (agent skill, "Keeping it current").
 */
export class BaseHalfAgentSkillContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.agentSkill';

	constructor(
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IBaseHalfAgentSkillNotifier notifier: IBaseHalfAgentSkillNotifier,
		@IBaseHalfAgentSkillService skillService: IBaseHalfAgentSkillService,
		@IHostService hostService: IHostService,
		@ILogService logService: ILogService
	) {
		super();
		const refresh = async () => {
			try {
				await skillService.refresh();
			} catch (error) {
				logService.warn('[BaseHalf] could not bring BaseHalf\'s own copy of the agent skill up to date', error);
			}
		};
		this._register(hostService.onDidChangeFocus(focused => {
			if (focused) {
				// Another BaseHalf on this machine may have run meanwhile.
				void refresh();
			}
		}));
		this._register(contextService.onDidChangeWorkspaceFolders(() => { void notifier.offer(); }));
		void refresh();
		void notifier.offer();
	}
}

registerWorkbenchContribution2(BaseHalfAgentSkillContribution.ID, BaseHalfAgentSkillContribution, WorkbenchPhase.AfterRestored);

CommandsRegistry.registerCommand(BASEHALF_SHOW_AGENT_SKILL_OFFER_COMMAND_ID, accessor => accessor.get(IBaseHalfAgentSkillNotifier).showOffer());

registerAction2(class BaseHalfInstallAgentSkillAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_INSTALL_AGENT_SKILL_COMMAND_ID,
			title: localize2('basehalf.agentSkill.installCommand', 'Install Agent Skill'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IBaseHalfAgentSkillNotifier).install();
	}
});

registerAction2(class BaseHalfRemoveAgentSkillAction extends Action2 {
	constructor() {
		super({
			id: BASEHALF_REMOVE_AGENT_SKILL_COMMAND_ID,
			title: localize2('basehalf.agentSkill.removeCommand', 'Remove Agent Skill'),
			category: localize2('basehalf.category', 'BaseHalf'),
			f1: true
		});
	}

	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(IBaseHalfAgentSkillNotifier).remove();
	}
});
