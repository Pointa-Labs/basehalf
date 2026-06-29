import * as vscode from 'vscode';

type FocusKind = 'file' | 'folder';

interface FocusNode {
	readonly path: string;
	readonly kind: FocusKind;
	readonly visibleLine?: number;
	readonly visibleBlock?: number;
	readonly cursorLine?: number;
	readonly cursorColumn?: number;
	readonly cursorBlock?: number;
	readonly linePrecision?: string;
	readonly viewportX?: number;
	readonly viewportY?: number;
	readonly zoom?: number;
}

type FocusTreeElement =
	| { readonly kind: 'message'; readonly label: string; readonly description?: string }
	| { readonly kind: 'focus'; readonly focus: FocusNode }
	| { readonly kind: 'field'; readonly label: string; readonly value: string };

export function activate(context: vscode.ExtensionContext): void {
	const provider = new BaseHalfFocusProvider();
	const tree = vscode.window.createTreeView('basehalf.focus', {
		treeDataProvider: provider,
		showCollapseAll: true
	});

	context.subscriptions.push(
		tree,
		provider,
		vscode.commands.registerCommand('basehalf.refreshFocus', () => provider.refresh()),
		vscode.commands.registerCommand('basehalf.openCurrentFocus', () => provider.openCurrentFocus())
	);

	void provider.refresh();
}

class BaseHalfFocusProvider implements vscode.TreeDataProvider<FocusTreeElement>, vscode.Disposable {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<FocusTreeElement | undefined>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	private focus: FocusNode | null = null;
	private message: string | null = null;

	dispose(): void {
		this.onDidChangeTreeDataEmitter.dispose();
	}

	async refresh(): Promise<void> {
		const folder = firstWorkspaceFolder();
		if (!folder) {
			this.focus = null;
			this.message = 'Open a folder to use BaseHalf.';
			this.onDidChangeTreeDataEmitter.fire(undefined);
			return;
		}

		const text = await readWorkspaceFile(folder, '.bh/current_focus.yaml');
		if (text === null) {
			this.focus = null;
			this.message = 'No .bh/current_focus.yaml found in this workspace.';
			this.onDidChangeTreeDataEmitter.fire(undefined);
			return;
		}

		const focus = parseFocusYaml(text);
		if (!focus) {
			this.focus = null;
			this.message = 'current_focus.yaml is present but could not be parsed.';
			this.onDidChangeTreeDataEmitter.fire(undefined);
			return;
		}

		this.focus = focus;
		this.message = null;
		this.onDidChangeTreeDataEmitter.fire(undefined);
	}

	async openCurrentFocus(): Promise<void> {
		await this.refresh();

		const folder = firstWorkspaceFolder();
		if (!folder || !this.focus) {
			await vscode.window.showInformationMessage(this.message ?? 'No BaseHalf focus is active.');
			return;
		}

		const uri = workspaceRelativeUri(folder, this.focus.path);
		if (!uri) {
			await vscode.window.showWarningMessage(`BaseHalf focus path is not workspace-relative: ${this.focus.path}`);
			return;
		}

		if (this.focus.kind === 'folder') {
			await vscode.commands.executeCommand('revealInExplorer', uri);
			return;
		}

		const document = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(document, { preview: true });
	}

	getTreeItem(element: FocusTreeElement): vscode.TreeItem {
		switch (element.kind) {
			case 'message': {
				const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
				item.description = element.description;
				item.iconPath = new vscode.ThemeIcon('info');
				return item;
			}
			case 'focus': {
				const path = element.focus.path === '' ? '<workspace root>' : element.focus.path;
				const item = new vscode.TreeItem(path, vscode.TreeItemCollapsibleState.Expanded);
				item.description = element.focus.kind;
				item.iconPath = new vscode.ThemeIcon(element.focus.kind === 'folder' ? 'folder' : 'file');
				item.command = {
					command: 'basehalf.openCurrentFocus',
					title: 'Open Current Focus'
				};
				return item;
			}
			case 'field': {
				const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
				item.description = element.value;
				item.iconPath = new vscode.ThemeIcon('symbol-property');
				return item;
			}
		}
	}

	getChildren(element?: FocusTreeElement): FocusTreeElement[] {
		if (element?.kind === 'focus') {
			return focusFields(element.focus);
		}

		if (element !== undefined) {
			return [];
		}

		if (this.focus) {
			return [{ kind: 'focus', focus: this.focus }];
		}

		return [{ kind: 'message', label: this.message ?? 'No BaseHalf focus is active.' }];
	}
}

function firstWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	return vscode.workspace.workspaceFolders?.[0];
}

async function readWorkspaceFile(folder: vscode.WorkspaceFolder, relPath: string): Promise<string | null> {
	try {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, ...relPath.split('/')));
		return new TextDecoder('utf-8').decode(bytes);
	} catch {
		return null;
	}
}

function parseFocusYaml(text: string): FocusNode | null {
	const kind = readScalar(text, 'kind');
	const path = readScalar(text, 'path');
	if ((kind !== 'file' && kind !== 'folder') || path === undefined) {
		return null;
	}

	return {
		path,
		kind,
		visibleLine: readNestedNumber(text, 'visible_lines', 'start'),
		visibleBlock: readNestedNumber(text, 'visible_blocks', 'start'),
		cursorLine: readNestedNumber(text, 'cursor', 'line'),
		cursorColumn: readNestedNumber(text, 'cursor', 'column'),
		cursorBlock: readNestedNumber(text, 'cursor', 'block'),
		linePrecision: readNestedScalar(text, 'cursor', 'line_precision'),
		viewportX: readNestedNumber(text, 'viewport_center', 'x'),
		viewportY: readNestedNumber(text, 'viewport_center', 'y'),
		zoom: readScalarNumber(text, 'zoom')
	};
}

function readScalar(text: string, key: string): string | undefined {
	const match = new RegExp(`^${escapeRegExp(key)}:\\s*(.*)$`, 'm').exec(text);
	if (!match) {
		return undefined;
	}

	return cleanYamlScalar(match[1] ?? '');
}

function readNestedScalar(text: string, parent: string, key: string): string | undefined {
	const block = readNestedBlock(text, parent);
	if (!block) {
		return undefined;
	}

	return readScalar(block, key);
}

function readScalarNumber(text: string, key: string): number | undefined {
	const value = readScalar(text, key);
	if (value === undefined || value === '') {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function readNestedNumber(text: string, parent: string, key: string): number | undefined {
	const value = readNestedScalar(text, parent, key);
	if (value === undefined || value === '') {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function readNestedBlock(text: string, parent: string): string | undefined {
	const parentMatch = new RegExp(`^${escapeRegExp(parent)}:\\s*$`, 'm').exec(text);
	if (!parentMatch) {
		const inline = new RegExp(`^${escapeRegExp(parent)}:\\s*\\{([^}]*)\\}\\s*$`, 'm').exec(text);
		if (!inline) {
			return undefined;
		}

		return inline[1].split(',').map(part => part.trim().replace(/:/, ': ')).join('\n');
	}

	const start = parentMatch.index + parentMatch[0].length;
	const lines = text.slice(start).split(/\r?\n/);
	const nested: string[] = [];
	for (const line of lines) {
		if (line.trim() === '') {
			continue;
		}
		if (!/^\s+/.test(line)) {
			break;
		}
		nested.push(line.replace(/^\s+/, ''));
	}

	return nested.join('\n');
}

function cleanYamlScalar(raw: string): string {
	const value = raw.trim();
	if (value === '""' || value === "''") {
		return '';
	}
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function focusFields(focus: FocusNode): FocusTreeElement[] {
	const fields: FocusTreeElement[] = [];
	fields.push({ kind: 'field', label: 'kind', value: focus.kind });

	if (focus.visibleLine !== undefined) {
		fields.push({ kind: 'field', label: 'visible line', value: String(focus.visibleLine) });
	}
	if (focus.visibleBlock !== undefined) {
		fields.push({ kind: 'field', label: 'visible block', value: String(focus.visibleBlock) });
	}
	if (focus.cursorLine !== undefined && focus.cursorColumn !== undefined) {
		const precision = focus.linePrecision ? ` (${focus.linePrecision})` : '';
		fields.push({
			kind: 'field',
			label: 'cursor',
			value: `${focus.cursorLine}:${focus.cursorColumn}${precision}`
		});
	}
	if (focus.cursorBlock !== undefined) {
		fields.push({ kind: 'field', label: 'cursor block', value: String(focus.cursorBlock) });
	}
	if (focus.viewportX !== undefined && focus.viewportY !== undefined) {
		fields.push({ kind: 'field', label: 'viewport center', value: `${focus.viewportX}, ${focus.viewportY}` });
	}
	if (focus.zoom !== undefined) {
		fields.push({ kind: 'field', label: 'zoom', value: String(focus.zoom) });
	}

	return fields;
}

function workspaceRelativeUri(folder: vscode.WorkspaceFolder, relPath: string): vscode.Uri | null {
	if (relPath === '') {
		return folder.uri;
	}

	if (relPath.startsWith('/') || relPath.includes('\0')) {
		return null;
	}

	const segments = relPath.split('/');
	if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
		return null;
	}

	return vscode.Uri.joinPath(folder.uri, ...segments);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
