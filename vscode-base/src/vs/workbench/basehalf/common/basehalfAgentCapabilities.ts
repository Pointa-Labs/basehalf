/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../base/common/buffer.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { createDecorator } from '../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../platform/instantiation/common/extensions.js';

const CONTRIBUTION_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/;
const COMMAND_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PARAMETER_NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/;
const FILE_EXTENSION_PATTERN = /^\.[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/;

const MAX_CAPABILITY_BYTES = 64 * 1024;
const MAX_DOCUMENTS = 16;
const MAX_OPERATIONS = 64;
const MAX_PARAMETERS = 32;
const MAX_ENUM_VALUES = 32;

export const BASEHALF_AGENT_OPERATION_PARAMETER_TYPES = ['uri', 'string', 'integer', 'number', 'boolean', 'enum'] as const;
export type BaseHalfAgentOperationParameterType = typeof BASEHALF_AGENT_OPERATION_PARAMETER_TYPES[number];

export const BASEHALF_AGENT_OPERATION_RETURN_TYPES = ['object', 'array', 'string', 'number', 'boolean', 'void'] as const;
export type BaseHalfAgentOperationReturnType = typeof BASEHALF_AGENT_OPERATION_RETURN_TYPES[number];

export interface IBaseHalfAgentDocumentFormatContribution {
	readonly kind: string;
	readonly version: number;
	readonly fileExtensions: readonly string[];
	readonly schemaSummary: string;
}

export interface IBaseHalfAgentOperationParameterContribution {
	readonly name: string;
	readonly type: BaseHalfAgentOperationParameterType;
	readonly required: boolean;
	readonly description: string;
	readonly values?: readonly string[];
}

export interface IBaseHalfAgentOperationReturnContribution {
	readonly type: BaseHalfAgentOperationReturnType;
	readonly description: string;
}

export interface IBaseHalfAgentOperationContribution {
	readonly id: string;
	readonly command: string;
	readonly description: string;
	readonly deterministic: true;
	readonly parameters?: readonly IBaseHalfAgentOperationParameterContribution[];
	readonly returns: IBaseHalfAgentOperationReturnContribution;
}

export interface IBaseHalfAgentCapabilityContribution {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly documents?: readonly IBaseHalfAgentDocumentFormatContribution[];
	readonly operations?: readonly IBaseHalfAgentOperationContribution[];
}

export interface IBaseHalfAgentCapabilityDescriptor extends Omit<IBaseHalfAgentCapabilityContribution, 'documents' | 'operations'> {
	readonly extensionId: string;
	readonly documents: readonly IBaseHalfAgentDocumentFormatContribution[];
	readonly operations: readonly IBaseHalfAgentOperationContribution[];
}

export interface IBaseHalfAgentOperationDescriptor {
	readonly capability: IBaseHalfAgentCapabilityDescriptor;
	readonly operation: IBaseHalfAgentOperationContribution;
}

export const BASEHALF_AGENT_CREATE_FROM_TEMPLATE_OPERATION_ID = 'basehalf.canvas.create-from-template';

export const IBaseHalfAgentCapabilityRegistryService = createDecorator<IBaseHalfAgentCapabilityRegistryService>('baseHalfAgentCapabilityRegistryService');

export interface IBaseHalfAgentCapabilityRegistryService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	registerCapability(extensionId: string, contribution: IBaseHalfAgentCapabilityContribution): IDisposable;
	getCapability(id: string): IBaseHalfAgentCapabilityDescriptor | undefined;
	getCapabilities(): readonly IBaseHalfAgentCapabilityDescriptor[];
	getOperation(id: string): IBaseHalfAgentOperationDescriptor | undefined;
}

export class BaseHalfAgentCapabilityRegistryService extends Disposable implements IBaseHalfAgentCapabilityRegistryService {
	declare readonly _serviceBrand: undefined;

	private readonly capabilities = new Map<string, IBaseHalfAgentCapabilityDescriptor>();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	registerCapability(extensionId: string, contribution: IBaseHalfAgentCapabilityContribution): IDisposable {
		const descriptor = validateBaseHalfAgentCapabilityContribution(extensionId, contribution);
		if (this.capabilities.has(descriptor.id)) {
			throw new Error(`A BaseHalf Agent capability with id '${descriptor.id}' is already registered.`);
		}
		for (const operation of descriptor.operations) {
			if (this.getOperation(operation.id)) {
				throw new Error(`A BaseHalf Agent operation with id '${operation.id}' is already registered.`);
			}
		}
		this.capabilities.set(descriptor.id, descriptor);
		this._onDidChange.fire();
		return toDisposable(() => {
			if (this.capabilities.get(descriptor.id) === descriptor) {
				this.capabilities.delete(descriptor.id);
				this._onDidChange.fire();
			}
		});
	}

	getCapability(id: string): IBaseHalfAgentCapabilityDescriptor | undefined {
		return this.capabilities.get(id.toLowerCase());
	}

	getCapabilities(): readonly IBaseHalfAgentCapabilityDescriptor[] {
		return [...this.capabilities.values()].sort((left, right) => left.id.localeCompare(right.id));
	}

	getOperation(id: string): IBaseHalfAgentOperationDescriptor | undefined {
		const normalized = id.trim().toLowerCase();
		for (const capability of this.capabilities.values()) {
			const operation = capability.operations.find(candidate => candidate.id === normalized);
			if (operation) {
				return { capability, operation };
			}
		}
		return undefined;
	}
}

export function validateBaseHalfAgentOperationParameters(
	operation: IBaseHalfAgentOperationContribution,
	value: unknown
): Readonly<Record<string, string | number | boolean>> {
	assertRecord(value, `BaseHalf Agent operation '${operation.id}' parameters`);
	const declared = new Map((operation.parameters ?? []).map(parameter => [parameter.name, parameter]));
	const unknown = Object.keys(value).filter(name => !declared.has(name));
	if (unknown.length > 0) {
		throw new Error(`BaseHalf Agent operation '${operation.id}' received unsupported parameters: ${unknown.join(', ')}.`);
	}
	const result: Record<string, string | number | boolean> = {};
	for (const parameter of operation.parameters ?? []) {
		const candidate = value[parameter.name];
		if (candidate === undefined) {
			if (parameter.required) {
				throw new Error(`BaseHalf Agent operation '${operation.id}' requires parameter '${parameter.name}'.`);
			}
			continue;
		}
		switch (parameter.type) {
			case 'uri':
			case 'string':
				if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 16 * 1024 || candidate.includes('\0')) {
					throw new Error(`BaseHalf Agent operation '${operation.id}' parameter '${parameter.name}' must be non-empty text.`);
				}
				break;
			case 'integer':
				if (!Number.isSafeInteger(candidate)) {
					throw new Error(`BaseHalf Agent operation '${operation.id}' parameter '${parameter.name}' must be a safe integer.`);
				}
				break;
			case 'number':
				if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
					throw new Error(`BaseHalf Agent operation '${operation.id}' parameter '${parameter.name}' must be a finite number.`);
				}
				break;
			case 'boolean':
				if (typeof candidate !== 'boolean') {
					throw new Error(`BaseHalf Agent operation '${operation.id}' parameter '${parameter.name}' must be a boolean.`);
				}
				break;
			case 'enum':
				if (typeof candidate !== 'string' || !parameter.values?.includes(candidate)) {
					throw new Error(`BaseHalf Agent operation '${operation.id}' parameter '${parameter.name}' must be one of: ${parameter.values?.join(', ')}.`);
				}
				break;
		}
		result[parameter.name] = candidate as string | number | boolean;
	}
	return Object.freeze(result);
}

export function validateBaseHalfAgentOperationReturn(
	operation: IBaseHalfAgentOperationContribution,
	value: unknown
): unknown {
	const expected = operation.returns.type;
	if (expected === 'void') {
		if (value !== undefined) {
			throw new Error(`BaseHalf Agent operation '${operation.id}' returned a value but declares void.`);
		}
		return undefined;
	}
	const valid = expected === 'array'
		? Array.isArray(value)
		: expected === 'object'
			? !!value && typeof value === 'object' && !Array.isArray(value)
			: typeof value === expected && (expected !== 'number' || Number.isFinite(value));
	if (!valid) {
		throw new Error(`BaseHalf Agent operation '${operation.id}' did not match its declared ${expected} return type.`);
	}
	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch {
		throw new Error(`BaseHalf Agent operation '${operation.id}' returned a value that is not JSON-serializable.`);
	}
	if (serialized === undefined || VSBuffer.fromString(serialized).byteLength > 1024 * 1024) {
		throw new Error(`BaseHalf Agent operation '${operation.id}' returned too much data.`);
	}
	return JSON.parse(serialized);
}

export function validateBaseHalfAgentCapabilityContribution(
	extensionId: string,
	contribution: IBaseHalfAgentCapabilityContribution
): IBaseHalfAgentCapabilityDescriptor {
	const owner = extensionId.trim().toLowerCase();
	if (!/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/.test(owner)) {
		throw new Error(`BaseHalf Agent capability owner '${extensionId}' is invalid.`);
	}
	assertRecord(contribution, 'BaseHalf Agent capability');
	assertOnlyKeys(contribution, ['id', 'label', 'description', 'documents', 'operations'], 'BaseHalf Agent capability');
	assertContributionSize(contribution);

	const id = ownedId(contribution.id, owner, 'BaseHalf Agent capability');
	const label = boundedText(contribution.label, `${id}.label`, 80);
	const description = optionalBoundedText(contribution.description, `${id}.description`, 500);
	const documents = validateDocuments(owner, id, contribution.documents);
	const operations = validateOperations(owner, id, contribution.operations);
	if (documents.length === 0 && operations.length === 0) {
		throw new Error(`BaseHalf Agent capability '${id}' must declare a document or operation.`);
	}

	return Object.freeze({
		extensionId: owner,
		id,
		label,
		...(description === undefined ? {} : { description }),
		documents,
		operations
	});
}

function validateDocuments(
	owner: string,
	capabilityId: string,
	value: readonly IBaseHalfAgentDocumentFormatContribution[] | undefined
): readonly IBaseHalfAgentDocumentFormatContribution[] {
	const documents = optionalArray(value, `${capabilityId}.documents`, MAX_DOCUMENTS);
	const kinds = new Set<string>();
	return Object.freeze(documents.map((document, index) => {
		assertRecord(document, `${capabilityId}.documents[${index}]`);
		assertOnlyKeys(document, ['kind', 'version', 'fileExtensions', 'schemaSummary'], `${capabilityId}.documents[${index}]`);
		const kind = ownedId(document.kind, owner, 'Document kind');
		if (kinds.has(kind)) {
			throw new Error(`BaseHalf Agent capability '${capabilityId}' declares document kind '${kind}' more than once.`);
		}
		kinds.add(kind);
		const version = integer(document.version, `${kind}.version`, 1, 1_000_000);
		const extensions = requiredArray(document.fileExtensions, `${kind}.fileExtensions`, 1, 16).map((extension, extensionIndex) => {
			if (typeof extension !== 'string' || !FILE_EXTENSION_PATTERN.test(extension)) {
				throw new Error(`BaseHalf Agent document '${kind}' has invalid file extension at index ${extensionIndex}.`);
			}
			return extension.toLowerCase();
		});
		if (new Set(extensions).size !== extensions.length) {
			throw new Error(`BaseHalf Agent document '${kind}' has duplicate file extensions.`);
		}
		const schemaSummary = boundedText(document.schemaSummary, `${kind}.schemaSummary`, 2_000);
		return Object.freeze({
			kind,
			version,
			fileExtensions: Object.freeze(extensions),
			schemaSummary
		});
	}));
}

function validateOperations(
	owner: string,
	capabilityId: string,
	value: readonly IBaseHalfAgentOperationContribution[] | undefined
): readonly IBaseHalfAgentOperationContribution[] {
	const operations = optionalArray(value, `${capabilityId}.operations`, MAX_OPERATIONS);
	const ids = new Set<string>();
	const commands = new Set<string>();
	return Object.freeze(operations.map((operation, index) => {
		assertRecord(operation, `${capabilityId}.operations[${index}]`);
		assertOnlyKeys(operation, ['id', 'command', 'description', 'deterministic', 'parameters', 'returns'], `${capabilityId}.operations[${index}]`);
		const id = ownedId(operation.id, owner, 'Agent operation');
		if (ids.has(id)) {
			throw new Error(`BaseHalf Agent capability '${capabilityId}' declares operation '${id}' more than once.`);
		}
		ids.add(id);
		const command = boundedText(operation.command, `${id}.command`, 200);
		if (!COMMAND_ID_PATTERN.test(command) || !command.toLowerCase().startsWith(`${owner}.`)) {
			throw new Error(`BaseHalf Agent operation '${id}' command '${command}' is not owned by '${owner}'.`);
		}
		if (commands.has(command)) {
			throw new Error(`BaseHalf Agent capability '${capabilityId}' publishes command '${command}' more than once.`);
		}
		commands.add(command);
		if (operation.deterministic !== true) {
			throw new Error(`BaseHalf Agent operation '${id}' must be deterministic.`);
		}
		const description = boundedText(operation.description, `${id}.description`, 500);
		const parameters = validateParameters(id, operation.parameters);
		const returns = validateReturns(id, operation.returns);
		return Object.freeze({ id, command, description, deterministic: true, parameters, returns });
	}));
}

function validateParameters(
	operationId: string,
	value: readonly IBaseHalfAgentOperationParameterContribution[] | undefined
): readonly IBaseHalfAgentOperationParameterContribution[] {
	const parameters = optionalArray(value, `${operationId}.parameters`, MAX_PARAMETERS);
	const names = new Set<string>();
	return Object.freeze(parameters.map((parameter, index) => {
		assertRecord(parameter, `${operationId}.parameters[${index}]`);
		assertOnlyKeys(parameter, ['name', 'type', 'required', 'description', 'values'], `${operationId}.parameters[${index}]`);
		const name = boundedText(parameter.name, `${operationId}.parameters[${index}].name`, 64);
		if (!PARAMETER_NAME_PATTERN.test(name) || names.has(name)) {
			throw new Error(`BaseHalf Agent operation '${operationId}' has invalid or duplicate parameter '${name}'.`);
		}
		names.add(name);
		if (!BASEHALF_AGENT_OPERATION_PARAMETER_TYPES.includes(parameter.type)) {
			throw new Error(`BaseHalf Agent operation '${operationId}' parameter '${name}' has an invalid type.`);
		}
		if (typeof parameter.required !== 'boolean') {
			throw new Error(`BaseHalf Agent operation '${operationId}' parameter '${name}' must declare whether it is required.`);
		}
		const description = boundedText(parameter.description, `${operationId}.parameters.${name}.description`, 300);
		let values: readonly string[] | undefined;
		if (parameter.type === 'enum') {
			values = Object.freeze(requiredArray(parameter.values, `${operationId}.parameters.${name}.values`, 1, MAX_ENUM_VALUES).map((entry, valueIndex) => boundedText(entry, `${operationId}.parameters.${name}.values[${valueIndex}]`, 100)));
			if (new Set(values).size !== values.length) {
				throw new Error(`BaseHalf Agent operation '${operationId}' parameter '${name}' has duplicate enum values.`);
			}
		} else if (parameter.values !== undefined) {
			throw new Error(`BaseHalf Agent operation '${operationId}' parameter '${name}' can declare values only for enum type.`);
		}
		return Object.freeze({
			name,
			type: parameter.type,
			required: parameter.required,
			description,
			...(values === undefined ? {} : { values })
		});
	}));
}

function validateReturns(operationId: string, value: IBaseHalfAgentOperationReturnContribution): IBaseHalfAgentOperationReturnContribution {
	assertRecord(value, `${operationId}.returns`);
	assertOnlyKeys(value, ['type', 'description'], `${operationId}.returns`);
	if (!BASEHALF_AGENT_OPERATION_RETURN_TYPES.includes(value.type)) {
		throw new Error(`BaseHalf Agent operation '${operationId}' has an invalid return type.`);
	}
	return Object.freeze({
		type: value.type,
		description: boundedText(value.description, `${operationId}.returns.description`, 500)
	});
}

function assertContributionSize(value: unknown): void {
	let serialized: string;
	try {
		serialized = JSON.stringify(value);
	} catch {
		throw new Error('BaseHalf Agent capability must be JSON-serializable.');
	}
	if (VSBuffer.fromString(serialized).byteLength > MAX_CAPABILITY_BYTES) {
		throw new Error(`BaseHalf Agent capability cannot exceed ${MAX_CAPABILITY_BYTES} UTF-8 bytes.`);
	}
}

function ownedId(value: unknown, owner: string, field: string): string {
	const id = boundedText(value, `${field} id`, 180);
	if (!CONTRIBUTION_ID_PATTERN.test(id) || !id.startsWith(`${owner}.`)) {
		throw new Error(`${field} '${id}' must start with '${owner}.'.`);
	}
	return id;
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${field} must be an object.`);
	}
}

function assertOnlyKeys(value: object, allowed: readonly string[], field: string): void {
	const unknown = Object.keys(value).filter(key => !allowed.includes(key));
	if (unknown.length > 0) {
		throw new Error(`${field} contains unsupported fields: ${unknown.join(', ')}.`);
	}
}

function boundedText(value: unknown, field: string, maximum: number): string {
	if (typeof value !== 'string') {
		throw new Error(`${field} must be a string.`);
	}
	const result = value.trim();
	if (!result || result.length > maximum || result.includes('\u0000')) {
		throw new Error(`${field} must contain 1-${maximum} characters.`);
	}
	return result;
}

function optionalBoundedText(value: unknown, field: string, maximum: number): string | undefined {
	return value === undefined ? undefined : boundedText(value, field, maximum);
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
	if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new Error(`${field} must be an integer from ${minimum} to ${maximum}.`);
	}
	return value as number;
}

function optionalArray<T>(value: readonly T[] | undefined, field: string, maximum: number): readonly T[] {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value) || value.length > maximum) {
		throw new Error(`${field} must be an array with at most ${maximum} items.`);
	}
	return value;
}

function requiredArray(value: unknown, field: string, minimum: number, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
		throw new Error(`${field} must be an array with ${minimum}-${maximum} items.`);
	}
	return value;
}

registerSingleton(IBaseHalfAgentCapabilityRegistryService, BaseHalfAgentCapabilityRegistryService, InstantiationType.Delayed);
