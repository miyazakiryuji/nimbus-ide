/**
 * Activity Bar アイコンの守り（T-330）。
 *
 * 差し替えで壊れやすいのは「参照とファイル名の食い違い」「単色でない SVG が混ざる」
 * 「XML が通らない」の 3 つ。中身のデザインではなく、その約束だけを固定する。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const RES = join(ROOT, 'extensions', 'nimbus', 'resources')
const ICONS = ['nimbus.svg', 'nimbus-tasks.svg', 'nimbus-settings.svg', 'nimbus-debug.svg']

test('package.json の view アイコン参照が実在する（T-330）', () => {
	const pkg = JSON.parse(readFileSync(join(ROOT, 'extensions', 'nimbus', 'package.json'), 'utf8'))
	const refs = JSON.stringify(pkg.contributes).match(/resources\/[\w-]+\.svg/g) ?? []
	const missing = [...new Set(refs)].filter((ref) => {
		try { readFileSync(join(ROOT, 'extensions', 'nimbus', ref)); return false } catch { return true }
	})
	assert.deepStrictEqual(missing, [])
})

test('Activity Bar の SVG は 24x24・currentColor 単色（T-330）', () => {
	const report = ICONS.map((name) => {
		const text = readFileSync(join(RES, name), 'utf8')
		const hardColors = (text.match(/(?:fill|stroke)="(?!currentColor|none)[^"]+"/g) ?? [])
		return {
			name,
			viewBox: /viewBox="0 0 24 24"/.test(text),
			svgRoot: text.trimStart().startsWith('<svg'),
			balanced: (text.match(/<svg/g) ?? []).length === (text.match(/<\/svg>/g) ?? []).length,
			hardColors
		}
	})
	assert.deepStrictEqual(
		report,
		ICONS.map((name) => ({ name, viewBox: true, svgRoot: true, balanced: true, hardColors: [] }))
	)
})
