/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// tasks.md T-227 の守り（IntelliJ 由来の機能。回帰ガードがここを数える）

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { addToHistory, filterHistory, IRunHistoryEntry, parseHistory, RunKind, stringifyHistory } from '../../common/runAnything.js';

suite('RunAnything', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const shell = (value: string): IRunHistoryEntry => ({ kind: RunKind.Terminal, value });
	const command = (value: string, label: string): IRunHistoryEntry => ({ kind: RunKind.Command, value, label });

	suite('addToHistory', () => {

		test('most recent first, with no duplicate of the same run', () => {
			let history = addToHistory([], shell('npm test'));
			history = addToHistory(history, shell('npm run build'));
			history = addToHistory(history, shell('npm test'));

			assert.deepStrictEqual(history.map(entry => entry.value), ['npm test', 'npm run build']);
		});

		test('a shell entry and a command entry with the same text stay separate', () => {
			const history = addToHistory([shell('build')], command('build', 'Build'));

			assert.deepStrictEqual(history, [command('build', 'Build'), shell('build')]);
		});

		test('drops the oldest once the cap is reached', () => {
			let history: IRunHistoryEntry[] = [];
			for (let i = 0; i < 5; i++) {
				history = addToHistory(history, shell(`cmd${i}`), 3);
			}

			assert.deepStrictEqual(history.map(entry => entry.value), ['cmd4', 'cmd3', 'cmd2']);
		});
	});

	suite('filterHistory', () => {

		test('matches the shell text or the command label, ignoring case', () => {
			const history = [shell('npm run build'), command('workbench.action.files.save', 'File: Save')];

			assert.deepStrictEqual({
				byShell: filterHistory(history, 'BUILD').map(entry => entry.value),
				byLabel: filterHistory(history, 'save').map(entry => entry.value),
				byCommandId: filterHistory(history, 'workbench').map(entry => entry.value),
				noMatch: filterHistory(history, 'zzz'),
				emptyTerm: filterHistory(history, '').length,
			}, {
				byShell: ['npm run build'],
				byLabel: ['workbench.action.files.save'],
				byCommandId: ['workbench.action.files.save'],
				noMatch: [],
				emptyTerm: 2,
			});
		});
	});

	suite('parseHistory', () => {

		test('round-trips and drops malformed entries', () => {
			const history = [shell('npm test'), command('editor.action.format', 'Format')];
			const damaged = JSON.stringify([
				...history,
				{ kind: 'nonsense', value: 'x' },
				{ kind: RunKind.Terminal, value: '' },
				{ kind: RunKind.Command },
				null,
			]);

			assert.deepStrictEqual({
				roundTrip: parseHistory(stringifyHistory(history)),
				salvaged: parseHistory(damaged),
				missing: parseHistory(undefined),
				notJson: parseHistory('['),
				notArray: parseHistory('"text"'),
			}, {
				roundTrip: history,
				salvaged: history,
				missing: [],
				notJson: [],
				notArray: [],
			});
		});
	});
});
