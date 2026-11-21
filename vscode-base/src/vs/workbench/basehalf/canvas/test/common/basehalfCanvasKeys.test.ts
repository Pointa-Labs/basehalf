/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { decodeKeybinding, KeyCodeChord } from '../../../../../base/common/keybindings.js';
import { OperatingSystem } from '../../../../../base/common/platform.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { USLayoutResolvedKeybinding } from '../../../../../platform/keybinding/common/usLayoutResolvedKeybinding.js';
import {
	BASEHALF_CANVAS_KEY_COMMANDS,
	BaseHalfCanvasCommandId,
	baseHalfCanvasKeyContext,
	baseHalfCanvasKeyContextValues,
	baseHalfCanvasStopsArrowKey,
	getBaseHalfCanvasKeyCommand,
	IBaseHalfCanvasKeyCommand,
	IBaseHalfCanvasKeyFacts
} from '../../common/basehalfCanvasKeys.js';

/** The keyboard on something among the cards, with nothing selected, unless the place says more. */
function facts(place: Partial<IBaseHalfCanvasKeyFacts>): IBaseHalfCanvasKeyFacts {
	return {
		inCanvas: true,
		cardDetailOpen: false,
		cardDetailDrawn: false,
		inScene: true,
		isScene: false,
		inToolbar: false,
		onSelectedConnection: false,
		inControl: false,
		isCard: false,
		cardPath: undefined,
		inText: false,
		inNameEditor: false,
		inCardWithToolbar: false,
		selectedCards: [],
		selectedConnections: 0,
		selectedCardEditsOnCard: false,
		picking: false,
		...place
	};
}

/** The places of the canvas where a key can be pressed (the keys of the canvas, criterion 5). */
const PLACES: Readonly<Record<string, IBaseHalfCanvasKeyFacts>> = {
	'the blank canvas, nothing selected': facts({ isScene: true }),
	'the blank canvas, one card selected': facts({ isScene: true, selectedCards: ['a.md'] }),
	'the blank canvas, a code card selected': facts({ isScene: true, selectedCards: ['a.ts'], selectedCardEditsOnCard: true }),
	'the blank canvas, two cards selected': facts({ isScene: true, selectedCards: ['a.md', 'b.md'] }),
	'the blank canvas, a connection selected': facts({ isScene: true, selectedConnections: 1 }),
	'the blank canvas, one card selected, while a generation card waits for a pick': facts({ isScene: true, selectedCards: ['a.md'], picking: true }),
	'the selected card': facts({ isCard: true, cardPath: 'a.md', selectedCards: ['a.md'] }),
	'the selected code card': facts({ isCard: true, cardPath: 'a.ts', selectedCards: ['a.ts'], selectedCardEditsOnCard: true }),
	'something of the selected code card that is no control': facts({ cardPath: 'a.ts', selectedCards: ['a.ts'], selectedCardEditsOnCard: true }),
	'the selected video card': facts({ isCard: true, cardPath: 'a.mp4', selectedCards: ['a.mp4'], inCardWithToolbar: true }),
	'a control of the selected video card': facts({ inControl: true, cardPath: 'a.mp4', selectedCards: ['a.mp4'], inCardWithToolbar: true }),
	'a card that is not selected': facts({ isCard: true, cardPath: 'b.md' }),
	'a card, while another is selected': facts({ isCard: true, cardPath: 'b.md', selectedCards: ['a.md'] }),
	'a card of two selected ones': facts({ isCard: true, cardPath: 'a.md', selectedCards: ['a.md', 'b.md'] }),
	'a selected connection': facts({ onSelectedConnection: true, inControl: true, selectedConnections: 1 }),
	'the frame the canvas library draws around the selected card': facts({ selectedCards: ['a.md'] }),
	'the toolbar of the selected card': facts({ inToolbar: true, inControl: true, selectedCards: ['a.md'] }),
	'the toolbar of two selected cards': facts({ inToolbar: true, inControl: true, selectedCards: ['a.md', 'b.md'] }),
	'a button of the selected card': facts({ inControl: true, cardPath: 'a.md', selectedCards: ['a.md'] }),
	'the name of a card being edited': facts({ inControl: true, inText: true, inNameEditor: true, cardPath: 'a.md' }),
	'a note edited on its card': facts({ inControl: true, inText: true, cardPath: 'a.md', selectedCards: ['a.md'] }),
	'a code card edited on its card': facts({ inControl: true, inText: true, cardPath: 'a.ts', selectedCards: ['a.ts'], selectedCardEditsOnCard: true }),
	'the prompt under the selected draft': facts({ inControl: true, inText: true, selectedCards: ['a.png'] }),
	'the Tidy Canvas button, one card selected': facts({ inScene: false, inControl: true, selectedCards: ['a.md'] }),
	'the canvas area outside the cards, a code card selected': facts({ inScene: false, selectedCards: ['a.ts'], selectedCardEditsOnCard: true }),
	'the selected card under Card Detail': facts({ cardDetailOpen: true, cardDetailDrawn: true, isCard: true, cardPath: 'a.md', selectedCards: ['a.md'] }),
	'the selected card while Card Detail fades out': facts({ cardDetailDrawn: true, isCard: true, cardPath: 'a.md', selectedCards: ['a.md'] }),
	'outside the canvas, one card selected': facts({ inCanvas: false, inScene: false, selectedCards: ['a.md'] })
};

const MOVE_CARD: readonly string[] = BASEHALF_CANVAS_KEY_COMMANDS.filter(command => command.move).map(command => command.id);

function holds(command: IBaseHalfCanvasKeyCommand, place: IBaseHalfCanvasKeyFacts): boolean {
	const values = baseHalfCanvasKeyContextValues(baseHalfCanvasKeyContext(place));
	return command.when.evaluate({ getValue: <T>(key: string) => values.get(key) as T | undefined });
}

/** The commands whose key acts in a place, with the eight of Move Card as one. */
function commandsAt(place: IBaseHalfCanvasKeyFacts): string[] {
	const acting = BASEHALF_CANVAS_KEY_COMMANDS.filter(command => command.keys && holds(command, place)).map(command => command.id as string);
	const moves = acting.filter(id => MOVE_CARD.includes(id));
	assert.ok(moves.length === 0 || moves.length === MOVE_CARD.length, 'the eight commands of Move Card act in the same places');
	const short = (id: string) => id.replace('basehalf.canvas.', '');
	return [...acting.filter(id => !MOVE_CARD.includes(id)).map(short), ...(moves.length ? ['moveCard'] : [])];
}

function keysOf(command: IBaseHalfCanvasKeyCommand, os: OperatingSystem): string[] {
	const keys = os === OperatingSystem.Macintosh && command.keys?.mac ? command.keys.mac : command.keys;
	return keys ? [keys.primary, ...(keys.secondary ?? [])].map(key => new USLayoutResolvedKeybinding(decodeKeybinding(key, os)!.chords.filter((chord): chord is KeyCodeChord => chord instanceof KeyCodeChord), os).getUserSettingsLabel()!) : [];
}

suite('BaseHalfCanvasKeys', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('where the key of each command acts', () => {
		const zoom = ['zoomIn', 'zoomOut', 'zoomTo100'];
		assert.deepStrictEqual(Object.fromEntries(Object.entries(PLACES).map(([name, place]) => [name, commandsAt(place)])), {
			'the blank canvas, nothing selected': [...zoom, 'tidy'],
			'the blank canvas, one card selected': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection', 'moveCard'],
			'the blank canvas, a code card selected': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection', 'openCard', 'moveCard'],
			'the blank canvas, two cards selected': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection'],
			'the blank canvas, a connection selected': [...zoom, 'tidy', 'deleteSelection'],
			'the blank canvas, one card selected, while a generation card waits for a pick': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection'],
			'the selected card': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection', 'renameCard', 'openCard', 'selectCard', 'moveCard'],
			'the selected code card': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection', 'renameCard', 'openCard', 'selectCard', 'moveCard'],
			'something of the selected code card that is no control': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection', 'openCard', 'moveCard'],
			'the selected video card': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection', 'renameCard', 'openCard', 'selectCard', 'focusCardToolbar', 'moveCard'],
			'a control of the selected video card': [...zoom, 'tidy', 'focusCardToolbar'],
			'a card that is not selected': [...zoom, 'tidy', 'renameCard', 'openCard', 'selectCard'],
			'a card, while another is selected': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection', 'renameCard', 'openCard', 'selectCard'],
			'a card of two selected ones': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection', 'renameCard', 'openCard', 'selectCard'],
			'a selected connection': [...zoom, 'tidy', 'deleteSelection'],
			'the frame the canvas library draws around the selected card': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection'],
			'the toolbar of the selected card': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection'],
			'the toolbar of two selected cards': [...zoom, 'tidy', 'duplicateSelection', 'deleteSelection'],
			'a button of the selected card': [...zoom, 'tidy'],
			'the name of a card being edited': [],
			'a note edited on its card': zoom,
			'a code card edited on its card': zoom,
			'the prompt under the selected draft': zoom,
			'the Tidy Canvas button, one card selected': [...zoom, 'tidy'],
			'the canvas area outside the cards, a code card selected': [...zoom, 'tidy', 'openCard'],
			'the selected card under Card Detail': [],
			'the selected card while Card Detail fades out': [...zoom, 'tidy'],
			'outside the canvas, one card selected': []
		});
	});

	test('no key has two commands in one place', () => {
		for (const os of [OperatingSystem.Macintosh, OperatingSystem.Windows]) {
			for (const [name, place] of Object.entries(PLACES)) {
				const taken = new Map<string, string>();
				for (const command of BASEHALF_CANVAS_KEY_COMMANDS.filter(candidate => candidate.keys && holds(candidate, place))) {
					for (const key of keysOf(command, os)) {
						assert.strictEqual(taken.get(key), undefined, `${key} on ${name}: ${taken.get(key)} and ${command.id}`);
						taken.set(key, command.id);
					}
				}
			}
		}
	});

	test('the commands and their default keys', () => {
		assert.deepStrictEqual(BASEHALF_CANVAS_KEY_COMMANDS.map(command => `${command.title.value}: ${keysOf(command, OperatingSystem.Macintosh).join(', ') || 'no key'}${command.palette ? '; in the palette' : ''}`), [
			'Zoom Canvas In: cmd+=, shift+cmd+=, cmd+numpad_add; in the palette',
			'Zoom Canvas Out: cmd+-, shift+cmd+-, cmd+numpad_subtract; in the palette',
			'Zoom Canvas to 100%: cmd+0, cmd+numpad0; in the palette',
			'Fit Canvas to Screen: no key; in the palette',
			'Tidy Canvas: shift+alt+f; in the palette',
			'Move Card Left: left',
			'Move Card Right: right',
			'Move Card Up: up',
			'Move Card Down: down',
			'Move Card Left by 10: shift+left',
			'Move Card Right by 10: shift+right',
			'Move Card Up by 10: shift+up',
			'Move Card Down by 10: shift+down',
			'Duplicate Selected Cards: cmd+d; in the palette',
			'Delete Selected Cards or Connections: delete, backspace, cmd+backspace; in the palette',
			'Rename Card: f2; in the palette',
			'Open Card: enter',
			'Select Card: space',
			'Focus Card Toolbar: alt+f10'
		]);
		// Where the system has no Command key, the keys are the same with Control, and Delete has no third key.
		assert.deepStrictEqual(
			[BaseHalfCanvasCommandId.ZoomIn, BaseHalfCanvasCommandId.ZoomOut, BaseHalfCanvasCommandId.DuplicateSelection, BaseHalfCanvasCommandId.DeleteSelection].map(id => keysOf(getBaseHalfCanvasKeyCommand(id)!, OperatingSystem.Windows).join(', ')),
			['ctrl+=, ctrl+shift+=, ctrl+numpad_add', 'ctrl+-, ctrl+shift+-, ctrl+numpad_subtract', 'ctrl+d', 'delete, backspace']
		);
		assert.strictEqual(new Set(BASEHALF_CANVAS_KEY_COMMANDS.map(command => command.id)).size, BASEHALF_CANVAS_KEY_COMMANDS.length);
		assert.strictEqual(getBaseHalfCanvasKeyCommand('workbench.action.zoomIn'), undefined);
	});

	test('the arrow keys that never reach the canvas library', () => {
		const stopped = (modifiers: { readonly ctrlOrMeta: boolean; readonly alt: boolean }) => Object.entries(PLACES)
			.filter(([, place]) => baseHalfCanvasStopsArrowKey(baseHalfCanvasKeyContext(place), modifiers))
			.map(([name]) => name);
		assert.deepStrictEqual({
			plain: stopped({ ctrlOrMeta: false, alt: false }),
			withCommand: stopped({ ctrlOrMeta: true, alt: false })
		}, {
			plain: [
				'the blank canvas, one card selected',
				'the blank canvas, a code card selected',
				'the blank canvas, two cards selected',
				'the selected card',
				'the selected code card',
				'something of the selected code card that is no control',
				'the selected video card',
				'a card of two selected ones'
			],
			// A set is not moved by keys, whatever is held with the arrow key.
			withCommand: ['the blank canvas, two cards selected', 'a card of two selected ones']
		});
	});
});
