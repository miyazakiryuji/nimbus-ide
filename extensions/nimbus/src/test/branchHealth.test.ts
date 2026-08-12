/**
 * ブランチの離れ具合（T-134 / T-219）の単体テスト。
 *
 * 「離れている」より「同じファイルを両側で触っている」ほうが危ない、という判断を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	assessDivergence,
	checkBranchName,
	overlappingFiles,
	parseAheadBehind,
	renderBranchHealth
} from '../core/branchHealth';

test('rev-list の出力を読む（左が behind・右が ahead）', () => {
	assert.deepStrictEqual(parseAheadBehind('12\t3\n'), { behind: 12, ahead: 3 });
});

test('読めない出力では 0 として扱う（数字をでっち上げない）', () => {
	assert.deepStrictEqual(parseAheadBehind('よく分からない'), { behind: 0, ahead: 0 });
});

test('両側で触られているファイルだけを、重複なく返す', () => {
	assert.deepStrictEqual(overlappingFiles(['a.ts', 'b.ts', 'a.ts'], ['b.ts', 'c.ts']), ['b.ts']);
});

test('同じファイルを触っていれば、離れ具合に関わらず危ない', () => {
	assert.strictEqual(assessDivergence({ ahead: 1, behind: 1, overlapping: ['a.ts'] }), 'risky');
});

test('離れているだけなら watch、近ければ ok', () => {
	assert.deepStrictEqual(
		[
			assessDivergence({ ahead: 1, behind: 30, overlapping: [] }),
			assessDivergence({ ahead: 1, behind: 2, overlapping: [] })
		],
		['watch', 'ok']
	);
});

test('ブランチ名の規則を判定する', () => {
	assert.deepStrictEqual(
		['nimbus', 'main', 'nimbus/claude-md', 'feature-x'].map((n) => checkBranchName(n)),
		[true, true, true, false]
	);
});

test('危ないときは、取り込む手順まで書く', () => {
	const text = renderBranchHealth('nimbus/x', 'main', { ahead: 2, behind: 5, overlapping: ['src/a.ts'] });
	assert.deepStrictEqual(
		['衝突しそうです', 'git pull --rebase', '`src/a.ts`'].map((s) => text.includes(s)),
		[true, true, true]
	);
});

test('規則に合わない名前のときだけ、その節を出す', () => {
	const bad = renderBranchHealth('feature-x', 'main', { ahead: 0, behind: 0, overlapping: [] });
	const good = renderBranchHealth('nimbus', 'main', { ahead: 0, behind: 0, overlapping: [] });
	assert.deepStrictEqual(
		[bad.includes('規則に合っていません'), good.includes('規則に合っていません')],
		[true, false]
	);
});
