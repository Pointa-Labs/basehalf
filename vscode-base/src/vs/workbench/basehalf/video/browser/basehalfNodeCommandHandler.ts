/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { isAbsolute } from '../../../../base/common/path.js';
import { raceCancellationError } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../../base/common/errors.js';
import { basename, dirname, extUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService, IFileStatWithPartialMetadata } from '../../../../platform/files/common/files.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import {
	BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_EXTENSIONS,
	BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_TEMPLATES,
	BASEHALF_AGENT_DISCOVERY_GENERATE_COMMAND,
	BASEHALF_AGENT_DISCOVERY_GENERATION_EXTENSIONS,
	BASEHALF_AGENT_DISCOVERY_GENERATION_FILE,
	BASEHALF_AGENT_DISCOVERY_HOST_OWNED,
	BASEHALF_AGENT_DISCOVERY_INPUTS_FILE,
	BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
	IBaseHalfAgentCapabilityDiscoveryExtension,
	IBaseHalfAgentCapabilityDiscoveryModelCatalog,
	IBaseHalfAgentCapabilityDiscoveryRequest,
	IBaseHalfAgentCapabilityDiscoveryResponse,
	IBaseHalfAgentOperationCommandRequest,
	IBaseHalfAgentOperationCommandResponse,
	IBaseHalfGenerateCommandRequest,
	IBaseHalfGenerateCommandResponse,
	IBaseHalfNodeCommandRequestEvent,
	IBaseHalfNodeCommandResponse
} from '../../../../platform/terminal/common/terminal.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkingCopyService } from '../../../services/workingCopy/common/workingCopyService.js';
import { IBaseHalfAgentAreaService } from '../../agentArea/common/basehalfAgentArea.js';
import {
	BASEHALF_AGENT_CREATE_FROM_TEMPLATE_OPERATION_ID,
	IBaseHalfAgentOperationContribution,
	IBaseHalfAgentCapabilityRegistryService,
	validateBaseHalfAgentOperationParameters,
	validateBaseHalfAgentOperationReturn
} from '../../plugins/common/basehalfAgentCapabilities.js';
import { IBaseHalfWorkspaceResource } from '../../navigation/common/basehalfCanvasNavigation.js';
import { BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID } from '../../canvas/common/basehalfCanvasTemplate.js';
import { IBaseHalfCanvasTemplateRegistryService } from '../../canvas/common/basehalfCanvasTemplateRegistry.js';
import { baseHalfProjectPathProblem } from '../../workspace/common/basehalfProjectPath.js';
import { getBaseHalfGenerationAgentContract } from '../common/basehalfGenerationAgentContract.js';
import { baseHalfReadDraftFacts } from '../common/basehalfGenerationDraft.js';
import { baseHalfGenerationKindOfPath } from '../common/basehalfGenerationInfo.js';
import { baseHalfVideoCatalogForAgents, baseHalfVideoExampleGeneration, IBaseHalfVideoCatalogProvider, IBaseHalfVideoGenerationChoice } from '../common/basehalfVideoCatalog.js';
import { baseHalfGenerationMissingFileMessage, IBaseHalfGenerationCardStore, IBaseHalfVideoCatalogService, IBaseHalfVideoGenerationService, IBaseHalfVideoProviderSettingsService } from '../common/basehalfVideoGeneration.js';

/** How long `--list-capabilities` waits for the model catalog while it loads. */
const MODEL_CATALOG_WAIT = 10_000;

/**
 * Answers the commands of `basehalf` in an Agent Area terminal (D63,
 * generation cards, "Agents"): `--generate` starts a generation of an image
 * or video card exactly as Generate does, without a question, and answers
 * with every card it lands on once its task record is `submitting`.
 * `--list-capabilities` and `--run-operation` describe and run what the host
 * and admitted extensions offer; the description includes what an agent may
 * write to a generation card and the model catalog it chooses from (D59).
 */
export class BaseHalfNodeCommandHandler {
	constructor(
		private readonly workspaceContextService: IWorkspaceContextService,
		private readonly fileService: IFileService,
		private readonly workingCopyService: IWorkingCopyService,
		private readonly agentAreaService: IBaseHalfAgentAreaService,
		private readonly videoGenerationService: IBaseHalfVideoGenerationService,
		private readonly generationCardStore: IBaseHalfGenerationCardStore,
		private readonly agentCapabilityRegistryService: IBaseHalfAgentCapabilityRegistryService,
		private readonly canvasTemplateRegistryService: IBaseHalfCanvasTemplateRegistryService,
		private readonly commandService: ICommandService,
		private readonly videoCatalogService: IBaseHalfVideoCatalogService,
		private readonly videoProviderSettings: IBaseHalfVideoProviderSettingsService
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

		return this.handleGenerate(event.request, cancellationToken);
	}

	/**
	 * `basehalf --generate <path>`: the path must name a generation card of
	 * the workspace folder, a draft or a card with its file. The generation
	 * runs exactly as Generate does, except that a value the model does not
	 * accept stops it instead of being made legal.
	 */
	private async handleGenerate(request: IBaseHalfGenerateCommandRequest, cancellationToken: CancellationToken): Promise<IBaseHalfGenerateCommandResponse> {
		try {
			if (cancellationToken.isCancellationRequested) {
				throw new CancellationError();
			}
			const card = await this.resolveGenerationCard(request);
			if (cancellationToken.isCancellationRequested) {
				throw new CancellationError();
			}
			// Once the generation starts it belongs to its cards: closing the
			// Agent session never stops it. No question is asked; the user asked
			// the agent to work, and their own key pays.
			const cards = await this.videoGenerationService.generate(card.resource, { agent: true });
			const paths = cards.map(resource => extUri.relativePath(card.workspaceFolder, resource) ?? resource.path);
			return paths.length ? generatedResponse(request.relativePath, paths) : rejectedGenerateResponse(request.relativePath, 'The generation lands on no card.');
		} catch (error) {
			return rejectedGenerateResponse(request.relativePath, isCancellationError(error)
				? 'The command was cancelled before the generation started.'
				: errorMessage(error));
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
			const installedTemplates = this.canvasTemplateRegistryService.getTemplates();
			if (installedTemplates.length > BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_TEMPLATES) {
				throw new Error('Too many reviewed canvas templates are installed to return safely.');
			}
			const extensions = Object.freeze(installedExtensions.map(capability => capabilityDiscoveryExtension(capability)));
			const templates = Object.freeze(installedTemplates.map(template => Object.freeze({
				id: template.id,
				label: template.label,
				...(template.description === undefined ? {} : { description: template.description })
			})));
			const templateIds = templates.map(template => template.id);
			const hostOperations = Object.freeze(templateIds.length === 0 ? [] : [capabilityDiscoveryOperation(createFromTemplateOperation(templateIds))]);
			const models = await this.modelCatalogForAgents();
			if (cancellationToken.isCancellationRequested) {
				throw new CancellationError();
			}
			const response: IBaseHalfAgentCapabilityDiscoveryResponse = {
				version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
				type: 'listCapabilities',
				ok: true,
				outcome: 'succeeded',
				host: Object.freeze({
					// D63: what an agent may write to make a draft or change a card's next generation.
					generationCards: Object.freeze({
						fileExtensions: BASEHALF_AGENT_DISCOVERY_GENERATION_EXTENSIONS,
						generationFile: BASEHALF_AGENT_DISCOVERY_GENERATION_FILE,
						inputsFile: BASEHALF_AGENT_DISCOVERY_INPUTS_FILE,
						hostOwned: BASEHALF_AGENT_DISCOVERY_HOST_OWNED,
						generateCommand: BASEHALF_AGENT_DISCOVERY_GENERATE_COMMAND,
						authoring: getBaseHalfGenerationAgentContract(models.example)
					}),
					// D37: the downstream node stores each edge once, in its own
					// `upstream` list; the reverse direction is derived by the host.
					// A generation card uses its inputs in that list's order.
					contextEdge: Object.freeze({
						source: 'direct-content' as const,
						target: 'direct-context' as const,
						autoRun: false as const,
						recursive: false as const,
						storedBy: 'downstream' as const,
						markdownFrontmatterKey: 'upstream' as const,
						inputOrder: 'target-upstream-order' as const,
						label: 'none' as const
					}),
					templates,
					operations: hostOperations,
					modelCatalog: models.catalog
				}),
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

	/** The model catalog for agents, and a generation of it to show in the authoring example. */
	private async modelCatalogForAgents(): Promise<{ readonly catalog: IBaseHalfAgentCapabilityDiscoveryModelCatalog; readonly example?: IBaseHalfVideoGenerationChoice }> {
		try {
			const catalog = await this.videoCatalogService.whenReady(MODEL_CATALOG_WAIT);
			const setup = (provider: IBaseHalfVideoCatalogProvider) => this.videoProviderSettings.getStatus(provider);
			const providers = JSON.parse(JSON.stringify(baseHalfVideoCatalogForAgents(catalog, setup)));
			const example = baseHalfVideoExampleGeneration(catalog, setup);
			return { catalog: Object.freeze({ providers }), ...(example ? { example } : {}) };
		} catch (error) {
			return { catalog: Object.freeze({ providers: Object.freeze([]), error: errorMessage(error).slice(0, 2_000) }) };
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

	private resolveOperation(operationId: string): { readonly operation: IBaseHalfAgentOperationContribution; readonly host?: 'template' } {
		const normalized = operationId.trim().toLowerCase();
		if (normalized === BASEHALF_AGENT_CREATE_FROM_TEMPLATE_OPERATION_ID) {
			const templateIds = this.canvasTemplateRegistryService.getTemplates().map(template => template.id);
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
			throw new Error(`Agent operation '${operationId}' is not available.`);
		}
		return { operation: descriptor.operation };
	}

	/**
	 * The card a `--generate` names: a portable path relative to the workspace
	 * folder of the command directory, with an image or video extension, whose
	 * folder is a real folder of that workspace folder, whose file, when it
	 * has one, is a regular file there, and that the card store knows as a
	 * generation card: a draft, or a file with generation information. A card
	 * whose file is gone, which has its `made.yaml` and no file, is a missing
	 * file: it never generates, and the answer is the one Generate gives.
	 */
	private async resolveGenerationCard(request: IBaseHalfGenerateCommandRequest): Promise<IBaseHalfWorkspaceResource> {
		if (request.version !== BASEHALF_NODE_COMMAND_BRIDGE_VERSION || request.type !== 'generate') {
			throw new Error('This generate command protocol version is not supported.');
		}
		if (baseHalfProjectPathProblem(request.relativePath)) {
			throw new Error('The card path must be a portable path relative to the workspace folder, outside .bh.');
		}
		if (!baseHalfGenerationKindOfPath(request.relativePath)) {
			throw new Error(`'${request.relativePath}' is not an image or video card: its name has no image or video extension.`);
		}
		const { workspaceFolder } = await this.resolveCommandWorkspace(request.cwd);
		const resource = URI.joinPath(workspaceFolder.uri, ...request.relativePath.split('/'));
		const workspaceRelativePath = extUri.relativePath(workspaceFolder.uri, resource);
		if (!workspaceRelativePath || baseHalfProjectPathProblem(workspaceRelativePath)
			|| !extUri.isEqualOrParent(resource, workspaceFolder.uri)
			|| extUri.isEqual(resource, workspaceFolder.uri)) {
			throw new Error('The card path does not resolve inside the workspace folder.');
		}
		// A missing file is not a draft (generation cards, "Drafts and missing
		// files"): its made.yaml, readable or not, stays while its file is gone,
		// also with its folder. It is refused as Generate refuses it.
		if (!await this.statQuietly(resource)
			&& (await baseHalfReadDraftFacts(this.fileService, workspaceFolder.uri, workspaceRelativePath)).hasMade) {
			throw new Error(baseHalfGenerationMissingFileMessage(basename(resource)));
		}
		// A draft has no file: its folder is what must be a real folder of the workspace.
		const folder = dirname(resource);
		if (!(await this.statQuietly(folder))?.isDirectory) {
			throw new Error(`The folder of '${workspaceRelativePath}' does not exist.`);
		}
		await this.assertNoSymbolicLinks(workspaceFolder.uri, folder);
		const [workspaceRealpath, folderRealpath, itemStat] = await Promise.all([
			this.fileService.realpath(workspaceFolder.uri),
			this.realpathQuietly(folder),
			this.statQuietly(resource)
		]);
		if (!workspaceRealpath || !folderRealpath || !extUri.isEqualOrParent(folderRealpath, workspaceRealpath)) {
			throw new Error(`The folder of '${workspaceRelativePath}' is not a folder of the workspace.`);
		}
		if (itemStat) {
			if (itemStat.isSymbolicLink || !itemStat.isFile) {
				throw new Error(`'${workspaceRelativePath}' must be a regular file or a draft, not a folder or a symbolic link.`);
			}
			const itemRealpath = await this.realpathQuietly(resource);
			if (!itemRealpath || !extUri.isEqualOrParent(itemRealpath, workspaceRealpath)) {
				throw new Error(`'${workspaceRelativePath}' resolves outside the workspace folder.`);
			}
		}
		if (!await this.generationCardStore.isGenerationCard(resource)) {
			throw new Error(itemStat
				? `'${workspaceRelativePath}' is not an image or video card: it has no prompt or settings. Write its .bh/mirror/${workspaceRelativePath}/generation.yaml first.`
				: `'${workspaceRelativePath}' names no file and no draft. Write .bh/mirror/${workspaceRelativePath}/generation.yaml to make a draft there.`);
		}
		return {
			resource,
			workspaceFolder: workspaceFolder.uri,
			relativePath: workspaceRelativePath
		};
	}

	private async statQuietly(resource: URI): Promise<IFileStatWithPartialMetadata | undefined> {
		try {
			return await this.fileService.stat(resource);
		} catch {
			return undefined;
		}
	}

	private async realpathQuietly(resource: URI): Promise<URI | undefined> {
		try {
			return await this.fileService.realpath(resource);
		} catch {
			return undefined;
		}
	}

	private async resolveCommandWorkspace(cwdValue: string): Promise<{ readonly cwd: URI; readonly workspaceFolder: { readonly uri: URI } }> {
		if (!isAbsolute(cwdValue) || cwdValue.includes('\0')) {
			throw new Error('Run the command from an absolute local workspace directory.');
		}
		const cwd = await this.workspacePathOf(URI.file(cwdValue));
		const workspaceFolder = cwd && this.workspaceContextService.getWorkspaceFolder(cwd);
		if (!cwd || !workspaceFolder || workspaceFolder.uri.scheme !== 'file') {
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

	/**
	 * The directory by the name the workspace gives it. A shell reports its
	 * directory with links resolved, so in a workspace opened through a link
	 * (on macOS, any folder under /tmp or /var) the directory is found by
	 * comparing real paths. The checks that follow see the workspace's name.
	 */
	private async workspacePathOf(directory: URI): Promise<URI | undefined> {
		if (this.workspaceContextService.getWorkspaceFolder(directory)) {
			return directory;
		}
		const realpath = async (resource: URI) => {
			try {
				return await this.fileService.realpath(resource);
			} catch {
				return undefined;
			}
		};
		const real = await realpath(directory);
		if (!real) {
			return undefined;
		}
		let containing: { readonly folder: URI; readonly real: URI } | undefined;
		for (const folder of this.workspaceContextService.getWorkspace().folders) {
			const folderReal = folder.uri.scheme === 'file' ? await realpath(folder.uri) : undefined;
			if (folderReal && extUri.isEqualOrParent(real, folderReal) && (!containing || containing.real.path.length < folderReal.path.length)) {
				containing = { folder: folder.uri, real: folderReal };
			}
		}
		if (!containing) {
			return undefined;
		}
		const relative = extUri.relativePath(containing.real, real);
		return relative ? URI.joinPath(containing.folder, ...relative.split('/')) : containing.folder;
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
			throw new Error('The requested path leaves the selected workspace folder.');
		}
		let current = root;
		if ((await this.fileService.stat(current)).isSymbolicLink) {
			throw new Error('The selected workspace path contains a symbolic link.');
		}
		for (const segment of relative.split('/').filter(Boolean)) {
			current = URI.joinPath(current, segment);
			const stat = await this.fileService.stat(current);
			if (stat.isSymbolicLink) {
				throw new Error('The requested path contains a symbolic link.');
			}
		}
	}
}

/** The answer to `--generate` once the generation's task record is `submitting`: every card it lands on. */
export function generatedResponse(path: string, cards: readonly string[]): IBaseHalfGenerateCommandResponse {
	return {
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		type: 'generate',
		ok: true,
		outcome: 'succeeded',
		path,
		cards: Object.freeze([...cards])
	};
}

function rejectedGenerateResponse(path: string, error: string): IBaseHalfGenerateCommandResponse {
	return {
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		type: 'generate',
		ok: false,
		outcome: 'rejected',
		path,
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

function rejectedResponseForRequest(request: IBaseHalfGenerateCommandRequest | IBaseHalfAgentOperationCommandRequest | IBaseHalfAgentCapabilityDiscoveryRequest, error: string): IBaseHalfNodeCommandResponse {
	if (request.type === 'runOperation') {
		return rejectedOperationResponse(request.operationId, error);
	}
	return request.type === 'listCapabilities'
		? rejectedCapabilityDiscoveryResponse(error)
		: rejectedGenerateResponse(request.relativePath, error);
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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
