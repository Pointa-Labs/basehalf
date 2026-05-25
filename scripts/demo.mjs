// SPDX-License-Identifier: Apache-2.0
// A 60-second narrated tour of the model. Run: npm run demo
// (Uses a throwaway temp store so it never touches your real data.)

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKb } from '../src/core/index.mjs';

const kb = createKb(mkdtempSync(join(tmpdir(), 'kb-demo-')));
const say = (s) => console.log(s);

say('\n1) You add a fact — with a source, so it can always be checked:');
const { id } = kb.add({ text: 'We chose Postgres for the cloud DB.', source: 'docs/decisions.md', actor: 'user' });
say(`   added ${id}`);

say('\n2) Later, an agent searches before it works — answers come back grounded:');
say('   ' + JSON.stringify(kb.search('postgres')));

say('\n3) Canvas: an agent arranges 3 items into a row.');
say('   (the agent does the layout math; your software just offers "move")');
const ids = ['A', 'B', 'C'].map((t) => kb.add({ text: t, type: 'canvas', x: 0, y: 0, actor: 'agent' }).id);
ids.forEach((it, i) => kb.move({ id: it, x: i * 100, y: 50, actor: 'agent' }));
say('   ' + kb.list().filter((n) => n.type === 'canvas').map((n) => `${n.text}@(${n.x},${n.y})`).join('  '));

say('\n4) The ledger shows who did what — the audit trail is automatic:');
for (const e of kb.log()) say(`   ${e.type.padEnd(13)} by ${e.actor}`);

say('\n5) Nothing above is destructive: every change is reversible by its');
say('   eventId or commandId (`kb undo <id>`). The events file is the truth.\n');
