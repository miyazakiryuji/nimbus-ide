/**
 * 既定テーマが Nimbus（Claude 配色）になっているか。
 * 色は目で見ないと分からない部分が多いが、「既定が差し替わっているか」は機械で確かめられる。
 */
const TERRACOTTA = [0xd9, 0x77, 0x57];

function parseRgb(value) {
	const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value ?? '');
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** テーマ変数は `#1f1e1d` の形で入っている */
function hexToRgb(value) {
	const hex = (value ?? '').replace('#', '').slice(0, 6);
	return hex.length === 6 ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) : undefined;
}

/**
 * テーマの色は `.monaco-workbench` に CSS 変数として載る。
 * `document.body` は**その親**なので変数を継承せず、読むと必ず空になる。
 * 同じ理由で、`.monaco-workbench` 自身の backgroundColor はテーマではなく
 * 素の CSS の色（rgb(37,37,38)）なので、そこを見てもテーマの正否は分からない。
 */
async function themeVar(page, name) {
	return page.evaluate((varName) => {
		const el = document.querySelector('.monaco-workbench');
		return el ? getComputedStyle(el).getPropertyValue(varName).trim() : '';
	}, name);
}

export default {
	name: '既定テーマが Nimbus 配色',
	async run(page, ctx) {
		const bg = await themeVar(page, '--vscode-editor-background');
		const rgb = parseRgb(bg) ?? hexToRgb(bg);
		ctx.expect(rgb !== undefined, `editor.background が取れない: "${bg}"`);
		// 温かいチャコール（#1F1E1D 系）: 暗く、赤 ≥ 青
		ctx.expect(rgb[0] < 80 && rgb[0] >= rgb[2], `背景が温かい暗色ではない: ${bg}`);

		// 差し色（フォーカス枠）がテラコッタか
		const focus = await themeVar(page, '--vscode-focusBorder');
		const hex = focus.replace('#', '').slice(0, 6);
		ctx.expect(hex.length === 6, `focusBorder が取れない: "${focus}"`);
		const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
		const near = Math.abs(r - TERRACOTTA[0]) + Math.abs(g - TERRACOTTA[1]) + Math.abs(b - TERRACOTTA[2]);
		ctx.expect(near < 90, `差し色がテラコッタから離れている: #${hex}`);
	}
};
