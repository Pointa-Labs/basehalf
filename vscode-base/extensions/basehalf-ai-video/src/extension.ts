/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	ADD_SEQUENCE_ITEM_COMMAND_ID,
	AI_VIDEO_RECIPE_IDS,
	CREATE_WORKFLOW_COMMAND_ID,
	HOST_CREATE_FROM_TEMPLATE_COMMAND_ID,
	INSPECT_SEQUENCE_COMMAND_ID,
	MOVE_SEQUENCE_ITEM_COMMAND_ID,
	REMOVE_SEQUENCE_ITEM_COMMAND_ID,
	REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID,
	STARTER_TEMPLATE_ID,
	UPDATE_SEQUENCE_ITEM_COMMAND_ID,
	type AIVideoRecipeInput,
	isAIVideoRecipeId,
	validateRecipeInputs
} from './domain';
import { FileReadLimitError, readFileWithinLimit } from './boundedFileRead';
import { createLocalPreviewArtifact } from './localPreview';
import { addSequenceItemFromCurrentCommand, inspectSequenceCommand, moveSequenceItemCommand, removeSequenceItemCommand, repairSequenceItemPathCommand, updateSequenceItemToCurrentCommand } from './sequenceCommands';
import { resolveSequenceProjection, SEQUENCE_PROJECTION_ID } from './sequenceProjection';
import { SequenceCleanupService } from './sequenceCleanup';

const MAX_FROZEN_TEXT_INPUT_BYTES = 1024 * 1024;

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand(CREATE_WORKFLOW_COMMAND_ID, () =>
		vscode.commands.executeCommand(HOST_CREATE_FROM_TEMPLATE_COMMAND_ID, STARTER_TEMPLATE_ID)));
	context.subscriptions.push(vscode.commands.registerCommand(INSPECT_SEQUENCE_COMMAND_ID, inspectSequenceCommand));
	context.subscriptions.push(vscode.commands.registerCommand(ADD_SEQUENCE_ITEM_COMMAND_ID, addSequenceItemFromCurrentCommand));
	context.subscriptions.push(vscode.commands.registerCommand(MOVE_SEQUENCE_ITEM_COMMAND_ID, moveSequenceItemCommand));
	context.subscriptions.push(vscode.commands.registerCommand(UPDATE_SEQUENCE_ITEM_COMMAND_ID, updateSequenceItemToCurrentCommand));
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

	for (const recipeId of AI_VIDEO_RECIPE_IDS) {
		context.subscriptions.push(vscode.basehalf.registerCanvasRecipeExecutor(recipeId, {
			execute: (request, progress, token) => executeLocalPreview(request, progress, token)
		}));
	}
}

async function executeLocalPreview(
	request: vscode.basehalf.CanvasRecipeExecutionRequest,
	progress: vscode.Progress<vscode.basehalf.CanvasRecipeProgress>,
	token: vscode.CancellationToken
): Promise<vscode.basehalf.CanvasRecipeExecutionResult> {
	if (!isAIVideoRecipeId(request.recipeId)) {
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
			artifacts: [{
				id: artifact.artifactId,
				outputId: artifact.outputId,
				kind: artifact.kind,
				resource,
				label: artifact.label
			}],
			primaryArtifactId: artifact.artifactId
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

async function readFrozenTextInputs(
	inputs: readonly AIVideoRecipeInput[],
	executionInputs: readonly vscode.basehalf.CanvasRecipeInput[],
	token: vscode.CancellationToken
): Promise<readonly AIVideoRecipeInput[]> {
	const byEdge = new Map(executionInputs.map(input => [input.edgeId, input]));
	return Promise.all(inputs.map(async input => {
		const source = byEdge.get(input.edgeId)?.source;
		const resource = source?.current?.resource ?? source?.resource;
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
