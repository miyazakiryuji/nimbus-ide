/**
 * 過去セッションの横断検索（T-034）の単体テスト。
 *
 * 記録は Nimbus が書いたものではない（Claude Code 本体の JSONL）ので、
 * **形が変わっても検索が全部止まらないこと**を特に押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	formatTimestamp,
	parseQuery,
	parseTranscript,
	projectDirName,
	readSessionMeta,
	searchEntries,
	snippetAround,
	type TranscriptSessionMeta
} from '../core/transcripts';

const jsonl = [
	JSON.stringify({ type: 'mode', mode: 'normal' }),
	JSON.stringify({
		type: 'user',
		timestamp: '2026-08-12T15:44:01.433Z',
		message: { role: 'user', content: 'worktree の片付けはどうやった？' }
	}),
	'{ 壊れた行',
	JSON.stringify({
		type: 'assistant',
		timestamp: '2026-08-12T15:45:19.956Z',
		message: {
			content: [
				{ type: 'thinking', thinking: '内緒の思考' },
				{ type: 'text', text: '未コミットの変更を WIP コミットしてから remove しています' },
				{ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/core/worktree.ts' } }
			]
		}
	}),
	JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '本文なし' }] } })
].join('\n');

test('作業ディレクトリから記録の置き場の名前を作る', () => {
	assert.strictEqual(
		projectDirName('/Users/x/Developer/work/Idris-co/10_products/Nimbus'),
		'-Users-x-Developer-work-Idris-co-10-products-Nimbus'
	);
});

test('JSONL を読み、壊れた行と知らない種別は飛ばす', () => {
	assert.deepStrictEqual(
		parseTranscript(jsonl).map((e) => ({ role: e.role, text: e.text, tools: e.tools, files: e.files })),
		[
			{ role: 'user', text: 'worktree の片付けはどうやった？', tools: [], files: [] },
			{
				role: 'assistant',
				text: '未コミットの変更を WIP コミットしてから remove しています',
				tools: ['Edit'],
				files: ['/repo/src/core/worktree.ts']
			}
		]
	);
});

test('思考ブロックは本文として扱わない（本文もツールも無い行は落とす）', () => {
	assert.ok(!parseTranscript(jsonl).some((e) => e.text.includes('内緒の思考')));
});

test('検索語と file: / tool: の絞り込みを読み分ける', () => {
	assert.deepStrictEqual(parseQuery('worktree 片付け file:worktree.ts tool:Edit'), {
		terms: ['worktree', '片付け'],
		file: 'worktree.ts',
		tool: 'Edit'
	});
});

test('語はすべて含まれることを求める', () => {
	const entries = parseTranscript(jsonl);
	assert.deepStrictEqual(
		[
			searchEntries(entries, parseQuery('WIP remove'), 's1').length,
			searchEntries(entries, parseQuery('WIP 存在しない語'), 's1').length
		],
		[1, 0]
	);
});

test('file: と tool: で絞れる', () => {
	const entries = parseTranscript(jsonl);
	assert.deepStrictEqual(
		[
			searchEntries(entries, parseQuery('file:worktree.ts'), 's1').length,
			searchEntries(entries, parseQuery('file:存在しない'), 's1').length,
			searchEntries(entries, parseQuery('tool:ed'), 's1').length,
			searchEntries(entries, parseQuery('tool:Bash'), 's1').length
		],
		[1, 0, 1, 0]
	);
});

test('ファイルパスも検索対象に含む（本文に無くても引ける）', () => {
	assert.strictEqual(searchEntries(parseTranscript(jsonl), parseQuery('worktree.ts'), 's1').length, 1);
});

test('抜粋は一致箇所の前後を切り出す', () => {
	const text = 'あ'.repeat(200) + 'キーワード' + 'い'.repeat(200);
	const snippet = snippetAround(text, 'キーワード', 10);
	assert.deepStrictEqual(
		{ head: snippet.startsWith('…'), tail: snippet.endsWith('…'), has: snippet.includes('キーワード') },
		{ head: true, tail: true, has: true }
	);
});

test('日時は分まで、無ければ空', () => {
	assert.deepStrictEqual(
		[formatTimestamp('2026-08-12T15:44:01.433Z'), formatTimestamp(undefined)],
		['2026-08-12 15:44', '']
	);
});

// --- 見出しとノイズ除去（統合時に足したぶん） ---

test('サブエージェントと内部用の行は結果に混ぜない', () => {
	const noisy = [
		JSON.stringify({ type: 'user', isSidechain: true, message: { content: 'サブエージェントの発言' } }),
		JSON.stringify({ type: 'user', isMeta: true, message: { content: '内部用の行' } })
	].join('\n');
	assert.deepStrictEqual(parseTranscript(noisy), []);
});

test('見出しはタイトル・作業ディレクトリ・ブランチ・期間を拾う', () => {
	const meta: TranscriptSessionMeta = { sessionId: 's1' };
	for (const line of [
		JSON.stringify({ type: 'ai-title', aiTitle: 'worktree の後始末' }),
		JSON.stringify({ type: 'user', cwd: '/repo', gitBranch: 'nimbus', timestamp: '2026-08-12T15:44:01.433Z' }),
		JSON.stringify({ type: 'assistant', cwd: '/ignored', timestamp: '2026-08-12T16:00:00.000Z' })
	]) {
		readSessionMeta(line, meta);
	}
	assert.deepStrictEqual(meta, {
		sessionId: 's1',
		title: 'worktree の後始末',
		// 先に見つかったものを採る（あとから来た /ignored で上書きしない）
		cwd: '/repo',
		gitBranch: 'nimbus',
		startedAt: '2026-08-12T15:44:01.433Z',
		endedAt: '2026-08-12T16:00:00.000Z'
	});
});

test('見出しの読み取りも壊れた行で止まらない', () => {
	const meta: TranscriptSessionMeta = { sessionId: 's1' };
	for (const line of ['', '   ', 'not json', '{"type":"ai-title"']) {
		readSessionMeta(line, meta);
	}
	assert.deepStrictEqual(meta, { sessionId: 's1' });
});
