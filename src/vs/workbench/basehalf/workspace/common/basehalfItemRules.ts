/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { IExpression, parse, ParsedExpression } from '../../../../base/common/glob.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileStat } from '../../../../platform/files/common/files.js';

// Which entries of a workspace folder are items (the items a canvas shows): the entries
// that have a card, which follow `files.exclude` as Files does, and the items BaseHalf
// follows, which its own walks of the folder cover and which follow `search.exclude`.

/** BaseHalf's and git's own stores, at any depth. */
const OWN_NAMES: ReadonlySet<string> = new Set(['.bh', '.git']);
/** Files the system makes in a folder. */
const SYSTEM_FILE_NAMES: ReadonlySet<string> = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
/** The agent files of the workspace folder itself. */
const AGENT_FILE_NAMES: ReadonlySet<string> = new Set(['CLAUDE.md', 'AGENTS.md']);

/** The settings of a workspace folder that decide its items. */
export interface IBaseHalfItemRules {
	/** What `files.exclude` leaves out of Files: such an entry has no card. */
	readonly hidden: ParsedExpression | undefined;
	/** What `search.exclude` leaves out of Search: BaseHalf does not follow what is under it. */
	readonly unsearched: ParsedExpression | undefined;
	/** What a walk for the items BaseHalf follows leaves out, for a file query. */
	readonly walkExclude: IExpression;
}

export function baseHalfItemRules(filesExclude?: IExpression, searchExclude?: IExpression): IBaseHalfItemRules {
	const patterns = (expression: IExpression | undefined) => expression && Object.keys(expression).length > 0 ? { ...expression } : undefined;
	const hidden = patterns(filesExclude);
	const unsearched = patterns(searchExclude);
	return {
		hidden: hidden && parse(hidden),
		unsearched: unsearched && parse(unsearched),
		walkExclude: { ...Object.fromEntries([...OWN_NAMES].map(name => [`**/${name}`, true])), ...unsearched }
	};
}

/** The rules without a setting: only what is never an item is left out. */
export const BASEHALF_ITEM_RULES_WITHOUT_SETTINGS: IBaseHalfItemRules = baseHalfItemRules();

/** Whether an entry is never an item, whatever the settings say: `rootLevel` for an entry of the workspace folder itself. */
function isNeverAnItem(name: string, isDirectory: boolean, rootLevel: boolean): boolean {
	return OWN_NAMES.has(name) || (!isDirectory && (SYSTEM_FILE_NAMES.has(name) || (rootLevel && AGENT_FILE_NAMES.has(name))));
}

function leavesOut(expression: ParsedExpression | undefined, path: string, name: string, hasSibling?: (name: string) => boolean): boolean {
	return !!expression && !!expression(path, name, hasSibling);
}

/**
 * The entries of the folder at `folderRelativePath` that have a card, of all its `children`:
 * what Files shows of them, without what is never an item.
 */
export function baseHalfShownEntries<T extends IFileStat>(rules: IBaseHalfItemRules, folderRelativePath: string, children: readonly T[], rootLevel = folderRelativePath === ''): T[] {
	const names = new Set(children.map(child => basename(child.resource)));
	const hasSibling = (name: string) => names.has(name);
	return children.filter(child => {
		const name = basename(child.resource);
		return (child.isDirectory || child.isFile)
			&& !isNeverAnItem(name, child.isDirectory, rootLevel)
			&& !leavesOut(rules.hidden, folderRelativePath ? `${folderRelativePath}/${name}` : name, name, hasSibling);
	});
}

function everySegment(relativePath: string, isDirectory: boolean, expression: ParsedExpression | undefined): boolean {
	if (!relativePath) {
		return false;
	}
	const segments = relativePath.split('/');
	let path = '';
	for (let position = 0; position < segments.length; position++) {
		const name = segments[position];
		path = position === 0 ? name : `${path}/${name}`;
		if (!name || isNeverAnItem(name, position < segments.length - 1 || isDirectory, position === 0) || leavesOut(expression, path, name)) {
			return false;
		}
	}
	return true;
}

/**
 * Whether the item at a path of the workspace folder has a card, by its path alone: neither
 * it nor a folder above it is left out. A pattern that depends on a sibling is not asked here.
 */
export function baseHalfIsShownPath(rules: IBaseHalfItemRules, relativePath: string, isDirectory: boolean): boolean {
	return everySegment(relativePath, isDirectory, rules.hidden);
}

/**
 * Whether BaseHalf follows the item at a path of the workspace folder: the reference index
 * reads it, a move of it outside BaseHalf is recognized, and the list of items to connect
 * offers it. Whether Files shows it does not matter: hiding an item changes nothing that names it.
 */
export function baseHalfIsFollowedPath(rules: IBaseHalfItemRules, relativePath: string, isDirectory: boolean): boolean {
	return everySegment(relativePath, isDirectory, rules.unsearched);
}

/** Reads the rules of each workspace folder from the settings, and says when they change. */
export class BaseHalfItemRulesReader extends Disposable {
	private readonly rules = new Map<string, IBaseHalfItemRules>();
	private readonly _onDidChangeShown = this._register(new Emitter<void>());
	/** `files.exclude` changed: other entries have a card. */
	readonly onDidChangeShown: Event<void> = this._onDidChangeShown.event;
	private readonly _onDidChangeFollowed = this._register(new Emitter<void>());
	/** `search.exclude` changed: BaseHalf follows other items. */
	readonly onDidChangeFollowed: Event<void> = this._onDidChangeFollowed.event;

	constructor(private readonly configurationService: IConfigurationService) {
		super();
		this._register(this.configurationService.onDidChangeConfiguration(event => {
			const shown = event.affectsConfiguration('files.exclude');
			const followed = event.affectsConfiguration('search.exclude');
			if (shown || followed) {
				this.rules.clear();
			}
			if (shown) {
				this._onDidChangeShown.fire();
			}
			if (followed) {
				this._onDidChangeFollowed.fire();
			}
		}));
	}

	of(workspaceFolder: URI): IBaseHalfItemRules {
		const key = workspaceFolder.toString();
		let rules = this.rules.get(key);
		if (!rules) {
			rules = baseHalfItemRules(
				this.configurationService.getValue<IExpression>('files.exclude', { resource: workspaceFolder }),
				this.configurationService.getValue<IExpression>('search.exclude', { resource: workspaceFolder })
			);
			this.rules.set(key, rules);
		}
		return rules;
	}
}
