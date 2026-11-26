/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ResourceMap, ResourceSet } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { baseHalfRenderableContentKind } from '../../workspace/common/basehalfContentRendering.js';
import { baseHalfIsUnderBhFolder } from '../../workspace/common/basehalfBhFolder.js';
import { ISCMRepository, ISCMResource, ISCMService } from '../../../contrib/scm/common/scm.js';

/** The projection of Card Detail that shows a file's changes (the changes of a file). */
export const BASEHALF_CHANGES_PROJECTION_ID = 'changes';

/** Opens a file in Card Detail at its Changes view, or at its usual view when it has none. */
export const BASEHALF_OPEN_FILE_CHANGES_COMMAND_ID = 'basehalf.changes.openFile';

/** Whether the Changes view of a text file shows, whose keys work wherever the keyboard is. */
export const BaseHalfChangesViewShownContext = new RawContextKey<boolean>('basehalfChangesViewShown', false);

/** Git hands a version to the window whole, so a larger one stays unread (the changes of a file, rules 14 and 18). */
export const BASEHALF_LARGEST_COMPARED_VERSION_BYTES = 256 * 1024 * 1024;

/** Source Control's group of a file changed since what is staged, and of what is staged. */
const WORKING_TREE_GROUP = 'workingTree';
const INDEX_GROUP = 'index';
const MERGE_GROUP = 'merge';

/** The two versions of a file that a comparison shows. */
export interface IBaseHalfFileChange {
	readonly groupId: string;
	readonly original: URI;
	readonly modified: URI;
}

export const IBaseHalfFileChangesService = createDecorator<IBaseHalfFileChangesService>('baseHalfFileChangesService');

/**
 * What git says about a file, as BaseHalf's surfaces read it (the changes of a
 * file). All of it comes from Source Control, so that it says what Source Control
 * says, when it says it: BaseHalf asks git nothing of its own.
 */
export interface IBaseHalfFileChangesService {
	readonly _serviceBrand: undefined;
	/** What Source Control lists changed. It fires once for several groups. */
	readonly onDidChange: Event<void>;
	/** Whether Source Control lists this file, in any group, a new file too. */
	isChanged(resource: URI): boolean;
	/** Whether a folder holds a changed file, at any depth, outside `.bh`. */
	holdsChange(folder: URI): boolean;
	/**
	 * The comparison of a file with its earlier version: of this group when it has
	 * one, otherwise as VS Code's Open Changes does, what is not staged first.
	 * Nothing for a new file, a deleted file, or a conflict.
	 */
	changeOf(resource: URI, groupId?: string): IBaseHalfFileChange | undefined;
	/** Whether Card Detail offers the Changes view of this file. */
	hasChangesView(resource: URI): boolean;
	/** A file turned out not to be text, so that it has no Changes view while it stays changed. */
	markNotText(resource: URI): void;
}

export class BaseHalfFileChangesService extends Disposable implements IBaseHalfFileChangesService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly repositories = this._register(new DisposableMap<ISCMRepository>());
	private readonly announce = this._register(new RunOnceScheduler(() => this._onDidChange.fire(), 50));
	private readonly notText: ResourceSet;

	/** Built when it is first read after a change: a status of many files fires per group. */
	private index: { readonly resources: ResourceMap<ISCMResource[]>; readonly folders: ResourceSet } | undefined;

	constructor(
		@ISCMService private readonly scmService: ISCMService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IFileService fileService: IFileService,
	) {
		super();
		this.notText = new ResourceSet(uri => this.uriIdentityService.extUri.getComparisonKey(uri));
		// A file written anew may be text now, as when an agent changed its encoding.
		this._register(fileService.onDidFilesChange(event => {
			for (const uri of [...this.notText]) {
				if (event.contains(uri)) {
					this.notText.delete(uri);
					this.announce.schedule();
				}
			}
		}));
		for (const repository of this.scmService.repositories) {
			this.watchRepository(repository);
		}
		this._register(this.scmService.onDidAddRepository(repository => {
			this.watchRepository(repository);
			this.invalidate();
		}));
		this._register(this.scmService.onDidRemoveRepository(repository => {
			this.repositories.deleteAndDispose(repository);
			this.invalidate();
		}));
	}

	private watchRepository(repository: ISCMRepository): void {
		const store = new DisposableStore();
		store.add(repository.provider.onDidChangeResources(() => this.invalidate()));
		store.add(repository.provider.onDidChangeResourceGroups(() => this.invalidate()));
		this.repositories.set(repository, store);
	}

	private invalidate(): void {
		this.index = undefined;
		this.announce.schedule();
	}

	private read(): { readonly resources: ResourceMap<ISCMResource[]>; readonly folders: ResourceSet } {
		if (this.index) {
			return this.index;
		}
		const extUri = this.uriIdentityService.extUri;
		const toKey = (uri: URI) => extUri.getComparisonKey(uri);
		const resources = new ResourceMap<ISCMResource[]>(toKey);
		const folders = new ResourceSet(toKey);
		for (const repository of this.scmService.repositories) {
			for (const group of repository.provider.groups) {
				for (const resource of group.resources) {
					const uri = resource.sourceUri;
					const known = resources.get(uri);
					if (known) {
						known.push(resource);
					} else {
						resources.set(uri, [resource]);
					}
					if (baseHalfIsUnderBhFolder(uri.path)) {
						continue;
					}
					// All the way up: a folder above a nested repository holds its changes too, as Files shows.
					for (let folder = extUri.dirname(uri); !folders.has(folder); folder = extUri.dirname(folder)) {
						folders.add(folder);
						if (extUri.isEqual(folder, extUri.dirname(folder))) {
							break;
						}
					}
				}
			}
		}
		for (const uri of [...this.notText]) {
			if (!resources.has(uri)) {
				this.notText.delete(uri);
			}
		}
		this.index = { resources, folders };
		return this.index;
	}

	isChanged(resource: URI): boolean {
		return this.read().resources.has(resource);
	}

	holdsChange(folder: URI): boolean {
		return this.read().folders.has(folder);
	}

	changeOf(resource: URI, groupId?: string): IBaseHalfFileChange | undefined {
		const listed = this.read().resources.get(resource);
		if (!listed) {
			return undefined;
		}
		const byGroup = (id: string | undefined) => listed.find(candidate => candidate.resourceGroup.id === id);
		for (const candidate of [byGroup(groupId), byGroup(WORKING_TREE_GROUP), byGroup(INDEX_GROUP)]) {
			if (candidate?.multiDiffEditorOriginalUri && candidate.multiDiffEditorModifiedUri && candidate.resourceGroup.id !== MERGE_GROUP) {
				return { groupId: candidate.resourceGroup.id, original: candidate.multiDiffEditorOriginalUri, modified: candidate.multiDiffEditorModifiedUri };
			}
		}
		return undefined;
	}

	hasChangesView(resource: URI): boolean {
		if (baseHalfIsUnderBhFolder(resource.path) || !this.changeOf(resource) || this.notText.has(resource)) {
			return false;
		}
		const kind = baseHalfRenderableContentKind(resource);
		return kind !== 'pdf' && kind !== 'book';
	}

	markNotText(resource: URI): void {
		if (!this.notText.has(resource)) {
			this.notText.add(resource);
			this._onDidChange.fire();
		}
	}
}

registerSingleton(IBaseHalfFileChangesService, BaseHalfFileChangesService, InstantiationType.Delayed);
