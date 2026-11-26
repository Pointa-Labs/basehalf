/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TerminalDataBufferer } from '../../../../../platform/terminal/common/terminalDataBuffering.js';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

suite('Workbench - TerminalDataBufferer', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let bufferer: TerminalDataBufferer;
	let counter: Map<number, number>;
	let data: Map<number, string>;

	setup(async () => {
		counter = new Map();
		data = new Map();
		bufferer = store.add(new TerminalDataBufferer((id, e) => {
			if (!counter.has(id)) {
				counter.set(id, 0);
			}
			counter.set(id, counter.get(id)! + 1);
			if (!data.has(id)) {
				data.set(id, '');
			}
			data.set(id, e);
		}));
	});

	test('start', async () => {
		const terminalOnData = new Emitter<string>();

		store.add(bufferer.startBuffering(1, terminalOnData.event, 0));

		terminalOnData.fire('1');
		terminalOnData.fire('2');
		terminalOnData.fire('3');

		await wait(0);

		terminalOnData.fire('4');

		assert.strictEqual(counter.get(1), 1);
		assert.strictEqual(data.get(1), '123');

		await wait(0);

		assert.strictEqual(counter.get(1), 2);
		assert.strictEqual(data.get(1), '4');
	});

	test('start 2', async () => {
		const terminal1OnData = new Emitter<string>();
		const terminal2OnData = new Emitter<string>();

		store.add(bufferer.startBuffering(1, terminal1OnData.event, 0));
		store.add(bufferer.startBuffering(2, terminal2OnData.event, 0));

		terminal1OnData.fire('1');
		terminal2OnData.fire('4');
		terminal1OnData.fire('2');
		terminal2OnData.fire('5');
		terminal1OnData.fire('3');
		terminal2OnData.fire('6');
		terminal2OnData.fire('7');

		assert.strictEqual(counter.get(1), undefined);
		assert.strictEqual(data.get(1), undefined);
		assert.strictEqual(counter.get(2), undefined);
		assert.strictEqual(data.get(2), undefined);

		await wait(0);

		assert.strictEqual(counter.get(1), 1);
		assert.strictEqual(data.get(1), '123');
		assert.strictEqual(counter.get(2), 1);
		assert.strictEqual(data.get(2), '4567');
	});

	test('stop', async () => {
		const terminalOnData = new Emitter<string>();

		bufferer.startBuffering(1, terminalOnData.event, 0);

		terminalOnData.fire('1');
		terminalOnData.fire('2');
		terminalOnData.fire('3');

		bufferer.stopBuffering(1);
		await wait(0);

		assert.strictEqual(counter.get(1), 1);
		assert.strictEqual(data.get(1), '123');
	});

	test('start 2 stop 1', async () => {
		const terminal1OnData = new Emitter<string>();
		const terminal2OnData = new Emitter<string>();

		bufferer.startBuffering(1, terminal1OnData.event, 0);
		store.add(bufferer.startBuffering(2, terminal2OnData.event, 0));

		terminal1OnData.fire('1');
		terminal2OnData.fire('4');
		terminal1OnData.fire('2');
		terminal2OnData.fire('5');
		terminal1OnData.fire('3');
		terminal2OnData.fire('6');
		terminal2OnData.fire('7');

		assert.strictEqual(counter.get(1), undefined);
		assert.strictEqual(data.get(1), undefined);
		assert.strictEqual(counter.get(2), undefined);
		assert.strictEqual(data.get(2), undefined);

		bufferer.stopBuffering(1);
		await wait(0);

		assert.strictEqual(counter.get(1), 1);
		assert.strictEqual(data.get(1), '123');
		assert.strictEqual(counter.get(2), 1);
		assert.strictEqual(data.get(2), '4567');
	});

	test('dispose should flush remaining data events', async () => {
		const terminal1OnData = new Emitter<string>();
		const terminal2OnData = new Emitter<string>();

		store.add(bufferer.startBuffering(1, terminal1OnData.event, 0));
		store.add(bufferer.startBuffering(2, terminal2OnData.event, 0));

		terminal1OnData.fire('1');
		terminal2OnData.fire('4');
		terminal1OnData.fire('2');
		terminal2OnData.fire('5');
		terminal1OnData.fire('3');
		terminal2OnData.fire('6');
		terminal2OnData.fire('7');

		assert.strictEqual(counter.get(1), undefined);
		assert.strictEqual(data.get(1), undefined);
		assert.strictEqual(counter.get(2), undefined);
		assert.strictEqual(data.get(2), undefined);

		bufferer.dispose();
		await wait(0);

		assert.strictEqual(counter.get(1), 1);
		assert.strictEqual(data.get(1), '123');
		assert.strictEqual(counter.get(2), 1);
		assert.strictEqual(data.get(2), '4567');
	});

	suite('quiet flush', () => {
		let now: number;
		let checks: (() => void)[];
		let sent: string[];
		let quiet: TerminalDataBufferer;
		const runChecks = () => {
			for (const check of checks.splice(0)) {
				check();
			}
		};

		setup(() => {
			now = 0;
			checks = [];
			sent = [];
			quiet = store.add(new TerminalDataBufferer((_, e) => sent.push(e), {
				quietTime: 1,
				now: () => now,
				schedule: callback => {
					checks.push(callback);
					return toDisposable(() => {
						const index = checks.indexOf(callback);
						if (index >= 0) {
							checks.splice(index, 1);
						}
					});
				}
			}));
		});

		test('sends output after a quiet period once the terminal has been silent, and the rest of the batch at its end', async () => {
			const terminalOnData = new Emitter<string>();
			store.add(quiet.startBuffering(1, terminalOnData.event, 20));

			terminalOnData.fire('a');
			now = 0.5;
			terminalOnData.fire('b');
			runChecks();
			now = 1.4;
			runChecks();
			const silentForLessThanTheQuietTime = [...sent];
			now = 1.5;
			runChecks();
			const silentForTheQuietTime = [...sent];
			now = 2;
			terminalOnData.fire('c');
			now = 10;
			runChecks();
			const laterInTheSameBatch = [...sent];
			await wait(40);
			const atTheEndOfTheBatch = [...sent];

			// A batch that begins less than its length after other output is not sent early.
			now = 15;
			terminalOnData.fire('d');
			const checksCloseBehindOtherOutput = checks.length;
			await wait(40);
			const closeBehindOtherOutput = [...sent];

			now = 100;
			terminalOnData.fire('e');
			now = 101;
			runChecks();

			assert.deepStrictEqual({ silentForLessThanTheQuietTime, silentForTheQuietTime, laterInTheSameBatch, atTheEndOfTheBatch, checksCloseBehindOtherOutput, closeBehindOtherOutput, afterAnotherQuietPeriod: sent }, {
				silentForLessThanTheQuietTime: [],
				silentForTheQuietTime: ['ab'],
				laterInTheSameBatch: ['ab'],
				atTheEndOfTheBatch: ['ab', 'c'],
				checksCloseBehindOtherOutput: 0,
				closeBehindOtherOutput: ['ab', 'c', 'd'],
				afterAnotherQuietPeriod: ['ab', 'c', 'd', 'e']
			});
		});

		test('sends a batch at the end of its time when the terminal does not fall silent', async () => {
			const terminalOnData = new Emitter<string>();
			store.add(quiet.startBuffering(1, terminalOnData.event, 0));

			terminalOnData.fire('a');
			terminalOnData.fire('b');
			await wait(0);

			assert.deepStrictEqual({ sent, pendingChecks: checks.length }, { sent: ['ab'], pendingChecks: 0 });
		});
	});
});
