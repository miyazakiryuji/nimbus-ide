# 文字（日本語で読む前提の積み）

**タスク**: T-273 / **実装**: `extensions/nimbus/media/cockpit.css`, `media/board.css` /
**考えかた**: [typography スキル](../../.claude/skills/typography/SKILL.md)

## なぜ

表示言語を日本語にした（T-245）のに、フォントの積みは upstream のままだった。
**役割（`body1` / `semiBold`）が正しくても、積みが日本語を持っていなければ読みにくい。**

調べた事実は 3 つ。

1. **等幅の積みに日本語が 1 文字も無い**（macOS の既定は `Menlo, Monaco, 'Courier New', monospace`）。
   ツール出力やコードブロックの日本語は、字ごとのフォールバックで**プロポーショナルな Hiragino** に落ち、
   桁が揃わない。**macOS には日本語の等幅がプリインストールされていない**（Osaka-Mono は現行 OS から消えた）
2. UI の積み（`-apple-system, BlinkMacSystemFont, sans-serif`）も日本語を名指ししていない。
   macOS では Hiragino に落ちて実用になるが、Linux では保証が無い
3. Hiragino Sans は **W0〜W9** を持つ。**名指しすれば `600` が実体で出る**。
   名指ししないと合成太字（faux bold）になり、画数の多い漢字が小さい字でつぶれる

## 決めたこと — 同梱せず、積みで名指しする

| 案 | 判断 |
| --- | --- |
| フォントを**同梱**する | **やらない。** ライセンスは足りても数 MB〜十数 MB 増える。Claude Code 本体を同梱しないと決めたのと同じ理由（配布の重さ） |
| 積みで**名指し**する | **これにする。** 0 バイトで効き、入っていない環境では今までどおり落ちるだけ |
| 利用者に**委ねる** | 委ねるだけにはしない。既定が読みにくいのを設定で直させるのは、直す人にしか届かない |

```css
--nimbus-ui-font:   var(--vscode-font-family), 'Hiragino Sans', 'Hiragino Kaku Gothic ProN',
                    'Noto Sans JP', 'Yu Gothic UI', Meiryo, sans-serif;
--nimbus-mono-font: var(--vscode-editor-font-family), 'Hiragino Sans', 'Noto Sans JP', monospace;
```

- **先頭は VS Code の変数のまま。** 利用者が `editor.fontFamily` を変えていれば、そちらが勝つ。
  こちらが足すのは**日本語の受け皿**だけ
- 等幅の側は、日本語がプロポーショナルに落ちること自体は避けられない。
  それでも名指ししておけば「**どの環境でも同じように落ちる**」ところまでは決められる
- コックピットと板で**同じ積み**にする。面ごとに字の顔が変わって見えないようにするため

## どこに効くか

| 面 | 効く |
| --- | --- |
| コックピット（会話・入力欄・コードブロック） | ✔ |
| タスク板 | ✔ |
| エディタ・ターミナル・ツリー（ワークベンチ側） | **効かない**。そちらは VS Code の設定（`editor.fontFamily` など）の領分 |

## 決めなかったこと

- **ワークベンチ側の既定を変える**のはやらない。コア（`src/vs/**`）を触ることになり、
  利用者の設定とも競合する。webview は Nimbus の持ちものなので、そこだけ決める
- **行間を日本語向けに一律で広げる**のはやらない。本文として読ませる面は既に 1.5 以上あり、
  一律に広げると型ラムの役割（`body` と `label` の差）が潰れる
