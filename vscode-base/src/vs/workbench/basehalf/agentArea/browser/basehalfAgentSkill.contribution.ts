/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { env } from '../../../../base/common/process.js';
import { dirname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { FileOperationResult, IFileService, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import {
	BASEHALF_AGENT_SKILL_MARKDOWN,
	BASEHALF_AGENT_SKILL_TARGETS,
	BASEHALF_AGENT_SKILL_VERSION,
	BaseHalfAgentSkillAgent,
	baseHalfAgentSkillOffer,
	baseHalfAgentSkillState,
	IBaseHalfAgentSkillInstallResult,
	IBaseHalfAgentSkillLocation,
	IBaseHalfAgentSkillService,
	IBaseHalfAgentSkillTarget
} from '../common/basehalfAgentSkill.js';
import { BaseHalfSetting } from '../../shell/common/basehalfConfiguration.js';
import { baseHalfIsWorkspaceFolderMarked } from '../../workspace/common/basehalfLegacyCleanup.js';
import { baseHalfPlainFailureReason } from '../../shell/common/basehalfPlainFailureReason.js';

/** The version of the skill for which the user chose Don't Ask Again (this machine). */
export const BASEHALF_AGENT_SKILL_DECLINED_VERSION_STORAGE_KEY = 'basehalf.agentSkill.declinedVersion';
export const BASEHALF_INSTALL_AGENT_SKILL_COMMAND_ID = 'basehalf.agentSkill.install';
export const BASEHALF_REMOVE_AGENT_SKILL_COMMAND_ID = 'basehalf.agentSkill.remove';

export class BaseHalfAgentSkillService extends Disposable implements IBaseHalfAgentSkillService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	constructor(
		@IFileService private readonly fileService: IFileService,
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
		return Promise.all(BASEHALF_AGENT_SKILL_TARGETS.map(async target => {
			const resource = await this.resource(target);
			return { ...target, resource, state: baseHalfAgentSkillState(await this.read(resource)) };
		}));
	}

	async isInstalledFor(agent: BaseHalfAgentSkillAgent): Promise<boolean> {
		const locations = await this.inspect();
		return locations.some(location => location.agent === agent && location.state !== 'missing');
	}

	async install(): Promise<IBaseHalfAgentSkillInstallResult> {
		const installed: IBaseHalfAgentSkillTarget[] = [];
		const failed: { target: IBaseHalfAgentSkillTarget; reason: string }[] = [];
		for (const target of BASEHALF_AGENT_SKILL_TARGETS) {
			// Each location is written on its own: one that fails does not
			// stop the other.
			try {
				const resource = await this.resource(target);
				await this.fileService.createFolder(dirname(resource));
				await this.fileService.writeFile(resource, VSBuffer.fromString(BASEHALF_AGENT_SKILL_MARKDOWN));
				installed.push(target);
			} catch (error) {
				this.logService.error(`[BaseHalf] the agent skill could not be installed for ${target.label}`, error);
				failed.push({ target, reason: baseHalfPlainFailureReason(error) });
			}
		}
		this._onDidChange.fire();
		return { installed, failed };
	}

	async remove(): Promise<boolean> {
		let removed = false;
		try {
			for (const target of BASEHALF_AGENT_SKILL_TARGETS) {
				const resource = await this.resource(target);
				if (!await this.fileService.exists(resource)) {
					continue;
				}
				await this.fileService.del(resource);
				removed = true;
				// The skill's own folder goes with it, unless the user put
				// something else there.
				const folder = dirname(resource);
				const remaining = (await this.fileService.resolve(folder)).children ?? [];
				if (remaining.length === 0) {
					await this.fileService.del(folder);
				}
			}
		} finally {
			// Also after a failure: what was removed before it is gone.
			this._onDidChange.fire();
		}
		return removed;
	}

	private async resource(target: IBaseHalfAgentSkillTarget): Promise<URI> {
		// The smoke points the skill at a folder of its own run, so that it
		// never reads or changes the agents' settings of the machine it runs
		// on. Moving the whole window's home folder instead would lose the
		// keychain. The product never sets it.
		const smokeHome = env['BASEHALF_SMOKE_AGENT_SKILL_HOME'];
		const home = smokeHome ? URI.file(smokeHome) : await this.pathService.userHome({ preferLocal: true });
		return URI.joinPath(home, ...target.segments);
	}

	/** The installed text, or `undefined` when the file does not exist. A file
	 * that cannot be read counts as other content: installing replaces it or
	 * reports why it cannot. */
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

	/** Offers the skill, at most once per window (agent skill, "Offer"). */
	offer(): Promise<void>;
	/** **BaseHalf: Install Agent Skill**. */
	install(): Promise<void>;
	/** **BaseHalf: Remove Agent Skill**. */
	remove(): Promise<void>;
}

export class BaseHalfAgentSkillNotifier implements IBaseHalfAgentSkillNotifier {
	declare readonly _serviceBrand: undefined;

	private offered = false;

	constructor(
		@IBaseHalfAgentSkillService private readonly skillService: IBaseHalfAgentSkillService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) { }

	async offer(): Promise<void> {
		const folders = this.contextService.getWorkspace().folders;
		if (this.offered || folders.length === 0 || !this.skillService.available) {
			return;
		}
		// Once per window, whatever the checks below decide.
		this.offered = true;
		if (this.configurationService.getValue(BaseHalfSetting.AgentsOfferSkill) === false) {
			return;
		}
		if (this.storageService.get(BASEHALF_AGENT_SKILL_DECLINED_VERSION_STORAGE_KEY, StorageScope.APPLICATION) === BASEHALF_AGENT_SKILL_VERSION) {
			return;
		}
		// Development sessions on the BaseHalf source tree get no product offer.
		const marked = await Promise.all(folders.map(folder => baseHalfIsWorkspaceFolderMarked(this.fileService, folder.uri)));
		if (marked.some(isMarked => isMarked)) {
			return;
		}
		let offer: 'install' | 'update' | undefined;
		try {
			offer = baseHalfAgentSkillOffer((await this.skillService.inspect()).map(location => location.state));
		} catch (error) {
			this.logService.warn('[BaseHalf] could not look for the agent skill', error);
			return;
		}
		if (!offer) {
			return;
		}
		const purpose = localize('basehalf.agentSkill.purpose', "It tells Claude Code and Codex where a card's description and connections are. It is added to your agents' own settings on this computer, not to this folder.");
		this.notificationService.prompt(
			Severity.Info,
			offer === 'update'
				? localize('basehalf.agentSkill.offerUpdate', "A newer BaseHalf skill is available for your agents. {0}", purpose)
				: localize('basehalf.agentSkill.offerInstall', "Install the BaseHalf skill for your agents? {0}", purpose),
			[
				{
					label: offer === 'update' ? localize('basehalf.agentSkill.update', "Update") : localize('basehalf.agentSkill.install', "Install"),
					run: () => { void this.install(); }
				},
				{ label: localize('basehalf.agentSkill.notNow', "Not Now"), run: () => { } },
				{
					label: localize('basehalf.agentSkill.dontAskAgain', "Don't Ask Again"),
					run: () => this.storageService.store(BASEHALF_AGENT_SKILL_DECLINED_VERSION_STORAGE_KEY, BASEHALF_AGENT_SKILL_VERSION, StorageScope.APPLICATION, StorageTarget.MACHINE)
				}
			]
		);
	}

	async install(): Promise<void> {
		const result = await this.skillService.install();
		for (const failure of result.failed) {
			this.notificationService.error(localize('basehalf.agentSkill.installFailed', "The BaseHalf skill could not be installed for {0}: {1}", failure.target.label, failure.reason));
		}
		if (result.failed.length === 0) {
			this.notificationService.info(localize('basehalf.agentSkill.installed', "The BaseHalf skill is installed for Claude Code and Codex. Agent sessions you start from now on can use it."));
		}
	}

	async remove(): Promise<void> {
		let removed: boolean;
		try {
			removed = await this.skillService.remove();
		} catch (error) {
			this.logService.error('[BaseHalf] the agent skill could not be removed', error);
			this.notificationService.error(localize('basehalf.agentSkill.removeFailed', "The BaseHalf skill could not be removed: {0}", baseHalfPlainFailureReason(error)));
			return;
		}
		this.notificationService.info(removed
			? localize('basehalf.agentSkill.removed', "The BaseHalf skill was removed.")
			: localize('basehalf.agentSkill.notInstalled', "The BaseHalf skill is not installed."));
	}
}

registerSingleton(IBaseHalfAgentSkillNotifier, BaseHalfAgentSkillNotifier, InstantiationType.Delayed);

/** Offers the agent skill when a workspace folder is open or is added. */
export class BaseHalfAgentSkillContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.basehalf.agentSkill';

	constructor(
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IBaseHalfAgentSkillNotifier notifier: IBaseHalfAgentSkillNotifier
	) {
		super();
		this._register(contextService.onDidChangeWorkspaceFolders(() => { void notifier.offer(); }));
		void notifier.offer();
	}
}

registerWorkbenchContribution2(BaseHalfAgentSkillContribution.ID, BaseHalfAgentSkillContribution, WorkbenchPhase.AfterRestored);

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
