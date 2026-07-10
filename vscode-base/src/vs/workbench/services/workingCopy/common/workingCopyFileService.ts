/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Event, AsyncEmitter, IWaitUntil } from '../../../../base/common/event.js';
import { Promises } from '../../../../base/common/async.js';
import { insert } from '../../../../base/common/arrays.js';
import { URI } from '../../../../base/common/uri.js';
import { dispose, Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IFileAtomicOptions, IFileService, FileOperation, IFileStatWithMetadata } from '../../../../platform/files/common/files.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { IWorkingCopyService } from './workingCopyService.js';
import { IWorkingCopy } from './workingCopy.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { WorkingCopyFileOperationParticipant } from './workingCopyFileOperationParticipant.js';
import { VSBuffer, VSBufferReadable, VSBufferReadableStream } from '../../../../base/common/buffer.js';
import { SaveReason } from '../../../common/editor.js';
import { IProgress, IProgressStep } from '../../../../platform/progress/common/progress.js';
import { StoredFileWorkingCopySaveParticipant } from './storedFileWorkingCopySaveParticipant.js';
import { IStoredFileWorkingCopy, IStoredFileWorkingCopyModel } from './storedFileWorkingCopy.js';

export const IWorkingCopyFileService = createDecorator<IWorkingCopyFileService>('workingCopyFileService');

export interface SourceTargetPair {

	/**
	 * The source resource that is defined for move operations.
	 */
	readonly source?: URI;

	/**
	 * The target resource the event is about.
	 */
	readonly target: URI;
}

export interface IFileOperationUndoRedoInfo {

	/**
	 * Id of the undo group that the file operation belongs to.
	 */
	undoRedoGroupId?: number;

	/**
	 * Flag indicates if the operation is an undo.
	 */
	isUndoing?: boolean;
}

export interface WorkingCopyFileEvent extends IWaitUntil {

	/**
	 * An identifier to correlate the operation through the
	 * different event types (before, after, error).
	 */
	readonly correlationId: number;

	/**
	 * The file operation that is taking place.
	 */
	readonly operation: FileOperation;

	/**
	 * The array of source/target pair of files involved in given operation.
	 */
	readonly files: readonly SourceTargetPair[];

	/**
	 * Members that completed on disk before this event fired. MOVE, COPY and
	 * DELETE execute sequentially, so a failure event exposes the exact durable
	 * prefix instead of forcing listeners to infer it from the post-failure file
	 * system shape. Empty in the will event; identical to `files` after a
	 * successful sequential operation. Every phase receives a fresh array
	 * snapshot, so a listener retaining or mutating one phase cannot corrupt the
	 * next phase's accounting.
	 */
	readonly completedFiles: readonly SourceTargetPair[];
}

export interface IWorkingCopyFileOperationParticipant {

	/**
	 * Participate in a file operation of working copies. Allows to
	 * change the working copies before they are being saved to disk.
	 */
	participate(
		files: SourceTargetPair[],
		operation: FileOperation,
		undoInfo: IFileOperationUndoRedoInfo | undefined,
		timeout: number,
		token: CancellationToken
	): Promise<void>;
}

/**
 * A file-operation precondition is a hard veto point. Unlike ordinary file
 * operation participants (whose failures are logged and ignored for extension
 * compatibility), a rejected precondition prevents `onWill` and physical IO.
 * A returned guard remains held through the did/fail event and is always
 * disposed afterwards, allowing an owner to freeze input across the operation.
 */
export interface IWorkingCopyFileOperationPrecondition {
	prepare(
		files: readonly SourceTargetPair[],
		operation: FileOperation,
		undoInfo: IFileOperationUndoRedoInfo | undefined,
		token: CancellationToken
	): Promise<IWorkingCopyFileOperationPreconditionGuard | void>;
}

/** A hard-precondition guard can finalize its private transaction immediately
 * after physical IO and before public did/fail listeners run. This avoids
 * listener-order deadlocks for nested resource operations while keeping plain
 * `IDisposable` guards source-compatible. */
export interface IWorkingCopyFileOperationPreconditionGuard extends IDisposable {
	didRun?(completedFiles: readonly SourceTargetPair[]): Promise<void>;
	didFail?(completedFiles: readonly SourceTargetPair[]): Promise<void>;
	/** Runs after every public did/fail listener but before guard disposal and
	 * before the file-operation promise resolves. */
	afterPublicEvents?(): Promise<void>;
}

interface IWorkingCopyFileOperationFinalizer {
	didRun(completedFiles: readonly SourceTargetPair[]): Promise<void>;
	didFail(completedFiles: readonly SourceTargetPair[]): Promise<void>;
	afterPublicEvents(): Promise<void>;
}

export interface IStoredFileWorkingCopySaveParticipantContext {
	/**
	 * The reason why the save was triggered.
	 */
	readonly reason: SaveReason;

	/**
	 * Only applies to when a text file was saved as, for
	 * example when starting with untitled and saving. This
	 * provides access to the initial resource the text
	 * file had before.
	 */
	readonly savedFrom?: URI;
}

export interface IStoredFileWorkingCopySaveParticipant {

	/**
	 * The ordinal number which determines the order of participation.
	 * Lower values mean to participant sooner
	 */
	readonly ordinal?: number;

	/**
	 * Participate in a save operation of file stored working copies.
	 * Allows to make changes before content is being saved to disk.
	 */
	participate(
		workingCopy: IStoredFileWorkingCopy<IStoredFileWorkingCopyModel>,
		context: IStoredFileWorkingCopySaveParticipantContext,
		progress: IProgress<IProgressStep>,
		token: CancellationToken
	): Promise<void>;
}

export interface ICreateOperation {
	resource: URI;
	overwrite?: boolean;
}

export interface ICreateFileOperation extends ICreateOperation {
	contents?: VSBuffer | VSBufferReadable | VSBufferReadableStream;
}

export interface IDeleteOperation {
	resource: URI;
	useTrash?: boolean;
	recursive?: boolean;
	atomic?: IFileAtomicOptions | false;
}

export interface IMoveOperation {
	file: Required<SourceTargetPair>;
	overwrite?: boolean;
}

export interface ICopyOperation extends IMoveOperation { }

/**
 * Returns the working copies for a given resource.
 */
type WorkingCopyProvider = (resourceOrFolder: URI) => IWorkingCopy[];

/**
 * A service that allows to perform file operations with working copy support.
 * Any operation that would leave a stale dirty working copy behind will make
 * sure to revert the working copy first.
 *
 * On top of that events are provided to participate in each state of the
 * operation to perform additional work.
 */
export interface IWorkingCopyFileService {

	readonly _serviceBrand: undefined;

	//#region Events

	/**
	 * An event that is fired when a certain working copy IO operation is about to run.
	 *
	 * Participants can join this event with a long running operation to keep some state
	 * before the operation is started, but working copies should not be changed at this
	 * point in time. For that purpose, use the `IWorkingCopyFileOperationParticipant` API.
	 */
	readonly onWillRunWorkingCopyFileOperation: Event<WorkingCopyFileEvent>;

	/**
	 * An event that is fired after a working copy IO operation has failed.
	 *
	 * Participants can join this event with a long running operation to clean up as needed.
	 */
	readonly onDidFailWorkingCopyFileOperation: Event<WorkingCopyFileEvent>;

	/**
	 * An event that is fired after a working copy IO operation has been performed.
	 *
	 * Participants can join this event with a long running operation to make changes
	 * after the operation has finished.
	 */
	readonly onDidRunWorkingCopyFileOperation: Event<WorkingCopyFileEvent>;

	//#endregion


	//#region File operation participants

	/**
	 * Adds a participant for file operations on working copies.
	 */
	addFileOperationParticipant(participant: IWorkingCopyFileOperationParticipant): IDisposable;

	/** Adds a hard precondition that runs after ordinary participants and before
	 *  `onWill`/disk IO. Rejections propagate to the operation caller. */
	addFileOperationPrecondition(precondition: IWorkingCopyFileOperationPrecondition): IDisposable;

	//#endregion


	//#region Stored File Working Copy save participants

	/**
	 * Whether save participants are present for stored file working copies.
	 */
	get hasSaveParticipants(): boolean;

	/**
	 * Adds a participant for save operations on stored file working copies.
	 */
	addSaveParticipant(participant: IStoredFileWorkingCopySaveParticipant): IDisposable;

	/**
	 * Runs all available save participants for stored file working copies.
	 */
	runSaveParticipants(workingCopy: IStoredFileWorkingCopy<IStoredFileWorkingCopyModel>, context: IStoredFileWorkingCopySaveParticipantContext, progress: IProgress<IProgressStep>, token: CancellationToken): Promise<void>;

	//#endregion


	//#region File operations

	/**
	 * Will create a resource with the provided optional contents, optionally overwriting any target.
	 *
	 * Working copy owners can listen to the `onWillRunWorkingCopyFileOperation` and
	 * `onDidRunWorkingCopyFileOperation` events to participate.
	 */
	create(operations: ICreateFileOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	/**
	 * Will create a folder and any parent folder that needs to be created.
	 *
	 * Working copy owners can listen to the `onWillRunWorkingCopyFileOperation` and
	 * `onDidRunWorkingCopyFileOperation` events to participate.
	 *
	 * Note: events will only be emitted for the provided resource, but not any
	 * parent folders that are being created as part of the operation.
	 */
	createFolder(operations: ICreateOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	/**
	 * Will move working copies matching the provided resources and corresponding children
	 * to the target resources using the associated file service for those resources.
	 *
	 * Working copy owners can listen to the `onWillRunWorkingCopyFileOperation` and
	 * `onDidRunWorkingCopyFileOperation` events to participate.
	 */
	move(operations: IMoveOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	/**
	 * Will copy working copies matching the provided resources and corresponding children
	 * to the target resources using the associated file service for those resources.
	 *
	 * Working copy owners can listen to the `onWillRunWorkingCopyFileOperation` and
	 * `onDidRunWorkingCopyFileOperation` events to participate.
	 */
	copy(operations: ICopyOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	/**
	 * Will delete working copies matching the provided resources and children
	 * using the associated file service for those resources.
	 *
	 * Working copy owners can listen to the `onWillRunWorkingCopyFileOperation` and
	 * `onDidRunWorkingCopyFileOperation` events to participate.
	 */
	delete(operations: IDeleteOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<void>;

	//#endregion


	//#region Path related

	/**
	 * Register a new provider for working copies based on a resource.
	 *
	 * @return a disposable that unregisters the provider.
	 */
	registerWorkingCopyProvider(provider: WorkingCopyProvider): IDisposable;

	/**
	 * Will return all working copies that are dirty matching the provided resource.
	 * If the resource is a folder and the scheme supports file operations, a working
	 * copy that is dirty and is a child of that folder will also be returned.
	 */
	getDirty(resource: URI): readonly IWorkingCopy[];

	//#endregion
}

export class WorkingCopyFileService extends Disposable implements IWorkingCopyFileService {

	declare readonly _serviceBrand: undefined;

	//#region Events

	private readonly _onWillRunWorkingCopyFileOperation = this._register(new AsyncEmitter<WorkingCopyFileEvent>());
	readonly onWillRunWorkingCopyFileOperation = this._onWillRunWorkingCopyFileOperation.event;

	private readonly _onDidFailWorkingCopyFileOperation = this._register(new AsyncEmitter<WorkingCopyFileEvent>());
	readonly onDidFailWorkingCopyFileOperation = this._onDidFailWorkingCopyFileOperation.event;

	private readonly _onDidRunWorkingCopyFileOperation = this._register(new AsyncEmitter<WorkingCopyFileEvent>());
	readonly onDidRunWorkingCopyFileOperation = this._onDidRunWorkingCopyFileOperation.event;

	//#endregion

	private correlationIds = 0;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		super();

		this.fileOperationParticipants = this._register(instantiationService.createInstance(WorkingCopyFileOperationParticipant));
		this.saveParticipants = this._register(instantiationService.createInstance(StoredFileWorkingCopySaveParticipant));

		// register a default working copy provider that uses the working copy service
		this._register(this.registerWorkingCopyProvider(resource => {
			return this.workingCopyService.workingCopies.filter(workingCopy => {
				if (this.fileService.hasProvider(resource)) {
					// only check for parents if the resource can be handled
					// by the file system where we then assume a folder like
					// path structure
					return this.uriIdentityService.extUri.isEqualOrParent(workingCopy.resource, resource);
				}

				return this.uriIdentityService.extUri.isEqual(workingCopy.resource, resource);
			});
		}));
	}


	//#region File operations

	create(operations: ICreateFileOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		return this.doCreateFileOrFolder(operations, true, token, undoInfo);
	}

	createFolder(operations: ICreateOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		return this.doCreateFileOrFolder(operations, false, token, undoInfo);
	}

	async doCreateFileOrFolder(operations: (ICreateFileOperation | ICreateOperation)[], isFile: boolean, token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		if (operations.length === 0) {
			return [];
		}

		// validate create operation before starting
		if (isFile) {
			const validateCreates = await Promises.settled(operations.map(operation => this.fileService.canCreateFile(operation.resource, { overwrite: operation.overwrite })));
			const error = validateCreates.find(validateCreate => validateCreate instanceof Error);
			if (error instanceof Error) {
				throw error;
			}
		}

		// file operation participant
		const files = operations.map(operation => ({ target: operation.resource }));
		await this.runFileOperationParticipants(files, FileOperation.CREATE, undoInfo, token);
		return this.runWithFileOperationPreconditions(files, FileOperation.CREATE, undoInfo, token, async finalizer => {
			// before events
			const event = { correlationId: this.correlationIds++, operation: FileOperation.CREATE, files };
			await this._onWillRunWorkingCopyFileOperation.fireAsync({ ...event, completedFiles: [] }, CancellationToken.None /* intentional: we currently only forward cancellation to participants */);

			// now actually create on disk
			let stats: IFileStatWithMetadata[];
			try {
				if (isFile) {
					stats = await Promises.settled(operations.map(operation => this.fileService.createFile(operation.resource, (operation as ICreateFileOperation).contents, { overwrite: operation.overwrite })));
				} else {
					stats = await Promises.settled(operations.map(operation => this.fileService.createFolder(operation.resource)));
				}
			} catch (error) {

				// error event
				await this.finalizeAndFire(
					() => finalizer.didFail([]),
					() => this._onDidFailWorkingCopyFileOperation.fireAsync({ ...event, completedFiles: [] }, CancellationToken.None /* intentional: we currently only forward cancellation to participants */),
					() => finalizer.afterPublicEvents()
				).catch(onUnexpectedError);

				throw error;
			}

			// after event
			await this.finalizeAndFire(
				() => finalizer.didRun(files),
				() => this._onDidRunWorkingCopyFileOperation.fireAsync({ ...event, completedFiles: [...files] }, CancellationToken.None /* intentional: we currently only forward cancellation to participants */),
				() => finalizer.afterPublicEvents()
			);

			return stats;
		});
	}

	async move(operations: IMoveOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		return this.doMoveOrCopy(operations, true, token, undoInfo);
	}

	async copy(operations: ICopyOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		return this.doMoveOrCopy(operations, false, token, undoInfo);
	}

	private async doMoveOrCopy(operations: IMoveOperation[] | ICopyOperation[], move: boolean, token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		const stats: IFileStatWithMetadata[] = [];

		// validate move/copy operation before starting
		for (const { file: { source, target }, overwrite } of operations) {
			const validateMoveOrCopy = await (move ? this.fileService.canMove(source, target, overwrite) : this.fileService.canCopy(source, target, overwrite));
			if (validateMoveOrCopy instanceof Error) {
				throw validateMoveOrCopy;
			}
		}

		// file operation participant
		const files = operations.map(o => o.file);
		const operation = move ? FileOperation.MOVE : FileOperation.COPY;
		await this.runFileOperationParticipants(files, operation, undoInfo, token);
		return this.runWithFileOperationPreconditions(files, operation, undoInfo, token, async finalizer => {
			// before event
			const event = { correlationId: this.correlationIds++, operation, files };
			const completedFiles: SourceTargetPair[] = [];
			await this._onWillRunWorkingCopyFileOperation.fireAsync({ ...event, completedFiles: [] }, CancellationToken.None /* intentional: we currently only forward cancellation to participants */);

			try {
				for (const { file, overwrite } of operations) {
					const { source, target } = file;
					// if source and target are not equal, handle dirty working copies
					// depending on the operation:
					// - move: revert both source and target (if any)
					// - copy: revert target (if any)
					if (!this.uriIdentityService.extUri.isEqual(source, target)) {
						const dirtyWorkingCopies = (move ? [...this.getDirty(source), ...this.getDirty(target)] : this.getDirty(target));
						await Promises.settled(dirtyWorkingCopies.map(dirtyWorkingCopy => dirtyWorkingCopy.revert({ soft: true })));
					}

					// now we can rename the source to target via file operation
					if (move) {
						stats.push(await this.fileService.move(source, target, overwrite));
					} else {
						stats.push(await this.fileService.copy(source, target, overwrite));
					}
					completedFiles.push(file);
				}
			} catch (error) {

				// error event
				await this.finalizeAndFire(
					() => finalizer.didFail(completedFiles),
					() => this._onDidFailWorkingCopyFileOperation.fireAsync({ ...event, completedFiles: [...completedFiles] }, CancellationToken.None /* intentional: we currently only forward cancellation to participants */),
					() => finalizer.afterPublicEvents()
				).catch(onUnexpectedError);

				throw error;
			}

			// after event
			await this.finalizeAndFire(
				() => finalizer.didRun(completedFiles),
				() => this._onDidRunWorkingCopyFileOperation.fireAsync({ ...event, completedFiles: [...completedFiles] }, CancellationToken.None /* intentional: we currently only forward cancellation to participants */),
				() => finalizer.afterPublicEvents()
			);

			return stats;
		});
	}

	delete(operations: IDeleteOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<void> {
		return this.doDelete(operations, token, undoInfo);
	}

	private async doDelete(operations: IDeleteOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<void> {

		// validate delete operation before starting
		for (const operation of operations) {
			const validateDelete = await this.fileService.canDelete(operation.resource, { recursive: operation.recursive, useTrash: operation.useTrash, atomic: operation.atomic });
			if (validateDelete instanceof Error) {
				throw validateDelete;
			}
		}

		// file operation participant
		const files = operations.map(operation => ({ target: operation.resource }));
		await this.runFileOperationParticipants(files, FileOperation.DELETE, undoInfo, token);
		return this.runWithFileOperationPreconditions(files, FileOperation.DELETE, undoInfo, token, async finalizer => {
			// before events
			const event = { correlationId: this.correlationIds++, operation: FileOperation.DELETE, files };
			const completedFiles: SourceTargetPair[] = [];
			await this._onWillRunWorkingCopyFileOperation.fireAsync({ ...event, completedFiles: [] }, CancellationToken.None /* intentional: we currently only forward cancellation to participants */);

			try {
				// check for any existing dirty working copies for the resource
				// and do a soft revert before deleting to be able to close
				// any opened editor with these working copies
				for (const operation of operations) {
					const dirtyWorkingCopies = this.getDirty(operation.resource);
					await Promises.settled(dirtyWorkingCopies.map(dirtyWorkingCopy => dirtyWorkingCopy.revert({ soft: true })));
				}

				// now actually delete from disk
				for (let index = 0; index < operations.length; index++) {
					const operation = operations[index];
					await this.fileService.del(operation.resource, { recursive: operation.recursive, useTrash: operation.useTrash, atomic: operation.atomic });
					completedFiles.push(files[index]);
				}
			} catch (error) {

				// error event
				await this.finalizeAndFire(
					() => finalizer.didFail(completedFiles),
					() => this._onDidFailWorkingCopyFileOperation.fireAsync({ ...event, completedFiles: [...completedFiles] }, CancellationToken.None /* intentional: we currently only forward cancellation to participants */),
					() => finalizer.afterPublicEvents()
				).catch(onUnexpectedError);

				throw error;
			}

			// after event
			await this.finalizeAndFire(
				() => finalizer.didRun(completedFiles),
				() => this._onDidRunWorkingCopyFileOperation.fireAsync({ ...event, completedFiles: [...completedFiles] }, CancellationToken.None /* intentional: we currently only forward cancellation to participants */),
				() => finalizer.afterPublicEvents()
			);
		});
	}

	//#endregion


	//#region File operation participants

	private readonly fileOperationParticipants: WorkingCopyFileOperationParticipant;
	private readonly fileOperationPreconditions: IWorkingCopyFileOperationPrecondition[] = [];

	addFileOperationParticipant(participant: IWorkingCopyFileOperationParticipant): IDisposable {
		return this.fileOperationParticipants.addFileOperationParticipant(participant);
	}

	addFileOperationPrecondition(precondition: IWorkingCopyFileOperationPrecondition): IDisposable {
		return toDisposable(insert(this.fileOperationPreconditions, precondition));
	}

	private runFileOperationParticipants(files: SourceTargetPair[], operation: FileOperation, undoInfo: IFileOperationUndoRedoInfo | undefined, token: CancellationToken): Promise<void> {
		return this.fileOperationParticipants.participate(files, operation, undoInfo, token);
	}

	private async runWithFileOperationPreconditions<T>(
		files: readonly SourceTargetPair[],
		operation: FileOperation,
		undoInfo: IFileOperationUndoRedoInfo | undefined,
		token: CancellationToken,
		task: (finalizer: IWorkingCopyFileOperationFinalizer) => Promise<T>
	): Promise<T> {
		const guards: IWorkingCopyFileOperationPreconditionGuard[] = [];
		try {
			for (const precondition of this.fileOperationPreconditions) {
				const guard = await precondition.prepare(files, operation, undoInfo, token);
				if (guard) {
					guards.push(guard);
				}
			}
			const finalize = async (kind: 'didRun' | 'didFail' | 'afterPublicEvents', completedFiles: readonly SourceTargetPair[]): Promise<void> => {
				const errors: unknown[] = [];
				for (const guard of guards) {
					try {
						if (kind === 'afterPublicEvents') {
							await guard.afterPublicEvents?.();
						} else {
							await guard[kind]?.([...completedFiles]);
						}
					} catch (error) {
						errors.push(error);
					}
				}
				if (errors.length === 1) {
					throw errors[0];
				}
				if (errors.length > 1) {
					throw new AggregateError(errors, `Working copy file-operation ${kind} finalizers failed`);
				}
			};
			return await task({
				didRun: completedFiles => finalize('didRun', completedFiles),
				didFail: completedFiles => finalize('didFail', completedFiles),
				afterPublicEvents: () => finalize('afterPublicEvents', [])
			});
		} finally {
			dispose(guards.reverse());
		}
	}

	private async finalizeAndFire(finalize: () => Promise<void>, fire: () => Promise<void>, afterPublicEvents: () => Promise<void>): Promise<void> {
		try {
			await finalize();
		} catch (error) {
			onUnexpectedError(error);
		}
		let eventError: unknown;
		try {
			await fire();
		} catch (error) {
			eventError = error;
		}
		try {
			await afterPublicEvents();
		} catch (error) {
			onUnexpectedError(error);
		}
		if (eventError !== undefined) {
			throw eventError;
		}
	}

	//#endregion

	//#region Save participants (stored file working copies only)

	private readonly saveParticipants: StoredFileWorkingCopySaveParticipant;

	get hasSaveParticipants(): boolean { return this.saveParticipants.length > 0; }

	addSaveParticipant(participant: IStoredFileWorkingCopySaveParticipant): IDisposable {
		return this.saveParticipants.addSaveParticipant(participant);
	}

	runSaveParticipants(workingCopy: IStoredFileWorkingCopy<IStoredFileWorkingCopyModel>, context: IStoredFileWorkingCopySaveParticipantContext, progress: IProgress<IProgressStep>, token: CancellationToken): Promise<void> {
		return this.saveParticipants.participate(workingCopy, context, progress, token);
	}

	//#endregion


	//#region Path related

	private readonly workingCopyProviders: WorkingCopyProvider[] = [];

	registerWorkingCopyProvider(provider: WorkingCopyProvider): IDisposable {
		const remove = insert(this.workingCopyProviders, provider);

		return toDisposable(remove);
	}

	getDirty(resource: URI): IWorkingCopy[] {
		const dirtyWorkingCopies = new Set<IWorkingCopy>();
		for (const provider of this.workingCopyProviders) {
			for (const workingCopy of provider(resource)) {
				if (workingCopy.isDirty()) {
					dirtyWorkingCopies.add(workingCopy);
				}
			}
		}

		return Array.from(dirtyWorkingCopies);
	}

	//#endregion
}

registerSingleton(IWorkingCopyFileService, WorkingCopyFileService, InstantiationType.Delayed);
