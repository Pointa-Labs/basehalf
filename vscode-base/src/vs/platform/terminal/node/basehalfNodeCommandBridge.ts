/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import type * as http from 'http';
import { CancellationToken, CancellationTokenSource } from '../../../base/common/cancellation.js';
import { join } from '../../../base/common/path.js';
import { createRandomIPCHandle } from '../../../base/parts/ipc/node/ipc.net.js';
import { ILogService } from '../../log/common/log.js';
import {
	BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_EXTENSIONS,
	BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_RECIPES,
	BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_TEMPLATES,
	BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
	IBaseHalfAgentOperationCommandRequest,
	IBaseHalfAgentOperationCommandResponse,
	IBaseHalfAgentCapabilityDiscoveryExtension,
	IBaseHalfAgentCapabilityDiscoveryRequest,
	IBaseHalfAgentCapabilityDiscoveryResponse,
	IBaseHalfNodeCommandRequest,
	IBaseHalfNodeCommandResponse,
	IBaseHalfRunNodeCommandRequest,
	IBaseHalfRunNodeCommandResponse
} from '../common/terminal.js';

const REQUEST_PATH = '/run-node';
const OPERATION_REQUEST_PATH = '/run-operation';
const CAPABILITY_DISCOVERY_REQUEST_PATH = '/list-capabilities';
const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export function resolveBaseHalfCliDirectory(
	appRoot: string,
	applicationName: string,
	windows: boolean,
	pathExists: (candidate: string) => boolean = fs.existsSync
): string | undefined {
	for (const directory of [join(appRoot, 'bin'), join(appRoot, '..', '..', 'bin')]) {
		if (pathExists(join(directory, `${applicationName}${windows ? '.cmd' : ''}`))) {
			return directory;
		}
	}
	return undefined;
}

export class BaseHalfNodeCommandServer {
	private server: http.Server | undefined;
	private readonly activeResponses = new Map<http.ServerResponse, {
		request: IBaseHalfNodeCommandRequest | undefined;
		readonly cancellation: CancellationTokenSource;
		runSettled: boolean;
	}>();
	private disposed = false;
	readonly ipcHandlePath = createRandomIPCHandle();

	constructor(
		private readonly runNode: (request: IBaseHalfNodeCommandRequest, cancellationToken: CancellationToken) => Promise<IBaseHalfNodeCommandResponse>,
		private readonly logService: ILogService
	) { }

	async start(): Promise<void> {
		const httpModule = await import('http');
		if (this.disposed) {
			throw new Error('The node command bridge was disposed before it could start.');
		}
		await new Promise<void>((resolve, reject) => {
			const server = httpModule.createServer((request, response) => void this.onRequest(request, response));
			this.server = server;
			const onError = (error: Error) => {
				server.off('listening', onListening);
				reject(error);
			};
			const onListening = () => {
				server.off('error', onError);
				if (process.platform !== 'win32') {
					fs.chmodSync(this.ipcHandlePath, 0o600);
				}
				resolve();
			};
			server.once('error', onError);
			server.once('listening', onListening);
			server.listen(this.ipcHandlePath);
		});
		this.server?.on('error', error => this.logService.error('BaseHalf node command bridge failed', error));
	}

	dispose(reason = 'This terminal is no longer owned by the BaseHalf Agent Area.'): void {
		this.disposed = true;
		for (const [response, active] of this.activeResponses) {
			if (!active.runSettled) {
				active.cancellation.cancel();
			}
			if (!response.headersSent) {
				this.send(response, 503, rejectedResponseForRequest(active.request, reason));
			} else if (!response.writableEnded) {
				response.destroy();
			}
		}
		this.server?.close();
		this.server = undefined;
		if (process.platform !== 'win32' && fs.existsSync(this.ipcHandlePath)) {
			try {
				fs.unlinkSync(this.ipcHandlePath);
			} catch (error) {
				this.logService.warn('Could not remove BaseHalf node command bridge socket', error);
			}
		}
	}

	private async onRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
		const rejectedForEndpoint = (error: string): IBaseHalfNodeCommandResponse => {
			switch (request.url) {
				case OPERATION_REQUEST_PATH:
					return baseHalfRejectedAgentOperationResponse('', error);
				case CAPABILITY_DISCOVERY_REQUEST_PATH:
					return baseHalfRejectedAgentCapabilityDiscoveryResponse(error);
				default:
					return baseHalfRejectedNodeCommandResponse('', error);
			}
		};
		const active = {
			request: undefined as IBaseHalfNodeCommandRequest | undefined,
			cancellation: new CancellationTokenSource(),
			runSettled: false
		};
		this.activeResponses.set(response, active);
		response.once('close', () => {
			this.activeResponses.delete(response);
			if (!active.runSettled) {
				active.cancellation.cancel();
			}
			active.cancellation.dispose();
		});
		if (this.disposed) {
			this.send(response, 503, rejectedForEndpoint('This terminal is no longer owned by the BaseHalf Agent Area.'));
			return;
		}
		if (request.method !== 'POST'
			|| (request.url !== REQUEST_PATH && request.url !== OPERATION_REQUEST_PATH && request.url !== CAPABILITY_DISCOVERY_REQUEST_PATH)
			|| request.headers['content-type'] !== 'application/json') {
			this.send(response, 404, rejectedForEndpoint('Unsupported Agent command request.'));
			return;
		}

		const chunks: Buffer[] = [];
		let size = 0;
		let tooLarge = false;
		request.on('data', (chunk: Buffer | string) => {
			if (tooLarge) {
				return;
			}
			const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
			size += buffer.byteLength;
			if (size > MAX_REQUEST_BYTES) {
				tooLarge = true;
				chunks.length = 0;
				return;
			}
			chunks.push(buffer);
		});
		request.on('error', error => {
			if (!response.headersSent) {
				this.send(response, 400, rejectedForEndpoint(messageForError(error)));
			}
		});
		request.on('end', async () => {
			if (this.disposed) {
				this.send(response, 503, rejectedForEndpoint('This terminal is no longer owned by the BaseHalf Agent Area.'));
				return;
			}
			if (tooLarge) {
				this.send(response, 413, rejectedForEndpoint('Agent command request is too large.'));
				return;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			} catch {
				this.send(response, 400, rejectedForEndpoint('Agent command request must be valid JSON.'));
				return;
			}
			if (!isBaseHalfNodeCommandRequest(parsed)) {
				this.send(response, 400, rejectedForEndpoint('Agent command request does not match the supported protocol.'));
				return;
			}
			if (request.url !== requestPath(parsed)) {
				this.send(response, 400, rejectedResponseForRequest(parsed, 'The command request type does not match its endpoint.'));
				return;
			}
			active.request = parsed;
			try {
				const result = await this.runNode(parsed, active.cancellation.token);
				active.runSettled = true;
				this.send(response, 200, result);
			} catch (error) {
				active.runSettled = true;
				this.send(response, 200, rejectedResponseForRequest(parsed, messageForError(error)));
			}
		});
	}

	private send(response: http.ServerResponse, statusCode: number, payload: IBaseHalfNodeCommandResponse): void {
		if (response.headersSent || response.destroyed || response.writableEnded) {
			return;
		}
		let body: string;
		if (!isBaseHalfNodeCommandResponse(payload)) {
			payload = rejectedResponseForResponse(payload, 'Command response does not match the supported protocol.');
			statusCode = 500;
		}
		try {
			body = JSON.stringify(payload);
		} catch {
			body = JSON.stringify(rejectedResponseForResponse(payload, 'Command response is not JSON-serializable.'));
			statusCode = 500;
		}
		if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
			body = JSON.stringify(rejectedResponseForResponse(payload, 'Command response is too large.'));
			statusCode = 500;
		}
		response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'connection': 'close' });
		response.end(body);
	}
}

export async function requestBaseHalfNodeCommand(
	ipcHandlePath: string,
	request: IBaseHalfRunNodeCommandRequest
): Promise<IBaseHalfRunNodeCommandResponse>;
export async function requestBaseHalfNodeCommand(
	ipcHandlePath: string,
	request: IBaseHalfAgentOperationCommandRequest
): Promise<IBaseHalfAgentOperationCommandResponse>;
export async function requestBaseHalfNodeCommand(
	ipcHandlePath: string,
	request: IBaseHalfAgentCapabilityDiscoveryRequest
): Promise<IBaseHalfAgentCapabilityDiscoveryResponse>;
export async function requestBaseHalfNodeCommand(
	ipcHandlePath: string,
	request: IBaseHalfNodeCommandRequest
): Promise<IBaseHalfNodeCommandResponse> {
	const httpModule = await import('http');
	return new Promise<IBaseHalfNodeCommandResponse>((resolve, reject) => {
		const body = JSON.stringify(request);
		const outgoing = httpModule.request({
			socketPath: ipcHandlePath,
			path: requestPath(request),
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'accept': 'application/json',
				'content-length': Buffer.byteLength(body)
			}
		}, incoming => {
			const chunks: Buffer[] = [];
			let size = 0;
			incoming.on('data', (chunk: Buffer | string) => {
				const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
				size += buffer.byteLength;
				if (size > MAX_RESPONSE_BYTES) {
					incoming.destroy(new Error('Node command response is too large.'));
					return;
				}
				chunks.push(buffer);
			});
			incoming.on('error', reject);
			incoming.on('end', () => {
				try {
					const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
					if (!isBaseHalfNodeCommandResponse(parsed)) {
						throw new Error('Node command bridge returned an invalid response.');
					}
					if (!responseMatchesRequest(request, parsed)) {
						throw new Error('Node command bridge returned a response for another request type.');
					}
					resolve(parsed);
				} catch (error) {
					reject(error);
				}
			});
		});
		outgoing.on('error', reject);
		outgoing.end(body);
	});
}

export function baseHalfRejectedNodeCommandResponse(nodePath: string, error: string): IBaseHalfRunNodeCommandResponse {
	return {
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		ok: false,
		outcome: 'rejected',
		nodePath,
		error: error.slice(0, 16 * 1024)
	};
}

export function baseHalfRejectedAgentOperationResponse(operationId: string, error: string): IBaseHalfAgentOperationCommandResponse {
	return {
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		type: 'runOperation',
		ok: false,
		outcome: 'rejected',
		operationId,
		error: error.slice(0, 16 * 1024)
	};
}

export function baseHalfRejectedAgentCapabilityDiscoveryResponse(error: string): IBaseHalfAgentCapabilityDiscoveryResponse {
	return {
		version: BASEHALF_NODE_COMMAND_BRIDGE_VERSION,
		type: 'listCapabilities',
		ok: false,
		outcome: 'rejected',
		error: error.slice(0, 16 * 1024)
	};
}

function rejectedResponseForRequest(request: IBaseHalfNodeCommandRequest | undefined, error: string): IBaseHalfNodeCommandResponse {
	if (request?.type === 'runOperation') {
		return baseHalfRejectedAgentOperationResponse(request.operationId, error);
	}
	return request?.type === 'listCapabilities'
		? baseHalfRejectedAgentCapabilityDiscoveryResponse(error)
		: baseHalfRejectedNodeCommandResponse(request?.relativePath ?? '', error);
}

function rejectedResponseForResponse(response: IBaseHalfNodeCommandResponse, error: string): IBaseHalfNodeCommandResponse {
	if (response.type === 'runOperation') {
		return baseHalfRejectedAgentOperationResponse(response.operationId, error);
	}
	return response.type === 'listCapabilities'
		? baseHalfRejectedAgentCapabilityDiscoveryResponse(error)
		: baseHalfRejectedNodeCommandResponse(typeof response.nodePath === 'string' ? response.nodePath : '', error);
}

function isBaseHalfNodeCommandRequest(value: unknown): value is IBaseHalfNodeCommandRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (record.version !== BASEHALF_NODE_COMMAND_BRIDGE_VERSION
		|| typeof record.cwd !== 'string'
		|| record.cwd.length === 0
		|| record.cwd.length > 4096) {
		return false;
	}
	if (record.type === 'runNode') {
		return Object.keys(record).length === 4
			&& typeof record.relativePath === 'string'
			&& record.relativePath.length > 0
			&& record.relativePath.length <= 1024;
	}
	if (record.type === 'listCapabilities') {
		return Object.keys(record).length === 3;
	}
	return record.type === 'runOperation'
		&& Object.keys(record).length === 5
		&& typeof record.operationId === 'string'
		&& record.operationId.length > 0
		&& record.operationId.length <= 180
		&& isOperationParameterRecord(record.parameters);
}

function isBaseHalfNodeCommandResponse(value: unknown): value is IBaseHalfNodeCommandResponse {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (record.version !== BASEHALF_NODE_COMMAND_BRIDGE_VERSION
		|| typeof record.ok !== 'boolean'
		|| (record.error !== undefined && typeof record.error !== 'string')) {
		return false;
	}
	if (record.type === 'runOperation') {
		const outcome = String(record.outcome);
		return ['succeeded', 'cancelled', 'rejected'].includes(outcome)
			&& record.ok === (outcome === 'succeeded')
			&& typeof record.operationId === 'string'
			&& (outcome === 'succeeded' || record.result === undefined)
			&& (outcome !== 'succeeded' || record.error === undefined);
	}
	if (record.type === 'listCapabilities') {
		if (record.outcome === 'succeeded') {
			return record.ok === true
				&& Object.keys(record).length === 7
				&& isCapabilityDiscoveryHost(record.host)
				&& Array.isArray(record.recipes)
				&& record.recipes.length <= BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_RECIPES
				&& isCapabilityDiscoveryRecipes(record.recipes)
				&& Array.isArray(record.extensions)
				&& record.extensions.length <= BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_EXTENSIONS
				&& record.error === undefined
				&& isCapabilityDiscoveryExtensions(record.extensions);
		}
		return record.outcome === 'rejected'
			&& record.ok === false
			&& Object.keys(record).length === 5
			&& record.host === undefined
			&& record.recipes === undefined
			&& record.extensions === undefined
			&& isBoundedText(record.error, 16 * 1024);
	}
	return typeof record.ok === 'boolean'
		&& ['succeeded', 'failed', 'cancelled', 'interrupted', 'rejected'].includes(String(record.outcome))
		&& typeof record.nodePath === 'string';
}

function isCapabilityDiscoveryHost(value: unknown): boolean {
	if (!isRecord(value)
		|| !hasOnlyKeys(value, ['nodeDocument', 'contextEdge', 'templates', 'operations'])
		|| !Array.isArray(value.templates)
		|| value.templates.length > BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_TEMPLATES
		|| !value.templates.every(template => isRecord(template)
			&& hasOnlyKeys(template, ['id', 'label'], ['description'])
			&& isContributionId(template.id)
			&& isBoundedText(template.label, 80)
			&& (template.description === undefined || isBoundedText(template.description, 500)))
		|| new Set(value.templates.map(template => (template as Record<string, unknown>).id)).size !== value.templates.length
		|| !Array.isArray(value.operations)
		|| value.operations.length > 16
		|| !value.operations.every(isCapabilityDiscoveryOperation)
		|| new Set(value.operations.map(operation => (operation as Record<string, unknown>).id)).size !== value.operations.length
		|| !isRecord(value.contextEdge)
		|| !hasOnlyKeys(value.contextEdge, ['source', 'resultNodeSource', 'target', 'autoRun', 'recursive', 'roleAndOrderOwner', 'label'])
		|| value.contextEdge.source !== 'direct-content'
		|| value.contextEdge.resultNodeSource !== 'sealed-result'
		|| value.contextEdge.target !== 'direct-context'
		|| value.contextEdge.autoRun !== false
		|| value.contextEdge.recursive !== false
		|| value.contextEdge.roleAndOrderOwner !== 'target-recipe-binding'
		|| value.contextEdge.label !== 'none'
		|| !isRecord(value.nodeDocument)) {
		return false;
	}
	const templateIds = value.templates.map(template => (template as Record<string, unknown>).id);
	const templateOperations = value.operations.filter(operation => isRecord(operation) && operation.id === 'basehalf.canvas.create-from-template');
	if (templateIds.length === 0 ? templateOperations.length !== 0 : templateOperations.length !== 1) {
		return false;
	}
	if (templateOperations.length === 1) {
		const parameters = (templateOperations[0] as Record<string, unknown>).parameters;
		if (!Array.isArray(parameters)
			|| parameters.length !== 1
			|| !isRecord(parameters[0])
			|| parameters[0].name !== 'templateId'
			|| parameters[0].type !== 'enum'
			|| !Array.isArray(parameters[0].values)
			|| !arraysEqual(parameters[0].values, templateIds)) {
			return false;
		}
	}
	const document = value.nodeDocument;
	const resultKinds = ['file', 'image', 'video', 'audio', 'pdf', 'presentation'];
	if (!hasOnlyKeys(document, ['fileExtension', 'documentVersion', 'resultKinds', 'inputBinding', 'lifecycle', 'runCommand', 'authoring'])
		|| document.fileExtension !== '.bhnode'
		|| !Number.isSafeInteger(document.documentVersion)
		|| (document.documentVersion as number) < 1
		|| !Array.isArray(document.resultKinds)
		|| document.resultKinds.length !== resultKinds.length
		|| !document.resultKinds.every((kind, index) => kind === resultKinds[index])
		|| !isRecord(document.inputBinding)
		|| !hasOnlyKeys(document.inputBinding, ['scope', 'fields'])
		|| document.inputBinding.scope !== 'direct-inbound-reference'
		|| !Array.isArray(document.inputBinding.fields)
		|| document.inputBinding.fields.length !== 3
		|| document.inputBinding.fields[0] !== 'sourcePath'
		|| document.inputBinding.fields[1] !== 'slot'
		|| document.inputBinding.fields[2] !== 'order'
		|| !isRecord(document.lifecycle)
		|| !hasOnlyKeys(document.lifecycle, ['attempts', 'result', 'retry'])
		|| document.lifecycle.attempts !== 'host-owned'
		|| document.lifecycle.result !== 'host-owned-single-file'
		|| document.lifecycle.retry !== 'frozen-only'
		|| document.runCommand !== 'basehalf --run-node <workspace-relative-.bhnode-path>'
		|| !isRecord(document.authoring)
		|| !hasOnlyKeys(document.authoring, ['contractVersion', 'schema', 'examples', 'hostOwnedFields', 'rules'])
		|| !Number.isSafeInteger(document.authoring.contractVersion)
		|| !isRecord(document.authoring.schema)
		|| !isRecord(document.authoring.examples)
		|| !Array.isArray(document.authoring.hostOwnedFields)
		|| !arraysEqual(document.authoring.hostOwnedFields, ['result', 'attempts'])
		|| !Array.isArray(document.authoring.rules)
		|| !document.authoring.rules.every(rule => isBoundedText(rule, 500))) {
		return false;
	}
	return isBoundedCapabilityJson(document.authoring);
}

function isCapabilityDiscoveryRecipes(value: readonly unknown[]): boolean {
	const ids = new Set<string>();
	for (const recipe of value) {
		if (!isRecord(recipe)
			|| !hasOnlyKeys(recipe, ['id', 'label', 'inputs', 'parameters', 'outputs'], ['description', 'icon', 'modelCapability', 'videoModelCatalogId'])
			|| !isContributionId(recipe.id)
			|| ids.has(recipe.id)
			|| !isBoundedText(recipe.label, 80)
			|| (recipe.description !== undefined && !isBoundedText(recipe.description, 500))
			|| (recipe.icon !== undefined && (typeof recipe.icon !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(recipe.icon)))
			|| (recipe.modelCapability !== undefined && !['text', 'image', 'video', 'audio'].includes(String(recipe.modelCapability)))
			|| (recipe.modelCapability === 'video'
				? !isContributionId(recipe.videoModelCatalogId) || !sameContributionOwner(recipe.id, recipe.videoModelCatalogId)
				: recipe.videoModelCatalogId !== undefined)
			|| !Array.isArray(recipe.inputs)
			|| recipe.inputs.length > 16
			|| !recipe.inputs.every(isCapabilityDiscoveryRecipeInput)
			|| !hasUniqueLocalIds(recipe.inputs)
			|| !Array.isArray(recipe.parameters)
			|| recipe.parameters.length > 32
			|| !recipe.parameters.every(isCapabilityDiscoveryRecipeParameter)
			|| !hasUniqueLocalIds(recipe.parameters)
			|| !Array.isArray(recipe.outputs)
			|| recipe.outputs.length !== 1
			|| !recipe.outputs.every(isCapabilityDiscoveryRecipeOutput)
			|| !hasUniqueLocalIds(recipe.outputs)
			|| !isRecord(recipe.outputs[0])
			|| recipe.outputs[0].primary !== true
			|| recipe.outputs[0].minItems !== 1
			|| recipe.outputs[0].maxItems !== 1) {
			return false;
		}
		ids.add(recipe.id);
	}
	return true;
}

function sameContributionOwner(left: unknown, right: unknown): boolean {
	if (typeof left !== 'string' || typeof right !== 'string') {
		return false;
	}
	return left.split('.', 2).join('.') === right.split('.', 2).join('.');
}

function isCapabilityDiscoveryRecipeInput(value: unknown): boolean {
	const kinds = ['text', 'code', 'file', 'folder', 'image', 'video', 'audio', 'pdf', 'presentation'];
	return isRecord(value)
		&& hasOnlyKeys(value, ['id', 'label', 'accepts', 'minItems', 'maxItems'])
		&& isLocalId(value.id)
		&& isBoundedText(value.label, 80)
		&& Array.isArray(value.accepts)
		&& value.accepts.length > 0
		&& value.accepts.length <= kinds.length
		&& value.accepts.every(kind => kinds.includes(String(kind)))
		&& new Set(value.accepts).size === value.accepts.length
		&& isItemRange(value.minItems, value.maxItems);
}

function isCapabilityDiscoveryRecipeParameter(value: unknown): boolean {
	if (!isRecord(value)
		|| !isLocalId(value.id)
		|| !isBoundedText(value.label, 80)
		|| (value.required !== undefined && value.required !== true)) {
		return false;
	}
	const baseKeys = ['id', 'label', 'type'];
	const optionalBaseKeys = ['required'];
	switch (value.type) {
		case 'string':
		case 'multiline': {
			if (!hasOnlyKeys(value, baseKeys, [...optionalBaseKeys, 'default', 'minLength', 'maxLength'])
				|| (value.default !== undefined && (typeof value.default !== 'string' || value.default.length > 100_000))
				|| !isOptionalInteger(value.minLength, 0, 100_000)
				|| !isOptionalInteger(value.maxLength, 1, 100_000)) {
				return false;
			}
			return value.minLength === undefined || value.maxLength === undefined || (value.maxLength as number) >= (value.minLength as number);
		}
		case 'number':
			return hasOnlyKeys(value, baseKeys, [...optionalBaseKeys, 'default', 'minimum', 'maximum', 'step'])
				&& [value.default, value.minimum, value.maximum, value.step].every(entry => entry === undefined || (typeof entry === 'number' && Number.isFinite(entry)))
				&& (value.minimum === undefined || value.maximum === undefined || (value.maximum as number) >= (value.minimum as number))
				&& (value.step === undefined || (value.step as number) > 0);
		case 'boolean':
			return hasOnlyKeys(value, baseKeys, [...optionalBaseKeys, 'default'])
				&& (value.default === undefined || typeof value.default === 'boolean');
		case 'enum': {
			if (!hasOnlyKeys(value, [...baseKeys, 'options'], [...optionalBaseKeys, 'default'])
				|| !Array.isArray(value.options)
				|| value.options.length < 1
				|| value.options.length > 50
				|| !value.options.every(option => isRecord(option)
					&& hasOnlyKeys(option, ['value', 'label'])
					&& isBoundedText(option.value, 100)
					&& isBoundedText(option.label, 100))) {
				return false;
			}
			const values = value.options.map(option => (option as Record<string, unknown>).value);
			return new Set(values).size === values.length
				&& (value.default === undefined || (typeof value.default === 'string' && values.includes(value.default)));
		}
		default:
			return false;
	}
}

function isCapabilityDiscoveryRecipeOutput(value: unknown): boolean {
	return isRecord(value)
		&& hasOnlyKeys(value, ['id', 'kind', 'extensions', 'minItems', 'maxItems'], ['primary'])
		&& isLocalId(value.id)
		&& ['file', 'image', 'video', 'audio', 'pdf', 'presentation'].includes(String(value.kind))
		&& Array.isArray(value.extensions)
		&& value.extensions.length > 0
		&& value.extensions.length <= 16
		&& value.extensions.every(extension => typeof extension === 'string' && /^\.[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/.test(extension))
		&& new Set(value.extensions).size === value.extensions.length
		&& isItemRange(value.minItems, value.maxItems)
		&& (value.primary === undefined || value.primary === true)
		&& (value.primary !== true || (value.minItems === 1 && value.maxItems === 1));
}

function requestPath(request: IBaseHalfNodeCommandRequest): string {
	switch (request.type) {
		case 'runNode': return REQUEST_PATH;
		case 'runOperation': return OPERATION_REQUEST_PATH;
		case 'listCapabilities': return CAPABILITY_DISCOVERY_REQUEST_PATH;
	}
}

function responseMatchesRequest(request: IBaseHalfNodeCommandRequest, response: IBaseHalfNodeCommandResponse): boolean {
	return request.type === 'runNode'
		? response.type !== 'runOperation' && response.type !== 'listCapabilities'
		: response.type === request.type;
}

function isCapabilityDiscoveryExtensions(value: readonly unknown[]): value is readonly IBaseHalfAgentCapabilityDiscoveryExtension[] {
	const capabilityIds = new Set<string>();
	const operationIds = new Set<string>();
	for (const capability of value) {
		if (!isRecord(capability)
			|| !hasOnlyKeys(capability, ['id', 'label', 'documents', 'operations'], ['description'])
			|| !isContributionId(capability.id)
			|| capabilityIds.has(capability.id)
			|| !isBoundedText(capability.label, 80)
			|| (capability.description !== undefined && !isBoundedText(capability.description, 500))
			|| !Array.isArray(capability.documents)
			|| capability.documents.length > 16
			|| !capability.documents.every(isCapabilityDiscoveryDocument)
			|| !Array.isArray(capability.operations)
			|| capability.operations.length > 64
			|| (capability.documents.length === 0 && capability.operations.length === 0)) {
			return false;
		}
		capabilityIds.add(capability.id);
		for (const operation of capability.operations) {
			if (!isCapabilityDiscoveryOperation(operation) || operationIds.has(operation.id)) {
				return false;
			}
			operationIds.add(operation.id);
		}
	}
	return true;
}

function isCapabilityDiscoveryDocument(value: unknown): boolean {
	return isRecord(value)
		&& hasOnlyKeys(value, ['kind', 'version', 'fileExtensions', 'schemaSummary'])
		&& isContributionId(value.kind)
		&& Number.isSafeInteger(value.version)
		&& (value.version as number) >= 1
		&& (value.version as number) <= 1_000_000
		&& Array.isArray(value.fileExtensions)
		&& value.fileExtensions.length > 0
		&& value.fileExtensions.length <= 16
		&& value.fileExtensions.every(extension => typeof extension === 'string' && /^\.[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/.test(extension))
		&& new Set(value.fileExtensions).size === value.fileExtensions.length
		&& isBoundedText(value.schemaSummary, 2_000);
}

function isCapabilityDiscoveryOperation(value: unknown): value is { readonly id: string } {
	if (!isRecord(value)
		|| !hasOnlyKeys(value, ['id', 'description', 'deterministic', 'parameters', 'returns'])
		|| !isContributionId(value.id)
		|| !isBoundedText(value.description, 500)
		|| value.deterministic !== true
		|| !Array.isArray(value.parameters)
		|| value.parameters.length > 32
		|| !value.parameters.every(isCapabilityDiscoveryParameter)
		|| !isRecord(value.returns)
		|| !hasOnlyKeys(value.returns, ['type', 'description'])
		|| !['object', 'array', 'string', 'number', 'boolean', 'void'].includes(String(value.returns.type))
		|| !isBoundedText(value.returns.description, 500)) {
		return false;
	}
	const names = value.parameters.map(parameter => (parameter as Record<string, unknown>).name);
	return new Set(names).size === names.length;
}

function isCapabilityDiscoveryParameter(value: unknown): boolean {
	if (!isRecord(value)
		|| !hasOnlyKeys(value, ['name', 'type', 'required', 'description'], ['values'])
		|| typeof value.name !== 'string'
		|| !/^[a-z][A-Za-z0-9]{0,63}$/.test(value.name)
		|| !['uri', 'string', 'integer', 'number', 'boolean', 'enum'].includes(String(value.type))
		|| typeof value.required !== 'boolean'
		|| !isBoundedText(value.description, 300)) {
		return false;
	}
	if (value.type !== 'enum') {
		return value.values === undefined;
	}
	return Array.isArray(value.values)
		&& value.values.length > 0
		&& value.values.length <= BASEHALF_AGENT_CAPABILITY_DISCOVERY_MAX_TEMPLATES
		&& value.values.every(entry => isBoundedText(entry, 100))
		&& new Set(value.values).size === value.values.length;
}

function hasUniqueLocalIds(values: readonly unknown[]): boolean {
	const ids = values.map(value => isRecord(value) ? value.id : undefined);
	return ids.every(isLocalId) && new Set(ids).size === ids.length;
}

function isLocalId(value: unknown): value is string {
	return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}

function isItemRange(minItems: unknown, maxItems: unknown): boolean {
	return Number.isInteger(minItems)
		&& Number.isInteger(maxItems)
		&& (minItems as number) >= 0
		&& (minItems as number) <= 64
		&& (maxItems as number) >= 1
		&& (maxItems as number) <= 64
		&& (maxItems as number) >= (minItems as number);
}

function isOptionalInteger(value: unknown, minimum: number, maximum: number): boolean {
	return value === undefined || (Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum);
}

function arraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function isBoundedCapabilityJson(value: unknown): boolean {
	const state = { nodes: 0 };
	const visit = (entry: unknown, depth: number): boolean => {
		state.nodes++;
		if (state.nodes > 8192 || depth > 20) {
			return false;
		}
		if (entry === null || typeof entry === 'boolean') {
			return true;
		}
		if (typeof entry === 'number') {
			return Number.isFinite(entry);
		}
		if (typeof entry === 'string') {
			return entry.length <= 100_000 && !entry.includes('\0');
		}
		if (Array.isArray(entry)) {
			return entry.length <= 1024 && entry.every(item => visit(item, depth + 1));
		}
		if (!isRecord(entry)) {
			return false;
		}
		const keys = Object.keys(entry);
		return keys.length <= 256
			&& keys.every(key => key.length > 0 && key.length <= 128 && visit(entry[key], depth + 1));
	};
	return visit(value, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
	const keys = Object.keys(value);
	return required.every(key => Object.hasOwn(value, key))
		&& keys.every(key => required.includes(key) || optional.includes(key));
}

function isContributionId(value: unknown): value is string {
	return typeof value === 'string'
		&& value.length <= 180
		&& /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/.test(value);
}

function isBoundedText(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maximum && !value.includes('\0');
}

function isOperationParameterRecord(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
		return false;
	}
	const keys = Object.keys(value);
	return keys.length <= 32 && keys.every(key => {
		const entry = (value as Record<string, unknown>)[key];
		return key.length > 0 && key.length <= 64
			&& (typeof entry === 'string'
				? entry.length <= 16 * 1024 && !entry.includes('\0')
				: typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry)));
	});
}

function messageForError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
