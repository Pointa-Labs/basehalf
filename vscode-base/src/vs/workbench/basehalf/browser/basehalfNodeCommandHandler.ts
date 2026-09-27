/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { isAbsolute } from '../../../base/common/path.js';
import { raceCancellationError } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../base/common/errors.js';
import { extUri, extUriIgnorePathCase } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { FileSystemProviderCapabilities, IFileService } from '../../../platform/files/common/files.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import {
	BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_EXTENSIONS,
	BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_RECIPES,
	BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_TEMPLATES,
	BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
	IBaseHalfAgentCapabilityDiscoveryExtension,
	IBaseHalfAgentCapabilityDiscoveryRecipe,
	IBaseHalfAgentCapabilityDiscoveryRequest,
	IBaseHalfAgentCapabilityDiscoveryResponse,
	IBaseHalfAgentOperationCommandRequest,
	IBaseHalfAgentOperationCommandResponse,
	IBaseHalfNodeCommandRequestEvent,
	IBaseHalfNodeCommandResponse,
	IBaseHalfRunNodeCommandRequest,
	IBaseHalfRunNodeCommandResponse
} from '../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkingCopyService } from '../../services/workingCopy/common/workingCopyService.js';
import { IBaseHalfAgentAreaService } from '../common/basehalfAgentArea.js';
import {
	BASEHALF_AGENT_CREATE_FROM_TEMPLATE_OPERATION_ID,
	BASEHALF_AGENT_WORKSPACE_MOVE_OPERATION_ID,
	IBaseHalfAgentOperationContribution,
	IBaseHalfAgentCapabilityRegistryService,
	validateBaseHalfAgentOperationParameters,
	validateBaseHalfAgentOperationReturn
} from '../common/basehalfAgentCapabilities.js';
import { IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasRecipeDescriptor, IBaseHalfCanvasRecipeRegistryService } from '../common/basehalfCanvasRecipes.js';
import { BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID } from '../common/basehalfCanvasTemplate.js';
import { baseHalfIsWorkspaceFolderMarked } from '../common/basehalfLegacyCleanup.js';
import {
	BASEHALF_NODE_DOCUMENT_EXTENSION,
	BASEHALF_NODE_DOCUMENT_VERSION,
	baseHalfProjectPathProblem,
	getBaseHalfNodeAgentAuthoringContract,
	IBaseHalfNodeDocument
} from '../common/basehalfNodeDocument.js';
import { baseHalfNormalizeUpstreamEntry, baseHalfUpstreamEntryGrammarProblem } from '../common/basehalfReferenceEntries.js';
import { BASEHALF_WORKSPACE_AGENT_MOVE_COMMAND_ID, IBaseHalfAgentMoveArgument } from '../common/basehalfRenameRefactor.js';
import { IBaseHalfNodeExecutionService } from './basehalfNodeExecutionService.js';

export class BaseHalfNodeCommandHandler {
	constructor(
		private readonly workspaceContextService: IWorkspaceContextService,
		private readonly fileService: IFileService,
		private readonly workingCopyService: IWorkingCopyService,
		private readonly agentAreaService: IBaseHalfAgentAreaService,
		private readonly executionService: IBaseHalfNodeExecutionService,
		private readonly agentCapabilityRegistryService: IBaseHalfAgentCapabilityRegistryService,
		private readonly canvasRecipeRegistryService: IBaseHalfCanvasRecipeRegistryService,
		private readonly commandService: ICommandService
	) { }

	async handle(event: IBaseHalfNodeCommandRequestEvent, cancellationToken: CancellationToken = CancellationToken.None): Promise<IBaseHalfNodeCommandResponse | undefined> {
		if (event.workspaceId !== this.workspaceContextService.getWorkspace().id) {
			return undefined;
		}
		const ownership = this.agentAreaService.terminalProcessOwnership(event.persistentProcessId);
		if (ownership === 'unknown') {
			return undefined;
		}
		if (ownership === 'released') {
			return rejectedResponseForRequest(event.request, 'This terminal is no longer owned by the BaseHalf Agent Area.');
		}
		if (event.request.type === 'listCapabilities') {
			return this.handleCapabilityDiscovery(event.request, cancellationToken);
		}
		if (event.request.type === 'runOperation') {
			return this.handleOperation(event.request, cancellationToken);
		}

		try {
			if (cancellationToken.isCancellationRequested) {
				throw new CancellationError();
			}
			const node = await this.resolveNode(event);
			if (cancellationToken.isCancellationRequested) {
				throw new CancellationError();
			}
			const execution = this.executionService.run(node);
			const attemptId = this.executionService.getActiveRun(node.resource)?.runId;
			if (!attemptId) {
				await execution;
				throw new Error('The node submission did not enter the host Attempt lifecycle.');
			}
			// Once accepted by the host, execution belongs to the durable canvas
			// node. Closing or switching an Agent renderer may abandon this RPC wait,
			// but it must never cancel a paid/provider task. Cancellation remains an
			// explicit node action addressed by node + attempt id.
			const document = await execution;
			return responseForCompletedAttempt(node.relativePath, attemptId, document);
		} catch (error) {
			return rejectedResponse(event.request.relativePath, errorMessage(error));
		}
	}

	private async handleCapabilityDiscovery(
		request: IBaseHalfAgentCapabilityDiscoveryRequest,
		cancellationToken: CancellationToken
	): Promise<IBaseHalfAgentCapabilityDiscoveryResponse> {
		try {
			if (request.version !== BASEHALF_NODE_COMMAND_BRIDGE_VERSION || request.type !== 'listCapabilities') {
				throw new Error('This Agent capability discovery protocol version is not supported.');
			}
			if (cancellationToken.isCancellationRequested) {
				throw new CancellationError();
			}
			await this.resolveCommandWorkspace(request.cwd);
			if (cancellationToken.isCancellationRequested) {
				throw new CancellationError();
			}
			const installedExtensions = this.agentCapabilityRegistryService.getCapabilities();
			if (installedExtensions.length > BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_EXTENSIONS) {
				throw new Error('Too many reviewed Agent capabilities are installed to return safely.');
			}
			const installedRecipes = this.canvasRecipeRegistryService.getRecipes();
			if (installedRecipes.length > BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_RECIPES) {
				throw new Error('Too many reviewed canvas recipes are installed to return safely.');
			}
			const installedTemplates = this.canvasRecipeRegistryService.getTemplates();
			if (installedTemplates.length > BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_TEMPLATES) {
				throw new Error('Too many reviewed canvas templates are installed to return safely.');
			}
			const extensions = Object.freeze(installedExtensions.map(capability => capabilityDiscoveryExtension(capability)));
			const recipes = Object.freeze(installedRecipes.map(recipe => capabilityDiscoveryRecipe(recipe)));
			const templates = Object.freeze(installedTemplates.map(template => Object.freeze({
				id: template.id,
				label: template.label,
				...(template.description === undefined ? {} : { description: template.description })
			})));
			const templateIds = templates.map(template => template.id);
			const hostOperations = Object.freeze([
				capabilityDiscoveryOperation(workspaceMoveOperation()),
				...(templateIds.length === 0 ? [] : [capabilityDiscoveryOperation(createFromTemplateOperation(templateIds))])
			]);
			const response: IBaseHalfAgentCapabilityDiscoveryResponse = {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'listCapabilities',
				ok: true,
				outcome: 'succeeded',
				host: Object.freeze({
					nodeDocument: Object.freeze({
						fileExtension: BASEHALF_NODE_DOCUMENT_EXTENSION,
						documentVersion: BASEHALF_NODE_DOCUMENT_VERSION,
						resultKinds: Object.freeze(['file', 'image', 'video', 'audio', 'pdf', 'presentation'] as const),
						inputBinding: Object.freeze({
							scope: 'node-upstream' as const,
							fields: Object.freeze(['sourcePath', 'slot', 'order'] as const)
						}),
						lifecycle: Object.freeze({
							attempts: 'host-owned' as const,
							result: 'host-owned-single-file' as const,
							retry: 'frozen-only' as const
						}),
						runCommand: 'basehalf --run-node <workspace-relative-.bhnode-path>',
						authoring: getBaseHalfNodeAgentAuthoringContract()
					}),
					// D37: the downstream node stores each edge once, in its own
					// `upstream` list; the reverse direction is derived by the host.
					contextEdge: Object.freeze({
						source: 'direct-content' as const,
						resultNodeSource: 'sealed-result' as const,
						target: 'direct-context' as const,
						autoRun: false as const,
						recursive: false as const,
						storedBy: 'downstream' as const,
						markdownFrontmatterKey: 'upstream' as const,
						nodeDocumentField: 'upstream' as const,
						roleAndOrderOwner: 'target-recipe-binding' as const,
						label: 'none' as const
					}),
					templates,
					operations: hostOperations
				}),
				recipes,
				extensions
			};
			if (VSBuffer.fromString(JSON.stringify(response)).byteLength > 1024 * 1024) {
				throw new Error('Agent capability discovery returned too much data.');
			}
			return response;
		} catch (error) {
			return rejectedCapabilityDiscoveryResponse(isCancellationError(error)
				? 'Agent capability discovery was cancelled.'
				: errorMessage(error));
		}
	}

	private async handleOperation(
		request: IBaseHalfAgentOperationCommandRequest,
		cancellationToken: CancellationToken
	): Promise<IBaseHalfAgentOperationCommandResponse> {
		try {
			if (request.version !== BASEHALF_NODE_COMMAND_BRIDGE_VERSION || request.type !== 'runOperation') {
				throw new Error('This Agent operation protocol version is not supported.');
			}
			if (cancellationToken.isCancellationRequested) {
				throw new CancellationError();
			}
			const workspace = await this.resolveCommandWorkspace(request.cwd);
			const reviewed = this.resolveOperation(request.operationId);
			const rawParameters = validateBaseHalfAgentOperationParameters(reviewed.operation, request.parameters);
			const commandParameters: Record<string, unknown> = { ...rawParameters };
			for (const parameter of reviewed.operation.parameters ?? []) {
				if (parameter.type !== 'uri' || rawParameters[parameter.name] === undefined) {
					continue;
				}
				commandParameters[parameter.name] = await this.resolveOperationResource(
					workspace.workspaceFolder.uri,
					String(rawParameters[parameter.name])
				);
			}
			if (cancellationToken.isCancellationRequested) {
				throw new CancellationError();
			}
			const argument = reviewed.host === 'template'
				? { templateId: commandParameters.templateId, targetFolder: workspace.cwd, cancellationToken }
				: reviewed.host === 'move'
					? await this.resolveMoveArgument(workspace.workspaceFolder.uri, String(rawParameters.from), String(rawParameters.to))
					: Object.freeze(commandParameters);
			const result = await raceCancellationError(
				this.commandService.executeCommand(reviewed.operation.command, argument, cancellationToken),
				cancellationToken
			);
			if (cancellationToken.isCancellationRequested) {
				throw new CancellationError();
			}
			const validatedResult = validateBaseHalfAgentOperationReturn(reviewed.operation, result);
			return {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'runOperation',
				ok: true,
				outcome: 'succeeded',
				operationId: reviewed.operation.id,
				...(reviewed.operation.returns.type === 'void'
					? {}
					: { result: validatedResult })
			};
		} catch (error) {
			if (isCancellationError(error)) {
				return cancelledOperationResponse(request.operationId);
			}
			return rejectedOperationResponse(request.operationId, errorMessage(error));
		}
	}

	private resolveOperation(operationId: string): { readonly operation: IBaseHalfAgentOperationContribution; readonly host?: 'template' | 'move' } {
		const normalized = operationId.trim().toLowerCase();
		if (normalized === BASEHALF_AGENT_WORKSPACE_MOVE_OPERATION_ID) {
			return { host: 'move', operation: workspaceMoveOperation() };
		}
		if (normalized === BASEHALF_AGENT_CREATE_FROM_TEMPLATE_OPERATION_ID) {
			const templateIds = this.canvasRecipeRegistryService.getTemplates().map(template => template.id);
			if (templateIds.length === 0) {
				throw new Error('No reviewed canvas template is installed.');
			}
			return {
				host: 'template',
				operation: createFromTemplateOperation(templateIds)
			};
		}
		const descriptor = this.agentCapabilityRegistryService.getOperation(normalized);
		if (!descriptor || descriptor.operation.deterministic !== true) {
			throw new Error(`Agent operation '${operationId}' is not installed and reviewed.`);
		}
		return { operation: descriptor.operation };
	}

	/**
	 * Validates an agent move (reference graph, "Agent moves"): both paths in the
	 * entry grammar, the segments the move creates also in the portable
	 * project-path grammar, both inside one unmarked workspace folder and without
	 * symbolic links. `from` and the existing folders of `to` are resolved to
	 * their spelling on disk. `from` must exist, `to` must not (unless it is a
	 * case-only rename of `from`), and `to` must not be inside `from`.
	 */
	private async resolveMoveArgument(workspaceFolder: URI, fromValue: string, toValue: string, keepNormalization = false): Promise<IBaseHalfAgentMoveArgument> {
		if (toValue.endsWith('/')) {
			throw new Error(`'to' is the item's new path, not a folder to move it into.`);
		}
		const requestedFrom = baseHalfNormalizeUpstreamEntry(fromValue);
		const requestedTo = keepNormalization ? toValue : toValue.normalize('NFC');
		for (const [name, value] of [['from', requestedFrom], ['to', requestedTo]] as const) {
			const problem = baseHalfUpstreamEntryGrammarProblem(value);
			if (problem) {
				throw new Error(problem === 'metadata'
					? `'${name}' must not be inside .bh/, which BaseHalf manages.`
					: `'${name}' must be a path relative to the workspace folder, with forward slashes and no '.' or '..' segments.`);
			}
		}
		if (await baseHalfIsWorkspaceFolderMarked(this.fileService, workspaceFolder)) {
			throw new Error('This workspace folder is marked as a BaseHalf source tree, where BaseHalf does not move files.');
		}
		const ignoreCase = !this.fileService.hasCapability(workspaceFolder, FileSystemProviderCapabilities.PathCaseSensitive);
		const nameKey = (name: string) => ignoreCase ? name.normalize('NFC').toLowerCase() : name.normalize('NFC');
		const toSegments = requestedTo.split('/');
		const newName = toSegments[toSegments.length - 1];
		const toFolders = await this.resolveDiskSpelling(workspaceFolder, toSegments.slice(0, -1), ignoreCase);
		if (toFolders.missing.length > 0 && await this.fileService.exists(URI.joinPath(workspaceFolder, ...toFolders.resolved, toFolders.missing[0]))) {
			// An alias such as a short 8.3 name reaches a folder its parent does not list by that name.
			throw new Error(`'${[...toFolders.resolved, toFolders.missing[0]].join('/')}' names an existing folder by a spelling its parent folder does not list. Use the folder's listed name.`);
		}
		// Only the segments the move creates must be portable; existing folders keep their names.
		const created = [...toFolders.missing, newName].join('/');
		const portability = baseHalfProjectPathProblem(created.normalize('NFC'));
		if (portability) {
			throw new Error(`The new part of 'to' (${created}) ${portability}`);
		}
		const to = [...toFolders.resolved, ...toFolders.missing, newName].join('/');
		const target = URI.joinPath(workspaceFolder, ...to.split('/'));
		const fromSpelling = await this.resolveDiskSpelling(workspaceFolder, requestedFrom.split('/'), ignoreCase);
		if (fromSpelling.missing.length > 0) {
			throw new Error(await this.fileService.exists(target)
				? `'${requestedFrom}' does not exist, but '${to}' does: the item may already have been moved.`
				: `'${requestedFrom}' does not exist. Paths are relative to the workspace folder, not to the current directory.`);
		}
		const from = fromSpelling.resolved.join('/');
		if (from === to) {
			throw new Error(`'from' and 'to' name the same path.`);
		}
		const source = URI.joinPath(workspaceFolder, ...from.split('/'));
		// Paths of a nested workspace folder belong to that folder: its .bh/ and marker rules apply.
		for (const [name, resource] of [['from', source], ['to', target]] as const) {
			const owner = this.workspaceContextService.getWorkspaceFolder(resource);
			if (!owner || !extUri.isEqual(owner.uri, workspaceFolder)) {
				throw new Error(`'${name}' belongs to another workspace folder. Run the command from inside that folder, with paths relative to it.`);
			}
		}
		const sameItem = nameKey(from) === nameKey(to);
		if (sameItem && from.normalize('NFC') === to.normalize('NFC')) {
			throw new Error(`'to' differs from '${from}' only in Unicode normalization.`);
		}
		if (sameItem && !keepNormalization && from !== from.normalize('NFC')) {
			// A case-only rename keeps the item's normalization form, so the file
			// system sees the same name with different case.
			return this.resolveMoveArgument(workspaceFolder, fromValue, [...toSegments.slice(0, -1), newName.normalize('NFD')].join('/'), true);
		}
		const comparer = ignoreCase ? extUriIgnorePathCase : extUri;
		if (!sameItem && comparer.isEqualOrParent(target, source)) {
			throw new Error(`'to' is inside '${from}'.`);
		}
		await this.assertNoSymbolicLinks(workspaceFolder, source);
		const [workspaceRealpath, sourceRealpath] = await Promise.all([
			this.fileService.realpath(workspaceFolder),
			this.fileService.realpath(source)
		]);
		if (!workspaceRealpath || !sourceRealpath
			|| !extUri.isEqualOrParent(sourceRealpath, workspaceRealpath)
			|| extUri.isEqual(sourceRealpath, workspaceRealpath)) {
			throw new Error(`'${from}' could not be verified inside the workspace folder.`);
		}
		// A sibling whose name matches the new one after normalization (and case, where
		// case is ignored) is an existing item, even when the file system reports no
		// conflict for a case-only rename.
		const fromName = fromSpelling.resolved[fromSpelling.resolved.length - 1];
		const sameParent = toFolders.missing.length === 0 && toFolders.resolved.join('/') === fromSpelling.resolved.slice(0, -1).join('/');
		const siblings = toFolders.missing.length > 0 ? [] : await this.childNames(URI.joinPath(workspaceFolder, ...toFolders.resolved));
		const occupied = siblings.some(name => (!sameParent || name !== fromName) && nameKey(name) === nameKey(newName));
		if (occupied || (!sameItem && await this.fileService.exists(target))) {
			throw new Error(`'${to}' already exists. 'to' is the item's new path, not a folder to move it into.`);
		}
		await this.assertNoSymbolicLinkAncestors(workspaceFolder, target);
		return { workspaceFolder, source, target, from, to };
	}

	private async childNames(folder: URI): Promise<string[]> {
		try {
			return ((await this.fileService.resolve(folder)).children ?? []).map(child => child.name);
		} catch {
			return [];
		}
	}

	/**
	 * Resolves each segment to the spelling its parent folder lists: an exact
	 * match first, then a name that differs only in Unicode normalization, then,
	 * on a case-insensitive file system, one that also differs in case.
	 * `missing` holds the segments from the first one that names nothing.
	 */
	private async resolveDiskSpelling(workspaceFolder: URI, segments: readonly string[], ignoreCase: boolean): Promise<{ readonly resolved: string[]; readonly missing: string[] }> {
		const resolved: string[] = [];
		let current = workspaceFolder;
		for (let index = 0; index < segments.length; index++) {
			const segment = segments[index];
			const names = await this.childNames(current);
			const nfc = segment.normalize('NFC');
			const only = (candidates: string[]) => candidates.length === 1 ? candidates[0] : undefined;
			const match = names.find(name => name === segment)
				?? only(names.filter(name => name.normalize('NFC') === nfc))
				?? (ignoreCase ? only(names.filter(name => name.normalize('NFC').toLowerCase() === nfc.toLowerCase())) : undefined);
			if (match === undefined) {
				return { resolved, missing: segments.slice(index) };
			}
			resolved.push(match);
			current = URI.joinPath(current, match);
		}
		return { resolved, missing: [] };
	}

	/** Like {@link assertNoSymbolicLinks} for a path that may not exist yet: checks the ancestors that do. */
	private async assertNoSymbolicLinkAncestors(root: URI, resource: URI): Promise<void> {
		const relative = extUri.relativePath(root, resource);
		if (relative === undefined || relative === '..' || relative.startsWith('../')) {
			throw new Error('The requested path leaves the selected workspace folder.');
		}
		const segments = relative.split('/').filter(Boolean);
		let current = root;
		for (const segment of segments.slice(0, -1)) {
			current = URI.joinPath(current, segment);
			let stat;
			try {
				stat = await this.fileService.stat(current);
			} catch {
				// The rest of the path does not exist yet; the move creates it.
				return;
			}
			if (stat.isSymbolicLink) {
				throw new Error('The requested path contains a symbolic link.');
			}
			if (!stat.isDirectory) {
				throw new Error(`'${extUri.relativePath(root, current)}' is not a folder.`);
			}
		}
	}

	private async resolveNode(event: IBaseHalfNodeCommandRequestEvent): Promise<IBaseHalfWorkspaceResource> {
		const request = event.request;
		if (request.version !== BASEHALF_NODE_COMMAND_BRIDGE_VERSION || request.type !== 'runNode') {
			throw new Error('This node command protocol version is not supported.');
		}
		if (!isAbsolute(request.cwd) || request.cwd.includes('\0')) {
			throw new Error('Run the command from an absolute local workspace directory.');
		}
		if (baseHalfProjectPathProblem(request.relativePath)) {
			throw new Error('The node path must be a portable relative project path.');
		}
		if (!request.relativePath.toLowerCase().endsWith(BASEHALF_NODE_DOCUMENT_EXTENSION)) {
			throw new Error(`The node path must end in ${BASEHALF_NODE_DOCUMENT_EXTENSION}.`);
		}

		const { cwd, workspaceFolder } = await this.resolveCommandWorkspace(request.cwd);
		const resource = URI.joinPath(workspaceFolder.uri, ...request.relativePath.split('/'));
		const workspaceRelativePath = extUri.relativePath(workspaceFolder.uri, resource);
		if (!workspaceRelativePath || baseHalfProjectPathProblem(workspaceRelativePath)
			|| !extUri.isEqualOrParent(resource, workspaceFolder.uri)
			|| extUri.isEqual(resource, workspaceFolder.uri)) {
			throw new Error('The node path does not resolve inside the selected workspace folder.');
		}

		await this.assertNoSymbolicLinks(workspaceFolder.uri, cwd);
		await this.assertNoSymbolicLinks(workspaceFolder.uri, resource);
		const [workspaceRealpath, cwdRealpath, resourceRealpath, cwdStat, resourceStat] = await Promise.all([
			this.fileService.realpath(workspaceFolder.uri),
			this.fileService.realpath(cwd),
			this.fileService.realpath(resource),
			this.fileService.stat(cwd),
			this.fileService.stat(resource)
		]);
		if (!workspaceRealpath || !cwdRealpath || !resourceRealpath) {
			throw new Error('The workspace node path could not be verified.');
		}
		if (!cwdStat.isDirectory || cwdStat.isSymbolicLink) {
			throw new Error('The command directory must be a regular workspace directory.');
		}
		if (!resourceStat.isFile || resourceStat.isDirectory || resourceStat.isSymbolicLink) {
			throw new Error('The node path must identify a regular node document.');
		}
		if (!extUri.isEqualOrParent(cwdRealpath, workspaceRealpath)
			|| !extUri.isEqualOrParent(resourceRealpath, workspaceRealpath)
			|| extUri.isEqual(resourceRealpath, workspaceRealpath)) {
			throw new Error('The verified node path resolves outside the selected workspace folder.');
		}
		if (this.workingCopyService.isDirty(resource)) {
			throw new Error('Save this node before running it.');
		}

		return {
			resource,
			workspaceFolder: workspaceFolder.uri,
			relativePath: workspaceRelativePath
		};
	}

	private async resolveCommandWorkspace(cwdValue: string): Promise<{ readonly cwd: URI; readonly workspaceFolder: { readonly uri: URI } }> {
		if (!isAbsolute(cwdValue) || cwdValue.includes('\0')) {
			throw new Error('Run the command from an absolute local workspace directory.');
		}
		const cwd = URI.file(cwdValue);
		const workspaceFolder = this.workspaceContextService.getWorkspaceFolder(cwd);
		if (!workspaceFolder || workspaceFolder.uri.scheme !== 'file') {
			throw new Error('The command directory is not inside an open local workspace folder.');
		}
		await this.assertNoSymbolicLinks(workspaceFolder.uri, cwd);
		const [workspaceRealpath, cwdRealpath, cwdStat] = await Promise.all([
			this.fileService.realpath(workspaceFolder.uri),
			this.fileService.realpath(cwd),
			this.fileService.stat(cwd)
		]);
		if (!workspaceRealpath || !cwdRealpath || !cwdStat.isDirectory || cwdStat.isSymbolicLink
			|| !extUri.isEqualOrParent(cwdRealpath, workspaceRealpath)) {
			throw new Error('The command directory could not be verified inside the workspace.');
		}
		return { cwd, workspaceFolder };
	}

	private async resolveOperationResource(workspaceFolder: URI, relativePath: string): Promise<URI> {
		if (baseHalfProjectPathProblem(relativePath)) {
			throw new Error('URI operation parameters must be portable workspace-relative paths.');
		}
		const resource = URI.joinPath(workspaceFolder, ...relativePath.split('/'));
		if (!extUri.isEqualOrParent(resource, workspaceFolder) || extUri.isEqual(resource, workspaceFolder)) {
			throw new Error('URI operation parameter resolves outside the workspace folder.');
		}
		await this.assertNoSymbolicLinks(workspaceFolder, resource);
		const [workspaceRealpath, resourceRealpath, stat] = await Promise.all([
			this.fileService.realpath(workspaceFolder),
			this.fileService.realpath(resource),
			this.fileService.stat(resource)
		]);
		if (!workspaceRealpath || !resourceRealpath || stat.isSymbolicLink
			|| !extUri.isEqualOrParent(resourceRealpath, workspaceRealpath)
			|| extUri.isEqual(resourceRealpath, workspaceRealpath)) {
			throw new Error('URI operation parameter could not be verified inside the workspace folder.');
		}
		if (this.workingCopyService.isDirty(resource)) {
			throw new Error('Save files passed to this Agent operation before running it.');
		}
		return resource;
	}

	private async assertNoSymbolicLinks(root: URI, resource: URI): Promise<void> {
		const relative = extUri.relativePath(root, resource);
		if (relative === undefined || relative === '..' || relative.startsWith('../')) {
			throw new Error('The requested node path leaves the selected workspace folder.');
		}
		let current = root;
		if ((await this.fileService.stat(current)).isSymbolicLink) {
			throw new Error('The selected workspace path contains a symbolic link.');
		}
		for (const segment of relative.split('/').filter(Boolean)) {
			current = URI.joinPath(current, segment);
			const stat = await this.fileService.stat(current);
			if (stat.isSymbolicLink) {
				throw new Error('The requested node path contains a symbolic link.');
			}
		}
	}
}

export function responseForCompletedAttempt(nodePath: string, attemptId: string, document: IBaseHalfNodeDocument): IBaseHalfRunNodeCommandResponse {
	const attempt = document.attempts.find(candidate => candidate.id === attemptId);
	if (!attempt || attempt.status === 'running') {
		return rejectedResponse(nodePath, 'The host did not return a completed record for this attempt.');
	}
	const result = document.result?.source === 'attempt' && document.result.attemptId === attempt.id
		? document.result
		: undefined;
	return {
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		ok: attempt.status === 'succeeded' && result !== undefined,
		outcome: attempt.status,
		nodePath,
		attempt: {
			id: attempt.id,
			status: attempt.status,
			...(attempt.completedAt === undefined ? {} : { completedAt: attempt.completedAt }),
			...(attempt.error === undefined ? {} : { error: attempt.error })
		},
		...(result === undefined ? {} : {
			result: { source: 'attempt', attemptId: result.attemptId, artifactPath: result.artifact.path }
		}),
		...(attempt.status === 'succeeded' || attempt.error === undefined ? {} : { error: attempt.error })
	};
}

function rejectedResponse(nodePath: string, error: string): IBaseHalfRunNodeCommandResponse {
	return {
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		ok: false,
		outcome: 'rejected',
		nodePath,
		error: error.slice(0, 16 * 1024)
	};
}

function rejectedOperationResponse(operationId: string, error: string): IBaseHalfAgentOperationCommandResponse {
	return {
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		type: 'runOperation',
		ok: false,
		outcome: 'rejected',
		operationId,
		error: error.slice(0, 16 * 1024)
	};
}

function cancelledOperationResponse(operationId: string): IBaseHalfAgentOperationCommandResponse {
	return {
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		type: 'runOperation',
		ok: false,
		outcome: 'cancelled',
		operationId
	};
}

function rejectedCapabilityDiscoveryResponse(error: string): IBaseHalfAgentCapabilityDiscoveryResponse {
	return {
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		type: 'listCapabilities',
		ok: false,
		outcome: 'rejected',
		error: error.slice(0, 16 * 1024)
	};
}

function rejectedResponseForRequest(request: IBaseHalfRunNodeCommandRequest | IBaseHalfAgentOperationCommandRequest | IBaseHalfAgentCapabilityDiscoveryRequest, error: string): IBaseHalfNodeCommandResponse {
	if (request.type === 'runOperation') {
		return rejectedOperationResponse(request.operationId, error);
	}
	return request.type === 'listCapabilities'
		? rejectedCapabilityDiscoveryResponse(error)
		: rejectedResponse(request.relativePath, error);
}

function capabilityDiscoveryExtension(
	capability: ReturnType<IBaseHalfAgentCapabilityRegistryService['getCapabilities']>[number]
): IBaseHalfAgentCapabilityDiscoveryExtension {
	return Object.freeze({
		id: capability.id,
		label: capability.label,
		...(capability.description === undefined ? {} : { description: capability.description }),
			documents: Object.freeze(capability.documents.map(document => Object.freeze({
				kind: document.kind,
				version: document.version,
				fileExtensions: Object.freeze([...document.fileExtensions]),
				schemaSummary: document.schemaSummary
			}))),
		operations: Object.freeze(capability.operations.map(operation => capabilityDiscoveryOperation(operation)))
	});
}

function capabilityDiscoveryOperation(operation: IBaseHalfAgentOperationContribution) {
	return Object.freeze({
		id: operation.id,
		description: operation.description,
		deterministic: operation.deterministic,
		parameters: Object.freeze((operation.parameters ?? []).map(parameter => Object.freeze({
			name: parameter.name,
			type: parameter.type,
			required: parameter.required,
			description: parameter.description,
			...(parameter.values === undefined ? {} : { values: Object.freeze([...parameter.values]) })
		}))),
		returns: Object.freeze({
			type: operation.returns.type,
			description: operation.returns.description
		})
	});
}

function workspaceMoveOperation(): IBaseHalfAgentOperationContribution {
	return Object.freeze({
		id: BASEHALF_AGENT_WORKSPACE_MOVE_OPERATION_ID,
		command: BASEHALF_WORKSPACE_AGENT_MOVE_COMMAND_ID,
		description: 'Move or rename a file or folder as the Explorer does: its BaseHalf metadata moves with it, and the upstream entries that name it are updated.',
		deterministic: true,
		parameters: Object.freeze([
			Object.freeze({
				name: 'from',
				type: 'string' as const,
				required: true,
				description: 'Path of the file or folder to move, relative to the workspace folder.'
			}),
			Object.freeze({
				name: 'to',
				type: 'string' as const,
				required: true,
				description: 'Its new path, relative to the workspace folder. Nothing may exist there yet.'
			})
		]),
		returns: Object.freeze({ type: 'object', description: 'from, to, and upstream: { updated, skipped, incomplete?, notUpdated? }.' })
	});
}

function createFromTemplateOperation(templateIds: readonly string[]): IBaseHalfAgentOperationContribution {
	return Object.freeze({
		id: BASEHALF_AGENT_CREATE_FROM_TEMPLATE_OPERATION_ID,
		command: BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID,
		description: 'Create a project from one installed reviewed canvas template.',
		deterministic: true,
		parameters: Object.freeze([Object.freeze({
			name: 'templateId',
			type: 'enum' as const,
			required: true,
			description: 'Installed canvas template identifier.',
			values: Object.freeze([...templateIds])
		})]),
		returns: Object.freeze({ type: 'object', description: 'Created template id and workspace-relative project path.' })
	});
}

function capabilityDiscoveryRecipe(recipe: IBaseHalfCanvasRecipeDescriptor): IBaseHalfAgentCapabilityDiscoveryRecipe {
	return Object.freeze({
		id: recipe.id,
		label: recipe.label,
		...(recipe.description === undefined ? {} : { description: recipe.description }),
		...(recipe.icon === undefined ? {} : { icon: recipe.icon }),
		...(recipe.modelCapability === undefined ? {} : { modelCapability: recipe.modelCapability }),
		...(recipe.videoModelCatalogId === undefined ? {} : { videoModelCatalogId: recipe.videoModelCatalogId }),
		inputs: Object.freeze(recipe.inputs.map(input => Object.freeze({
			id: input.id,
			label: input.label,
			accepts: Object.freeze([...input.accepts]),
			minItems: input.minItems,
			maxItems: input.maxItems
		}))),
		parameters: Object.freeze(recipe.parameters.map(parameter => {
			const base = {
				id: parameter.id,
				label: parameter.label,
				type: parameter.type,
				...(parameter.required === true ? { required: true as const } : {})
			};
			switch (parameter.type) {
				case 'string':
				case 'multiline':
					return Object.freeze({
						...base,
						...(parameter.default === undefined ? {} : { default: parameter.default }),
						...(parameter.minLength === undefined ? {} : { minLength: parameter.minLength }),
						...(parameter.maxLength === undefined ? {} : { maxLength: parameter.maxLength })
					});
				case 'number':
					return Object.freeze({
						...base,
						...(parameter.default === undefined ? {} : { default: parameter.default }),
						...(parameter.minimum === undefined ? {} : { minimum: parameter.minimum }),
						...(parameter.maximum === undefined ? {} : { maximum: parameter.maximum }),
						...(parameter.step === undefined ? {} : { step: parameter.step })
					});
				case 'boolean':
					return Object.freeze({
						...base,
						...(parameter.default === undefined ? {} : { default: parameter.default })
					});
				case 'enum':
					return Object.freeze({
						...base,
						...(parameter.default === undefined ? {} : { default: parameter.default }),
						options: Object.freeze(parameter.options.map(option => Object.freeze({ value: option.value, label: option.label })))
					});
			}
		})),
		outputs: Object.freeze(recipe.outputs.map(output => Object.freeze({
			id: output.id,
			kind: output.kind,
			extensions: Object.freeze([...output.extensions]),
			minItems: output.minItems,
			maxItems: output.maxItems,
			...(output.primary === true ? { primary: true as const } : {})
		})))
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
