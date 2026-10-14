/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import {
	ADD_SEQUENCE_ITEM_COMMAND_ID,
	CREATE_WORKFLOW_COMMAND_ID,
	HOST_CREATE_FROM_TEMPLATE_COMMAND_ID,
	INSPECT_SEQUENCE_COMMAND_ID,
	MOVE_SEQUENCE_ITEM_COMMAND_ID,
	REMOVE_SEQUENCE_ITEM_COMMAND_ID,
	REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID,
	STARTER_TEMPLATE_ID
} from './domain';
import { addSequenceItemFromVideoResultCommand, inspectSequenceCommand, moveSequenceItemCommand, removeSequenceItemCommand, repairSequenceItemPathCommand } from './sequenceCommands';
import { resolveSequenceProjection, SEQUENCE_PROJECTION_ID } from './sequenceProjection';
import { SequenceCleanupService } from './sequenceCleanup';
import { cancelVideoTask, downloadVideo, pollVideoTask, submitVideoTask, VIDEO_PROVIDER_COMMANDS } from './videoProviders';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
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

	// The provider requests of a Video node generation (D58). The workbench
	// passes the key with every call; nothing is kept here between calls.
	context.subscriptions.push(vscode.commands.registerCommand(VIDEO_PROVIDER_COMMANDS.submit, (request: unknown) => submitVideoTask(request)));
	context.subscriptions.push(vscode.commands.registerCommand(VIDEO_PROVIDER_COMMANDS.poll, (task: unknown) => pollVideoTask(task)));
	context.subscriptions.push(vscode.commands.registerCommand(VIDEO_PROVIDER_COMMANDS.download, (request: unknown) => downloadVideo(request)));
	context.subscriptions.push(vscode.commands.registerCommand(VIDEO_PROVIDER_COMMANDS.cancel, (task: unknown) => cancelVideoTask(task)));
}
