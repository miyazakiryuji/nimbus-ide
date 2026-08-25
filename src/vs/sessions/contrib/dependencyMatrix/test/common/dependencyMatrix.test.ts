/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// tasks.md T-230 の守り（IntelliJ 由来の機能。回帰ガードがここを数える）

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildMatrix, extractImports, findCycles, IFileImports, moduleKeyFor, renderMatrix, resolveSpecifier } from '../../common/dependencyMatrix.js';

suite('DependencyMatrix', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('extractImports', () => {

		test('finds every shape an import takes', () => {
			const source = [
				`import { a } from './a.js';`,
				`import './side-effect.css';`,
				`export { b } from '../b/index.js';`,
				`const c = await import('./c.js');`,
				`const d = require('./d');`,
				`import type { E } from './e.js';`,
			].join('\n');

			assert.deepStrictEqual(extractImports(source).sort(), [
				'../b/index.js', './a.js', './c.js', './d', './e.js', './side-effect.css',
			]);
		});
	});

	suite('resolveSpecifier', () => {

		test('resolves relative paths and refuses to guess at anything else', () => {
			assert.deepStrictEqual({
				sibling: resolveSpecifier('src/app/main.ts', './util.js'),
				parent: resolveSpecifier('src/app/main.ts', '../core/thing.js'),
				deep: resolveSpecifier('src/a/b/c.ts', '../../x/y.ts'),
				noExtension: resolveSpecifier('src/app/main.ts', './util'),
				bare: resolveSpecifier('src/app/main.ts', 'react'),
				aliased: resolveSpecifier('src/app/main.ts', 'vs/base/common/uri'),
				escapesRoot: resolveSpecifier('main.ts', '../outside.js'),
			}, {
				sibling: 'src/app/util',
				parent: 'src/core/thing',
				deep: 'src/x/y',
				noExtension: 'src/app/util',
				bare: undefined,
				aliased: undefined,
				escapesRoot: undefined,
			});
		});
	});

	suite('moduleKeyFor', () => {

		test('collapses a file path to the folder the matrix counts by', () => {
			assert.deepStrictEqual({
				depth3: moduleKeyFor('src/vs/base/common/uri.ts', 3),
				depth2: moduleKeyFor('src/vs/base/common/uri.ts', 2),
				shallower: moduleKeyFor('src/main.ts', 3),
				rootFile: moduleKeyFor('index.ts', 3),
			}, {
				depth3: 'src/vs/base',
				depth2: 'src/vs',
				shallower: 'src',
				rootFile: '.',
			});
		});
	});

	suite('buildMatrix', () => {

		test('counts folder to folder and ignores imports inside one folder', () => {
			const files: IFileImports[] = [
				{ path: 'src/a/one.ts', specifiers: ['../b/x.js', '../b/y.js', './two.js'] },
				{ path: 'src/a/two.ts', specifiers: ['react'] },
				{ path: 'src/b/x.ts', specifiers: [] },
				{ path: 'src/b/y.ts', specifiers: [] },
			];

			const matrix = buildMatrix(files, 2);

			assert.deepStrictEqual({
				modules: matrix.modules,
				counts: matrix.counts,
			}, {
				modules: ['src/a', 'src/b'],
				// src/a imports src/b twice; the sibling import and the bare one are not edges.
				counts: [[0, 2], [0, 0]],
			});
		});
	});

	suite('findCycles', () => {

		test('reports each set of folders that can reach each other', () => {
			const cyclic = buildMatrix([
				{ path: 'src/a/one.ts', specifiers: ['../b/x.js'] },
				{ path: 'src/b/x.ts', specifiers: ['../c/y.js'] },
				{ path: 'src/c/y.ts', specifiers: ['../a/one.js'] },
				{ path: 'src/d/z.ts', specifiers: ['../a/one.js'] },
			], 2);

			const acyclic = buildMatrix([
				{ path: 'src/a/one.ts', specifiers: ['../b/x.js'] },
				{ path: 'src/b/x.ts', specifiers: [] },
			], 2);

			assert.deepStrictEqual({
				cycle: findCycles(cyclic),
				none: findCycles(acyclic),
				empty: findCycles({ modules: [], counts: [] }),
			}, {
				cycle: [['src/a', 'src/b', 'src/c']],
				none: [],
				empty: [],
			});
		});

		test('finds a two-folder cycle', () => {
			const matrix = buildMatrix([
				{ path: 'src/a/one.ts', specifiers: ['../b/x.js'] },
				{ path: 'src/b/x.ts', specifiers: ['../a/one.js'] },
			], 2);

			assert.deepStrictEqual(findCycles(matrix), [['src/a', 'src/b']]);
		});
	});

	suite('renderMatrix', () => {

		test('numbers the columns and spells the folders out down the side', () => {
			const matrix = buildMatrix([
				{ path: 'src/a/one.ts', specifiers: ['../b/x.js', '../b/y.js'] },
				{ path: 'src/b/x.ts', specifiers: [] },
			], 2);

			assert.strictEqual(renderMatrix(matrix), [
				'            1  2',
				'1. src/a    —  2',
				'2. src/b    .  —',
			].join('\n'));
		});
	});
});
