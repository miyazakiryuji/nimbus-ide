/** スキル一覧に、ワークスペースのスキルが出るか（用意した gui-test-skill が見えること） */
import { expandPane, labels, openHiddenView, openNimbusSettingsSidebar, sidebarText } from '../helpers.mjs';

export default {
	name: 'スキル一覧にプロジェクトのスキルが出る',
	async run(page, ctx) {
		// アイコンはトグルなので、押すのではなく「開いている状態にする」（helpers.mjs 参照）
		// スキルはサイドバーの段から外し、歯車雲のコンテナへ移した（T-243）。コマンドでも開く
		await openHiddenView(page, 'スキル一覧を開く');
		ctx.expect(await openNimbusSettingsSidebar(page), 'Nimbus 設定のサイドバーを開けない');
		await expandPane(page, labels('view.nimbus.skills')[0]);
		await page.waitForTimeout(1500);

		const sidebar = await sidebarText(page);
		ctx.expect(
			sidebar.includes('gui-test-skill'),
			`用意したスキルが一覧に出ていない:\n${sidebar.slice(0, 400)}`
		);
	}
};
