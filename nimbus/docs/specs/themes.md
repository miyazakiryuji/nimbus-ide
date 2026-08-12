# テーマ（Nimbus Dark / Nimbus Light）

Nimbus 独自の配色。組み込み拡張がテーマとして提供し、コア側で既定テーマに指定する。

## 何を解決するのか

フォークが「別の製品」として立つには、開いた瞬間の色が違わないといけない。
同時に、Nimbus は Claude を操縦する道具なので、**Claude の意匠に寄せた配色**にする。
VS Code の既定テーマのままでは、見た目が VS Code のままになる。

## 振る舞い

- 組み込み拡張 `extensions/nimbus` が 2 つのテーマを提供する
  - **Nimbus Dark**（`uiTheme: vs-dark`）
  - **Nimbus Light**（`uiTheme: vs`）
- **既定テーマが Nimbus Dark / Nimbus Light**（コアの既定値を変更）。
  初回起動時のテーマ選択でも Nimbus を先頭に出す
- 配色の考え方
  - 差し色は**テラコッタ `#D97757`**（バッジ・ボタン・フォーカス枠）
  - 背景は温かみのあるチャコール（`#1F1E1D`）
  - 文字と雲は生成り（`#D6D3C7` / `#F0EEE6` / `#EBDBBC` / `#D4A27F`）
  - 型だけは可読性のために寒色のスレートを当てている
- Webview（コックピット・タスク板）は VS Code のテーマ変数を使うので**自動で追従する**。
  Webview 側に色を直書きしない

## 設計

- `extensions/nimbus/themes/nimbus-dark.json`（UI 色 181 項目・構文色 20 グループ）
- `extensions/nimbus/themes/nimbus-light.json`
- `extensions/nimbus/package.json` の `contributes.themes`
- 既定テーマの変更はコア（`src/vs/workbench/services/themes/common/workbenchThemeService.ts`）。
  `nimbus/docs/core-changes.md` の 12 番に記録

アプリアイコンも同じ配色で描き直してある（`nimbus/branding/make-icon.mjs`）。

## 受け入れ条件

- [x] テーマ 2 つが一覧に出て、切り替えられる
- [x] 初期状態で Nimbus Dark が適用される
- [x] Webview（コックピット・タスク板）がテーマに追従する
- [x] コアの変更が `core-changes.md` に記録されている

## 決めなかったこと・やらないこと

- **新しい配色を機能ごとに足すこと** — 機能を足すときも**このテーマ変数に従う**。
  独自の色を直書きしない（IntelliJ 由来機能の実装方針もこれに揃える）
- **エージェントの状態に連動した配色** — 面白いが別の話（`tasks.md` T-064）
