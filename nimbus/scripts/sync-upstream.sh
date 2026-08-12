#!/bin/bash
# upstream（microsoft/vscode）の新しいリリースへ載せ替える。
#
#   bash nimbus/scripts/sync-upstream.sh release/1.133
#
# **載せ替えはしない。** 何が起きるかを先に全部見せて、rebase は人が打つ。
# 一度実際に回して分かったことは nimbus/docs/upstream-sync.md に書いてある。
set -euo pipefail

TARGET="${1:?使い方: sync-upstream.sh <upstream のブランチ or タグ 例 release/1.133>}"
BRANCH="${TARGET#refs/heads/}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

command -v git >/dev/null || { echo "git が必要です"; exit 1; }

# 追跡していないファイル（エディタや道具が置く一時ファイル）は rebase の邪魔をしないので見ない。
# ここを --untracked-files=no にしないと、`.observer.lock` 1 つで止まる（実際に止まった）。
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
	echo "追跡中のファイルに未コミットの変更があります。コミットしてから実行してください" >&2
	git status --short --untracked-files=no >&2
	exit 1
fi

echo "== upstream を取得 =="
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/microsoft/vscode.git
git fetch upstream "$BRANCH"

# いま乗っている upstream のリリースを product.json の version から割り出し、その分岐点を基点にする。
#
# **ここを間違えると検査が全部無意味になる。** 以前は @{u}（origin/nimbus）との
# merge-base を使っていたが、それは実質 HEAD なので「Nimbus が触ったファイル」が
# 全部「upstream で変わった」と出ていた（9 ファイル中 9 件。つまり毎回全部）。
CURRENT_RELEASE="release/$(node -p "require('./package.json').version.split('.').slice(0,2).join('.')")"
git fetch upstream "$CURRENT_RELEASE" 2>/dev/null || true
BASE="$(git merge-base HEAD "upstream/$CURRENT_RELEASE" 2>/dev/null || true)"
if [ -z "$BASE" ]; then
	echo "いま乗っている upstream の分岐点が分かりません（$CURRENT_RELEASE を取得できませんでした）" >&2
	exit 1
fi
echo "  いまの基点: $(git describe --tags --always "$BASE") ($CURRENT_RELEASE)"
echo "  載せ替え先: $BRANCH"

echo
echo "== 触っているコアファイルが upstream 側で変わったか =="
# 台帳に載っているファイルだけを見る。基点からの差分を見るので、ここに出るのは
# 「向こうが変えた」ものだけ（こちらが変えただけのものは出ない）
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
CHANGED=0
for f in "${CORE_FILES[@]}"; do
	if ! git diff --quiet "$BASE" "upstream/$BRANCH" -- "$f" 2>/dev/null; then
		echo "  変更あり: $f"
		CHANGED=$((CHANGED + 1))
	fi
done
[ "$CHANGED" -eq 0 ] && echo "  （なし）"

echo
echo "== 試しに併合して、衝突を先に数える =="
# --write-tree は作業ツリーを一切触らない。載せ替える前に実際の衝突が分かる
MERGE_OUT="$(git merge-tree --write-tree --merge-base="$BASE" HEAD "upstream/$BRANCH" 2>&1 || true)"
CONFLICTS="$(printf '%s\n' "$MERGE_OUT" | grep -c '^CONFLICT' || true)"
if [ "$CONFLICTS" -eq 0 ]; then
	echo "  衝突なし"
else
	echo "  衝突 $CONFLICTS 件:"
	printf '%s\n' "$MERGE_OUT" | grep '^CONFLICT' \
		| sed -E 's/^CONFLICT \(([^)]+)\): ([^ ]+).*/\1\t\2/' \
		| awk -F'\t' '{ kind[$1]++; if ($2 ~ /^extensions\/copilot\//) copilot++; else other[$2]=$1 } END {
			for (k in kind) printf "    %s: %d 件\n", k, kind[k];
			if (copilot) printf "    うち extensions/copilot/ 配下: %d 件（削除済みなので `git rm` で片付く）\n", copilot;
			if (length(other)) { print "    人の判断が要るもの:"; for (f in other) printf "      %s (%s)\n", f, other[f] }
		}'
fi

echo
echo "== 載せ替え（ここから先は人が打つ） =="
cat <<STEPS
  git rebase --onto upstream/$BRANCH $BASE nimbus

  衝突の大半は「Nimbus が消したファイルを upstream が変えた」形（modify/delete）。
  消したままでよいので、まとめて片付く:

    git status --porcelain | awk '/^DU |^UD /{print \$2}' | xargs -r git rm -q --
    git rebase --continue

  内容そのものの衝突（CONFLICT (content)）が出たときだけ、
  nimbus/docs/core-changes.md を見ながら手で直し、台帳の側も更新する。
STEPS

echo
echo "== 載せ替えたあとに必ず行うこと =="
cat <<'STEPS'
  1. node nimbus/branding/apply-product-json.mjs
  2. node nimbus/branding/sync-builtin-extension-hashes.mjs
  3. node nimbus/branding/apply-core-changes.mjs   # 対象が見つからなければ失敗する（= upstream の変更に気づける）
  4. npm install && npm run compile
  5. node --test "extensions/nimbus/out/test/*.test.js"
  6. node nimbus/scripts/nls-extract.mjs --check
  7. npm run gulp vscode-darwin-arm64 && bash nimbus/branding/smoke-packaged.sh
  8. nimbus/docs/core-changes.md を更新（当て方が変わった箇所を記録）
STEPS
