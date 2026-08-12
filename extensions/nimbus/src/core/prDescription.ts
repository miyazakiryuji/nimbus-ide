/**
 * PR の説明文を組み立てる（tasks.md T-220）。
 *
 * レビューする側がまず知りたいのは「何のための変更か」「どこを見ればいいか」「確かめたか」の 3 つ。
 * コミットと差分から**そこまでは機械で埋められる**ので、埋めた状態から書き始められるようにする。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { GroupedChange } from './releaseNotes';
import type { ChangeStats } from './changeStats';

const GROUP_TITLE: Record<GroupedChange['group'], string> = {
	feature: '足したもの',
	fix: '直したもの',
	docs: 'ドキュメント',
	other: 'そのほか'
};

const GROUP_ORDER: GroupedChange['group'][] = ['feature', 'fix', 'docs', 'other'];

/**
 * 見出しを決める。
 * コミットが 1 つならその件名、複数ならタスク ID をまとめる。
 * **決められないときは空にして人に書かせる**（それらしい題を捏造しない）。
 */
export function suggestTitle(changes: readonly GroupedChange[]): string {
	if (changes.length === 0) {
		return '';
	}
	if (changes.length === 1) {
		return changes[0].subject;
	}
	const ids = [...new Set(changes.flatMap((change) => change.taskIds))];
	return ids.length > 0 ? `${ids.join(' / ')} をまとめて` : '';
}

export interface PrInput {
	branch: string;
	base: string;
	changes: readonly GroupedChange[];
	stats: ChangeStats;
	/** テストの実行結果（分かるときだけ） */
	testSummary?: string;
}

export function renderPrDescription({ branch, base, changes, stats, testSummary }: PrInput): string {
	const title = suggestTitle(changes);
	const lines = [
		title ? `# ${title}` : '# （題を書いてください）',
		'',
		`\`${branch}\` → \`${base}\``,
		'',
		'## 何のための変更か',
		'',
		'<!-- レビューする人がまず知りたいところ。ここだけは機械では埋められません -->',
		''
	];

	if (changes.length > 0) {
		lines.push('## 入っているもの', '');
		for (const group of GROUP_ORDER) {
			const rows = changes.filter((change) => change.group === group);
			if (rows.length === 0) {
				continue;
			}
			lines.push(`**${GROUP_TITLE[group]}**`, '');
			for (const row of rows) {
				lines.push(`- ${row.subject}`);
			}
			lines.push('');
		}
	}

	lines.push(
		'## どこを見ればいいか',
		'',
		`触ったファイル ${stats.files.length} 件（+${stats.added} / -${stats.removed}）。変更の大きい順:`,
		''
	);
	for (const file of stats.files.slice(0, 10)) {
		lines.push(`- \`${file.path}\` +${file.added} / -${file.removed}${file.isTest ? ' 〈テスト〉' : ''}`);
	}
	if (stats.files.length > 10) {
		lines.push(`- …ほか ${stats.files.length - 10} 件`);
	}
	lines.push('');

	lines.push('## 確かめたこと', '');
	if (testSummary) {
		lines.push(`- ${testSummary}`);
	} else {
		lines.push('- <!-- 何をどう確かめたか。テストの結果や、画面で見た内容 -->');
	}
	if (stats.noTestChanges) {
		lines.push('', '⚠️ **テストが伴っていません。** 書けない事情があるなら、その理由をここに書いてください。');
	}
	lines.push('');

	return lines.join('\n');
}
