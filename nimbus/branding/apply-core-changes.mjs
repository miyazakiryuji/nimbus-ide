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

const WELCOME_CONTENT = 'src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts'
const WELCOME_PAGE = 'src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts'
const CHAT_CONTRIB = 'src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts'
const EXTENSIONS_CONTRIB = 'src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts'
const GULPFILE_VSCODE = 'build/gulpfile.vscode.ts'
const THEME_SERVICE = 'src/vs/workbench/services/themes/common/workbenchThemeService.ts'
const NLS = 'src/vs/nls.ts'
const EXTENSION_MANAGEMENT = 'src/vs/platform/extensionManagement/node/extensionManagementService.ts'

// 置き換える製品名は product.json から取る（改名しても追随する）
const productName = JSON.parse(readFileSync(join(process.cwd(), 'product.json'), 'utf8')).nameShort

/** [ファイル, 置換前, 置換後] — 置換前は必ず 1 箇所だけ一致すること */
const replacements = [
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
