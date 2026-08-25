/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// tasks.md T-231 の守り（IntelliJ 由来の機能。回帰ガードがここを数える）

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFeature, isTrackableCommand, parseStats, rankByUsage, recordUsage, stringifyStats, totalInvocations, unusedShortcuts, UsageStats } from '../../common/productivityGuide.js';

suite('ProductivityGuide', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const features: IFeature[] = [
		{ commandId: 'a', label: 'Alpha', keybinding: 'Cmd+A' },
		{ commandId: 'b', label: 'Bravo', keybinding: 'Cmd+B' },
		{ commandId: 'c', label: 'Charlie' },
		{ commandId: 'd', label: 'Delta', keybinding: 'Cmd+D' },
	];

	suite('recordUsage', () => {

		test('counts up and remembers when, ignoring commands that say nothing', () => {
			let stats: UsageStats = {};
			stats = recordUsage(stats, 'a', 1000);
			stats = recordUsage(stats, 'a', 2000);
			stats = recordUsage(stats, 'b', 1500);

			const ignored = recordUsage(stats, 'workbench.action.showCommands', 3000);

			assert.deepStrictEqual({
				stats,
				ignoredIsUnchanged: ignored === stats,
				total: totalInvocations(stats),
			}, {
				stats: { a: { count: 2, last: 2000 }, b: { count: 1, last: 1500 } },
				ignoredIsUnchanged: true,
				total: 3,
			});
		});

		test('does not mutate the stats it was given', () => {
			const original: UsageStats = { a: { count: 1, last: 100 } };
			recordUsage(original, 'a', 200);

			assert.deepStrictEqual(original, { a: { count: 1, last: 100 } });
		});
	});

	suite('isTrackableCommand', () => {

		test('skips the guide itself and the palette', () => {
			assert.deepStrictEqual({
				normal: isTrackableCommand('editor.action.formatDocument'),
				guide: isTrackableCommand('nimbus.productivityGuide.show'),
				palette: isTrackableCommand('workbench.action.showCommands'),
				empty: isTrackableCommand(''),
			}, { normal: true, guide: false, palette: false, empty: false });
		});
	});

	suite('rankByUsage', () => {

		test('most used first, recency breaks ties, and untouched commands are left out', () => {
			const stats: UsageStats = {
				a: { count: 2, last: 100 },
				b: { count: 5, last: 50 },
				c: { count: 2, last: 900 },
			};

			assert.deepStrictEqual(rankByUsage(stats, features).map(entry => entry.commandId), ['b', 'c', 'a']);
		});

		test('honours the limit', () => {
			const stats: UsageStats = { a: { count: 1, last: 1 }, b: { count: 2, last: 1 }, c: { count: 3, last: 1 } };

			assert.deepStrictEqual(rankByUsage(stats, features, 2).map(entry => entry.commandId), ['c', 'b']);
		});
	});

	suite('unusedShortcuts', () => {

		test('lists only commands that have a key and have never been run', () => {
			const stats: UsageStats = { a: { count: 1, last: 1 } };

			assert.deepStrictEqual(unusedShortcuts(stats, features).map(entry => entry.commandId), ['b', 'd']);
		});
	});

	suite('parseStats', () => {

		test('round-trips and rejects anything that is not a real count', () => {
			const stats: UsageStats = { a: { count: 3, last: 12345 } };
			const damaged = JSON.stringify({
				a: { count: 3, last: 12345 },
				b: { count: 0, last: 1 },
				c: { count: 'many', last: 1 },
				d: { count: 2 },
				'nimbus.productivityGuide.show': { count: 9, last: 1 },
			});

			assert.deepStrictEqual({
				roundTrip: parseStats(stringifyStats(stats)),
				salvaged: parseStats(damaged),
				missing: parseStats(undefined),
				notJson: parseStats('{'),
				array: parseStats('[]'),
			}, {
				roundTrip: stats,
				salvaged: stats,
				missing: {},
				notJson: {},
				array: {},
			});
		});
	});
});
