#!/bin/bash
# upstream（microsoft/vscode）の新しいリリースへ載せ替える。
#
#   bash nimbus/scripts/sync-upstream.sh release/1.133
#
# 方針は「コア変更を最小に保ち、機能は extensions/nimbus に置く」なので、
# 衝突するのは基本的に nimbus/docs/core-changes.md に載っている数ファイルだけになる。
# 衝突したら台帳を見ながら直し、台帳の側も更新すること。
set -euo pipefail

TARGET="${1:?使い方: sync-upstream.sh <upstream のブランチ or タグ 例 release/1.133>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

command -v git >/dev/null || { echo "git が必要です"; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
	echo "作業ツリーが汚れています。コミットするか退避してから実行してください" >&2
	exit 1
fi

CURRENT_BASE="$(git merge-base HEAD "$(git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo HEAD)" 2>/dev/null || true)"
echo "== upstream を取得 =="
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/microsoft/vscode.git
git fetch upstream "$TARGET"

echo "== 触っているコアファイルが upstream 側で変わったか =="
# 台帳に載っているファイルだけを見る。ここに出たものは要注意
CORE_FILES=(
	product.json
	build/gulpfile.vscode.ts
	build/gulpfile.extensions.ts
	build/lib/extensions.ts
	src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts
	src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts
	src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts
	src/vs/workbench/contrib/welcomeGettingStarted/common/gettingStartedContent.ts
	src/vs/platform/extensionManagement/node/extensionManagementService.ts
)
for f in "${CORE_FILES[@]}"; do
	if ! git diff --quiet "${CURRENT_BASE:-HEAD}" "upstream/${TARGET#refs/heads/}" -- "$f" 2>/dev/null; then
		echo "  変更あり: $f"
	fi
done

echo
echo "== 載せ替え（rebase） =="
echo "  git rebase --onto upstream/${TARGET#refs/heads/} <現在のベース> nimbus"
echo "  ※ ベースが分からない場合は nimbus/docs/core-changes.md の記載を確認する"
echo
echo "== 載せ替えたあとに必ず行うこと =="
cat <<'STEPS'
  1. node nimbus/branding/apply-product-json.mjs
  2. node nimbus/branding/sync-builtin-extension-hashes.mjs
  3. node nimbus/branding/apply-core-changes.mjs   # 対象が見つからなければ失敗する（= upstream の変更に気づける）
  4. npm install && npm run compile
  5. node --test "extensions/nimbus/out/test/*.test.js"
  6. npm run gulp vscode-darwin-arm64 && bash nimbus/branding/smoke-packaged.sh
  7. nimbus/docs/core-changes.md を更新（当て方が変わった箇所を記録）
STEPS
