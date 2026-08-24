/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { isAbsolute } from '../../../base/common/path.js';
import { raceCancellationError } from '../../../base/common/async.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import { CancellationError, isCancellationError } from '../../../base/common/errors.js';
import { extUri } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { IFileService } from '../../../platform/files/common/files.js';
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
	IBaseHalfAgentOperationContribution,
	IBaseHalfAgentCapabilityRegistryService,
	validateBaseHalfAgentOperationParameters,
	validateBaseHalfAgentOperationReturn
} from '../common/basehalfAgentCapabilities.js';
import { IBaseHalfWorkspaceResource } from '../common/basehalfCanvasNavigation.js';
import { IBaseHalfCanvasRecipeDescriptor, IBaseHalfCanvasRecipeRegistryService } from '../common/basehalfCanvasRecipes.js';
import { BASEHALF_CANVAS_CREATE_FROM_TEMPLATE_COMMAND_ID } from '../common/basehalfCanvasTemplate.js';
import {
	BASEHALF_NODE_DOCUMENT_EXTENSION,
	BASEHALF_NODE_DOCUMENT_VERSION,
	baseHalfProjectPathProblem,
	getBaseHalfNodeAgentAuthoringContract,
	IBaseHalfNodeDocument
} from '../common/basehalfNodeDocument.js';
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
			const hostOperations = Object.freeze(templateIds.length === 0
				? []
				: [capabilityDiscoveryOperation(createFromTemplateOperation(templateIds))]);
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
							scope: 'direct-inbound-reference' as const,
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
					contextEdge: Object.freeze({
						source: 'direct-content' as const,
					resultNodeSource: 'sealed-result' as const,
						target: 'direct-context' as const,
						autoRun: false as const,
						recursive: false as const,
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
			const argument = reviewed.hostTemplate
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

	private resolveOperation(operationId: string): { readonly operation: IBaseHalfAgentOperationContribution; readonly hostTemplate: boolean } {
		const normalized = operationId.trim().toLowerCase();
		if (normalized === BASEHALF_AGENT_CREATE_FROM_TEMPLATE_OPERATION_ID) {
			const templateIds = this.canvasRecipeRegistryService.getTemplates().map(template => template.id);
			if (templateIds.length === 0) {
				throw new Error('No reviewed canvas template is installed.');
			}
			return {
				hostTemplate: true,
				operation: createFromTemplateOperation(templateIds)
			};
		}
		const descriptor = this.agentCapabilityRegistryService.getOperation(normalized);
		if (!descriptor || descriptor.operation.deterministic !== true) {
			throw new Error(`Agent operation '${operationId}' is not installed and reviewed.`);
		}
		return { operation: descriptor.operation, hostTemplate: false };
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
