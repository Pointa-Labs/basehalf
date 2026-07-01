/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import themePickerContent from './media/theme_picker.js';
import themePickerSmallContent from './media/theme_picker_small.js';
import notebookProfileContent from './media/notebookProfile.js';
import { localize } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';

interface IGettingStartedContentProvider {
	(): string;
}

class GettingStartedContentProviderRegistry {

	private readonly providers = new Map<string, IGettingStartedContentProvider>();

	registerProvider(moduleId: string, provider: IGettingStartedContentProvider): void {
		this.providers.set(moduleId, provider);
	}

	getProvider(moduleId: string): IGettingStartedContentProvider | undefined {
		return this.providers.get(moduleId);
	}
}
export const gettingStartedContentRegistry = new GettingStartedContentProviderRegistry();

export async function moduleToContent(resource: URI): Promise<string> {
	if (!resource.query) {
		throw new Error('Getting Started: invalid resource');
	}

	const query = JSON.parse(resource.query);
	if (!query.moduleId) {
		throw new Error('Getting Started: invalid resource');
	}

	const provider = gettingStartedContentRegistry.getProvider(query.moduleId);
	if (!provider) {
		throw new Error(`Getting Started: no provider registered for ${query.moduleId}`);
	}

	return provider();
}

gettingStartedContentRegistry.registerProvider('vs/workbench/contrib/welcomeGettingStarted/common/media/theme_picker', themePickerContent);
gettingStartedContentRegistry.registerProvider('vs/workbench/contrib/welcomeGettingStarted/common/media/theme_picker_small', themePickerSmallContent);
gettingStartedContentRegistry.registerProvider('vs/workbench/contrib/welcomeGettingStarted/common/media/notebookProfile', notebookProfileContent);
gettingStartedContentRegistry.registerProvider('vs/workbench/contrib/welcomeGettingStarted/common/media/empty', () => '');

export type BuiltinGettingStartedStep = {
	id: string;
	title: string;
	description: string;
	completionEvents?: string[];
	when?: string;
	media:
	| { type: 'image'; path: string | { hc: string; hcLight?: string; light: string; dark: string }; altText: string }
	| { type: 'svg'; path: string; altText: string }
	| { type: 'markdown'; path: string }
	| { type: 'video'; path: string | { hc: string; hcLight?: string; light: string; dark: string }; poster?: string | { hc: string; hcLight?: string; light: string; dark: string }; altText: string };
};

export type BuiltinGettingStartedCategory = {
	id: string;
	title: string;
	description: string;
	isFeatured: boolean;
	next?: string;
	icon: ThemeIcon;
	when?: string;
	content:
	| { type: 'steps'; steps: BuiltinGettingStartedStep[] };
	walkthroughPageTitle: string;
};

export type BuiltinGettingStartedStartEntry = {
	id: string;
	title: string;
	description: string;
	icon: ThemeIcon;
	when?: string;
	content:
	| { type: 'startEntry'; command: string };
};

type GettingStartedWalkthroughContent = BuiltinGettingStartedCategory[];
type GettingStartedStartEntryContent = BuiltinGettingStartedStartEntry[];

export const startEntries: GettingStartedStartEntryContent = [
	{
		id: 'basehalfOpenFolder',
		title: localize('gettingStarted.basehalf.openFolder.title', "Open Folder as Canvas..."),
		description: localize('gettingStarted.basehalf.openFolder.description', "Choose a folder and start from its file graph."),
		icon: Codicon.folderOpened,
		when: '!isWeb && isMac',
		content: {
			type: 'startEntry',
			command: 'command:workbench.action.files.openFolder',
		}
	},
	{
		id: 'basehalfOpenFolderOther',
		title: localize('gettingStarted.basehalf.openFolder.title', "Open Folder as Canvas..."),
		description: localize('gettingStarted.basehalf.openFolder.description', "Choose a folder and start from its file graph."),
		icon: Codicon.folderOpened,
		when: '!isWeb && !isMac',
		content: {
			type: 'startEntry',
			command: 'command:workbench.action.files.openFolder',
		}
	},
	{
		id: 'basehalfOpenFolderWeb',
		title: localize('gettingStarted.basehalf.openFolder.title', "Open Folder as Canvas..."),
		description: localize('gettingStarted.basehalf.openFolder.description', "Choose a folder and start from its file graph."),
		icon: Codicon.folderOpened,
		when: '!openFolderWorkspaceSupport && workbenchState == \'workspace\'',
		content: {
			type: 'startEntry',
			command: 'command:workbench.action.files.openFolderViaWorkspace',
		}
	},
	{
		id: 'basehalfCloneRepository',
		title: localize('gettingStarted.basehalf.cloneRepository.title', "Clone Repository..."),
		description: localize('gettingStarted.basehalf.cloneRepository.description', "Clone a Git repository and open it as a canvas."),
		when: 'config.git.enabled && !git.missing',
		icon: Codicon.sourceControl,
		content: {
			type: 'startEntry',
			command: 'command:git.clone',
		}
	},
	{
		id: 'basehalfOpenAgentArea',
		title: localize('gettingStarted.basehalf.openAgentArea.title', "Open Agent Area..."),
		description: localize('gettingStarted.basehalf.openAgentArea.description', "Start Codex, Claude, or a terminal session beside the canvas."),
		icon: Codicon.robot,
		content: {
			type: 'startEntry',
			command: 'command:basehalf.agentArea.toggle',
		}
	},
	{
		id: 'basehalfOpenSettings',
		title: localize('gettingStarted.basehalf.openSettings.title', "Open BaseHalf Settings..."),
		description: localize('gettingStarted.basehalf.openSettings.description', "Tune canvas, editor, and Agent Area settings."),
		icon: Codicon.settingsGear,
		content: {
			type: 'startEntry',
			command: 'command:workbench.action.openSettings?%22@tag:basehalf%22',
		}
	},
	{
		id: 'basehalfShowCommands',
		title: localize('gettingStarted.basehalf.showCommands.title', "Command Palette..."),
		description: localize('gettingStarted.basehalf.showCommands.description', "Run BaseHalf and VS Code commands."),
		icon: Codicon.terminal,
		content: {
			type: 'startEntry',
			command: 'command:workbench.action.showCommands',
		}
	},
];

export const walkthroughs: GettingStartedWalkthroughContent = [];
