/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// tasks.md T-033 の守り（IntelliJ 由来の機能。回帰ガードがここを数える）

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { DEFAULT_SCRATCH_EXTENSION, extensionForLanguage, IScratchFile, nextScratchName, sortScratchFiles } from '../../common/scratchFiles.js';

suite('ScratchFiles', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('nextScratchName', () => {

		test('numbers files the way IntelliJ IDEA does as they accumulate', () => {
			const created: string[] = [];
			for (let i = 0; i < 4; i++) {
				created.push(nextScratchName(created, '.ts'));
			}

			assert.deepStrictEqual(created, ['scratch.ts', 'scratch_1.ts', 'scratch_2.ts', 'scratch_3.ts']);
		});

		test('reuses the gap left by a deleted file and keeps extensions apart', () => {
			assert.deepStrictEqual({
				gapReused: nextScratchName(['scratch.ts', 'scratch_2.ts'], '.ts'),
				baseFreedAgain: nextScratchName(['scratch_1.ts'], '.ts'),
				otherExtensionUnaffected: nextScratchName(['scratch.ts', 'scratch_1.ts'], '.py'),
				emptyFolder: nextScratchName([], '.md'),
			}, {
				gapReused: 'scratch_1.ts',
				baseFreedAgain: 'scratch.ts',
				otherExtensionUnaffected: 'scratch.py',
				emptyFolder: 'scratch.md',
			});
		});
	});

	suite('extensionForLanguage', () => {

		test('takes the first registered extension and falls back when there is none', () => {
			assert.deepStrictEqual({
				first: extensionForLanguage(['.ts', '.mts', '.cts']),
				only: extensionForLanguage(['.md']),
				none: extensionForLanguage([]),
			}, {
				first: '.ts',
				only: '.md',
				none: DEFAULT_SCRATCH_EXTENSION,
			});
		});
	});

	suite('sortScratchFiles', () => {

		test('puts the most recently modified first and breaks ties by name', () => {
			const file = (name: string, mtime: number): IScratchFile => ({
				resource: URI.file(`/scratches/${name}`),
				name,
				mtime,
			});

			const sorted = sortScratchFiles([
				file('scratch_2.ts', 100),
				file('scratch.ts', 300),
				file('scratch_3.ts', 200),
				file('scratch_1.ts', 200),
			]);

			assert.deepStrictEqual(sorted.map(entry => entry.name), [
				'scratch.ts',
				'scratch_1.ts',
				'scratch_3.ts',
				'scratch_2.ts',
			]);
		});

		test('does not mutate the input', () => {
			const input: IScratchFile[] = [
				{ resource: URI.file('/scratches/b.ts'), name: 'b.ts', mtime: 1 },
				{ resource: URI.file('/scratches/a.ts'), name: 'a.ts', mtime: 2 },
			];

			sortScratchFiles(input);

			assert.deepStrictEqual(input.map(entry => entry.name), ['b.ts', 'a.ts']);
		});
	});
});
