/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { fromNow } from '../../../../base/common/date.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize, localize2 } from '../../../../nls.js';
import { ILocalizedString } from '../../../../platform/action/common/action.js';
import { Action2, isIMenuItem, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { GUIDE_LIMIT, IFeature, parseStats, rankByUsage, recordUsage, stringifyStats, totalInvocations, unusedShortcuts, USAGE_STORAGE_KEY, UsageStats } from '../common/productivityGuide.js';

const SHOW_COMMAND_ID = 'nimbus.productivityGuide.show';

/**
 * Counts are written on a timer rather than on every command, so tracking never
 * turns a keystroke into a disk write.
 */
const SAVE_DELAY_MS = 5000;

const IUsageTracker = createDecorator<IUsageTracker>('nimbusUsageTracker');

interface IUsageTracker {
	readonly _serviceBrand: undefined;
	readonly stats: UsageStats;
}

class UsageTracker extends Disposable implements IUsageTracker, IWorkbenchContribution {

	static readonly ID = 'nimbus.productivityGuide.tracker';

	declare readonly _serviceBrand: undefined;

	private current: UsageStats;
	private dirty = false;

	private readonly saveScheduler: RunOnceScheduler;

	constructor(
		@ICommandService commandService: ICommandService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		this.current = parseStats(this.storageService.get(USAGE_STORAGE_KEY, StorageScope.PROFILE));

		this.saveScheduler = this._register(new RunOnceScheduler(() => this.flush(), SAVE_DELAY_MS));

		this._register(commandService.onDidExecuteCommand(event => {
			const updated = recordUsage(this.current, event.commandId, Date.now());
			if (updated !== this.current) {
				this.current = updated;
				this.dirty = true;
				if (!this.saveScheduler.isScheduled()) {
					this.saveScheduler.schedule();
				}
			}
		}));

		// A window that closes between ticks must not lose the counts.
		this._register(this.storageService.onWillSaveState(() => this.flush()));
	}

	get stats(): UsageStats {
		return this.current;
	}

	private flush(): void {
		if (!this.dirty) {
			return;
		}

		this.dirty = false;
		this.storageService.store(USAGE_STORAGE_KEY, stringifyStats(this.current), StorageScope.PROFILE, StorageTarget.USER);
	}

	override dispose(): void {
		this.flush();
		super.dispose();
	}
}

registerSingleton(IUsageTracker, UsageTracker, InstantiationType.Eager);
registerWorkbenchContribution2(UsageTracker.ID, UsageTracker, WorkbenchPhase.AfterRestored);

function titleOf(title: string | ILocalizedString): string {
	return typeof title === 'string' ? title : title.value;
}

/**
 * Everything reachable from the command palette right now, with the key that
 * reaches it. This is the population the guide measures against.
 */
function collectFeatures(accessor: ServicesAccessor): IFeature[] {
	const contextKeyService = accessor.get(IContextKeyService);
	const keybindingService = accessor.get(IKeybindingService);

	const seen = new Set<string>();
	const features: IFeature[] = [];

	for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
		if (!isIMenuItem(item) || !contextKeyService.contextMatchesRules(item.when)) {
			continue;
		}

		const commandId = item.command.id;
		if (seen.has(commandId)) {
			continue;
		}
		seen.add(commandId);

		const category = item.command.category ? titleOf(item.command.category) : undefined;
		const label = titleOf(item.command.title);

		features.push({
			commandId,
			label: category ? `${category}: ${label}` : label,
			keybinding: keybindingService.lookupKeybinding(commandId)?.getLabel() ?? undefined,
		});
	}

	return features;
}

registerAction2(class ShowProductivityGuideAction extends Action2 {

	constructor() {
		super({
			id: SHOW_COMMAND_ID,
			title: localize2('productivityGuide.show', "Show Productivity Guide"),
			category: localize2('productivityGuide.category', "Help"),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const commandService = accessor.get(ICommandService);
		const stats = accessor.get(IUsageTracker).stats;

		const features = collectFeatures(accessor);
		const used = rankByUsage(stats, features);
		const unused = unusedShortcuts(stats, features);

		const entries: (IQuickPickItem & { commandId?: string } | IQuickPickSeparator)[] = [];

		entries.push({
			type: 'separator',
			label: localize('productivityGuide.mostUsed', "Most used — {0} commands run in total", totalInvocations(stats)),
		});

		if (used.length === 0) {
			entries.push({
				label: localize('productivityGuide.nothingYet', "Nothing recorded yet"),
				detail: localize('productivityGuide.nothingYetDetail', "Counts start from the next command you run."),
			});
		} else {
			for (const feature of used) {
				entries.push({
					commandId: feature.commandId,
					label: feature.label,
					description: feature.keybinding,
					detail: localize('productivityGuide.usage', "{0} times · last {1}", feature.count, fromNow(feature.last, true)),
					iconClass: ThemeIcon.asClassName(Codicon.flame),
				});
			}
		}

		if (unused.length > 0) {
			entries.push({
				type: 'separator',
				label: localize('productivityGuide.unused', "Shortcuts you have not used ({0})", unused.length === GUIDE_LIMIT ? `${GUIDE_LIMIT}+` : unused.length),
			});

			for (const feature of unused) {
				entries.push({
					commandId: feature.commandId,
					label: feature.label,
					description: feature.keybinding,
					iconClass: ThemeIcon.asClassName(Codicon.lightbulb),
				});
			}
		}

		const picked = await quickInputService.pick(entries, {
			placeHolder: localize('productivityGuide.placeholder', "Pick a command to run it now"),
			matchOnDescription: true,
			matchOnDetail: true,
		});

		if (picked?.commandId) {
			await commandService.executeCommand(picked.commandId);
		}
	}
});
