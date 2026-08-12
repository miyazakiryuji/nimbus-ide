/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { matchesFuzzy } from '../../../../base/common/filters.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { basename, dirname } from '../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { URI } from '../../../../base/common/uri.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { SymbolKinds } from '../../../../editor/common/languages.js';
import { localize, localize2 } from '../../../../nls.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { Action2, isIMenuItem, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { getWorkspaceSymbols } from '../../../../workbench/contrib/search/common/search.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { ISearchService } from '../../../../workbench/services/search/common/search.js';
import { QueryBuilder } from '../../../../workbench/services/search/common/queryBuilder.js';
import { CATEGORY_LIMITS, evaluateArithmetic, formatNumber, includesCategory, parseQuery, SearchScope } from '../common/searchEverywhere.js';

const SEARCH_EVERYWHERE_COMMAND_ID = 'nimbus.searchEverywhere.open';

/**
 * How close together the two Shift presses have to be. Long enough to be
 * comfortable, short enough that two unrelated shifted words do not trigger it.
 */
const DOUBLE_SHIFT_WINDOW_MS = 400;

interface ISearchEverywhereItem extends IQuickPickItem {
	run(): Promise<void>;
}

type PickerEntry = ISearchEverywhereItem | IQuickPickSeparator;

function titleOf(title: string | ILocalizedString): string {
	return typeof title === 'string' ? title : title.value;
}

function collectActions(term: string, accessor: ServicesAccessor): PickerEntry[] {
	const contextKeyService = accessor.get(IContextKeyService);
	const commandService = accessor.get(ICommandService);

	const matches: ISearchEverywhereItem[] = [];

	for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
		if (!isIMenuItem(item) || !contextKeyService.contextMatchesRules(item.when)) {
			continue;
		}

		const category = item.command.category ? titleOf(item.command.category) : undefined;
		const label = titleOf(item.command.title);
		const searchable = category ? `${category}: ${label}` : label;

		if (term && !matchesFuzzy(term, searchable, true)) {
			continue;
		}

		const commandId = item.command.id;
		matches.push({
			label,
			description: category,
			alwaysShow: true,
			iconClass: ThemeIcon.asClassName(Codicon.symbolEvent),
			run: async () => {
				await commandService.executeCommand(commandId);
			},
		});

		if (matches.length >= CATEGORY_LIMITS.actions) {
			break;
		}
	}

	return matches.length === 0
		? []
		: [{ type: 'separator', label: localize('searchEverywhere.actions', "Actions") }, ...matches];
}

async function collectFiles(term: string, accessor: ServicesAccessor, token: CancellationToken): Promise<PickerEntry[]> {
	if (!term) {
		return [];
	}

	const contextService = accessor.get(IWorkspaceContextService);
	const searchService = accessor.get(ISearchService);
	const instantiationService = accessor.get(IInstantiationService);
	const editorService = accessor.get(IEditorService);
	const labelService = accessor.get(ILabelService);

	const folders = contextService.getWorkspace().folders;
	if (folders.length === 0) {
		return [];
	}

	const queryBuilder = instantiationService.createInstance(QueryBuilder);
	const query = queryBuilder.file(folders, {
		filePattern: term,
		maxResults: CATEGORY_LIMITS.files,
		sortByScore: true,
	});

	const complete = await searchService.fileSearch(query, token);
	if (complete.results.length === 0) {
		return [];
	}

	const matches: ISearchEverywhereItem[] = complete.results.map(match => {
		const resource: URI = match.resource;
		return {
			label: basename(resource),
			description: labelService.getUriLabel(dirname(resource), { relative: true }),
			alwaysShow: true,
			iconClass: ThemeIcon.asClassName(Codicon.file),
			run: async () => {
				await editorService.openEditor({ resource });
			},
		};
	});

	return [{ type: 'separator', label: localize('searchEverywhere.files', "Files") }, ...matches];
}

async function collectSymbols(term: string, accessor: ServicesAccessor, token: CancellationToken): Promise<PickerEntry[]> {
	if (!term) {
		return [];
	}

	const editorService = accessor.get(IEditorService);
	const labelService = accessor.get(ILabelService);

	const symbols = await getWorkspaceSymbols(term, token);
	if (symbols.length === 0) {
		return [];
	}

	const matches: ISearchEverywhereItem[] = symbols.slice(0, CATEGORY_LIMITS.symbols).map(entry => {
		const symbol = entry.symbol;
		const resource = symbol.location.uri;
		const range: IRange | undefined = symbol.location.range;

		return {
			label: symbol.name,
			description: symbol.containerName || labelService.getUriLabel(resource, { relative: true }),
			alwaysShow: true,
			iconClass: ThemeIcon.asClassName(SymbolKinds.toIcon(symbol.kind)),
			run: async () => {
				await editorService.openEditor({ resource, options: range ? { selection: range } : undefined });
			},
		};
	});

	return [{ type: 'separator', label: localize('searchEverywhere.symbols', "Symbols") }, ...matches];
}

function collectCalculator(rawTerm: string, accessor: ServicesAccessor): PickerEntry[] {
	const value = evaluateArithmetic(rawTerm);
	if (value === undefined) {
		return [];
	}

	const clipboardService = accessor.get(IClipboardService);
	const formatted = formatNumber(value);

	return [
		{ type: 'separator', label: localize('searchEverywhere.calculator', "Calculator") },
		{
			label: formatted,
			description: rawTerm,
			detail: localize('searchEverywhere.copyResult', "Press Enter to copy the result"),
			alwaysShow: true,
			iconClass: ThemeIcon.asClassName(Codicon.symbolOperator),
			run: async () => {
				await clipboardService.writeText(formatted);
			},
		},
	];
}

async function collectEntries(input: string, accessor: ServicesAccessor, token: CancellationToken): Promise<PickerEntry[]> {
	const { scope, term } = parseQuery(input);

	const entries: PickerEntry[] = [];

	if (scope === SearchScope.All) {
		entries.push(...collectCalculator(term, accessor));
	}

	if (includesCategory(scope, SearchScope.Actions)) {
		entries.push(...collectActions(term, accessor));
	}

	const [files, symbols] = await Promise.all([
		includesCategory(scope, SearchScope.Files) ? collectFiles(term, accessor, token) : Promise.resolve([]),
		includesCategory(scope, SearchScope.Symbols) ? collectSymbols(term, accessor, token) : Promise.resolve([]),
	]);

	entries.push(...files, ...symbols);

	return entries;
}

async function showSearchEverywhere(accessor: ServicesAccessor): Promise<void> {
	const quickInputService = accessor.get(IQuickInputService);

	const store = new DisposableStore();
	const picker = store.add(quickInputService.createQuickPick<ISearchEverywhereItem>({ useSeparators: true }));

	picker.placeholder = localize('searchEverywhere.placeholder', "Search actions, files, and symbols — '>' for actions, '#' for symbols, or type a sum");
	// Every source filters its own results, so the picker must not filter again.
	picker.matchOnLabel = false;
	picker.matchOnDescription = false;
	picker.matchOnDetail = false;

	let generation = 0;
	const queries = store.add(new DisposableStore());

	const refresh = async () => {
		const current = ++generation;
		queries.clear();

		const source = new CancellationTokenSource();
		queries.add(source);

		picker.busy = true;
		try {
			const entries = await collectEntries(picker.value, accessor, source.token);
			if (current === generation) {
				picker.items = entries;
			}
		} catch {
			if (current === generation) {
				picker.items = [];
			}
		} finally {
			if (current === generation) {
				picker.busy = false;
			}
		}
	};

	store.add(picker.onDidChangeValue(() => refresh()));
	store.add(picker.onDidAccept(async () => {
		const selected = picker.selectedItems[0];
		picker.hide();
		await selected?.run();
	}));
	store.add(picker.onDidHide(() => store.dispose()));

	picker.show();
	await refresh();
}

registerAction2(class SearchEverywhereAction extends Action2 {

	constructor() {
		super({
			id: SEARCH_EVERYWHERE_COMMAND_ID,
			title: localize2('searchEverywhere.open', "Search Everywhere"),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyO,
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await showSearchEverywhere(accessor);
	}
});

/**
 * IntelliJ IDEA opens Search Everywhere on a double Shift. The keybinding
 * system has no notion of a double tap, so the sequence is detected here:
 * two Shift releases inside the window, with no other key pressed between
 * them — that last part is what keeps typing two capitalised words from
 * opening the picker.
 */
class DoubleShiftActivation extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'nimbus.searchEverywhere.doubleShift';

	private lastShiftUp = 0;

	constructor(
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();

		this._register(addDisposableListener(mainWindow, EventType.KEY_DOWN, event => {
			if (event.key !== 'Shift') {
				this.lastShiftUp = 0;
			}
		}, true));

		this._register(addDisposableListener(mainWindow, EventType.KEY_UP, event => {
			if (event.key !== 'Shift') {
				return;
			}

			const now = Date.now();
			if (this.lastShiftUp !== 0 && now - this.lastShiftUp <= DOUBLE_SHIFT_WINDOW_MS) {
				this.lastShiftUp = 0;
				this.commandService.executeCommand(SEARCH_EVERYWHERE_COMMAND_ID);
				return;
			}

			this.lastShiftUp = now;
		}, true));
	}
}

registerWorkbenchContribution2(DoubleShiftActivation.ID, DoubleShiftActivation, WorkbenchPhase.AfterRestored);
