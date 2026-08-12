/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { assignMnemonic, IBookmark, isValidMnemonic, MNEMONICS, nextFreeMnemonic, parseBookmarks, sortBookmarks, stringifyBookmarks, toggleBookmark } from '../../common/bookmarks.js';

suite('Bookmarks', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const A = 'file:///a.ts';
	const B = 'file:///b.ts';

	suite('toggleBookmark', () => {

		test('adds on the first call and removes on the second', () => {
			const added = toggleBookmark([], A, 10, 'const x = 1;');
			const removed = toggleBookmark(added, A, 10, 'const x = 1;');

			assert.deepStrictEqual({ added, removed }, {
				added: [{ uri: A, line: 10, preview: 'const x = 1;' }],
				removed: [],
			});
		});

		test('treats a different line or file as a different bookmark', () => {
			let bookmarks = toggleBookmark([], A, 10, 'first');
			bookmarks = toggleBookmark(bookmarks, A, 20, 'second');
			bookmarks = toggleBookmark(bookmarks, B, 10, 'other file');

			assert.deepStrictEqual(bookmarks.map(entry => `${entry.uri}:${entry.line}`), [
				`${A}:10`, `${A}:20`, `${B}:10`,
			]);
		});
	});

	suite('assignMnemonic', () => {

		test('a mnemonic points at exactly one place, so reusing it moves it', () => {
			let bookmarks = assignMnemonic([], A, 10, 'first', '1');
			bookmarks = assignMnemonic(bookmarks, B, 20, 'second', '1');

			assert.deepStrictEqual(bookmarks, [
				{ uri: A, line: 10, preview: 'first', mnemonic: undefined },
				{ uri: B, line: 20, preview: 'second', mnemonic: '1' },
			]);
		});

		test('upgrades a plain bookmark in place and upper-cases the key', () => {
			const plain = toggleBookmark([], A, 10, 'first');
			const withKey = assignMnemonic(plain, A, 10, 'first', 'b');

			assert.deepStrictEqual(withKey, [{ uri: A, line: 10, preview: 'first', mnemonic: 'B' }]);
		});
	});

	suite('nextFreeMnemonic', () => {

		test('hands out the lowest free key and gives up when all 36 are taken', () => {
			const two: IBookmark[] = [
				{ uri: A, line: 1, preview: '', mnemonic: '0' },
				{ uri: A, line: 2, preview: '', mnemonic: '1' },
			];
			const all: IBookmark[] = MNEMONICS.map((mnemonic, index) => ({ uri: A, line: index + 1, preview: '', mnemonic }));

			assert.deepStrictEqual({
				empty: nextFreeMnemonic([]),
				partial: nextFreeMnemonic(two),
				exhausted: nextFreeMnemonic(all),
			}, {
				empty: '0',
				partial: '2',
				exhausted: undefined,
			});
		});
	});

	suite('isValidMnemonic', () => {

		test('accepts 0-9 and A-Z in any case, nothing else', () => {
			assert.deepStrictEqual({
				digit: isValidMnemonic('7'),
				upper: isValidMnemonic('Q'),
				lower: isValidMnemonic('q'),
				punctuation: isValidMnemonic('!'),
				twoChars: isValidMnemonic('AB'),
				empty: isValidMnemonic(''),
			}, {
				digit: true, upper: true, lower: true,
				punctuation: false, twoChars: false, empty: false,
			});
		});
	});

	suite('sortBookmarks', () => {

		test('groups by file then by line', () => {
			const sorted = sortBookmarks([
				{ uri: B, line: 5, preview: '' },
				{ uri: A, line: 30, preview: '' },
				{ uri: A, line: 4, preview: '' },
			]);

			assert.deepStrictEqual(sorted.map(entry => `${entry.uri}:${entry.line}`), [
				`${A}:4`, `${A}:30`, `${B}:5`,
			]);
		});
	});

	suite('parseBookmarks', () => {

		test('round-trips through storage', () => {
			const bookmarks: IBookmark[] = [
				{ uri: A, line: 3, preview: 'first', mnemonic: '1' },
				{ uri: B, line: 9, preview: 'second' },
			];

			assert.deepStrictEqual(parseBookmarks(stringifyBookmarks(bookmarks)), bookmarks);
		});

		test('drops malformed entries and demotes a duplicated mnemonic', () => {
			const raw = JSON.stringify([
				{ uri: A, line: 3, preview: 'keeps key', mnemonic: '1' },
				{ uri: B, line: 4, preview: 'loses key', mnemonic: '1' },
				{ uri: A, line: 0, preview: 'bad line' },
				{ uri: A, line: 1.5, preview: 'fractional line' },
				{ uri: '', line: 2, preview: 'no uri' },
				{ uri: A, line: 5, preview: 'bad key', mnemonic: '!!' },
				null,
			]);

			assert.deepStrictEqual({
				salvaged: parseBookmarks(raw),
				missing: parseBookmarks(undefined),
				notJson: parseBookmarks('nope'),
				notArray: parseBookmarks('{}'),
			}, {
				salvaged: [
					{ uri: A, line: 3, preview: 'keeps key', mnemonic: '1' },
					{ uri: B, line: 4, preview: 'loses key' },
				],
				missing: [],
				notJson: [],
				notArray: [],
			});
		});
	});
});
