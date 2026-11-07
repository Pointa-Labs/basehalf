/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Pointa Labs. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE in the repository root.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import { dirname, join, relative, sep } from 'path';
import { createImportRuleListener } from './utils.ts';

/**
 * BaseHalf's folders are ordered within each of VS Code's layers
 * (docs/harness/code-organization.md, "The order of the folders"). A module of
 * a folder imports, in its own layer, only folders that come before its folder
 * in the order of that layer; it imports the lower layers of any folder. What a
 * folder imports of itself is left to `code-layering` and `code-import-patterns`.
 * A feature of the canvas imports no other feature of the canvas. Tests are not
 * bound by the order.
 */
type Options = {
	/** BaseHalf's root, as the end of a path (`src/vs/workbench/basehalf`). */
	readonly root: string;
	/** VS Code's layers, the lowest first. */
	readonly layers: readonly string[];
	/** For each layer, its folders from the bottom; `canvasContrib/*` stands for every feature of the canvas. */
	readonly order: Readonly<Record<string, readonly string[]>>;
};

interface IPlace {
	readonly folder: string;
	readonly entry: string;
	readonly layer: string | undefined;
	readonly isTest: boolean;
}

export default new class implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		messages: {
			later: 'BaseHalf\'s folders are in an order in each layer: {{from}}/{{layer}} may not import {{to}}/{{layer}}, which comes after it. Import a folder that comes before it, or move what is shared to a folder below both (docs/harness/code-organization.md, "The order of the folders").',
			unordered: 'The folder {{folder}} is not in the order of the {{layer}} layer of BaseHalf\'s folders. Add it to the order of local/code-basehalf-folder-order in eslint.config.js and docs/harness/code-organization.md.',
			canvasFeature: 'A feature of the canvas does not import another feature of the canvas: {{from}} imports {{to}}. Move what they share into the canvas core.'
		},
		schema: false
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {
		const options = context.options[0] as Options;
		const marker = sep + options.root.split('/').join(sep) + sep;
		const at = context.filename.lastIndexOf(marker);
		if (at < 0) {
			return {};
		}
		const rootDir = context.filename.slice(0, at + marker.length - 1);
		const from = this.place(rootDir, context.filename, options);
		if (!from || !from.layer || from.isTest) {
			// Tests compose the services of several folders and nothing imports them: the order binds the product's code.
			return {};
		}
		const fromLayer = from.layer;
		return createImportRuleListener((node, value) => {
			if (!value.startsWith('.')) {
				return;
			}
			const to = this.place(rootDir, join(dirname(context.filename), value), options);
			if (!to || !to.layer || to.folder === from.folder) {
				return;
			}
			if (from.entry === 'canvasContrib/*' && to.entry === 'canvasContrib/*') {
				context.report({ loc: node.loc, messageId: 'canvasFeature', data: { from: from.folder, to: to.folder } });
				return;
			}
			const fromRank = options.layers.indexOf(fromLayer);
			const toRank = options.layers.indexOf(to.layer);
			if (fromRank < 0 || toRank < 0 || toRank !== fromRank) {
				// A lower layer of any folder may be imported; a higher one is code-layering's to report.
				return;
			}
			const order = options.order[fromLayer] ?? [];
			const fromIndex = order.indexOf(from.entry);
			const toIndex = order.indexOf(to.entry);
			if (fromIndex < 0) {
				context.report({ loc: node.loc, messageId: 'unordered', data: { folder: from.folder, layer: fromLayer } });
			} else if (toIndex < 0) {
				context.report({ loc: node.loc, messageId: 'unordered', data: { folder: to.folder, layer: fromLayer } });
			} else if (toIndex > fromIndex) {
				context.report({ loc: node.loc, messageId: 'later', data: { from: from.folder, to: to.folder, layer: fromLayer } });
			}
		});
	}

	/** The folder, its entry in the order, and the layer of a file below BaseHalf's root; `undefined` outside it. */
	private place(rootDir: string, file: string, options: Options): IPlace | undefined {
		const path = relative(rootDir, file);
		if (!path || path.startsWith('..')) {
			return undefined;
		}
		const parts = path.split(sep);
		if (parts.length < 2) {
			return undefined;
		}
		const isCanvasFeature = parts[0] === 'canvasContrib';
		const folder = isCanvasFeature ? `${parts[0]}/${parts[1]}` : parts[0];
		const rest = parts.slice(isCanvasFeature ? 2 : 1, -1);
		const layerAt = rest[0] === 'test' ? 1 : 0;
		const layer = rest[layerAt] !== undefined && options.layers.includes(rest[layerAt]) ? rest[layerAt] : undefined;
		return { folder, entry: isCanvasFeature ? 'canvasContrib/*' : folder, layer, isTest: layerAt === 1 };
	}
};
