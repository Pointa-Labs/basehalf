/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-no-unexternalized-strings -- HTML entity escaping is protocol data, not UI copy. */

import * as vscode from 'vscode';
import { AIProject } from './model';

export interface AIProjectWebviewState {
	readonly project: AIProject;
	readonly revision: string;
	readonly videoProviders: readonly { readonly id: string; readonly label: string }[];
	readonly voiceProviders: readonly { readonly id: string; readonly label: string }[];
}

export function aiProjectWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, state: AIProjectWebviewState): string {
	const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'main.js'));
	const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'main.css'));
	const initialState = escapeAttribute(JSON.stringify(state));
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${styleUri}">
	<title>AI Video workflow</title>
</head>
<body>
	<div id="root" data-initial-state="${initialState}"></div>
	<script type="module" src="${scriptUri}"></script>
</body>
</html>`;
}

function escapeAttribute(value: string): string {
	return value.replace(/[&<>"']/g, character => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	}[character]!));
}
