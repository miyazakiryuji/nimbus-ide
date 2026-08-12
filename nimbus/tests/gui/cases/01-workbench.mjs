/** 起動して、ワークベンチがちゃんと描画されるか */
export default {
	name: 'ワークベンチが起動する',
	async run(page, ctx) {
		const title = await page.title();
		ctx.expect(/Nimbus/i.test(title) || title.length > 0, `ウィンドウのタイトルが空: "${title}"`);
		const workbench = await page.$('.monaco-workbench');
		ctx.expect(workbench !== null, 'ワークベンチの要素が見つからない');
		// 起動直後にエラーダイアログが出ていないこと
		const dialog = await page.$('.monaco-dialog-box');
		ctx.expect(dialog === null, '起動直後にダイアログが出ている');
	}
};
