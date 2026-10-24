/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { basename, extUri, relativePath as getRelativePath } from '../../../../base/common/resources.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IUndoRedoService, IWorkspaceUndoRedoElement, UndoRedoElementType, UndoRedoGroup } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { BASEHALF_CANVAS_UNDO_REDO_SOURCE } from '../../canvas/common/basehalfCanvasEditing.js';
import { baseHalfTransitionChangesUpstream } from '../../references/common/basehalfReferenceStore.js';
import { baseHalfProjectPathProblem } from './basehalfProjectPath.js';
import { IBaseHalfWorkspaceMutationCoordinator } from './basehalfWorkspaceMutation.js';

export const BASEHALF_PROJECT_FILE_TRANSITION_MAX_BYTES = 4 * 1024 * 1024;

export interface IBaseHalfProjectFileTransition {
	readonly resource: URI;
	readonly expected: VSBuffer;
	readonly next: VSBuffer;
	readonly label: string;
}

export const IBaseHalfProjectFileTransitionService = createDecorator<IBaseHalfProjectFileTransitionService>('baseHalfProjectFileTransitionService');

export interface IBaseHalfProjectFileTransitionService {
	readonly _serviceBrand: undefined;
	apply(transition: IBaseHalfProjectFileTransition, undoRedoGroup?: UndoRedoGroup): Promise<void>;
}

export class BaseHalfProjectFileTransitionService implements IBaseHalfProjectFileTransitionService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IBaseHalfWorkspaceMutationCoordinator private readonly workspaceMutationCoordinator: IBaseHalfWorkspaceMutationCoordinator,
		@IUndoRedoService private readonly undoRedoService: IUndoRedoService
	) { }

	async apply(transition: IBaseHalfProjectFileTransition, undoRedoGroup?: UndoRedoGroup): Promise<void> {
		const validated = await this.validate(transition);
		if (validated.expected.equals(validated.next)) {
			return;
		}
		await this.replay(validated, false);
		const element: IWorkspaceUndoRedoElement = {
			type: UndoRedoElementType.Workspace,
			resources: [validated.resource],
			label: validated.label,
			code: 'basehalf.projectFileTransition',
			undo: () => this.replay(validated, true),
			redo: () => this.replay(validated, false)
		};
		this.undoRedoService.pushElement(element, undoRedoGroup, BASEHALF_CANVAS_UNDO_REDO_SOURCE);
	}

	/** Writes the transition's bytes, or its expected bytes back when `reverse`, under a mutation lease. */
	private async replay(transition: IBaseHalfValidatedProjectFileTransition, reverse: boolean): Promise<void> {
		const expected = reverse ? transition.next : transition.expected;
		const next = reverse ? transition.expected : transition.next;
		const stamp = this.workspaceMutationCoordinator.captureResource(transition.workspaceFolder, transition.relativePath);
		await this.workspaceMutationCoordinator.runResourceMutation(transition.workspaceFolder, stamp, async lease => {
			this.workspaceMutationCoordinator.assertLease(lease, transition.workspaceFolder);
			if (this.workingCopyService.isDirty(transition.resource)) {
				throw new Error(`Save '${basename(transition.resource)}' before changing this project document.`);
			}
			await this.assertSafeResource(transition.workspaceFolder, transition.resource, transition.relativePath);
			await this.commit(transition.resource, expected, next);
		});
	}

	private async validate(transition: IBaseHalfProjectFileTransition): Promise<IBaseHalfValidatedProjectFileTransition> {
		if (transition.resource.query || transition.resource.fragment || transition.resource.scheme !== 'file') {
			throw new Error('Project file transitions require one plain local file URI.');
		}
		if (!transition.label.trim() || transition.label.length > 160) {
			throw new Error('Project file transition labels must contain at most 160 characters.');
		}
		if (transition.expected.byteLength > BASEHALF_PROJECT_FILE_TRANSITION_MAX_BYTES || transition.next.byteLength > BASEHALF_PROJECT_FILE_TRANSITION_MAX_BYTES) {
			throw new Error(`Project file transitions support at most ${BASEHALF_PROJECT_FILE_TRANSITION_MAX_BYTES} bytes.`);
		}
		const workspace = this.workspaceContextService.getWorkspaceFolder(transition.resource);
		const relativePath = workspace ? getRelativePath(workspace.uri, transition.resource) : undefined;
		if (!workspace || relativePath === undefined || baseHalfProjectPathProblem(relativePath)) {
			throw new Error('Project file transitions must target an ordinary file inside the current workspace.');
		}
		if (this.workingCopyService.isDirty(transition.resource)) {
			throw new Error(`Save '${basename(transition.resource)}' before changing this project document.`);
		}
		// D37: a project file transition may not change any upstream value. Compare
		// the upstream state (unreadable, or the ordered raw entries) of the
		// expected and next bytes; any difference, including one that makes the
		// store readable or unreadable, is rejected. Undo and redo replay exactly
		// these validated bytes, so they never change an upstream value either.
		if (baseHalfTransitionChangesUpstream(relativePath, transition.expected.toString(), transition.next.toString())) {
			throw new Error(`Project file transitions cannot change the upstream list of '${relativePath}'. BaseHalf changes upstream entries only through explicit user actions.`);
		}
		await this.assertSafeResource(workspace.uri, transition.resource, relativePath);
		return {
			resource: transition.resource,
			expected: transition.expected.clone(),
			next: transition.next.clone(),
			label: transition.label.trim(),
			workspaceFolder: workspace.uri,
			relativePath
		};
	}

	private async assertSafeResource(workspaceFolder: URI, resource: URI, relativePath: string): Promise<void> {
		const pathEntries = [workspaceFolder];
		let current = workspaceFolder;
		for (const segment of relativePath.split('/')) {
			current = URI.joinPath(current, segment);
			pathEntries.push(current);
		}
		const [workspaceRealpath, resourceRealpath, pathStats] = await Promise.all([
			this.fileService.realpath(workspaceFolder),
			this.fileService.realpath(resource),
			Promise.all(pathEntries.map(entry => this.fileService.stat(entry)))
		]);
		const stat = pathStats.at(-1);
		if (!workspaceRealpath || !resourceRealpath || !stat?.isFile || pathStats.some(candidate => candidate.isSymbolicLink)
			|| !extUri.isEqualOrParent(resourceRealpath, workspaceRealpath) || extUri.isEqual(resourceRealpath, workspaceRealpath)) {
			throw new Error('Project file transitions cannot follow symbolic links or leave the workspace.');
		}
	}

	private async commit(resource: URI, expected: VSBuffer, next: VSBuffer): Promise<void> {
		await this.fileService.writeFileWithExpectedContents(resource, next, expected, {
			atomic: { postfix: `.basehalf-project-transition-${generateUuid()}` }
		});
	}
}

interface IBaseHalfValidatedProjectFileTransition extends IBaseHalfProjectFileTransition {
	readonly workspaceFolder: URI;
	readonly relativePath: string;
}

registerSingleton(IBaseHalfProjectFileTransitionService, BaseHalfProjectFileTransitionService, InstantiationType.Delayed);
