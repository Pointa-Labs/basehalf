/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import assert from 'assert';
import { workspace, commands, window, Uri, WorkspaceEdit, Range, TextDocument, extensions, TabInputTextDiff } from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GitExtension, API, Repository } from '../api/git';
import { Status } from '../api/git.constants';
import { eventToPromise } from '../util';

suite('git smoke test', function () {
	const cwd = workspace.workspaceFolders![0].uri.fsPath;

	function file(relativePath: string) {
		return path.join(cwd, relativePath);
	}

	function uri(relativePath: string) {
		return Uri.file(file(relativePath));
	}

	async function open(relativePath: string) {
		const doc = await workspace.openTextDocument(uri(relativePath));
		await window.showTextDocument(doc);
		return doc;
	}

	async function type(doc: TextDocument, text: string) {
		const edit = new WorkspaceEdit();
		const end = doc.lineAt(doc.lineCount - 1).range.end;
		edit.replace(doc.uri, new Range(end, end), text);
		await workspace.applyEdit(edit);
	}

	let git: API;
	let repository: Repository;
	const tempDirs: string[] = [];

	suiteSetup(async function () {
		fs.writeFileSync(file('app.js'), 'hello', 'utf8');
		fs.writeFileSync(file('index.pug'), 'hello', 'utf8');
		cp.execSync('git init -b main', { cwd });
		cp.execSync('git config user.name testuser', { cwd });
		cp.execSync('git config user.email monacotools@example.com', { cwd });
		cp.execSync('git config commit.gpgsign false', { cwd });
		cp.execSync('git add .', { cwd });
		cp.execSync('git commit -m "initial commit"', { cwd });

		// make sure git is activated
		const ext = extensions.getExtension<GitExtension>('vscode.git');
		await ext?.activate();
		git = ext!.exports.getAPI(1);

		if (git.repositories.length === 0) {
			const onDidOpenRepository = eventToPromise(git.onDidOpenRepository);
			await commands.executeCommand('git.openRepository', cwd);
			await onDidOpenRepository;
		}

		assert.strictEqual(git.repositories.length, 1);
		assert.strictEqual(git.repositories[0].rootUri.fsPath, cwd);

		repository = git.repositories[0];
	});

	suiteTeardown(function () {
		for (const tempDir of tempDirs) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('reflects working tree changes', async function () {
		await commands.executeCommand('workbench.view.scm');

		const appjs = await open('app.js');
		await type(appjs, ' world');
		await appjs.save();
		await repository.status();

		assert.strictEqual(repository.state.workingTreeChanges.length, 1);
		assert.strictEqual(repository.state.workingTreeChanges[0].uri.path, appjs.uri.path);
		assert.strictEqual(repository.state.workingTreeChanges[0].status, Status.MODIFIED);

		fs.writeFileSync(file('newfile.txt'), '');
		const newfile = await open('newfile.txt');
		await type(newfile, 'hey there');
		await newfile.save();
		await repository.status();

		assert.strictEqual(repository.state.workingTreeChanges.length, 2);
		assert.strictEqual(repository.state.workingTreeChanges[0].uri.path, appjs.uri.path);
		assert.strictEqual(repository.state.workingTreeChanges[0].status, Status.MODIFIED);
		assert.strictEqual(repository.state.workingTreeChanges[1].uri.path, newfile.uri.path);
		assert.strictEqual(repository.state.workingTreeChanges[1].status, Status.UNTRACKED);
	});

	test('opens diff editor', async function () {
		const appjs = uri('app.js');
		await commands.executeCommand('git.openChange', appjs);

		assert(window.activeTextEditor);
		assert.strictEqual(window.activeTextEditor!.document.uri.path, appjs.path);

		assert(window.tabGroups.activeTabGroup.activeTab);
		assert(window.tabGroups.activeTabGroup.activeTab!.input instanceof TabInputTextDiff);
	});

	test('stages correctly', async function () {
		const appjs = uri('app.js');
		const newfile = uri('newfile.txt');

		await repository.add([appjs.fsPath]);

		assert.strictEqual(repository.state.indexChanges.length, 1);
		assert.strictEqual(repository.state.indexChanges[0].uri.path, appjs.path);
		assert.strictEqual(repository.state.indexChanges[0].status, Status.INDEX_MODIFIED);

		assert.strictEqual(repository.state.workingTreeChanges.length, 1);
		assert.strictEqual(repository.state.workingTreeChanges[0].uri.path, newfile.path);
		assert.strictEqual(repository.state.workingTreeChanges[0].status, Status.UNTRACKED);

		await repository.revert([appjs.fsPath]);

		assert.strictEqual(repository.state.indexChanges.length, 0);

		assert.strictEqual(repository.state.workingTreeChanges.length, 2);
		assert.strictEqual(repository.state.workingTreeChanges[0].uri.path, appjs.path);
		assert.strictEqual(repository.state.workingTreeChanges[0].status, Status.MODIFIED);
		assert.strictEqual(repository.state.workingTreeChanges[1].uri.path, newfile.path);
		assert.strictEqual(repository.state.workingTreeChanges[1].status, Status.UNTRACKED);
	});

	test('stages, commits changes and verifies outgoing change', async function () {
		const appjs = uri('app.js');
		const newfile = uri('newfile.txt');

		await repository.add([appjs.fsPath]);
		await repository.commit('second commit');

		assert.strictEqual(repository.state.workingTreeChanges.length, 1);
		assert.strictEqual(repository.state.workingTreeChanges[0].uri.path, newfile.path);
		assert.strictEqual(repository.state.workingTreeChanges[0].status, Status.UNTRACKED);

		assert.strictEqual(repository.state.indexChanges.length, 0);

		await repository.commit('third commit', { all: true });

		assert.strictEqual(repository.state.workingTreeChanges.length, 0);
		assert.strictEqual(repository.state.indexChanges.length, 0);
	});

	test('publishes a no-remote branch through a registered remote source publisher', async function () {
		let publishedRoot: string | undefined;
		const disposable = git.registerRemoteSourcePublisher({
			name: 'BaseHalf Test',
			icon: 'github',
			publishRepository: async publishedRepository => {
				publishedRoot = publishedRepository.rootUri.fsPath;
				assert.strictEqual(publishedRepository.state.remotes.length, 0);
				assert.strictEqual(publishedRepository.state.HEAD?.upstream, undefined);
			}
		});

		try {
			const onDidPublish = eventToPromise(git.onDidPublish);
			await commands.executeCommand('git.publish', repository.rootUri);
			const event = await onDidPublish;

			assert.strictEqual(publishedRoot, cwd);
			assert.strictEqual(event.repository.rootUri.fsPath, cwd);
			assert.strictEqual(event.branch, 'main');
		} finally {
			disposable.dispose();
		}
	});

	test('exposes branch refs for the VS Code branch picker path', async function () {
		await repository.createBranch('feature/local-picker', false);

		const branches = await repository.getBranches({ remote: false });

		assert.ok(branches.some(branch => branch.name === 'main'));
		assert.ok(branches.some(branch => branch.name === 'feature/local-picker'));
		assert.strictEqual(repository.state.HEAD?.name, 'main');
	});

	test('pushes, fetches and pulls through command routes against a local upstream remote', async function () {
		const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-git-remote-'));
		const peerParent = fs.mkdtempSync(path.join(os.tmpdir(), 'basehalf-git-peer-'));
		const peerRoot = path.join(peerParent, 'peer');
		tempDirs.push(remoteRoot, peerParent);

		cp.execFileSync('git', ['init', '--bare'], { cwd: remoteRoot, stdio: 'ignore' });

		await repository.addRemote('origin', remoteRoot);
		await repository.push('origin', 'main', true);
		await repository.status();

		assert.strictEqual(repository.state.HEAD?.upstream?.remote, 'origin');
		assert.strictEqual(repository.state.HEAD?.upstream?.name, 'main');

		fs.appendFileSync(file('app.js'), '\nlocal upstream smoke\n', 'utf8');
		await repository.commit('local upstream smoke', { all: true });
		await repository.status();

		assert.strictEqual(repository.state.HEAD?.ahead, 1);

		await commands.executeCommand('git.push', repository.rootUri);
		await repository.status();

		assert.strictEqual(repository.state.HEAD?.ahead ?? 0, 0);

		cp.execFileSync('git', ['clone', remoteRoot, peerRoot], { stdio: 'ignore' });
		cp.execFileSync('git', ['config', 'user.name', 'testuser'], { cwd: peerRoot });
		cp.execFileSync('git', ['config', 'user.email', 'monacotools@example.com'], { cwd: peerRoot });
		cp.execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: peerRoot });
		fs.writeFileSync(path.join(peerRoot, 'remote-only.txt'), 'remote smoke\n', 'utf8');
		cp.execFileSync('git', ['add', 'remote-only.txt'], { cwd: peerRoot });
		cp.execFileSync('git', ['commit', '-m', 'remote upstream smoke'], { cwd: peerRoot, stdio: 'ignore' });
		cp.execFileSync('git', ['push'], { cwd: peerRoot, stdio: 'ignore' });

		await commands.executeCommand('git.fetch', repository.rootUri);
		await repository.status();

		assert.strictEqual(repository.state.HEAD?.behind, 1);

		await commands.executeCommand('git.pull', repository.rootUri);
		await repository.status();

		assert.strictEqual(repository.state.HEAD?.behind ?? 0, 0);
		assert.strictEqual(fs.existsSync(file('remote-only.txt')), true);
	});

	test('provides commit log data used by the VS Code Source Control Graph path', async function () {
		const commits = await repository.log({ maxEntries: 5 });

		assert.ok(commits.length >= 2);
		assert.strictEqual(typeof commits[0].hash, 'string');
		assert.ok(commits[0].hash.length >= 7);
		assert.ok(Array.isArray(commits[0].parents));
		assert.ok(commits.some(commit => commit.message === 'remote upstream smoke'));
	});

	test('rename/delete conflict', async function () {
		await commands.executeCommand('workbench.view.scm');

		const appjs = file('app.js');
		const renamejs = file('rename.js');

		await repository.createBranch('test', true);

		// Delete file (test branch)
		fs.unlinkSync(appjs);
		await repository.commit('commit on test', { all: true });

		await repository.checkout('main');

		// Rename file (main branch)
		fs.renameSync(appjs, renamejs);
		await repository.commit('commit on main', { all: true });

		try {
			await repository.merge('test');
		} catch (e) { }

		assert.strictEqual(repository.state.mergeChanges.length, 1);
		assert.strictEqual(repository.state.mergeChanges[0].status, Status.DELETED_BY_THEM);

		assert.strictEqual(repository.state.workingTreeChanges.length, 0);
		assert.strictEqual(repository.state.indexChanges.length, 0);
	});
});
