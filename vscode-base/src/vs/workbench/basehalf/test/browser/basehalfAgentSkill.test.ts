/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from '../../../../base/common/async.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../base/common/network.js';
import { joinPath, relativePath as getRelativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { FileService } from '../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../platform/log/common/log.js';
import { INotification, INotificationHandle, IPromptChoice, IPromptOptions, Severity } from '../../../../platform/notification/common/notification.js';
import { TestNotificationService } from '../../../../platform/notification/test/common/testNotificationService.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { testWorkspace } from '../../../../platform/workspace/test/common/testWorkspace.js';
import { Workspace } from '../../../../platform/workspace/common/workspace.js';
import { IRemoteAgentService } from '../../../services/remote/common/remoteAgentService.js';
import { TestPathService } from '../../../test/browser/workbenchTestServices.js';
import { TestContextService } from '../../../test/common/workbenchTestServices.js';
import { BASEHALF_AGENT_SKILL_DECLINED_VERSION_STORAGE_KEY, BaseHalfAgentSkillNotifier, BaseHalfAgentSkillService } from '../../browser/basehalfAgentSkill.contribution.js';
import { BASEHALF_AGENT_SKILL_MARKDOWN, BASEHALF_AGENT_SKILL_VERSION } from '../../common/basehalfAgentSkill.js';

const home = URI.file('/home/user');
const folder = URI.file('/work');
const claudeSkill = '.claude/skills/basehalf/SKILL.md';
const sharedSkill = '.agents/skills/basehalf/SKILL.md';

class RecordingNotificationService extends TestNotificationService {
	readonly messages: string[] = [];
	readonly prompts: { readonly message: string; readonly choices: IPromptChoice[] }[] = [];

	override notify(notification: INotification): INotificationHandle {
		this.messages.push(String(notification.message));
		return super.notify(notification);
	}

	override prompt(severity: Severity, message: string, choices: IPromptChoice[], promptOptions?: IPromptOptions): INotificationHandle {
		this.prompts.push({ message, choices });
		return super.prompt(severity, message, choices, promptOptions);
	}
}

suite('BaseHalfAgentSkill (install and offer)', () => {
	const disposables = new DisposableStore();
	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	async function createHarness(files: Record<string, string> = {}, options: { offerSkill?: boolean; workspace?: Workspace; storage?: InMemoryStorageService } = {}) {
		const fileService = disposables.add(new FileService(new NullLogService()));
		disposables.add(fileService.registerProvider(Schemas.file, disposables.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(home);
		await fileService.createFolder(folder);
		for (const [path, content] of Object.entries(files)) {
			await fileService.writeFile(URI.file(path), VSBuffer.fromString(content));
		}
		const storage = options.storage ?? disposables.add(new InMemoryStorageService());
		const notifications = new RecordingNotificationService();
		const service = disposables.add(new BaseHalfAgentSkillService(fileService, new TestPathService(home), { getConnection: () => null } as IRemoteAgentService, new NullLogService()));
		const notifier = new BaseHalfAgentSkillNotifier(
			service,
			new TestContextService(options.workspace ?? testWorkspace(folder)),
			new TestConfigurationService({ basehalf: { agents: { offerSkill: options.offerSkill ?? true } } }),
			storage,
			notifications,
			fileService,
			new NullLogService()
		);
		const list = async (root: URI) => {
			const out: string[] = [];
			const stack = [root];
			while (stack.length) {
				const stat = await fileService.resolve(stack.pop()!);
				for (const child of stat.children ?? []) {
					if (child.isDirectory) {
						stack.push(child.resource);
					} else {
						out.push(getRelativePath(root, child.resource)!);
					}
				}
			}
			return out.sort();
		};
		return {
			fileService,
			service,
			notifier,
			notifications,
			storage,
			list,
			read: async (path: string) => (await fileService.readFile(joinPath(home, ...path.split('/')))).value.toString(),
			states: async () => (await service.inspect()).map(location => `${location.label}:${location.state}`),
			async choose(label: string) {
				const prompt = notifications.prompts[notifications.prompts.length - 1];
				prompt.choices.find(choice => choice.label === label)!.run();
				await timeout(10);
			}
		};
	}

	test('installs the bundled text for Claude Code and for the shared location, and nothing into the workspace', async () => {
		const harness = await createHarness({ '/work/note.md': '# N\n' });
		const before = await harness.states();
		const installed = await harness.service.install();
		const [claudeInstalled, sharedInstalled] = [await harness.service.isInstalledFor('claude'), await harness.service.isInstalledFor('shared')];

		await harness.fileService.writeFile(joinPath(home, ...claudeSkill.split('/')), VSBuffer.fromString(`${BASEHALF_AGENT_SKILL_MARKDOWN}\nmy own note\n`));
		const edited = await harness.states();

		assert.deepStrictEqual({
			before,
			installed: [installed.installed.map(target => target.label), installed.failed],
			home: await harness.list(home),
			bytes: [await harness.read(sharedSkill) === BASEHALF_AGENT_SKILL_MARKDOWN, claudeInstalled, sharedInstalled],
			edited,
			workspace: await harness.list(folder)
		}, {
			before: ['Claude Code:missing', 'Codex:missing'],
			installed: [['Claude Code', 'Codex'], []],
			home: [sharedSkill, claudeSkill],
			bytes: [true, true, true],
			// An edited copy is no longer the bundled text; an update replaces it.
			edited: ['Claude Code:outdated', 'Codex:current'],
			workspace: ['note.md']
		});
	});

	test('removes the skill and its folder, keeps a folder the user added to, and reports a location it cannot write', async () => {
		const harness = await createHarness({ '/home/user/.claude/skills/basehalf/notes.txt': 'mine' });
		await harness.service.install();
		const removed = await harness.service.remove();
		const afterRemove = await harness.list(home);
		const again = await harness.service.remove();

		// A file where the shared folder belongs: that location fails, the other installs.
		const blocked = await createHarness({ '/home/user/.agents': 'not a folder' });
		const partial = await blocked.service.install();
		await blocked.notifier.install();

		assert.deepStrictEqual({
			removed,
			afterRemove,
			again,
			partial: [partial.installed.map(target => target.label), partial.failed.map(failure => failure.target.label)],
			states: await blocked.states(),
			told: blocked.notifications.messages.map(message => message.replace(/: [^:]*$/, ': <reason>'))
		}, {
			removed: true,
			afterRemove: ['.claude/skills/basehalf/notes.txt'],
			again: false,
			partial: [['Claude Code'], ['Codex']],
			states: ['Claude Code:current', 'Codex:missing'],
			told: ['The BaseHalf skill could not be installed for Codex: <reason>']
		});
	});

	test('offers the skill once per window, installs it when asked, and reports removal', async () => {
		const harness = await createHarness();
		await harness.notifier.offer();
		await harness.notifier.offer();
		const offered = harness.notifications.prompts.map(prompt => [prompt.message, prompt.choices.map(choice => choice.label)]);
		await harness.choose('Install');
		await harness.notifier.remove();
		await harness.notifier.remove();

		assert.deepStrictEqual({ offered, messages: harness.notifications.messages, home: await harness.list(home) }, {
			offered: [[
				'Install the BaseHalf skill for your agents? It tells Claude Code and Codex where a card\'s description and connections are. It is added to your agents\' own settings on this computer, not to this folder.',
				['Install', 'Not Now', 'Don\'t Ask Again']
			]],
			messages: [
				'The BaseHalf skill is installed for Claude Code and Codex. Agent sessions you start from now on can use it.',
				'The BaseHalf skill was removed.',
				'The BaseHalf skill is not installed.'
			],
			home: []
		});
	});

	test('offers an update for an older copy, and no offer when there is nothing to do or the user said no', async () => {
		const older = { [`/home/user/${claudeSkill}`]: 'older text', [`/home/user/${sharedSkill}`]: BASEHALF_AGENT_SKILL_MARKDOWN };
		const current = { [`/home/user/${claudeSkill}`]: BASEHALF_AGENT_SKILL_MARKDOWN, [`/home/user/${sharedSkill}`]: BASEHALF_AGENT_SKILL_MARKDOWN };
		const offersOf = async (files: Record<string, string>, options: Parameters<typeof createHarness>[1] = {}) => {
			const harness = await createHarness(files, options);
			await harness.notifier.offer();
			return harness.notifications.prompts.map(prompt => `${prompt.message.split('.')[0].split('?')[0]} [${prompt.choices[0].label}]`);
		};

		// Don't Ask Again is remembered for this version of the skill only.
		const declined = await createHarness();
		await declined.notifier.offer();
		await declined.choose('Don\'t Ask Again');
		const earlierVersion = disposables.add(new InMemoryStorageService());
		earlierVersion.store(BASEHALF_AGENT_SKILL_DECLINED_VERSION_STORAGE_KEY, '0', StorageScope.APPLICATION, StorageTarget.MACHINE);

		assert.deepStrictEqual({
			older: await offersOf(older),
			current: await offersOf(current),
			settingOff: await offersOf({}, { offerSkill: false }),
			markedWorkspace: await offersOf({ '/work/.basehalf-no-workspace-setup': '' }),
			noFolder: await offersOf({}, { workspace: new Workspace('empty', [], false, null, () => false) }),
			declinedVersion: declined.storage.get(BASEHALF_AGENT_SKILL_DECLINED_VERSION_STORAGE_KEY, StorageScope.APPLICATION),
			afterDecline: await offersOf({}, { storage: declined.storage }),
			afterDeclineOfEarlierVersion: await offersOf({}, { storage: earlierVersion }),
			nothingWritten: await declined.list(home)
		}, {
			older: ['A newer BaseHalf skill is available for your agents [Update]'],
			current: [],
			settingOff: [],
			markedWorkspace: [],
			noFolder: [],
			declinedVersion: BASEHALF_AGENT_SKILL_VERSION,
			afterDecline: [],
			afterDeclineOfEarlierVersion: ['Install the BaseHalf skill for your agents [Install]'],
			nothingWritten: []
		});
	});
});
