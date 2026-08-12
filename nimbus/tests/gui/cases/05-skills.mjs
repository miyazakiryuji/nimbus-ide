/** スキル一覧に、ワークスペースのスキルが出るか（用意した gui-test-skill が見えること） */
import { expandPane, labels, openNimbusSidebar, sidebarText } from '../helpers.mjs';

export default {
	name: 'スキル一覧にプロジェクトのスキルが出る',
	async run(page, ctx) {
		// アイコンはトグルなので、押すのではなく「開いている状態にする」（helpers.mjs 参照）
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		await expandPane(page, labels('view.nimbus.skills')[0]);
		await page.waitForTimeout(1500);

		const sidebar = await sidebarText(page);
		ctx.expect(
			sidebar.includes('gui-test-skill'),
			`用意したスキルが一覧に出ていない:\n${sidebar.slice(0, 400)}`
		);
	}
};
