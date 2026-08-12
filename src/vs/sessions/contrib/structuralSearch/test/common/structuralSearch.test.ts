/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { applyReplacement, findStructuralMatches, parsePattern, placeholderNames } from '../../common/structuralSearch.js';

function captures(text: string, pattern: string): string[] {
	return findStructuralMatches(text, pattern).map(match => text.slice(match.start, match.end));
}

suite('StructuralSearch', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('parsePattern', () => {

		test('splits placeholders out and treats $$ as a literal dollar', () => {
			assert.deepStrictEqual({
				simple: parsePattern('foo($x$)'),
				escaped: parsePattern('cost$$'),
				dangling: parsePattern('foo($x)'),
				empty: parsePattern(''),
			}, {
				simple: [
					{ kind: 'literal', text: 'foo(' },
					{ kind: 'placeholder', name: 'x' },
					{ kind: 'literal', text: ')' },
				],
				escaped: [{ kind: 'literal', text: 'cost$' }],
				dangling: undefined,
				empty: undefined,
			});
		});
	});

	suite('findStructuralMatches', () => {

		test('a placeholder takes a whole balanced expression, not up to the first bracket', () => {
			assert.deepStrictEqual({
				nested: captures('foo(bar(1, 2))', 'foo($x$)'),
				binding: findStructuralMatches('foo(bar(1, 2))', 'foo($x$)')[0].bindings,
			}, {
				nested: ['foo(bar(1, 2))'],
				binding: { x: 'bar(1, 2)' },
			});
		});

		test('never matches structure that only exists inside a string or a comment', () => {
			assert.deepStrictEqual({
				inString: captures('const message = "foo(1)";', 'foo($x$)'),
				inLineComment: captures('// foo(1)\nconst a = 1;', 'foo($x$)'),
				inHashComment: captures('# foo(1)\nvalue = 1', 'foo($x$)'),
				inBlockComment: captures('/* foo(1) */ const a = 1;', 'foo($x$)'),
				realOneAfterComment: captures('// foo(1)\nfoo(2)', 'foo($x$)'),
			}, {
				inString: [],
				inLineComment: [],
				inHashComment: [],
				inBlockComment: [],
				realOneAfterComment: ['foo(2)'],
			});
		});

		test('the same placeholder twice means the same code twice', () => {
			assert.deepStrictEqual({
				same: captures('total = x + x;', '$a$ + $a$'),
				different: captures('total = x + y;', '$a$ + $a$'),
			}, {
				same: ['x + x'],
				different: [],
			});
		});

		test('formatting differences do not break a match, but words are not split', () => {
			assert.deepStrictEqual({
				tight: captures('if(ready){}', 'if ($c$)'),
				loose: captures('if  (  ready  )  {}', 'if ($c$)'),
				splitWord: captures('i f (ready)', 'if ($c$)'),
			}, {
				tight: ['if(ready)'],
				loose: ['if  (  ready  )'],
				splitWord: [],
			});
		});

		test('finds every non-overlapping occurrence and honours the limit', () => {
			const text = 'foo(1); foo(2); foo(3);';

			assert.deepStrictEqual({
				all: captures(text, 'foo($x$)'),
				limited: findStructuralMatches(text, 'foo($x$)', 2).length,
			}, {
				all: ['foo(1)', 'foo(2)', 'foo(3)'],
				limited: 2,
			});
		});

		test('a malformed pattern finds nothing rather than guessing', () => {
			assert.deepStrictEqual(findStructuralMatches('foo(1)', 'foo($x)'), []);
		});
	});

	suite('applyReplacement', () => {

		test('fills captured code in and leaves an unknown name visible', () => {
			const match = findStructuralMatches('foo(bar(1, 2))', 'foo($x$)')[0];

			assert.deepStrictEqual({
				filled: applyReplacement('baz($x$)', match.bindings),
				reordered: applyReplacement('[$x$, $x$]', match.bindings),
				unknown: applyReplacement('qux($nope$)', match.bindings),
				escaped: applyReplacement('$$$x$', match.bindings),
			}, {
				filled: 'baz(bar(1, 2))',
				reordered: '[bar(1, 2), bar(1, 2)]',
				unknown: 'qux($nope$)',
				escaped: '$bar(1, 2)',
			});
		});
	});

	suite('placeholderNames', () => {

		test('lists each name once, in order of first appearance', () => {
			assert.deepStrictEqual({
				several: placeholderNames('$a$.map($b$).filter($a$)'),
				none: placeholderNames('plain text'),
				malformed: placeholderNames('$a'),
			}, {
				several: ['a', 'b'],
				none: [],
				malformed: [],
			});
		});
	});
});
