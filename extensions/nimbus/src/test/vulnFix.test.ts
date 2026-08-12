/**
 * 脆弱性の警告の並べ替え（T-121）の単体テスト。
 *
 * **深刻さより先に「今日できるか」で分ける**を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { parseAudit, planFixes, renderFixPlan } from '../core/vulnFix';

const audit = JSON.stringify({
	vulnerabilities: {
		safe: { severity: 'moderate', fixAvailable: { version: '1.2.3', isSemVerMajor: false }, via: [{ title: 'XSS' }] },
		major: { severity: 'critical', fixAvailable: { version: '3.0.0', isSemVerMajor: true } },
		stuck: { severity: 'high', fixAvailable: false }
	}
});

test('npm audit の出力を読む', () => {
	assert.deepStrictEqual(
		parseAudit(audit).map((a) => `${a.name}:${a.severity}:${a.breaking}`),
		['safe:moderate:false', 'major:critical:true', 'stuck:high:false']
	);
});

test('壊れた JSON では空を返す', () => {
	assert.deepStrictEqual(parseAudit('{ 壊れている'), []);
});

test('今日できるもの・破壊的なもの・直せないものに分ける', () => {
	const plan = planFixes(parseAudit(audit));
	assert.deepStrictEqual(
		{ safe: plan.safe.map((a) => a.name), breaking: plan.breaking.map((a) => a.name), unresolved: plan.unresolved.map((a) => a.name) },
		{ safe: ['safe'], breaking: ['major'], unresolved: ['stuck'] }
	);
});

test('深刻な脆弱性でも、破壊的なら「今日できる」には入れない', () => {
	const plan = planFixes(parseAudit(audit));
	assert.ok(!plan.safe.some((a) => a.severity === 'critical'));
});

test('各区分の中は深刻な順に並ぶ', () => {
	const many = parseAudit(
		JSON.stringify({
			vulnerabilities: {
				a: { severity: 'low', fixAvailable: { version: '1', isSemVerMajor: false } },
				b: { severity: 'critical', fixAvailable: { version: '1', isSemVerMajor: false } }
			}
		})
	);
	assert.deepStrictEqual(planFixes(many).safe.map((a) => a.name), ['b', 'a']);
});

test('--force を使わないよう明記する', () => {
	assert.ok(renderFixPlan(planFixes(parseAudit(audit))).includes('--force` は使わないでください'));
});

test('警告が無ければ、その旨だけを書く', () => {
	assert.ok(renderFixPlan(planFixes([])).includes('警告はありませんでした'));
});

test('直し方が示されていないものには、判断が要ると書く', () => {
	assert.ok(renderFixPlan(planFixes(parseAudit(audit))).includes('使うのをやめるか、待つかの判断'));
});
