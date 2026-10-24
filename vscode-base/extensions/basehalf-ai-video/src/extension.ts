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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	context.subscriptions.push(vscode.commands.registerCommand(CREATE_WORKFLOW_COMMAND_ID, () =>
		vscode.commands.executeCommand(HOST_CREATE_FROM_TEMPLATE_COMMAND_ID, STARTER_TEMPLATE_ID)));
	context.subscriptions.push(vscode.commands.registerCommand(INSPECT_SEQUENCE_COMMAND_ID, inspectSequenceCommand));
	context.subscriptions.push(vscode.commands.registerCommand(ADD_SEQUENCE_ITEM_COMMAND_ID, addSequenceItemFromVideoResultCommand));
	context.subscriptions.push(vscode.commands.registerCommand(MOVE_SEQUENCE_ITEM_COMMAND_ID, moveSequenceItemCommand));
	context.subscriptions.push(vscode.commands.registerCommand(REMOVE_SEQUENCE_ITEM_COMMAND_ID, removeSequenceItemCommand));
	context.subscriptions.push(vscode.commands.registerCommand(REPAIR_SEQUENCE_ITEM_PATH_COMMAND_ID, repairSequenceItemPathCommand));
	// Deleting a video changes no Sequence: its clip shows as missing (D63).
	context.subscriptions.push(vscode.basehalf.registerCardProjectionProvider(SEQUENCE_PROJECTION_ID, {
		resolveCardProjection: resolveSequenceProjection
	}));
	// The provider service runs in the shared process (D75).
}
