/**
 * ゆあのシステムプロンプト。
 * 人格の細部より、「越えてはいけない線」が入っていることを固定する。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildYuaSystemPrompt, NIMBUS_GUIDE } from '../help/yua';

test('名乗りと日本語での応答が指示されている', () => {
	const prompt = buildYuaSystemPrompt();
	assert.ok(prompt.includes('ゆあ'));
	assert.ok(prompt.includes('日本語'));
});

test('知らないことを推測で埋めないよう明示している', () => {
	const prompt = buildYuaSystemPrompt();
	assert.ok(prompt.includes('分かりません'));
	assert.ok(prompt.includes('推測'));
});

test('公式製品だと誤認させない指示がある', () => {
	const prompt = buildYuaSystemPrompt();
	assert.ok(prompt.includes('公式'));
});

test('Nimbus の説明が同梱されている（承認・タスク・課金）', () => {
	const prompt = buildYuaSystemPrompt();
	for (const topic of ['承認', 'worktree', '課金モード', 'Open VSX', 'コックピット']) {
		assert.ok(prompt.includes(topic), `${topic} の説明が含まれること`);
	}
});

test('説明には「完了しても成果が消えない」ことが書かれている', () => {
	// 利用者がいちばん不安になる操作なので、案内から落ちてはいけない
	assert.ok(NIMBUS_GUIDE.includes('自動でコミット'));
});
