/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../editor/browser/editorExtensions.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { Range } from '../../../../editor/common/core/range.js';
import { IEditorContribution, IEditorDecorationsCollection } from '../../../../editor/common/editorCommon.js';
import { IModelDeltaDecoration, TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { ModelDecorationOptions } from '../../../../editor/common/model/textModel.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { IBookmark, IBookmarksService, isValidMnemonic, MNEMONICS, nextFreeMnemonic, sortBookmarks } from '../common/bookmarks.js';
import { BookmarksService } from './bookmarksService.js';

import './media/bookmarks.css';

registerSingleton(IBookmarksService, BookmarksService, InstantiationType.Delayed);

const BOOKMARK_CATEGORY = localize2('bookmarks.category', "Bookmark");

const TOGGLE_COMMAND_ID = 'nimbus.bookmarks.toggle';
const TOGGLE_WITH_MNEMONIC_COMMAND_ID = 'nimbus.bookmarks.toggleWithMnemonic';
const GO_TO_COMMAND_ID = 'nimbus.bookmarks.goTo';
const GO_TO_MNEMONIC_COMMAND_ID = 'nimbus.bookmarks.goToMnemonic';
const CLEAR_ALL_COMMAND_ID = 'nimbus.bookmarks.clearAll';

interface IEditorLocation {
	readonly resource: URI;
	readonly line: number;
	readonly preview: string;
}

/**
 * Where a bookmark command should act: the focused editor's cursor line.
 * Returns `undefined` when there is no text editor to act on.
 */
function currentLocation(accessor: ServicesAccessor): IEditorLocation | undefined {
	const editor = accessor.get(ICodeEditorService).getFocusedCodeEditor()
		?? accessor.get(ICodeEditorService).getActiveCodeEditor();

	const model = editor?.getModel();
	const position = editor?.getPosition();

	if (!model || !position) {
		return undefined;
	}

	return {
		resource: model.uri,
		line: position.lineNumber,
		preview: model.getLineContent(position.lineNumber).trim(),
	};
}

// ── gutter marks ──────────────────────────────────────────────────────────

const PLAIN_DECORATION = ModelDecorationOptions.register({
	description: 'nimbus-bookmark',
	glyphMarginClassName: 'nimbus-bookmark',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
});

const MNEMONIC_DECORATIONS = new Map<string, ModelDecorationOptions>(
	MNEMONICS.map(mnemonic => [
		mnemonic,
		ModelDecorationOptions.register({
			description: `nimbus-bookmark-${mnemonic}`,
			glyphMarginClassName: `nimbus-bookmark nimbus-bookmark-${mnemonic}`,
			stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		}),
	]),
);

/**
 * Paints the gutter for whichever file an editor is showing. Registered per
 * editor so split views and diff panes each keep their own marks.
 */
class BookmarkGutter extends Disposable implements IEditorContribution {

	static readonly ID = 'nimbus.bookmarks.gutter';

	private readonly decorations: IEditorDecorationsCollection;

	constructor(
		private readonly editor: ICodeEditor,
		@IBookmarksService private readonly bookmarksService: IBookmarksService,
	) {
		super();

		this.decorations = this.editor.createDecorationsCollection();

		this._register(this.bookmarksService.onDidChange(() => this.update()));
		this._register(this.editor.onDidChangeModel(() => this.update()));

		this.update();
	}

	private update(): void {
		const model = this.editor.getModel();
		if (!model) {
			this.decorations.clear();
			return;
		}

		const lineCount = model.getLineCount();
		const decorations: IModelDeltaDecoration[] = [];

		for (const bookmark of this.bookmarksService.forResource(model.uri)) {
			if (bookmark.line > lineCount) {
				continue;
			}

			decorations.push({
				range: new Range(bookmark.line, 1, bookmark.line, 1),
				options: (bookmark.mnemonic && MNEMONIC_DECORATIONS.get(bookmark.mnemonic)) || PLAIN_DECORATION,
			});
		}

		this.decorations.set(decorations);
	}

	override dispose(): void {
		this.decorations.clear();
		super.dispose();
	}
}

registerEditorContribution(BookmarkGutter.ID, BookmarkGutter, EditorContributionInstantiation.AfterFirstRender);

// ── picking and jumping ───────────────────────────────────────────────────

interface IBookmarkPick extends IQuickPickItem {
	readonly bookmark: IBookmark;
}

function toBookmarkPicks(bookmarks: readonly IBookmark[], labelService: ILabelService): IBookmarkPick[] {
	return sortBookmarks(bookmarks).map(bookmark => ({
		bookmark,
		label: bookmark.mnemonic ? `[${bookmark.mnemonic}] ${bookmark.preview}` : bookmark.preview,
		description: `${labelService.getUriLabel(URI.parse(bookmark.uri), { relative: true })}:${bookmark.line}`,
	}));
}

async function reveal(accessor: ServicesAccessor, bookmark: IBookmark): Promise<void> {
	await accessor.get(IEditorService).openEditor({
		resource: URI.parse(bookmark.uri),
		options: { selection: new Range(bookmark.line, 1, bookmark.line, 1) },
	});
}

// ── commands ──────────────────────────────────────────────────────────────

registerAction2(class ToggleBookmarkAction extends Action2 {

	constructor() {
		super({
			id: TOGGLE_COMMAND_ID,
			title: localize2('bookmarks.toggle', "Toggle Bookmark"),
			category: BOOKMARK_CATEGORY,
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.KeyB,
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const location = currentLocation(accessor);
		if (location) {
			accessor.get(IBookmarksService).toggle(location.resource, location.line, location.preview);
		}
	}
});

registerAction2(class ToggleBookmarkWithMnemonicAction extends Action2 {

	constructor() {
		super({
			id: TOGGLE_WITH_MNEMONIC_COMMAND_ID,
			title: localize2('bookmarks.toggleWithMnemonic', "Toggle Bookmark with Mnemonic..."),
			category: BOOKMARK_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const bookmarksService = accessor.get(IBookmarksService);
		const quickInputService = accessor.get(IQuickInputService);

		const location = currentLocation(accessor);
		if (!location) {
			return;
		}

		const suggested = nextFreeMnemonic(bookmarksService.list());
		const taken = new Map(bookmarksService.list()
			.filter(bookmark => bookmark.mnemonic)
			.map(bookmark => [bookmark.mnemonic as string, bookmark]));

		const picked = await quickInputService.pick(MNEMONICS.map(mnemonic => {
			const holder = taken.get(mnemonic);
			return {
				label: mnemonic,
				description: holder
					? localize('bookmarks.mnemonicTaken', "In use — {0}:{1}", holder.preview, holder.line)
					: mnemonic === suggested ? localize('bookmarks.mnemonicSuggested', "Free (suggested)") : localize('bookmarks.mnemonicFree', "Free"),
			};
		}), {
			placeHolder: localize('bookmarks.pickMnemonic', "Pick a key for this bookmark — reusing one moves it here"),
		});

		if (picked) {
			bookmarksService.setMnemonic(location.resource, location.line, location.preview, picked.label);
		}
	}
});

registerAction2(class GoToBookmarkAction extends Action2 {

	constructor() {
		super({
			id: GO_TO_COMMAND_ID,
			title: localize2('bookmarks.goTo', "Go to Bookmark..."),
			category: BOOKMARK_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const bookmarksService = accessor.get(IBookmarksService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const labelService = accessor.get(ILabelService);

		const bookmarks = bookmarksService.list();
		if (bookmarks.length === 0) {
			notificationService.info(localize('bookmarks.none', "No bookmarks yet. Run \"Bookmark: Toggle Bookmark\" on a line to add one."));
			return;
		}

		const picked = await quickInputService.pick(toBookmarkPicks(bookmarks, labelService), {
			placeHolder: localize('bookmarks.pickToOpen', "Select a bookmark"),
			matchOnDescription: true,
		});

		if (picked) {
			await reveal(accessor, picked.bookmark);
		}
	}
});

registerAction2(class GoToMnemonicAction extends Action2 {

	constructor() {
		super({
			id: GO_TO_MNEMONIC_COMMAND_ID,
			title: localize2('bookmarks.goToMnemonic', "Go to Bookmark by Mnemonic"),
			category: BOOKMARK_CATEGORY,
			f1: true,
		});
	}

	/**
	 * Takes the mnemonic as an argument so a keybinding can carry it, which is
	 * how a single key ends up jumping to one bookmark:
	 * `{ "key": "ctrl+1", "command": "nimbus.bookmarks.goToMnemonic", "args": "1" }`
	 */
	async run(accessor: ServicesAccessor, mnemonic?: string): Promise<void> {
		const bookmarksService = accessor.get(IBookmarksService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);

		let key = mnemonic;

		if (key === undefined) {
			const picked = await quickInputService.pick(
				MNEMONICS.filter(candidate => bookmarksService.find(candidate)).map(candidate => {
					const bookmark = bookmarksService.find(candidate);
					return { label: candidate, description: bookmark?.preview };
				}),
				{ placeHolder: localize('bookmarks.pickMnemonicToOpen', "Select a mnemonic") },
			);
			key = picked?.label;
		}

		if (key === undefined) {
			return;
		}

		if (!isValidMnemonic(key)) {
			notificationService.warn(localize('bookmarks.invalidMnemonic', "'{0}' is not a bookmark key. Use 0-9 or A-Z.", key));
			return;
		}

		const bookmark = bookmarksService.find(key);
		if (!bookmark) {
			notificationService.info(localize('bookmarks.mnemonicUnused', "No bookmark is assigned to '{0}'.", key.toUpperCase()));
			return;
		}

		await reveal(accessor, bookmark);
	}
});

registerAction2(class ClearBookmarksAction extends Action2 {

	constructor() {
		super({
			id: CLEAR_ALL_COMMAND_ID,
			title: localize2('bookmarks.clearAll', "Clear All Bookmarks"),
			category: BOOKMARK_CATEGORY,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const bookmarksService = accessor.get(IBookmarksService);
		const dialogService = accessor.get(IDialogService);

		const count = bookmarksService.list().length;
		if (count === 0) {
			return;
		}

		const { confirmed } = await dialogService.confirm({
			message: localize('bookmarks.confirmClear', "Remove all {0} bookmarks?", count),
			detail: localize('bookmarks.confirmClearDetail', "Bookmarks are removed permanently and cannot be restored."),
			primaryButton: localize({ key: 'bookmarks.clearButton', comment: ['&& denotes a mnemonic'] }, "&&Remove All"),
			type: 'warning',
		});

		if (confirmed) {
			bookmarksService.clearAll();
		}
	}
});
