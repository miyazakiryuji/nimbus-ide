/**
 * upstream のソース（`src/**` と `build/**`）に対する Nimbus のパッチを当てる。
 *
 * 方針:
 * - 商標にあたる直書き（"Visual Studio Code" / "VS Code"）は、"Nimbus" への置換ではなく
 *   **製品名を差し込む形に一般化**する。upstream にとっても意味の通る変更になり、名前を変えても追随が要らない
 * - 既定値の変更は、なぜそうしないと壊れるのかを必ずコメントに残す（すべて実機で確認したもの）
 * - 変更箇所は `// --- Start Nimbus ---` / `// --- End Nimbus ---` で囲み、
 *   `nimbus/docs/core-changes.md` の台帳と対応させる
 *
 * 対象文字列が見つからない場合は失敗させる（upstream 側の変更に気づけるように）。
 *
 *   node nimbus/branding/apply-core-changes.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const WELCOME_CONTENT = 'src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts'
const WELCOME_PAGE = 'src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts'
const CHAT_CONTRIB = 'src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts'
const EXTENSIONS_CONTRIB = 'src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts'
const GULPFILE_VSCODE = 'build/gulpfile.vscode.ts'
const THEME_SERVICE = 'src/vs/workbench/services/themes/common/workbenchThemeService.ts'
const NLS = 'src/vs/nls.ts'
const EXTENSION_MANAGEMENT = 'src/vs/platform/extensionManagement/node/extensionManagementService.ts'
const MAIN = 'src/main.ts'
const PANE_COMPOSITE_BAR = 'src/vs/workbench/browser/parts/paneCompositeBar.ts'
const EDITOR_WATERMARK = 'src/vs/workbench/browser/parts/editor/editorGroupWatermark.ts'
const WORKBENCH_CONTRIB = 'src/vs/workbench/browser/workbench.contribution.ts'
const LAYOUT = 'src/vs/workbench/browser/layout.ts'

// 置き換える製品名は product.json から取る（改名しても追随する）
const productName = JSON.parse(readFileSync(join(process.cwd(), 'product.json'), 'utf8')).nameShort

/** [ファイル, 置換前, 置換後] — 置換前は必ず 1 箇所だけ一致すること */
export const replacements = [
  // サイドバーの既定幅を広げる（T-341）。Nimbus の主面はコックピットで、
  // セッションの縦レールと会話が同じ面を分け合うため、300px では会話が読めない。
  [
    LAYOUT,
    `const DEFAULT_WORKSPACE_WINDOW_DIMENSIONS = new Dimension(DEFAULT_WORKSPACE_WINDOW_SIZE.width, DEFAULT_WORKSPACE_WINDOW_SIZE.height);`,
    `const DEFAULT_WORKSPACE_WINDOW_DIMENSIONS = new Dimension(DEFAULT_WORKSPACE_WINDOW_SIZE.width, DEFAULT_WORKSPACE_WINDOW_SIZE.height);

// --- Start Nimbus ---
/**
 * サイドバーの既定幅。upstream は 300px。
 *
 * Nimbus の主面は**コックピット**で、セッションの縦レールと会話が同じ面を分け合う（T-341）。
 * 300px だとセッション一覧（200px）を引いた残りが 100px しかなく、会話が読めない。
 * 画面に対する上限も 1/4 → 40% に上げる — 1440px 幅の画面で 1/4 は 360px にしかならず、
 * 既定値を上げても効かない（実測）。
 */
const NIMBUS_DEFAULT_SIDEBAR_WIDTH = 560;
// --- End Nimbus ---`
  ],
  [
    LAYOUT,
    `\tSIDEBAR_SIZE: new InitializationStateKey<number>('sideBar.size', StorageScope.PROFILE, StorageTarget.MACHINE, 300),`,
    `\t// --- Start Nimbus ---
\tSIDEBAR_SIZE: new InitializationStateKey<number>('sideBar.size', StorageScope.PROFILE, StorageTarget.MACHINE, NIMBUS_DEFAULT_SIDEBAR_WIDTH),
\t// --- End Nimbus ---`
  ],
  [
    LAYOUT,
    `\t\tLayoutStateKeys.SIDEBAR_SIZE.defaultValue = Math.min(300, mainContainerDimension.width / 4);`,
    `\t\t// --- Start Nimbus ---
\t\tLayoutStateKeys.SIDEBAR_SIZE.defaultValue = Math.min(NIMBUS_DEFAULT_SIDEBAR_WIDTH, mainContainerDimension.width * 0.4);
\t\t// --- End Nimbus ---`
  ],
  // **上の既定値だけでは効かない。** 「小さい窓では詰める」道が 1440px 以下で上書きするので、
  // ノート PC のほとんどがそちらを通る（実測）。補助バーは upstream のまま。
  [
    LAYOUT,
    `\t\t\tthis.setInitializationValue(LayoutStateKeys.SIDEBAR_SIZE, Math.min(300, configuration.mainContainerDimension.width / 4));`,
    `\t\t\t// --- Start Nimbus ---
\t\t\t// **この道が既定値を上書きする。** 判定は「1440px 以下」なので、ノート PC の
\t\t\t// ほとんど（13〜14 インチ）が通る。ここを直さないと上の既定値は一度も効かない（実測）。
\t\t\t// 補助バーは upstream のまま — 広げたいのはコックピットだけ（T-341）
\t\t\tthis.setInitializationValue(LayoutStateKeys.SIDEBAR_SIZE, Math.min(NIMBUS_DEFAULT_SIDEBAR_WIDTH, configuration.mainContainerDimension.width * 0.4));
\t\t\t// --- End Nimbus ---`
  ],
  // サイドバーの幅を「開いている面ごと」に覚える（T-361）。台帳 #29。
  // upstream のサイドバー幅は全ビュー共有の 1 値なので、#28 でコックピットのために 560px にしたぶん、
  // エクスプローラーや検索まで 560px になる。利用者の言葉:「コックピットを開いている時は今ぐらいの
  // サイズで良いんだけど、ファイルとかのアクティビティバーをクリックしたときも同じサイズだと
  // ちょっと使いづらい」（2026-08-31）。
  //
  // **既存の #28 のエントリは触らない（`to` を伸ばさない）。** 適用ループは `includes(to)` で
  // 「適用済み」を判定するので、適用済みのツリーで `to` を伸ばすと
  //   - #28 の 1 本目: `from` がまだ残っているので Nimbus ブロックが 2 個目として挿入され、二重宣言で落ちる
  //   - #28 の 2 本目: `from` が既に消えているので 0 件 → throw
  // となる。だから**新規エントリとして、#28 の 4 本より後ろに**足す。1 本目のアンカーは
  // #28 の 1 本目が同じ run で作る文字列に乗るので、並び順そのものが意味を持つ。
  [
    LAYOUT,
    `const NIMBUS_DEFAULT_SIDEBAR_WIDTH = 560;
// --- End Nimbus ---`,
    `const NIMBUS_DEFAULT_SIDEBAR_WIDTH = 560;
// --- End Nimbus ---

// --- Start Nimbus ---
/** upstream のサイドバー既定幅。Nimbus 以外の面（エクスプローラー・検索など）はここへ戻す（T-361） */
const NIMBUS_UPSTREAM_SIDEBAR_WIDTH = 300;

/** Nimbus のビューコンテナ id の接頭辞（\`extensions/nimbus\` の \`viewsContainers.activitybar\`） */
const NIMBUS_VIEW_CONTAINER_PREFIX = 'workbench.view.extension.nimbus';

/**
 * 面（ビューコンテナ）ごとの既定幅（T-361）。
 *
 * VS Code のサイドバー幅は**全ビュー共有の 1 値**（\`sideBar.size\`）なので、
 * コックピットのために 560px にした（台帳 #28）ぶん、エクスプローラーや検索まで 560px になる。
 * 利用者の言葉:「コックピットを開いている時は今ぐらいのサイズで良いんだけど、
 * ファイルとかのアクティビティバーをクリックしたときも同じサイズだとちょっと使いづらい」。
 * だから **Nimbus の面は 560px、それ以外は upstream の 300px** へ落とす。
 */
function nimbusDefaultSideBarWidth(viewContainerId: string, containerWidth: number): number {
	return viewContainerId.startsWith(NIMBUS_VIEW_CONTAINER_PREFIX)
		? Math.min(NIMBUS_DEFAULT_SIDEBAR_WIDTH, containerWidth * 0.4)		// 台帳 #28 と同じ式
		: Math.min(NIMBUS_UPSTREAM_SIDEBAR_WIDTH, containerWidth / 4);		// upstream の原式
}
// --- End Nimbus ---`
  ],
  [
    LAYOUT,
    `	AUXILIARYBAR_SIZE: new InitializationStateKey<number>('auxiliaryBar.size', StorageScope.PROFILE, StorageTarget.MACHINE, 300),`,
    `	// --- Start Nimbus ---
	/**
	 * 面（ビューコンテナ id）ごとのサイドバー幅（T-361）。\`sideBar.size\` は触らない —
	 * upstream の 1 値はそのまま「いま出ている面の幅」として使い、この表は面を切り替えたときに
	 * 戻す先を覚えるためだけに使う。値は必ず \`{ id: 幅(number) }\` のフラットな形にすること
	 * （読み出しは \`JSON.parse\` が裸で走るので、壊れた形を書くと起動が落ちる）。
	 */
	SIDEBAR_SIZE_BY_VIEW: new InitializationStateKey<{ [viewContainerId: string]: number }>('sideBar.sizeByView', StorageScope.PROFILE, StorageTarget.MACHINE, {}),
	// --- End Nimbus ---
	AUXILIARYBAR_SIZE: new InitializationStateKey<number>('auxiliaryBar.size', StorageScope.PROFILE, StorageTarget.MACHINE, 300),`
  ],
  [
    LAYOUT,
    `			this.stateModel.setInitializationValue(LayoutStateKeys.SIDEBAR_SIZE, sideBarSize as number);`,
    `			this.stateModel.setInitializationValue(LayoutStateKeys.SIDEBAR_SIZE, sideBarSize as number);

			// --- Start Nimbus ---
			// 面を切り替えずに終了しても、いま出ている面の幅を覚える（T-361）。
			// **この upstream のハンドラの中でなければならない** — \`setInitializationValue\` は
			// キャッシュに置くだけで、書き出すのはこのハンドラ末尾の \`save(true, true)\`。
			// 別に \`onWillSaveState\` を足すと登録順で後になり、その保存に間に合わない
			this.nimbusRememberSideBarWidth(this.paneCompositeService.getActivePaneComposite(ViewContainerLocation.Sidebar)?.getId());
			// --- End Nimbus ---`
  ],
  [
    LAYOUT,
    `		this._register(Event.any(this.paneCompositeService.onDidPaneCompositeOpen, this.paneCompositeService.onDidPaneCompositeClose)(() => {

			// Auxiliary Bar State
			this.stateModel.setInitializationValue(LayoutStateKeys.AUXILIARYBAR_EMPTY, this.paneCompositeService.getPaneCompositeIds(ViewContainerLocation.AuxiliaryBar).length === 0);
		}));`,
    `		this._register(Event.any(this.paneCompositeService.onDidPaneCompositeOpen, this.paneCompositeService.onDidPaneCompositeClose)(() => {

			// Auxiliary Bar State
			this.stateModel.setInitializationValue(LayoutStateKeys.AUXILIARYBAR_EMPTY, this.paneCompositeService.getPaneCompositeIds(ViewContainerLocation.AuxiliaryBar).length === 0);
		}));

		// --- Start Nimbus ---
		// サイドバーの幅を面ごとに覚える（T-361）。「コックピットは今ぐらいで良いが、
		// ファイルなどを開いたときも同じ幅だと使いづらい」への答え。
		// \`compositePart.ts\` の \`doOpenComposite\` は close → open の順に**同期で**走り、
		// 間にグリッドのリサイズが挟まらないので、close の時点ではまだ
		// 「出ていく面」の幅がグリッドに残っている。
		// \`ViewContainerLocation.Sidebar\` で絞る — パネル・補助バーの開閉で表を汚さないため
		this._register(this.paneCompositeService.onDidPaneCompositeClose(({ composite, viewContainerLocation }) => {
			if (viewContainerLocation === ViewContainerLocation.Sidebar) {
				this.nimbusRememberSideBarWidth(composite.getId());
			}
		}));
		this._register(this.paneCompositeService.onDidPaneCompositeOpen(({ composite, viewContainerLocation }) => {
			if (viewContainerLocation === ViewContainerLocation.Sidebar) {
				this.nimbusRestoreSideBarWidth(composite.getId());
			}
		}));
		// --- End Nimbus ---`
  ],
  [
    LAYOUT,
    `	private setSideBarHidden(hidden: boolean): void {`,
    `	// --- Start Nimbus ---
	/**
	 * 直前に自分で当てた幅（当てたあとに実測し直した値）。
	 *
	 * \`resizeView\` は兄弟（エディタ）の最小幅に当たると要求どおりの幅を出せず切り詰める。
	 * その切り詰められた幅を次の切り替えで「利用者が引いた幅」として焼き付けると、
	 * 面を往復するたびにコックピットの希望幅が痩せていく。目印を持って書き込みを止める（T-361）。
	 */
	private nimbusAppliedSideBarWidth: number | undefined;

	/**
	 * 起動後にサイドバーの面を測ったか（T-361）。
	 *
	 * 起動直後に復元される \`sideBar.size\` は「最後に開いていた面の幅」なので、
	 * **Nimbus の面に限って**その 1 回だけは既定へ落とさずに表へ取り込む。そうしないと、
	 * この機能を入れた最初の起動でコックピットの引いた幅を 1 回失う。
	 * **2 回目以降は必ず既定へ落とす** — でないと「知らない面を開いたら、出ていった面の幅を
	 * そのまま名乗る」ことになり、直したい症状そのものになる
	 */
	private nimbusSideBarWidthSeeded = false;

	/**
	 * 面ごとの幅の表を、必ず「素のオブジェクト」として取り出す（T-361）。
	 *
	 * 読み出しは \`loadKeyFromStorage\` の \`JSON.parse\` が裸で走るので、
	 * 保存値が壊れていると \`null\` や配列が入ってくることがある。そのまま添字を引くと落ちる
	 */
	private nimbusSideBarWidthsByView(): { [viewContainerId: string]: number } {
		const sizes = this.stateModel.getInitializationValue(LayoutStateKeys.SIDEBAR_SIZE_BY_VIEW);
		return sizes && typeof sizes === 'object' && !Array.isArray(sizes) ? sizes : {};
	}

	/**
	 * 出ていく面の幅を控える（T-361）。
	 *
	 * 式は upstream が \`sideBar.size\` を保存するとき（\`onWillSaveState\`）とまったく同じ。
	 * 畳む経路では close の時点で既に \`SIDEBAR_HIDDEN = true\` なので、
	 * \`getViewSize().width\` だけを見ると 0 を覚えてしまう。
	 */
	private nimbusRememberSideBarWidth(viewContainerId: string | undefined): void {
		if (!viewContainerId || !this.workbenchGrid || !this.sideBarPartView) {
			return;
		}

		const width = this.stateModel.getRuntimeValue(LayoutStateKeys.SIDEBAR_HIDDEN)
			? this.workbenchGrid.getViewCachedVisibleSize(this.sideBarPartView)
			: this.workbenchGrid.getViewSize(this.sideBarPartView).width;
		if (typeof width !== 'number' || width < this.sideBarPartView.minimumWidth) {
			return; // 畳みきっている・まだ幅が無い
		}

		if (width === this.nimbusAppliedSideBarWidth) {
			return; // 自分が当てたまま = 利用者は引いていない。希望幅を切り詰め値で潰さない
		}

		const sizes = this.nimbusSideBarWidthsByView();
		if (sizes[viewContainerId] === width) {
			return;
		}

		// 既定値 \`{}\` は参照のままキャッシュに入るので、直接書き換えるとキー自体の既定が汚れる。
		// 必ず新しいオブジェクトを作って差し替える
		this.stateModel.setInitializationValue(LayoutStateKeys.SIDEBAR_SIZE_BY_VIEW, { ...sizes, [viewContainerId]: width });
	}

	/** 入ってくる面の幅へ戻す（T-361）。覚えていなければ面ごとの既定へ落ちる */
	private nimbusRestoreSideBarWidth(viewContainerId: string): void {
		if (!this.workbenchGrid || !this.sideBarPartView || this.stateModel.getRuntimeValue(LayoutStateKeys.SIDEBAR_HIDDEN)) {
			return;
		}

		const sizes = this.nimbusSideBarWidthsByView();
		const stored = sizes[viewContainerId];
		const current = this.workbenchGrid.getViewSize(this.sideBarPartView);

		// 起動後にサイドバーを測る最初の 1 回。いま出ている幅は \`sideBar.size\` の復元値、
		// つまり利用者が最後に引いた幅なので、覚えていなければ取り込む。
		//
		// **取り込むのは Nimbus の面だけ。** パッケージ版（\`isBuilt\`）の冷起動では、上の
		// \`initLayoutState\` が「既定のビューコンテナへ戻す」道を通るので、**起動時に復元される面は
		// ほぼ必ずエクスプローラー**（拡張のビューは既定になれない）。ここで面を選ばずに取り込むと、
		// エクスプローラーが 560px を自分の幅として名乗って固定され、**直したい症状がそのまま残る**。
		// Nimbus 以外はここを素通りさせ、下で既定（300px）へ縮める
		if (!this.nimbusSideBarWidthSeeded) {
			this.nimbusSideBarWidthSeeded = true;
			if (viewContainerId.startsWith(NIMBUS_VIEW_CONTAINER_PREFIX) && typeof stored !== 'number' && current.width >= this.sideBarPartView.minimumWidth) {
				this.stateModel.setInitializationValue(LayoutStateKeys.SIDEBAR_SIZE_BY_VIEW, { ...sizes, [viewContainerId]: current.width });
				this.nimbusAppliedSideBarWidth = current.width;
				return;
			}
		}

		const target = typeof stored === 'number' && stored > 0
			? stored
			: nimbusDefaultSideBarWidth(viewContainerId, this._mainContainerDimension.width);

		if (Math.abs(current.width - target) < 1) {
			this.nimbusAppliedSideBarWidth = current.width;
			return; // 既に目標の幅。定常状態ではここを通るので、切り替えでちらつかない
		}

		this.workbenchGrid.resizeView(this.sideBarPartView, { width: target, height: current.height });
		// 実際に出た幅を読み戻す — 切り詰められたぶんを「利用者が引いた幅」と取り違えないため
		this.nimbusAppliedSideBarWidth = this.workbenchGrid.getViewSize(this.sideBarPartView).width;
	}
	// --- End Nimbus ---

	private setSideBarHidden(hidden: boolean): void {`
  ],
  // 内蔵チャットを出さないので、右の補助バーは既定では開かない（T-238）。
  [
    WORKBENCH_CONTRIB,
    `			'workbench.secondarySideBar.defaultVisibility': {
				'type': 'string',
				'enum': ['hidden', 'visibleInWorkspace', 'visible', 'maximizedInWorkspace', 'maximized'],
				'default': 'visibleInWorkspace',`,
    `			'workbench.secondarySideBar.defaultVisibility': {
				'type': 'string',
				'enum': ['hidden', 'visibleInWorkspace', 'visible', 'maximizedInWorkspace', 'maximized'],
				// --- Start Nimbus ---
				// upstream の既定 \`visibleInWorkspace\` は、右の補助バーに内蔵チャットを置く前提。
				// Nimbus はそのチャットを出さないので、**中身が無いまま帯だけ残る**（実測・T-238）。
				// 開きたい人は今までどおり ⌥⌘B で開ける。
				'default': 'hidden',
				// --- End Nimbus ---`
  ],
  // 空のエディタの案内からも標準のデバッグを外す。アイコンだけ消しても、
  // 一番よく見る画面に出ていては隠したことにならない（T-246）。
  [
    EDITOR_WATERMARK,
    `const otherEntries: WatermarkEntry[] = [
	gotoFile,
	findInFiles,
	startDebugging,
	toggleTerminal,
	openSettings,
];`,
    `const otherEntries: WatermarkEntry[] = [
	gotoFile,
	findInFiles,
	startDebugging,
	toggleTerminal,
	openSettings,
// --- Start Nimbus ---
// 標準のデバッグは、Claude 用のものを用意するまで前に出さない（T-246）。
// 空のエディタは一番よく見る画面なので、ここに出したままだと「隠した」ことにならない。
// F5 は今までどおり効く — この一覧から外すだけ。戻すときはこの filter を消す
].filter(entry => entry.id !== 'workbench.action.debug.start');
// --- End Nimbus ---`
  ],
  // 標準のデバッグは Claude 用のものを用意するまでアイコンを出さない。登録は消していないので、
  // F5・ブレークポイント・デバッグコンソールは今までどおり動く（T-246）。
  [
    PANE_COMPOSITE_BAR,
    `	private getViewContainer(id: string): ViewContainer | undefined {
		const viewContainer = this.viewDescriptorService.getViewContainerById(id);
		return viewContainer && this.viewDescriptorService.getViewContainerLocation(viewContainer) === this.location ? viewContainer : undefined;
	}

	private getViewContainers(): readonly ViewContainer[] {
		return this.viewDescriptorService.getViewContainersByLocation(this.location);
	}`,
    `	// --- Start Nimbus ---
	/**
	 * アクティビティバーに出さないビューコンテナ。
	 *
	 * - \`workbench.view.debug\` — 標準のデバッグ。Claude 用のものを用意するまで出さない（T-246）
	 * - \`workbench.panel.chat\` — VS Code 内蔵のチャット。Nimbus のチャットはコックピットなので、
	 *   似て非なるものが右に常駐していると、どちらに書けばよいのか分からない（T-238）
	 *
	 * **登録は消していない** — F5・ブレークポイント・⇧⌘D も、内蔵チャットのコマンドも
	 * 今までどおり呼べる。アイコンが出なくなるだけなので、この集合から外せばそのまま戻る。
	 *
	 * ここで外すのは、バーがコンテナを引く口がこの 2 つしかないため。
	 * 「このバーの担当ではない」を表す既存の道すじにそのまま乗るので、
	 * 表示・非表示の判定を各所に足すより副作用が少ない。
	 */
	private static readonly NIMBUS_HIDDEN_VIEW_CONTAINERS: ReadonlySet<string> = new Set([
		'workbench.view.debug',
		'workbench.panel.chat'
	]);
	// --- End Nimbus ---

	private getViewContainer(id: string): ViewContainer | undefined {
		// --- Start Nimbus ---
		if (PaneCompositeBar.NIMBUS_HIDDEN_VIEW_CONTAINERS.has(id)) {
			return undefined;
		}
		// --- End Nimbus ---
		const viewContainer = this.viewDescriptorService.getViewContainerById(id);
		return viewContainer && this.viewDescriptorService.getViewContainerLocation(viewContainer) === this.location ? viewContainer : undefined;
	}

	private getViewContainers(): readonly ViewContainer[] {
		const containers = this.viewDescriptorService.getViewContainersByLocation(this.location);
		// --- Start Nimbus ---
		return containers.filter(container => !PaneCompositeBar.NIMBUS_HIDDEN_VIEW_CONTAINERS.has(container.id));
		// --- End Nimbus ---
	}`
  ],
  // 既定の表示言語。upstream は指定が無いと undefined を返し、NLS の解決自体を行わないので
  // 画面が英語のままになる。日本語で使う道具なので、既定を ja にしておく。
  // 明示の `--locale` と argv.json の `locale` は今までどおり優先される。
  [
    MAIN,
    `	return typeof argvConfig?.locale === 'string' ? argvConfig.locale.toLowerCase() : undefined;
}`,
    `	// --- Start Nimbus ---
	// 指定が無いときの既定を日本語にする。upstream はここで undefined を返し、そうすると
	// NLS の解決自体が行われないため、画面が英語のままになる。
	// \`--locale\` と argv.json の \`locale\` は今までどおり優先されるので、変えたい人は変えられる。
	// 文言の実体は同梱の言語パック（MS-CEINTL.vscode-language-pack-ja）が持つ。
	// パックが無いときは upstream どおり英語に落ちるだけで、壊れない。
	return typeof argvConfig?.locale === 'string' ? argvConfig.locale.toLowerCase() : 'ja';
	// --- End Nimbus ---
}`
  ],
  // upstream の文言には製品名が直書きされている（`localize()` の中だけで 152 箇所・約 90 ファイル）。
  // ファイルごとに直すとコア差分が 90 ファイルへ広がり、追従が現実的でなくなる。
  // 文言が組み立てられる唯一の場所（`_format`）で置き換えれば、1 ファイルの変更で全部に効き、
  // upstream が新しい文言を足しても自動的に追随する。
  [
    NLS,
    `	if (isPseudo) {
		// FF3B and FF3D is the Unicode zenkaku representation for [ and ]
		result = '\\uFF3B' + result.replace(/[aouei]/g, '$&$&') + '\\uFF3D';
	}

	return result;
}`,
    `	if (isPseudo) {
		// FF3B and FF3D is the Unicode zenkaku representation for [ and ]
		result = '\\uFF3B' + result.replace(/[aouei]/g, '$&$&') + '\\uFF3D';
	}

	// --- Start Nimbus ---
	result = nimbusRebrand(result);
	// --- End Nimbus ---

	return result;
}

// --- Start Nimbus ---
/**
 * upstream の文言に直書きされた製品名を、この製品の名前に置き換える。
 *
 * ここは \`localize\` / \`localize2\` の両方が必ず通る唯一の場所。ファイルごとに直すと
 * コア差分が 90 ファイルへ広がって追従できなくなるため、集約点で 1 回だけ行う。
 * nls.ts は最下層で product.json を読むモジュールに依存できないので、名前は
 * \`nimbus/branding/apply-core-changes.mjs\` が product.json から差し込む。
 *
 * ほとんどの文言は製品名を含まないので、置換の前に含有チェックで抜ける。
 */
const NIMBUS_PRODUCT_NAME = '${productName}';

function nimbusRebrand(message: string): string {
	if (message.indexOf('Visual Studio Code') !== -1) {
		message = message.replace(/Visual Studio Code/g, NIMBUS_PRODUCT_NAME);
	}
	if (message.indexOf('VS Code') !== -1) {
		message = message.replace(/VS Code/g, NIMBUS_PRODUCT_NAME);
	}
	return message;
}
// --- End Nimbus ---`
  ],
  [
    WELCOME_CONTENT,
    `localize('gettingStarted.setup.title', "Get started with VS Code")`,
    `localize('gettingStarted.setup.title', "Get started with {0}", product.nameLong)`
  ],
  [
    WELCOME_CONTENT,
    `localize('gettingStarted.setup.walkthroughPageTitle', 'Setup VS Code')`,
    `localize('gettingStarted.setup.walkthroughPageTitle', 'Setup {0}', product.nameLong)`
  ],
  [
    WELCOME_CONTENT,
    `localize('gettingStarted.setupWeb.title', "Get Started with VS Code for the Web")`,
    `localize('gettingStarted.setupWeb.title', "Get Started with {0} for the Web", product.nameLong)`
  ],
  [
    WELCOME_CONTENT,
    `localize('gettingStarted.setupWeb.walkthroughPageTitle', 'Setup VS Code Web')`,
    `localize('gettingStarted.setupWeb.walkthroughPageTitle', 'Setup {0} Web', product.nameLong)`
  ],
  [
    WELCOME_CONTENT,
    `localize('gettingStarted.setupAccessibility.walkthroughPageTitle', 'Setup VS Code Accessibility')`,
    `localize('gettingStarted.setupAccessibility.walkthroughPageTitle', 'Setup {0} Accessibility', product.nameLong)`
  ],
  [
    WELCOME_CONTENT,
    `localize('gettingStarted.setupAccessibility.description', "Learn the tools and shortcuts that make VS Code accessible. Note that some actions are not actionable from within the context of the walkthrough.")`,
    `localize('gettingStarted.setupAccessibility.description', "Learn the tools and shortcuts that make {0} accessible. Note that some actions are not actionable from within the context of the walkthrough.", product.nameLong)`
  ],
  // Code - OSS は GitHub Copilot を同梱しており、初回起動で
  // 「Welcome to VS Code / Sign in to use GitHub Copilot」のモーダルが出る（実測）。
  // 抑止の正しい経路は既存の設定 `chat.disableAIFeatures` で、これが真だと
  // startupPage.tryShowOnboarding() が sentiment.hidden により早期 return する。
  // 拡張の configurationDefaults では起動時のこの判定に間に合わないため、既定値そのものを変える。
  [
    CHAT_CONTRIB,
    `		[ChatAIDisabledSettingId]: {
			type: 'boolean',
			description: nls.localize('chat.disableAIFeatures', "Disable and hide built-in AI features provided by GitHub Copilot, including chat and inline suggestions."),
			default: false,`,
    `		[ChatAIDisabledSettingId]: {
			type: 'boolean',
			description: nls.localize('chat.disableAIFeatures', "Disable and hide built-in AI features provided by GitHub Copilot, including chat and inline suggestions."),
			// --- Start Nimbus ---
			// Nimbus は Claude の操縦席であり Copilot を同梱しない。既定で内蔵 AI 機能を隠す。
			default: true,
			// --- End Nimbus ---`
  ],
  // 拡張の署名検証は Microsoft の署名を前提にしており、Open VSX の拡張には署名が無い。
  // さらに OSS ビルドには検証ライブラリが同梱されないため、検証は「実行されなかった（undefined）」となり、
  // 実測でインストールが "Signature verification was not executed." で必ず失敗する。
  // トレードオフ: 署名による改ざん検知が効かなくなる。代わりに product.json の
  // extensionsGallery.controlUrl（Eclipse が管理する悪意ある拡張の停止リスト）を有効にしてある。
  [
    EXTENSIONS_CONTRIB,
    `			[VerifyExtensionSignatureConfigKey]: {
				type: 'boolean',
				description: localize('extensions.verifySignature', "When enabled, extensions are verified to be signed before getting installed."),
				default: true,`,
    `			[VerifyExtensionSignatureConfigKey]: {
				type: 'boolean',
				description: localize('extensions.verifySignature', "When enabled, extensions are verified to be signed before getting installed."),
				// --- Start Nimbus ---
				// Open VSX の拡張は Microsoft 署名を持たず、OSS ビルドには検証機構も無いため既定で無効。
				default: false,
				// --- End Nimbus ---`
  ],
  // 設定 `extensions.verifySignature` の既定値を false にするだけでは足りない。
  // 設定の登録はワークベンチ側の contribution なので、CLI（`--install-extension`）や
  // ワークベンチ外の経路では値が undefined になり、ここのフォールバックで true に戻る（実測で
  // CLI からのインストールが失敗し続けた）。分岐そのものを Nimbus の既定に合わせる。
  [
    EXTENSION_MANAGEMENT,
    `		if (verifySignature) {
			const value = this.configurationService.getValue(VerifyExtensionSignatureConfigKey);
			verifySignature = isBoolean(value) ? value : true;
		}`,
    `		if (verifySignature) {
			const value = this.configurationService.getValue(VerifyExtensionSignatureConfigKey);
			// --- Start Nimbus ---
			// Open VSX の拡張は Microsoft 署名を持たないため、設定が無い経路（CLI 等）でも既定を false にする。
			verifySignature = isBoolean(value) ? value : false;
			// --- End Nimbus ---
		}`
  ],
  // Copilot を同梱しない。Nimbus は Claude の操縦席であり、UI を隠したうえで中身だけ配るのは筋が悪い。
  // 実害もある: `prepareBuiltInCopilotRipgrepShim` が Copilot SDK ディレクトリを要求し、
  // 見つからないと**パッケージビルド全体が失敗する**（実測）。
  // フラグ 1 つで戻せる形にしておく（upstream の関数はそのまま残す）。
  [
    GULPFILE_VSCODE,
    `const buildRoot = path.dirname(root);`,
    `// --- Start Nimbus ---
// Nimbus は Copilot を同梱しない。戻したいときはこのフラグを true にする。
const NIMBUS_BUNDLE_COPILOT = false;
// --- End Nimbus ---

const buildRoot = path.dirname(root);`
  ],
  // Copilot を同梱しないので、プラットフォーム別 CLI パッケージの取得もしない
  // （取得しに行くと、同梱しないものをダウンロードすることになる）
  [
    GULPFILE_VSCODE,
    `		ensureCopilotPlatformPackage(platform, arch);`,
    `		// --- Start Nimbus ---
		if (NIMBUS_BUNDLE_COPILOT) {
			ensureCopilotPlatformPackage(platform, arch);
		}
		// --- End Nimbus ---`
  ],
  [
    GULPFILE_VSCODE,
    `			packageTask(platform, arch, sourceFolderName, destinationFolderName, opts),
			prepareCopilotRipgrepShimTask(platform, arch, destinationFolderName)
		];`,
    `			packageTask(platform, arch, sourceFolderName, destinationFolderName, opts),
			// --- Start Nimbus ---
			...(NIMBUS_BUNDLE_COPILOT ? [prepareCopilotRipgrepShimTask(platform, arch, destinationFolderName)] : [])
			// --- End Nimbus ---
		];`
  ],
  [
    GULPFILE_VSCODE,
    `				cleanExtensionsBuildTask,
				compileNonNativeExtensionsBuildTask,
				compileCopilotExtensionBuildTask,
				compileExtensionMediaBuildTask,
				writeISODate('out-build'),`,
    `				cleanExtensionsBuildTask,
				compileNonNativeExtensionsBuildTask,
				// --- Start Nimbus ---
				...(NIMBUS_BUNDLE_COPILOT ? [compileCopilotExtensionBuildTask] : []),
				// --- End Nimbus ---
				compileExtensionMediaBuildTask,
				writeISODate('out-build'),`
  ],
  [
    GULPFILE_VSCODE,
    `				cleanExtensionsBuildTask,
				compileNonNativeExtensionsBuildTask,
				compileCopilotExtensionBuildTask,
				compileExtensionMediaBuildTask,
				minified ? minifyVSCodeTask : bundleVSCodeTask,`,
    `				cleanExtensionsBuildTask,
				compileNonNativeExtensionsBuildTask,
				// --- Start Nimbus ---
				...(NIMBUS_BUNDLE_COPILOT ? [compileCopilotExtensionBuildTask] : []),
				// --- End Nimbus ---
				compileExtensionMediaBuildTask,
				minified ? minifyVSCodeTask : bundleVSCodeTask,`
  ],
  // 既定のカラーテーマを Nimbus のものにする。
  // 配色は Claude の意匠に寄せてある（テラコッタの差し色＋温かみのある無彩色）。
  // テーマ自体は組み込み拡張 extensions/nimbus が提供するので、ここで変えるのは既定値だけ。
  [
    THEME_SERVICE,
    `	export const COLOR_THEME_DARK = 'Dark 2026';
	export const COLOR_THEME_LIGHT = 'Light 2026';`,
    `	// --- Start Nimbus ---
	export const COLOR_THEME_DARK = 'Nimbus Dark';
	export const COLOR_THEME_LIGHT = 'Nimbus Light';
	// --- End Nimbus ---`
  ],
  // パッケージの出力先が `VSCode-<platform>-<arch>` 固定になっている。
  // 利用者の作業ディレクトリの隣に "VSCode" という名前のフォルダが生えるのは紛らわしいので、
  // 製品名から決める（`Nimbus-darwin-arm64`）。
  [
    GULPFILE_VSCODE,
    '\t\tconst destinationFolderName = `VSCode${dashed(platform)}${dashed(arch)}`;',
    `\t\t// --- Start Nimbus ---
\t\tconst destinationFolderName = \`\${product.nameShort}\${dashed(platform)}\${dashed(arch)}\`;
\t\t// --- End Nimbus ---`
  ],
  // macOS 版のターミナル用コマンドが `bin/code` 固定になっている。
  // 本物の VS Code と衝突するうえ、Nimbus の中で `code` と名乗るのは誤解を招くため製品名から決める。
  [
    GULPFILE_VSCODE,
    `				.pipe(rename('bin/code'));`,
    `				.pipe(rename(\`bin/\${product.applicationName}\`));`
  ],
  // Welcome 画面の副題は VS Code のキャッチコピーそのものなので、Nimbus のものに差し替える
  [
    WELCOME_PAGE,
    `localize({ key: 'gettingStarted.editingEvolved', comment: ['Shown as subtitle on the Welcome page.'] }, "Editing evolved")`,
    `localize({ key: 'nimbus.welcomeSubtitle', comment: ['Shown as subtitle on the Welcome page.'] }, "A cockpit for your agents")`
  ]
]

/**
 * パッチを当てる。**直接実行したときだけ走る**（T-366）。
 *
 * 以前はモジュールの直下で走っていたので、`import` しただけでツリーが書き換わり、
 * **試験から呼べなかった**。呼べないから守りが無く、T-238 でツリーだけ直したときに
 * script の置換文字列が取り残され、**素で走らせると throw する**状態が続いていた
 * （upstream 追従のときにだけ効く形で腐る — CLAUDE.md「回帰の 3 大原因」の 3 つめ）。
 */
export function applyCoreChanges() {
let applied = 0
let alreadyDone = 0
const byFile = new Map()
for (const [file, from, to] of replacements) {
  if (!byFile.has(file)) byFile.set(file, readFileSync(join(process.cwd(), file), 'utf8'))
  let text = byFile.get(file)
  if (text.includes(to)) {
    alreadyDone++
    continue
  }
  const hits = text.split(from).length - 1
  if (hits !== 1) {
    throw new Error(`${file}: 置換対象が ${hits} 箇所（1 箇所であるべき）— upstream の文言が変わった可能性:\n  ${from}`)
  }
  // 置換文字列は関数で渡す。素の文字列だと `$&` などが JS の特殊記法として展開され、
  // パッチが壊れる（実際に nls.ts のパッチが壊れて esbuild が構文エラーを出した）
  byFile.set(file, text.replace(from, () => to))
  applied++
}

for (const [file, text] of byFile) writeFileSync(join(process.cwd(), file), text)
console.log(`製品名の直書きを置換: ${applied} 件（適用済み ${alreadyDone} 件）`)
return { applied, alreadyDone }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyCoreChanges()
}
