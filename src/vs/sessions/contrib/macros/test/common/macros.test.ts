/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IMacro, isRecordableCommand, parseMacros, serializableArgs, stringifyMacros, uniqueMacroName } from '../../common/macros.js';

suite('Macros', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	suite('isRecordableCommand', () => {

		test('records editor work but never recursion, window teardown, or blocking pickers', () => {
			assert.deepStrictEqual({
				editorAction: isRecordableCommand('editor.action.deleteLines'),
				typing: isRecordableCommand('type'),
				undo: isRecordableCommand('undo'),
				ownCommands: isRecordableCommand('nimbus.macros.play'),
				reload: isRecordableCommand('workbench.action.reloadWindow'),
				quit: isRecordableCommand('workbench.action.quit'),
				commandPalette: isRecordableCommand('workbench.action.showCommands'),
				quickOpen: isRecordableCommand('workbench.action.quickOpen'),
				empty: isRecordableCommand(''),
			}, {
				editorAction: true,
				typing: true,
				undo: true,
				ownCommands: false,
				reload: false,
				quit: false,
				commandPalette: false,
				quickOpen: false,
				empty: false,
			});
		});
	});

	suite('serializableArgs', () => {

		test('keeps plain values and rejects anything that cannot survive storage', () => {
			assert.deepStrictEqual({
				empty: serializableArgs([]),
				primitives: serializableArgs(['text', 7, true, null]),
				plainObject: serializableArgs([{ lineNumber: 3, nested: [1, 2] }]),
				undefinedArg: serializableArgs([undefined]),
				functionArg: serializableArgs([() => 1]),
				symbolArg: serializableArgs([Symbol('x')]),
			}, {
				empty: [],
				primitives: ['text', 7, true, null],
				plainObject: [{ lineNumber: 3, nested: [1, 2] }],
				undefinedArg: undefined,
				functionArg: undefined,
				symbolArg: undefined,
			});
		});

		test('rejects circular structures instead of throwing', () => {
			const circular: Record<string, unknown> = {};
			circular.self = circular;

			assert.strictEqual(serializableArgs([circular]), undefined);
		});
	});

	suite('uniqueMacroName', () => {

		test('suffixes a counter so saving twice never silently replaces', () => {
			assert.deepStrictEqual({
				free: uniqueMacroName([], 'Tidy imports'),
				trimmed: uniqueMacroName([], '  Tidy imports  '),
				firstClash: uniqueMacroName(['Tidy imports'], 'Tidy imports'),
				secondClash: uniqueMacroName(['Tidy imports', 'Tidy imports (2)'], 'Tidy imports'),
				gapReused: uniqueMacroName(['Tidy imports', 'Tidy imports (3)'], 'Tidy imports'),
			}, {
				free: 'Tidy imports',
				trimmed: 'Tidy imports',
				firstClash: 'Tidy imports (2)',
				secondClash: 'Tidy imports (3)',
				gapReused: 'Tidy imports (2)',
			});
		});
	});

	suite('parseMacros', () => {

		test('round-trips through storage', () => {
			const macros: IMacro[] = [
				{ name: 'Tidy imports', steps: [{ commandId: 'editor.action.organizeImports', args: [] }] },
				{ name: 'Wrap', steps: [{ commandId: 'type', args: [{ text: '(' }] }] },
			];

			assert.deepStrictEqual(parseMacros(stringifyMacros(macros)), macros);
		});

		test('drops malformed entries instead of losing every macro', () => {
			const good = { name: 'Good', steps: [{ commandId: 'undo', args: [] }] };
			const raw = JSON.stringify([
				good,
				{ name: '', steps: [] },
				{ name: 'No steps array', steps: 'nope' },
				{ steps: [] },
				{ name: 'Bad step', steps: [{ args: [] }] },
				null,
			]);

			assert.deepStrictEqual({
				salvaged: parseMacros(raw),
				missing: parseMacros(undefined),
				notJson: parseMacros('{{{'),
				notArray: parseMacros('{"name":"x"}'),
			}, {
				salvaged: [good],
				missing: [],
				notJson: [],
				notArray: [],
			});
		});
	});
});
