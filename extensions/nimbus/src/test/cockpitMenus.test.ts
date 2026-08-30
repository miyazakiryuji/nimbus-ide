/**
 * コックピットから使う操作に、**押せる場所があるか**（T-294）。
 *
 * コマンドを足しても入口を作らないと、その機能は**コマンド名を知っている人にしか存在しない**。
 * 実際に同じ原因の報告が続けて 4 件出た — 新しいセッション（T-290）/ 右半分（T-292）/
 * セッション一覧（T-293）/ 全画面とタブで開く（T-289）。どれも「実装したのに無い」に見えていた。
 *
 * 読むのは `extensions/nimbus/package.json`。テストはリポジトリの根から走る。
 */
import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { test } from 'node:test';

interface MenuEntry {
	command: string;
	when?: string;
	group?: string;
}

function manifest(): {
	commands: { command: string; icon?: string }[];
	menus: Record<string, MenuEntry[]>;
} {
	const parsed = JSON.parse(
		readFileSync(join(process.cwd(), 'extensions', 'nimbus', 'package.json'), 'utf8')
	);
	return { commands: parsed.contributes.commands, menus: parsed.contributes.menus };
}

/** その面のタイトルに出ているコマンド */
function titleCommands(menu: MenuEntry[] | undefined, when: string): string[] {
	return (menu ?? []).filter((entry) => entry.when === when).map((entry) => entry.command);
}

test('コックピットの面から、主な操作がすべて押せる（T-294）', () => {
	const { menus } = manifest();
	assert.deepStrictEqual(titleCommands(menus['view/title'], 'view == nimbus.cockpit'), [
		// 並びは使う頻度の順。上 3 つはアイコンとして、下 2 つは `...` に入る
		'nimbus.newSession',
		'nimbus.showSessions',
		// 一覧（Home）— ≡ を廃止した分の入口（T-345）。webview から面のタイトルへ移した
		'nimbus.openHome',
		'nimbus.fullscreenCockpit',
		// 待ち時間コンパス（T-336）。開いた先の頭に判定が出る
		'nimbus.openRhythm',
		'nimbus.showSessionSide',
		'nimbus.openCockpitTab',
		// 取り込みと押し上げ（T-306）。使う頻度が低めなので `...` の後ろ
		'nimbus.syncBranch',
		// セッションを横に並べる（T-320）
		'nimbus.openSessionBeside'
	]);
});

test('全画面（エディタタブ）でも同じ操作が押せる（T-290 / T-292 / T-293）', () => {
	const { menus } = manifest();
	// 全画面ではサイドバーごと畳むので、`view/title` は消える。
	// ここに置かないと、全画面にした瞬間に**入口がゼロになる**
	assert.deepStrictEqual(
		titleCommands(menus['editor/title'], 'activeWebviewPanelId == nimbus.cockpitTab'),
		[
			'nimbus.newSession',
			'nimbus.showSessions',
			// 全画面はサイドバーを畳むので、ここに無いと Home の入口がゼロになる（T-345）
			'nimbus.openHome',
			'nimbus.showSessionSide',
			'nimbus.fullscreenCockpit',
			'nimbus.openRhythm'
		]
	);
});

test('タイトルに置いたコマンドには必ずアイコンがある（T-294）', () => {
	const { commands, menus } = manifest();
	const icons = new Map(commands.map((entry) => [entry.command, entry.icon]));
	const placed = [...(menus['view/title'] ?? []), ...(menus['editor/title'] ?? [])];
	// アイコンが無いままタイトルに置くと、VS Code は歯抜けのまま並べる。
	// 「押す場所が無い」の裏返しで、「押す場所はあるが何のボタンか分からない」になる
	assert.deepStrictEqual(
		placed.filter((entry) => !icons.get(entry.command)).map((entry) => entry.command),
		[]
	);
});
