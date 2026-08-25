/**
 * CLAUDE.md のテンプレート（T-319）。
 *
 * 崩れると困るのは「**数えた事実で埋める**（推測を書き込まない）」の側 —
 * 取れた事実は入り、取れなかったものは TODO か「節ごと無し」になること。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	renderCustomTemplate,
	renderTemplate,
	suggestTemplate,
	templateChoices
} from '../core/claudeMdTemplates';

test('最小テンプレートは 3 見出し＋数えた事実（T-319）', () => {
	const body = renderTemplate('minimal', {
		projectName: 'demo',
		conventions: 'インデント: タブ / 引用符: シングル',
		runCommands: ['npm run test', 'npm run build']
	});
	assert.deepStrictEqual(
		[
			body.startsWith('# demo'),
			body.includes('## 何をするプロジェクトか'),
			body.includes('## 触ってよい場所'),
			body.includes('## 走らせ方'),
			body.includes('- `npm run test`'),
			body.includes('インデント: タブ'),
			// 取れた事実の節に TODO は出ない
			body.includes('走らせ方\n\n<!-- TODO')
		],
		[true, true, true, true, true, true, false]
	);
});

test('取れなかった事実は TODO か「節ごと無し」（推測を書き込まない）（T-319）', () => {
	const body = renderTemplate('minimal', { projectName: 'demo' });
	assert.deepStrictEqual(
		[body.includes('<!-- TODO: ビルド・テスト・起動のコマンド'), body.includes('書き方（数えた事実）')],
		[true, false]
	);
});

test('pubspec が居たら Flutter を勧める（外れても 1 押し増えるだけ）（T-319）', () => {
	assert.deepStrictEqual(
		[suggestTemplate({ projectName: 'x', flutter: true }), suggestTemplate({ projectName: 'x' })],
		['flutter', 'minimal']
	);
});

test('並行開発テンプレートには Nimbus 自身の作法が入る（T-319）', () => {
	const body = renderTemplate('parallel', { projectName: 'demo' });
	assert.deepStrictEqual(
		[body.includes('git add -A` を使わない'), body.includes('pull --rebase'), body.includes('回帰テスト')],
		[true, true, true]
	);
});

test('自分のテンプレートは {{project}} と {{conventions}} だけ差し込む（T-319）', () => {
	assert.strictEqual(
		renderCustomTemplate('# {{project}}\n{{conventions}}\nその他 {{unknown}}', {
			projectName: 'demo',
			conventions: '事実'
		}),
		'# demo\n事実\nその他 {{unknown}}'
	);
	// conventions が無ければ空文字（プレースホルダを残さない）
	assert.strictEqual(renderCustomTemplate('a{{conventions}}b', { projectName: 'x' }), 'ab');
});

test('テンプレートは 5 種で、それぞれ説明を持つ（T-319）', () => {
	assert.deepStrictEqual(
		templateChoices().map((choice) => choice.id),
		['minimal', 'app', 'parallel', 'flutter', 'library']
	);
	assert.ok(templateChoices().every((choice) => choice.description.length > 0));
});
