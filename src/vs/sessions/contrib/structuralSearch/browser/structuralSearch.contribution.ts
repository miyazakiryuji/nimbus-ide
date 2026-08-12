/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { applyReplacement, findStructuralMatches, IStructuralMatch, parsePattern, placeholderNames } from '../common/structuralSearch.js';

const SEARCH_COMMAND_ID = 'nimbus.structuralSearch.find';
const REPLACE_COMMAND_ID = 'nimbus.structuralSearch.replace';

const STRUCTURAL_CATEGORY = localize2('structuralSearch.category', "Structural Search");

interface IEditorTarget {
	readonly editor: ICodeEditor;
	readonly model: ITextModel;
}

function activeEditor(accessor: ServicesAccessor): IEditorTarget | undefined {
	const codeEditorService = accessor.get(ICodeEditorService);
	const editor = codeEditorService.getFocusedCodeEditor() ?? codeEditorService.getActiveCodeEditor();
	const model = editor?.getModel();

	return editor && model ? { editor, model } : undefined;
}

/**
 * Asks for a pattern and returns the matches, reporting the reason when there
 * are none — an empty result and a malformed pattern feel identical otherwise.
 */
async function promptForMatches(accessor: ServicesAccessor, target: IEditorTarget, prompt: string): Promise<{ pattern: string; matches: IStructuralMatch[] } | undefined> {
	const quickInputService = accessor.get(IQuickInputService);
	const notificationService = accessor.get(INotificationService);

	const pattern = await quickInputService.input({
		prompt,
		placeHolder: localize('structuralSearch.example', "For example: foo($arg$)"),
	});

	if (pattern === undefined || pattern.trim().length === 0) {
		return undefined;
	}

	if (!parsePattern(pattern)) {
		notificationService.warn(localize('structuralSearch.badPattern', "That pattern has a stray '$'. Write a placeholder as $name$, or $$ for a literal dollar."));
		return undefined;
	}

	const matches = findStructuralMatches(target.model.getValue(), pattern);
	if (matches.length === 0) {
		notificationService.info(localize('structuralSearch.noMatches', "No structural matches for '{0}' in this file.", pattern));
		return undefined;
	}

	return { pattern, matches };
}

interface IMatchPick extends IQuickPickItem {
	readonly match: IStructuralMatch;
}

registerAction2(class StructuralSearchAction extends Action2 {

	constructor() {
		super({
			id: SEARCH_COMMAND_ID,
			title: localize2('structuralSearch.find', "Structural Search..."),
			category: STRUCTURAL_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		const target = activeEditor(accessor);
		if (!target) {
			notificationService.info(localize('structuralSearch.noEditor', "Open a file first — structural search runs on the active editor."));
			return;
		}

		const found = await promptForMatches(accessor, target, localize('structuralSearch.searchPrompt', "Structural pattern to find"));
		if (!found) {
			return;
		}

		const picks: IMatchPick[] = found.matches.map(match => {
			const position = target.model.getPositionAt(match.start);
			return {
				match,
				label: target.model.getLineContent(position.lineNumber).trim(),
				description: localize('structuralSearch.atLine', "Line {0}", position.lineNumber),
				detail: Object.entries(match.bindings).map(([name, value]) => `$${name}$ = ${value}`).join('   '),
				iconClass: ThemeIcon.asClassName(Codicon.symbolNamespace),
			};
		});

		const picked = await quickInputService.pick(picks, {
			placeHolder: localize('structuralSearch.pickMatch', "{0} matches — select one to jump to it", found.matches.length),
			matchOnDetail: true,
		});

		if (picked) {
			const start = target.model.getPositionAt(picked.match.start);
			const end = target.model.getPositionAt(picked.match.end);
			target.editor.setSelection(Range.fromPositions(start, end));
			target.editor.revealRangeInCenterIfOutsideViewport(Range.fromPositions(start, end));
			target.editor.focus();
		}
	}
});

registerAction2(class StructuralReplaceAction extends Action2 {

	constructor() {
		super({
			id: REPLACE_COMMAND_ID,
			title: localize2('structuralSearch.replace', "Structural Replace..."),
			category: STRUCTURAL_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const dialogService = accessor.get(IDialogService);
		const notificationService = accessor.get(INotificationService);

		const target = activeEditor(accessor);
		if (!target) {
			notificationService.info(localize('structuralSearch.noEditor', "Open a file first — structural search runs on the active editor."));
			return;
		}

		const found = await promptForMatches(accessor, target, localize('structuralSearch.replacePrompt', "Structural pattern to replace"));
		if (!found) {
			return;
		}

		const names = placeholderNames(found.pattern);
		const template = await quickInputService.input({
			prompt: localize('structuralSearch.templatePrompt', "Replace each match with"),
			placeHolder: names.length > 0
				? localize('structuralSearch.available', "Available placeholders: {0}", names.map(name => `$${name}$`).join(', '))
				: localize('structuralSearch.noPlaceholders', "This pattern has no placeholders"),
		});

		if (template === undefined) {
			return;
		}

		// The first rewrite is shown in full, because a structural replace can
		// reshape more code than the pattern makes obvious.
		const first = found.matches[0];
		const { confirmed } = await dialogService.confirm({
			message: localize('structuralSearch.confirm', "Replace {0} matches in this file?", found.matches.length),
			detail: localize('structuralSearch.confirmDetail', "First match:\n{0}\n\nbecomes:\n{1}",
				target.model.getValue().slice(first.start, first.end),
				applyReplacement(template, first.bindings)),
			primaryButton: localize({ key: 'structuralSearch.replaceButton', comment: ['&& denotes a mnemonic'] }, "&&Replace All"),
		});

		if (!confirmed) {
			return;
		}

		// Applied in one edit so a single undo takes the whole rewrite back.
		const edits = found.matches.map(match => ({
			range: Range.fromPositions(target.model.getPositionAt(match.start), target.model.getPositionAt(match.end)),
			text: applyReplacement(template, match.bindings),
		}));

		target.editor.pushUndoStop();
		target.editor.executeEdits('structuralSearch', edits);
		target.editor.pushUndoStop();

		notificationService.info(localize('structuralSearch.replaced', "Replaced {0} matches.", found.matches.length));
	}
});
