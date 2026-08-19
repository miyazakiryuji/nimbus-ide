/**
 * 社内 Wiki に貼れる形へ直す。
 *
 * 守りたいのは 2 つ — **相対リンクを死なせない**ことと、
 * **伏せた跡を残す**こと（黙って消すと、何かあったことすら分からない）。
 *
 * 守っている修正（T-274）: T-208
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	browseUrl,
	describeExport,
	redactInternal,
	resolveLinks,
	stripFrontMatter,
	toWiki,
	wikiTitle
} from '../core/wikiExport';

const DOC = [
	'---',
	'title: 元のメタデータ',
	'---',
	'# 積み上げた PR',
	'',
	'詳しくは [pr-stack](pr-stack.md) と [README](../../README.md) を見てください。',
	'外は [GitHub](https://github.com)、中の見出しは [ここ](#なぜ)。',
	'![図](images/stack.png)',
	'',
	'<!-- internal -->',
	'社内の URL: http://wiki.internal/secret',
	'<!-- /internal -->',
	'',
	'おわり。'
].join('\n');

test('front matter を落とし、最初の見出しを題にする', () => {
	assert.ok(stripFrontMatter(DOC).startsWith('# 積み上げた PR'));
	assert.strictEqual(wikiTitle(DOC), '積み上げた PR');
	assert.strictEqual(wikiTitle('見出しがありません'), undefined);
});

test('伏せた跡を残す', () => {
	const redacted = redactInternal(DOC);
	assert.strictEqual(redacted.count, 1);
	assert.ok(redacted.markdown.includes('> （社内向けの記述をここから外しています）'), redacted.markdown);
	assert.ok(!redacted.markdown.includes('wiki.internal'), redacted.markdown);
});

const OPTIONS = {
	repoUrl: 'https://github.com/owner/repo',
	ref: 'nimbus',
	basePath: 'nimbus/docs/specs/pr-stack.md'
};

test('相対リンクだけを絶対 URL に直す。画像は raw', () => {
	const linked = resolveLinks(stripFrontMatter(DOC), OPTIONS);
	assert.ok(
		linked.markdown.includes('[pr-stack](https://github.com/owner/repo/blob/nimbus/nimbus/docs/specs/pr-stack.md)'),
		linked.markdown
	);
	// `nimbus/docs/specs/` から `../../` は `nimbus/` まで戻る
	assert.ok(
		linked.markdown.includes('[README](https://github.com/owner/repo/blob/nimbus/nimbus/README.md)'),
		linked.markdown
	);
	assert.ok(linked.markdown.includes('![図](https://github.com/owner/repo/raw/nimbus/nimbus/docs/specs/images/stack.png)'), linked.markdown);
	// 外部リンクと同一ページの見出しは触らない
	assert.ok(linked.markdown.includes('[GitHub](https://github.com)'), linked.markdown);
	assert.ok(linked.markdown.includes('[ここ](#なぜ)'), linked.markdown);
	assert.strictEqual(linked.resolved, 3);
});

test('リポジトリの URL が無ければ書き換えず、直せなかったと言う', () => {
	const linked = resolveLinks(stripFrontMatter(DOC), {});
	assert.ok(linked.markdown.includes('[pr-stack](pr-stack.md)'), linked.markdown);
	assert.deepStrictEqual(linked.unresolved.sort(), ['../../README.md', 'images/stack.png', 'pr-stack.md']);
});

test('通しで直し、要約を出す', () => {
	const result = toWiki(DOC, OPTIONS);
	assert.strictEqual(
		describeExport(result),
		['「積み上げた PR」を貼れる形にしました', '  絶対 URL に直したリンク: 3 件', '  伏せた区画: 1 件'].join('\n')
	);
});

test('remote の URL をブラウザで開ける形にし、資格情報は落とす', () => {
	assert.strictEqual(browseUrl('git@github.com:owner/repo.git'), 'https://github.com/owner/repo');
	assert.strictEqual(browseUrl('https://github.com/owner/repo.git'), 'https://github.com/owner/repo');
	assert.strictEqual(browseUrl('https://user:tokenvalue@github.com/owner/repo.git'), 'https://github.com/owner/repo');
	assert.strictEqual(browseUrl(''), undefined);
});
