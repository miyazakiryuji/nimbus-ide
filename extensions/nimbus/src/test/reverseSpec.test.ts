/**
 * 仕様の逆生成。
 *
 * 丸投げすると**それらしい嘘**が出る。事実と推測を分けさせる一文が入っているかを固定する。
 *
 * 守っている修正（T-274）: T-080
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildReverseSpecPrompt, specPathFor } from '../core/reverseSpec';

test('置き場所は既存の仕様書に合わせ、名前は kebab-case にする', () => {
	assert.deepStrictEqual(
		['src/core/repoSummary.ts', 'lib/main.dart', 'a/b/SomeThing.kt'].map(specPathFor),
		['nimbus/docs/specs/repo-summary.md', 'nimbus/docs/specs/main.md', 'nimbus/docs/specs/some-thing.md']
	);
});

test('新規のときは「起こす」、既存のときは「直す」と頼む', () => {
	const base = { file: 'src/a.ts', outline: '', specPath: 'nimbus/docs/specs/a.md' };
	assert.ok(buildReverseSpecPrompt({ ...base, exists: false }).startsWith('src/a.ts から仕様書を起こして'));
	const update = buildReverseSpecPrompt({ ...base, exists: true });
	assert.ok(update.startsWith('src/a.ts の仕様書 nimbus/docs/specs/a.md を、いまのコードに合わせて直して'));
	assert.ok(update.includes('**既にある記述を消さない。**'), update);
});

test('事実と推測を分けさせる一文を必ず入れる', () => {
	const prompt = buildReverseSpecPrompt({
		file: 'src/a.ts',
		outline: '- Class Foo  (1–10)',
		specPath: 'nimbus/docs/specs/a.md',
		exists: false
	});
	assert.ok(prompt.includes('**コードから読み取れる事実だけ**'), prompt);
	assert.ok(prompt.includes('**「理由は記録されていない」**'), prompt);
	assert.ok(prompt.includes('**「推測:」と明記**'), prompt);
	assert.ok(prompt.includes('- Class Foo  (1–10)'), prompt);
	assert.ok(prompt.includes('## 決めたこと'), prompt);
});

test('アウトラインが無ければ、その節ごと出さない', () => {
	const prompt = buildReverseSpecPrompt({
		file: 'src/a.ts',
		outline: '   ',
		specPath: 'nimbus/docs/specs/a.md',
		exists: false
	});
	assert.ok(!prompt.includes('構造（言語サーバーのアウトライン）'), prompt);
});
