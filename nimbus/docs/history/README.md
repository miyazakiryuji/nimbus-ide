# これまでの Nimbus（Electron 自前実装・2026-08-11）

Nimbus は最初、Electron + React で IDE の土台から自前で作っていた（v0.1.0 〜 v0.5.0）。
2026-08-12 に **Code - OSS フォーク**へ方針転換し、その実装は役目を終えた。
ここには、フォークでも意味を持つ資料だけを残してある。

| ファイル | 中身 |
| --- | --- |
| `NIMBUS_SPEC.md` | 最初に書かれた仕様書。何を作りたいのかの原典 |
| `vscode-fork-migration.md` | フォークへ移る判断とその根拠（F0 の調査結果を含む） |
| `sdk-verification-2026-08-11.json` | Claude Agent SDK の型を実測した結果 |
| `testing/` | 旧実装で積み上げた検証記録（step-1〜8・各 Phase のレビュー） |

## 旧実装から引き継いだもの

- セッション実行エンジン（SessionManager / normalize / AsyncMessageQueue）
- サニタイザ（ログに鍵やホームパスを残さない）
- 承認の考え方（canUseTool で握り、答えなかったら拒否に倒す）
- worktree の破棄前に WIP コミットで成果を守る設計
- 課金モードの判定（`apiKeySource='none'` はサブスク）

## 旧実装で捨てたもの

エディタ・ファイルツリー・SCM・メニューバー・テーマ基盤・検索。すべて VS Code 側が
上位互換で持っているため。作ったこと自体は無駄ではなく、**要件と使い勝手の実証**として
機能した（課金表示の誤りや承認キューの設計はそこで見つかった）。

## 旧リポジトリ

`https://github.com/miyazakiryuji/nimbus` — アーカイブ済み（読み取り専用）。
v0.1.0 〜 v0.5.0 のリリースはそのまま残してある。
