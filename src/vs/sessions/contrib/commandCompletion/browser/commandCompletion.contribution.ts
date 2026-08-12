/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { matchesFuzzy } from '../../../../base/common/filters.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Position } from '../../../../editor/common/core/position.js';
import { Range } from '../../../../editor/common/core/range.js';
import { CompletionContext, CompletionItem, CompletionItemKind, CompletionItemProvider, CompletionList } from '../../../../editor/common/languages.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { COMMAND_LIMIT, findCommandTrigger } from '../common/commandCompletion.js';

function titleOf(title: string | ILocalizedString): string {
	return typeof title === 'string' ? title : title.value;
}

interface ICandidate {
	readonly commandId: string;
	readonly label: string;
	readonly category?: string;
}

/**
 * Offers IDE actions from the editor after a dot, the way IntelliJ IDEA's
 * command completion does — so a command can be reached without knowing its
 * shortcut, without leaving the keyboard, and without losing the caret.
 */
class CommandCompletionProvider implements CompletionItemProvider {

	readonly _debugDisplayName = 'nimbusCommandCompletion';

	readonly triggerCharacters = ['.'];

	constructor(
		private readonly contextKeyService: IContextKeyService,
	) { }

	/**
	 * With nothing typed after the dot, the editor context menu is the answer:
	 * VS Code already curates it as "what applies to the code under the caret".
	 * Once the user types, the whole command palette opens up, because they are
	 * now naming something specific.
	 */
	private candidates(query: string): ICandidate[] {
		const menu = query ? MenuId.CommandPalette : MenuId.EditorContext;
		const seen = new Set<string>();
		const result: ICandidate[] = [];

		for (const item of MenuRegistry.getMenuItems(menu)) {
			if (!isIMenuItem(item) || !this.contextKeyService.contextMatchesRules(item.when)) {
				continue;
			}

			const commandId = item.command.id;
			if (seen.has(commandId)) {
				continue;
			}

			const label = titleOf(item.command.title);
			const category = item.command.category ? titleOf(item.command.category) : undefined;

			if (query && !matchesFuzzy(query, category ? `${category}: ${label}` : label, true)) {
				continue;
			}

			seen.add(commandId);
			result.push({ commandId, label, category });

			if (result.length >= COMMAND_LIMIT) {
				break;
			}
		}

		return result;
	}

	provideCompletionItems(model: ITextModel, position: Position, _context: CompletionContext, _token: CancellationToken): CompletionList | undefined {
		const trigger = findCommandTrigger(model.getLineContent(position.lineNumber), position.column);
		if (!trigger) {
			return undefined;
		}

		// Accepting an item must leave the text exactly as it was before the dot,
		// so the replaced range covers the dot and everything typed after it and
		// the inserted text is empty. The action then runs through `command`.
		const range = new Range(position.lineNumber, trigger.dotColumn, position.lineNumber, position.column);

		const suggestions: CompletionItem[] = this.candidates(trigger.query).map((candidate, index) => ({
			label: candidate.label,
			detail: candidate.category,
			kind: CompletionItemKind.Event,
			insertText: '',
			range,
			filterText: `.${candidate.category ? `${candidate.category} ` : ''}${candidate.label}`,
			sortText: String(index).padStart(3, '0'),
			command: { id: candidate.commandId, title: candidate.label },
		}));

		if (suggestions.length === 0) {
			return undefined;
		}

		return { suggestions, incomplete: true };
	}
}

class CommandCompletionContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'nimbus.commandCompletion';

	constructor(
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		this._register(languageFeaturesService.completionProvider.register(
			{ scheme: '*', hasAccessToAllModels: true },
			new CommandCompletionProvider(contextKeyService),
		));
	}
}

registerWorkbenchContribution2(CommandCompletionContribution.ID, CommandCompletionContribution, WorkbenchPhase.AfterRestored);
