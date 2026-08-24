/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	ADD_SEQUENCE_ITEM_COMMAND_ID,
	AI_VIDEO_LOCAL_RECIPE_IDS,
	CREATE_WORKFLOW_COMMAND_ID,
	GENERATE_VIDEO_RECIPE_ID,
	HOST_CREATE_FROM_TEMPLATE_COMMAND_ID,
	INSPECT_SEQUENCE_COMMAND_ID,
	MOVE_SEQUENCE_ITEM_COMMAND_ID,
	REMOVE_SEQUENCE_ITEM_COMMAND_ID,
	REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID,
	STARTER_TEMPLATE_ID,
	type AIVideoRecipeInput,
	isAIVideoLocalRecipeId,
	validateRecipeInputs
} from './domain';
import { FileReadLimitError, readFileWithinLimit } from './boundedFileRead';
import { createLocalPreviewArtifact } from './localPreview';
import { addSequenceItemFromVideoResultCommand, inspectSequenceCommand, moveSequenceItemCommand, removeSequenceItemCommand, repairSequenceItemPathCommand } from './sequenceCommands';
import { resolveSequenceProjection, SEQUENCE_PROJECTION_ID } from './sequenceProjection';
import { SequenceCleanupService } from './sequenceCleanup';
import { loadBundledVideoModelCatalog, OFFICIAL_VIDEO_MODEL_CATALOG_ID } from './videoModelCatalog';
import { serializeVideoProviderRequest } from './videoProviderAdapters';
import {
	MAX_PROVIDER_IMAGE_BYTES,
	assertVideoServiceMatchesSnapshot,
	prepareVideoProviderSubmission
} from './videoGeneration';
import {
	VideoProviderCancelledError,
	VideoProviderExecutionFailure,
	executeSerializedVideoProviderRequest
} from './videoProviderExecution';
import { videoProviderPreparationFailureForIntent } from './videoProviderExecutionContract';
import { OFFICIAL_VIDEO_PROVIDER_CONNECTION_SPEC_IDS, validateOfficialVideoProviderConnection } from './providerConnectionValidation';

const MAX_FROZEN_TEXT_INPUT_BYTES = 1024 * 1024;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const videoModelCatalog = await loadBundledVideoModelCatalog(context.extensionUri.fsPath);
	for (const specId of OFFICIAL_VIDEO_PROVIDER_CONNECTION_SPEC_IDS) {
		context.subscriptions.push(vscode.basehalf.registerModelProviderConnectionValidator(specId, {
			validate: (request, token) => validateOfficialVideoProviderConnection(request, token)
		}));
	}
	context.subscriptions.push(vscode.commands.registerCommand(CREATE_WORKFLOW_COMMAND_ID, () =>
		vscode.commands.executeCommand(HOST_CREATE_FROM_TEMPLATE_COMMAND_ID, STARTER_TEMPLATE_ID)));
	context.subscriptions.push(vscode.commands.registerCommand(INSPECT_SEQUENCE_COMMAND_ID, inspectSequenceCommand));
	context.subscriptions.push(vscode.commands.registerCommand(ADD_SEQUENCE_ITEM_COMMAND_ID, addSequenceItemFromVideoResultCommand));
	context.subscriptions.push(vscode.commands.registerCommand(MOVE_SEQUENCE_ITEM_COMMAND_ID, moveSequenceItemCommand));
	context.subscriptions.push(vscode.commands.registerCommand(REMOVE_SEQUENCE_ITEM_COMMAND_ID, removeSequenceItemCommand));
	context.subscriptions.push(vscode.commands.registerCommand(REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID, repairSequenceItemPathCommand));
	context.subscriptions.push(vscode.basehalf.registerCardProjectionProvider(SEQUENCE_PROJECTION_ID, {
		resolveCardProjection: resolveSequenceProjection
	}));
	const sequenceCleanup = new SequenceCleanupService();
	context.subscriptions.push(sequenceCleanup);
	context.subscriptions.push(vscode.basehalf.registerCanvasStructuralCleanupProvider({
		prepareDelete: sequenceCleanup.prepareDelete
	}));

	for (const recipeId of AI_VIDEO_LOCAL_RECIPE_IDS) {
		context.subscriptions.push(vscode.basehalf.registerCanvasRecipeExecutor(recipeId, {
			execute: (request, progress, token) => executeLocalPreview(request, progress, token)
		}));
	}
	context.subscriptions.push(vscode.basehalf.registerCanvasRecipeExecutor(GENERATE_VIDEO_RECIPE_ID, {
		execute: (request, progress, token) => executeVideoGeneration(videoModelCatalog, request, progress, token)
	}));
}

async function executeLocalPreview(
	request: vscode.basehalf.CanvasRecipeExecutionRequest,
	progress: vscode.Progress<vscode.basehalf.CanvasRecipeProgress>,
	token: vscode.CancellationToken
): Promise<vscode.basehalf.CanvasRecipeExecutionResult> {
	if (!isAIVideoLocalRecipeId(request.recipeId)) {
		throw new Error(`Unsupported video recipe '${request.recipeId}'.`);
	}
	if (request.modelServiceId) {
		throw new Error('This local previsualization recipe does not call a model service.');
	}
	throwIfCancelled(token);
	progress.report({ message: 'Preparing local previsualization', increment: 20 });

	const inputs = await readFrozenTextInputs(validateRecipeInputs(request.recipeId, request.inputs), request.inputs, token);
	const artifact = createLocalPreviewArtifact({
		recipeId: request.recipeId,
		nodeTitle: nodeLabel(request.node.path),
		nodePath: request.node.path,
		prompt: request.prompt,
		parameters: request.parameters,
		inputs
	});
	const resource = vscode.Uri.joinPath(request.outputDirectory, artifact.fileName);
	let wroteArtifact = false;
	try {
		await vscode.workspace.fs.createDirectory(request.outputDirectory);
		throwIfCancelled(token);
		await vscode.workspace.fs.writeFile(resource, artifact.bytes);
		wroteArtifact = true;
		throwIfCancelled(token);
		progress.report({ message: 'Saved local previsualization', increment: 80 });
		return {
			artifact: {
				id: artifact.artifactId,
				outputId: artifact.outputId,
				kind: artifact.kind,
				resource,
				label: artifact.label
			}
		};
	} catch (error) {
		if (wroteArtifact) {
			try {
				await vscode.workspace.fs.delete(resource, { recursive: false, useTrash: false });
			} catch {
				// The host treats the run directory as disposable until a result is accepted.
			}
		}
		throw error;
	}
}

async function executeVideoGeneration(
	catalog: unknown,
	request: vscode.basehalf.CanvasRecipeExecutionRequest,
	progress: vscode.Progress<vscode.basehalf.CanvasRecipeProgress>,
	token: vscode.CancellationToken
): Promise<vscode.basehalf.CanvasRecipeExecutionResult> {
	if (request.recipeId !== GENERATE_VIDEO_RECIPE_ID) {
		throw new Error(`Unsupported video generation recipe '${request.recipeId}'.`);
	}
	const legacyRecovery = request.providerTaskIntent === undefined && request.resumeProviderRequestId !== undefined;
	const providerTaskIntent = request.providerTaskIntent ?? (request.resumeProviderRequestId === undefined
		? undefined
		: { kind: 'recover' as const, providerRequestId: request.resumeProviderRequestId });
	if (!providerTaskIntent) {
		throw new Error('Video generation requires an explicit provider task intent.');
	}
	if (!legacyRecovery && (!request.providerRequestFingerprint || !request.reportProviderExecutionFailure)) {
		throw new Error('Video generation requires a host-bound request fingerprint and failure reporter.');
	}
	if ((providerTaskIntent.kind === 'new'
		|| (providerTaskIntent.kind === 'exact-retry' && providerTaskIntent.replacementAuthorized))
		&& !request.consumeProviderCreateAuthorization) {
		throw new Error('Video generation has no host create authorization.');
	}
	const prepareExecution = async () => {
		if (!request.modelService || !request.modelServiceId || request.modelService.serviceId !== request.modelServiceId
			|| request.modelService.capability !== 'video') {
			throw new Error('Video generation requires one host-frozen video model connection.');
		}
		throwIfCancelled(token);
		progress.report({ message: 'Validating reviewed model capability', increment: 5 });
		const prepared = await prepareVideoProviderSubmission({
			prompt: request.prompt,
			parameters: request.parameters,
			inputs: request.inputs
		}, async resource => {
			throwIfCancelled(token);
			const bytes = await readFileWithinLimit(resource, MAX_PROVIDER_IMAGE_BYTES, {
				stat: candidate => vscode.workspace.fs.stat(candidate),
				readFile: candidate => vscode.workspace.fs.readFile(candidate)
			}, 'Provider image input');
			throwIfCancelled(token);
			return bytes;
		}, OFFICIAL_VIDEO_MODEL_CATALOG_ID);
		if (request.modelService.modelId !== prepared.snapshot.modelId) {
			throw new Error('The frozen model connection and video model selection use different model ids.');
		}
		const access = await vscode.basehalf.getModelServiceAccess(request.modelService);
		throwIfCancelled(token);
		if (!access || access.id !== request.modelServiceId || access.connectionIdentity !== request.modelService.connectionIdentity
			|| !access.capabilities.includes('video')) {
			throw new Error('The selected video model connection is no longer available with the frozen identity.');
		}
		assertVideoServiceMatchesSnapshot(access, prepared.snapshot);
		return Object.freeze({
			access,
			serialized: serializeVideoProviderRequest(catalog, prepared.submission)
		});
	};
	let preparedExecution: Awaited<ReturnType<typeof prepareExecution>>;
	try {
		preparedExecution = await prepareExecution();
	} catch (error) {
		if (error instanceof vscode.CancellationError) {
			throw error;
		}
		if (!legacyRecovery && request.reportProviderExecutionFailure) {
			await request.reportProviderExecutionFailure(videoProviderPreparationFailureForIntent(providerTaskIntent));
		}
		throw error;
	}
	let executed: Awaited<ReturnType<typeof executeSerializedVideoProviderRequest>>;
	try {
		executed = await executeSerializedVideoProviderRequest(preparedExecution.serialized, preparedExecution.access, {
			cancellation: token,
			taskIntent: providerTaskIntent,
			...(request.consumeProviderCreateAuthorization === undefined || request.providerRequestFingerprint === undefined ? {} : {
				consumeCreateAuthorization: (kind: 'new' | 'replacement') => request.consumeProviderCreateAuthorization!(
					request.providerRequestFingerprint!,
					request.attemptId,
					kind
				)
			}),
			acknowledgeProviderRequestId: providerRequestId => request.acknowledgeProviderRequestId(providerRequestId),
			onStatus: message => progress.report({ message })
		});
	} catch (error) {
		if (error instanceof VideoProviderCancelledError) {
			throw new vscode.CancellationError();
		}
		if (error instanceof VideoProviderExecutionFailure && !legacyRecovery && request.reportProviderExecutionFailure) {
			await request.reportProviderExecutionFailure(error.evidence);
		}
		throw error;
	}

	const resource = vscode.Uri.joinPath(request.outputDirectory, 'generated-video.mp4');
	let artifactWriteStarted = false;
	try {
		throwIfCancelled(token);
		await vscode.workspace.fs.createDirectory(request.outputDirectory);
		artifactWriteStarted = true;
		await vscode.workspace.fs.writeFile(resource, executed.video);
		throwIfCancelled(token);
		progress.report({ message: 'Saved generated video locally', increment: 95 });
		return {
			artifact: {
				id: 'generated-video',
				outputId: 'video',
				kind: 'video',
				resource,
				label: 'Generated video'
			},
			providerRequestId: executed.providerRequestId,
			...(executed.usage === undefined ? {} : { usage: executed.usage })
		};
	} catch (error) {
		if (artifactWriteStarted) {
			try {
				await vscode.workspace.fs.delete(resource, { recursive: false, useTrash: false });
			} catch {
				// The host also treats the unique run directory as unaccepted until
				// this executor returns one complete artifact.
			}
		}
		if (!(error instanceof vscode.CancellationError) && !legacyRecovery && request.reportProviderExecutionFailure) {
			await request.reportProviderExecutionFailure({
				kind: 'artifact-commit',
				retry: 'resume-existing',
				providerRequestId: executed.providerRequestId
			});
		}
		throw error;
	}
}

async function readFrozenTextInputs(
	inputs: readonly AIVideoRecipeInput[],
	executionInputs: readonly vscode.basehalf.CanvasRecipeInput[],
	token: vscode.CancellationToken
): Promise<readonly AIVideoRecipeInput[]> {
	const byEdge = new Map(executionInputs.map(input => [input.edgeId, input]));
	return Promise.all(inputs.map(async input => {
		const source = byEdge.get(input.edgeId)?.source;
		const resource = source?.result?.resource ?? source?.resource;
		if (!resource || !['text', 'code', 'file'].includes(input.source.kind)) {
			return input;
		}
		throwIfCancelled(token);
		let bytes: Uint8Array;
		try {
			bytes = await readFileWithinLimit(resource, MAX_FROZEN_TEXT_INPUT_BYTES, {
				stat: candidate => vscode.workspace.fs.stat(candidate),
				readFile: candidate => vscode.workspace.fs.readFile(candidate)
			}, 'Recipe text input');
		} catch (error) {
			if (error instanceof FileReadLimitError) {
				return input;
			}
			throw error;
		}
		if (bytes.includes(0)) {
			return input;
		}
		let text: string;
		try {
			text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
		} catch {
			return input;
		}
		return {
			...input,
			source: { ...input.source, text }
		};
	}));
}

function nodeLabel(nodePath: string): string {
	const fileName = nodePath.split('/').at(-1) ?? nodePath;
	return fileName.toLowerCase().endsWith('.bhnode') ? fileName.slice(0, -'.bhnode'.length) : fileName;
}

function throwIfCancelled(token: vscode.CancellationToken): void {
	if (token.isCancellationRequested) {
		throw new vscode.CancellationError();
	}
}
