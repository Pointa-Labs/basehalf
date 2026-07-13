/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AIProject } from './model';

export interface AIProjectWebviewState {
	readonly project: AIProject;
	readonly revision: string;
	readonly providers: readonly { readonly id: string; readonly label: string }[];
}

export function aiProjectWebviewHtml(webview: vscode.Webview, state: AIProjectWebviewState): string {
	const nonce = createNonce();
	const initialState = JSON.stringify(state).replace(/</g, '\\u003c');
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; media-src ${webview.cspSource}; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<style nonce="${nonce}">
		:root { color-scheme: light dark; }
		* { box-sizing: border-box; }
		body { margin: 0; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
		.shell { width: min(1180px, 100%); margin: 0 auto; padding: 26px 30px 80px; }
		.topbar { position: sticky; top: 0; z-index: 4; display: flex; align-items: center; gap: 12px; padding: 12px 0; background: color-mix(in srgb, var(--vscode-editor-background) 94%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--vscode-editorWidget-border); }
		.title { flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; font: 600 19px/1.3 var(--vscode-font-family); outline: none; }
		.status { min-width: 80px; color: var(--vscode-descriptionForeground); font-size: 12px; text-align: right; }
		button { border: 1px solid var(--vscode-button-border, transparent); border-radius: 5px; padding: 6px 10px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; cursor: pointer; }
		button:hover { background: var(--vscode-button-hoverBackground); }
		button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
		button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
		button.ghost { color: var(--vscode-descriptionForeground); background: transparent; border-color: transparent; }
		button.danger { color: var(--vscode-errorForeground); background: transparent; border-color: transparent; }
		section { margin-top: 28px; }
		.section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
		h2 { flex: 1; margin: 0; font-size: 14px; letter-spacing: .02em; }
		.count { color: var(--vscode-descriptionForeground); font-size: 11px; }
		textarea, input, select { width: 100%; border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border)); border-radius: 5px; padding: 7px 9px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); font: inherit; outline: none; }
		textarea:focus, input:focus, select:focus { border-color: var(--vscode-focusBorder); }
		.script { min-height: 180px; resize: vertical; line-height: 1.55; }
		.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
		.card { min-width: 0; padding: 13px; border: 1px solid var(--vscode-editorWidget-border); border-radius: 7px; background: color-mix(in srgb, var(--vscode-editorWidget-background) 58%, transparent); }
		.card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
		.card-head input { font-weight: 600; }
		.card textarea { min-height: 76px; resize: vertical; }
		.shots { display: flex; flex-direction: column; gap: 12px; }
		.shot { display: grid; grid-template-columns: 150px minmax(0, 1fr) 180px; gap: 12px; padding: 15px; border: 1px solid var(--vscode-editorWidget-border); border-radius: 8px; }
		.shot-main, .shot-side { display: flex; flex-direction: column; gap: 8px; }
		.shot-main textarea { min-height: 84px; resize: vertical; }
		.label { color: var(--vscode-descriptionForeground); font-size: 11px; }
		.badge { display: inline-flex; align-self: flex-start; padding: 2px 7px; border-radius: 999px; color: var(--vscode-descriptionForeground); background: var(--vscode-badge-background); font-size: 11px; }
		.outputs { display: flex; flex-direction: column; gap: 4px; }
		.output { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
		.banner { display: none; margin-top: 12px; padding: 9px 11px; border: 1px solid var(--vscode-inputValidation-warningBorder); border-radius: 5px; color: var(--vscode-inputValidation-warningForeground); background: var(--vscode-inputValidation-warningBackground); }
		.banner.visible { display: flex; align-items: center; gap: 10px; }
		.banner span { flex: 1; }
		.empty { padding: 22px; color: var(--vscode-descriptionForeground); border: 1px dashed var(--vscode-editorWidget-border); border-radius: 7px; text-align: center; }
		@media (max-width: 780px) { .shell { padding-inline: 16px; } .shot { grid-template-columns: 1fr; } .topbar { flex-wrap: wrap; } }
	</style>
</head>
<body>
	<div class="shell">
		<div class="topbar">
			<input class="title" data-project-field="title" aria-label="Project title">
			<div class="status" id="status">Saved</div>
			<button class="danger" id="cancel" data-action="cancel" hidden>Cancel</button>
			<button class="secondary" data-action="run-pending">Run pending</button>
			<button data-action="save">Save</button>
		</div>
		<div class="banner" id="banner"><span></span><button class="secondary" data-action="reload">Reload from disk</button></div>
		<section>
			<div class="section-head"><h2>Script</h2></div>
			<textarea class="script" data-project-field="script" placeholder="Write or paste the episode script. Agents can edit this same local project file."></textarea>
		</section>
		<section><div class="section-head"><h2>Characters</h2><span class="count" id="character-count"></span><button class="secondary" data-action="add-character">Add character</button></div><div class="grid" id="characters"></div></section>
		<section><div class="section-head"><h2>Scenes</h2><span class="count" id="scene-count"></span><button class="secondary" data-action="add-scene">Add scene</button></div><div class="grid" id="scenes"></div></section>
		<section><div class="section-head"><h2>Shots & workflow</h2><span class="count" id="shot-count"></span><button class="secondary" data-action="add-shot">Add shot</button></div><div class="shots" id="shots"></div></section>
	</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		let state = ${initialState};
		let project = state.project;
		let revision = state.revision;
		let dirty = false;
		const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
		const id = prefix => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
		const setDirty = value => { dirty = value; document.getElementById('status').textContent = value ? 'Unsaved' : 'Saved'; vscode.postMessage({ type: 'dirty', dirty: value }); };
		const field = (collection, itemId, name, value) => { const item = project[collection].find(candidate => candidate.id === itemId); if (item) { item[name] = value; setDirty(true); } };
		function render() {
			document.querySelector('[data-project-field="title"]').value = project.title;
			document.querySelector('[data-project-field="script"]').value = project.script;
			document.getElementById('character-count').textContent = project.characters.length + ' total';
			document.getElementById('scene-count').textContent = project.scenes.length + ' total';
			document.getElementById('shot-count').textContent = project.shots.length + ' total';
			document.getElementById('characters').innerHTML = project.characters.length ? project.characters.map(item => card('characters', item, 'Character name')).join('') : '<div class="empty">No characters yet.</div>';
			document.getElementById('scenes').innerHTML = project.scenes.length ? project.scenes.map(item => card('scenes', item, 'Scene name')).join('') : '<div class="empty">No scenes yet.</div>';
			document.getElementById('shots').innerHTML = project.shots.length ? project.shots.map(shotCard).join('') : '<div class="empty">No shots yet. Add one to begin the workflow.</div>';
		}
		function card(collection, item, placeholder) { return '<div class="card"><div class="card-head"><input data-collection="'+collection+'" data-id="'+esc(item.id)+'" data-field="name" value="'+esc(item.name)+'" placeholder="'+placeholder+'"><button class="danger" data-action="remove" data-collection="'+collection+'" data-id="'+esc(item.id)+'">Remove</button></div><textarea data-collection="'+collection+'" data-id="'+esc(item.id)+'" data-field="description" placeholder="Description">'+esc(item.description)+'</textarea></div>'; }
		function options(items, selected, label) { return '<option value="">'+label+'</option>' + items.map(item => '<option value="'+esc(item.id)+'" '+(item.id===selected?'selected':'')+'>'+esc(item.name)+'</option>').join(''); }
		function providerOptions(selected) { return state.providers.map(item => '<option value="'+esc(item.id)+'" '+(item.id===selected?'selected':'')+'>'+esc(item.label)+'</option>').join(''); }
		function shotCard(shot) { return '<div class="shot"><div class="shot-side"><input data-collection="shots" data-id="'+esc(shot.id)+'" data-field="title" value="'+esc(shot.title)+'"><label class="label">Scene</label><select data-collection="shots" data-id="'+esc(shot.id)+'" data-field="sceneId">'+options(project.scenes, shot.sceneId, 'Unassigned')+'</select><span class="badge">'+esc(shot.status)+'</span><button class="danger" data-action="remove" data-collection="shots" data-id="'+esc(shot.id)+'">Remove shot</button></div><div class="shot-main"><label class="label">Visual prompt</label><textarea data-collection="shots" data-id="'+esc(shot.id)+'" data-field="prompt" placeholder="Camera, composition, action, lighting, continuity…">'+esc(shot.prompt)+'</textarea><label class="label">Dialogue / voice text</label><textarea data-collection="shots" data-id="'+esc(shot.id)+'" data-field="dialogue" placeholder="Dialogue or narration">'+esc(shot.dialogue)+'</textarea></div><div class="shot-side"><label class="label">Generation provider</label><select data-collection="shots" data-id="'+esc(shot.id)+'" data-field="videoProvider">'+providerOptions(shot.videoProvider)+'</select><label class="label">Voice provider</label><input data-collection="shots" data-id="'+esc(shot.id)+'" data-field="voiceProvider" value="'+esc(shot.voiceProvider)+'" placeholder="none"><button data-action="run-shot" data-id="'+esc(shot.id)+'">Run shot</button><div class="outputs">'+(shot.outputs||[]).map(output => '<button class="ghost output" title="'+esc(output)+'" data-action="open-output" data-output="'+esc(output)+'">'+esc(output)+'</button>').join('')+'</div>'+(shot.error?'<div class="label">'+esc(shot.error)+'</div>':'')+'</div></div>'; }
		document.addEventListener('input', event => { const target = event.target; if (target.dataset.projectField) { project[target.dataset.projectField] = target.value; setDirty(true); return; } if (target.dataset.collection) { field(target.dataset.collection, target.dataset.id, target.dataset.field, target.value); } });
		document.addEventListener('change', event => { const target = event.target; if (target.dataset.collection) { field(target.dataset.collection, target.dataset.id, target.dataset.field, target.value); } });
		document.addEventListener('click', event => { const button = event.target.closest('button[data-action]'); if (!button) return; const action = button.dataset.action; if (action === 'save') vscode.postMessage({ type: 'save', project, revision }); if (action === 'reload') vscode.postMessage({ type: 'reload' }); if (action === 'run-shot') vscode.postMessage({ type: 'runShot', project, revision, shotId: button.dataset.id }); if (action === 'run-pending') vscode.postMessage({ type: 'runPending', project, revision }); if (action === 'cancel') vscode.postMessage({ type: 'cancel' }); if (action === 'open-output') vscode.postMessage({ type: 'openOutput', path: button.dataset.output }); if (action === 'add-character') { project.characters.push({id:id('character'),name:'New character',description:''}); setDirty(true); render(); } if (action === 'add-scene') { project.scenes.push({id:id('scene'),name:'New scene',description:''}); setDirty(true); render(); } if (action === 'add-shot') { project.shots.push({id:id('shot'),title:'Shot '+(project.shots.length+1),sceneId:project.scenes[0]?.id||'',prompt:'',dialogue:'',videoProvider:state.providers[0]?.id||'prompt-package',voiceProvider:'none',status:'draft',outputs:[]}); setDirty(true); render(); } if (action === 'remove') { project[button.dataset.collection] = project[button.dataset.collection].filter(item => item.id !== button.dataset.id); setDirty(true); render(); } });
		window.addEventListener('message', event => { const message = event.data; const cancel=document.getElementById('cancel'); if (message.type === 'saved') { revision = message.revision; setDirty(false); cancel.hidden=true; } if (message.type === 'project') { project = message.project; revision = message.revision; state.providers = message.providers || state.providers; setDirty(false); cancel.hidden=true; document.getElementById('banner').classList.remove('visible'); render(); } if (message.type === 'providers') { state.providers=message.providers; render(); } if (message.type === 'running') { document.getElementById('status').textContent = message.label || 'Running…'; cancel.hidden=false; } if (message.type === 'cancelled') { document.getElementById('status').textContent='Cancelled'; cancel.hidden=true; } if (message.type === 'error') { document.getElementById('status').textContent = 'Error'; cancel.hidden=true; const banner=document.getElementById('banner'); banner.querySelector('span').textContent=message.message; banner.classList.add('visible'); } if (message.type === 'externalChange') { const banner=document.getElementById('banner'); banner.querySelector('span').textContent='This project changed on disk while you have unsaved edits.'; banner.classList.add('visible'); } });
		render();
	</script>
</body>
</html>`;
}

function createNonce(): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let index = 0; index < 32; index++) {
		value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
	}
	return value;
}
