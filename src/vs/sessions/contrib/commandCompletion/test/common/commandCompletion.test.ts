/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { findCommandTrigger, MAX_QUERY_LENGTH } from '../../common/commandCompletion.js';

suite('CommandCompletion', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('findCommandTrigger', () => {

		test('locates the dot and what has been typed after it', () => {
			assert.deepStrictEqual({
				// "value." with the caret right after the dot
				bareDot: findCommandTrigger('value.', 7),
				// "value.form" with the caret at the end
				withQuery: findCommandTrigger('value.form', 11),
				// dot at the very start of the line
				lineStart: findCommandTrigger('.fmt', 5),
				// digits count as part of the query
				digits: findCommandTrigger('a.utf8', 7),
			}, {
				bareDot: { dotColumn: 6, query: '' },
				withQuery: { dotColumn: 6, query: 'form' },
				lineStart: { dotColumn: 1, query: 'fmt' },
				digits: { dotColumn: 2, query: 'utf8' },
			});
		});

		test('stays out of the way where a dot is not a request for actions', () => {
			assert.deepStrictEqual({
				noDot: findCommandTrigger('value', 6),
				range: findCommandTrigger('0..10', 6),
				afterSpace: findCommandTrigger('value. ', 8),
				// a dot further back, with a non-word character in between
				brokenRun: findCommandTrigger('a.b(c', 6),
				emptyLine: findCommandTrigger('', 1),
			}, {
				noDot: undefined,
				range: undefined,
				afterSpace: undefined,
				brokenRun: undefined,
				emptyLine: undefined,
			});
		});

		test('gives up once the run is too long to be an action search', () => {
			const long = `x.${'a'.repeat(MAX_QUERY_LENGTH + 1)}`;
			const withinLimit = `x.${'a'.repeat(MAX_QUERY_LENGTH)}`;

			assert.deepStrictEqual({
				tooLong: findCommandTrigger(long, long.length + 1),
				atLimit: findCommandTrigger(withinLimit, withinLimit.length + 1)?.query.length,
			}, {
				tooLong: undefined,
				atLimit: MAX_QUERY_LENGTH,
			});
		});
	});
});
