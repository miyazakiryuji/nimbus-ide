/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// tasks.md T-225 の守り（IntelliJ 由来の機能。回帰ガードがここを数える）

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { evaluateArithmetic, formatNumber, includesCategory, parseQuery, SearchScope } from '../../common/searchEverywhere.js';

suite('SearchEverywhere', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('parseQuery', () => {

		test('splits the Quick Open sigils off the search term', () => {
			assert.deepStrictEqual({
				plain: parseQuery('  editor  '),
				actions: parseQuery('>toggle word wrap'),
				symbols: parseQuery('#MacroService'),
				sigilOnly: parseQuery('>'),
				empty: parseQuery('   '),
			}, {
				plain: { scope: SearchScope.All, term: 'editor' },
				actions: { scope: SearchScope.Actions, term: 'toggle word wrap' },
				symbols: { scope: SearchScope.Symbols, term: 'MacroService' },
				sigilOnly: { scope: SearchScope.Actions, term: '' },
				empty: { scope: SearchScope.All, term: '' },
			});
		});
	});

	suite('includesCategory', () => {

		test('All takes everything, a narrowed scope takes only itself', () => {
			assert.deepStrictEqual({
				allTakesFiles: includesCategory(SearchScope.All, SearchScope.Files),
				allTakesActions: includesCategory(SearchScope.All, SearchScope.Actions),
				actionsTakeActions: includesCategory(SearchScope.Actions, SearchScope.Actions),
				actionsSkipFiles: includesCategory(SearchScope.Actions, SearchScope.Files),
				symbolsSkipActions: includesCategory(SearchScope.Symbols, SearchScope.Actions),
			}, {
				allTakesFiles: true,
				allTakesActions: true,
				actionsTakeActions: true,
				actionsSkipFiles: false,
				symbolsSkipActions: false,
			});
		});
	});

	suite('evaluateArithmetic', () => {

		test('evaluates the arithmetic IntelliJ answers inline', () => {
			assert.deepStrictEqual({
				addition: evaluateArithmetic('1 + 2'),
				precedence: evaluateArithmetic('2 + 3 * 4'),
				parentheses: evaluateArithmetic('(2 + 3) * 4'),
				division: evaluateArithmetic('10 / 4'),
				modulo: evaluateArithmetic('10 % 3'),
				negation: evaluateArithmetic('-5 + 2'),
				sqrt: evaluateArithmetic('sqrt(16)'),
				nested: evaluateArithmetic('sqrt(16) * 2 + 1'),
				hex: evaluateArithmetic('0xff'),
				binary: evaluateArithmetic('0b1010'),
				octal: evaluateArithmetic('0o17'),
				hexArithmetic: evaluateArithmetic('0xff + 1'),
			}, {
				addition: 3,
				precedence: 14,
				parentheses: 20,
				division: 2.5,
				modulo: 1,
				negation: -3,
				sqrt: 4,
				nested: 9,
				hex: 255,
				binary: 10,
				octal: 15,
				hexArithmetic: 256,
			});
		});

		test('exponentiation binds tighter than multiplication and is right associative', () => {
			assert.deepStrictEqual({
				rightAssociative: evaluateArithmetic('2^3^2'),
				tighterThanTimes: evaluateArithmetic('2 * 3^2'),
			}, {
				rightAssociative: 512,
				tighterThanTimes: 18,
			});
		});

		test('treats a bare number or plain text as a search term, not a sum', () => {
			assert.deepStrictEqual({
				bareInteger: evaluateArithmetic('42'),
				bareDecimal: evaluateArithmetic('3.14'),
				word: evaluateArithmetic('editor'),
				empty: evaluateArithmetic(''),
				pathLike: evaluateArithmetic('src/vs/base'),
			}, {
				bareInteger: undefined,
				bareDecimal: undefined,
				word: undefined,
				empty: undefined,
				pathLike: undefined,
			});
		});

		test('rejects malformed expressions instead of guessing', () => {
			assert.deepStrictEqual({
				trailingOperator: evaluateArithmetic('1 +'),
				unbalanced: evaluateArithmetic('(1 + 2'),
				unknownFunction: evaluateArithmetic('frobnicate(2)'),
				functionWithoutArgs: evaluateArithmetic('sqrt'),
				trailingJunk: evaluateArithmetic('1 + 2 foo'),
				divideByZero: evaluateArithmetic('1 / 0'),
			}, {
				trailingOperator: undefined,
				unbalanced: undefined,
				unknownFunction: undefined,
				functionWithoutArgs: undefined,
				trailingJunk: undefined,
				divideByZero: undefined,
			});
		});

		test('knows the constants', () => {
			const pi = evaluateArithmetic('pi');
			const doubled = evaluateArithmetic('pi * 2');

			assert.ok(pi !== undefined && Math.abs(pi - Math.PI) < 1e-12);
			assert.ok(doubled !== undefined && Math.abs(doubled - Math.PI * 2) < 1e-12);
		});
	});

	suite('formatNumber', () => {

		test('keeps integers whole and trims floating point noise', () => {
			assert.deepStrictEqual({
				integer: formatNumber(20),
				negative: formatNumber(-3),
				decimal: formatNumber(2.5),
				noise: formatNumber(0.1 + 0.2),
			}, {
				integer: '20',
				negative: '-3',
				decimal: '2.5',
				noise: '0.3',
			});
		});
	});
});
