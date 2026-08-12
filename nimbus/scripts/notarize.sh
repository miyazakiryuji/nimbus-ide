#!/bin/bash
# Apple の公証（notarization）を通す（tasks.md T-006）。
#
#   bash nimbus/scripts/notarize.sh <path-to-app-or-dmg>
#
# これを通すと、初回起動の「右クリック → 開く」が要らなくなる。
#
# ## 使う前に決めること
#
# 公証には **Developer ID 証明書**が要る。この証明書で署名すると、配布物の署名に
# **チーム名（多くの場合は個人名）が載る**。`codesign -dv` を打てば誰でも読める。
# これは Apple の仕組み上避けられない — 「誰が配ったか分かる」ことが、
# 警告を出さない理由そのものだから。
#
# そのため make-dmg.sh は、既定では **ad-hoc 署名しか通さない**（実名が載らない）。
# 公証したいときだけ、環境変数で明示的に切り替える。
#
# ## 要るもの
#
#   NIMBUS_SIGN_IDENTITY   Developer ID Application: ... の証明書名
#   NIMBUS_NOTARY_PROFILE  `xcrun notarytool store-credentials` で保存した名前
#
# 保存は 1 度だけ:
#
#   xcrun notarytool store-credentials "nimbus" \
#     --apple-id "<Apple ID>" --team-id "<Team ID>" --password "<App 用パスワード>"
#
# App 用パスワードは appleid.apple.com で作る（Apple ID の本体パスワードではない）。
#
# ## 確かめかた
#
#   NIMBUS_DRY_RUN=1 bash nimbus/scripts/notarize.sh <path>
#
# 証明書が無くても、**手順と前提の確認までは通る**。
set -euo pipefail

TARGET="${1:?使い方: notarize.sh <path-to-app-or-dmg>}"
DRY_RUN="${NIMBUS_DRY_RUN:-}"

fail() {
	echo "!! $1" >&2
	exit 1
}

[ -e "$TARGET" ] || fail "$TARGET が見つかりません"

echo "== 前提の確認 =="
xcrun --find notarytool >/dev/null 2>&1 || fail "notarytool がありません（Xcode の command line tools を入れてください）"
xcrun --find stapler >/dev/null 2>&1 || fail "stapler がありません"
echo "  ✔ notarytool / stapler"

IDENTITY="${NIMBUS_SIGN_IDENTITY:-}"
PROFILE="${NIMBUS_NOTARY_PROFILE:-}"

if [ -z "$IDENTITY" ] || [ -z "$PROFILE" ]; then
	if [ -n "$DRY_RUN" ]; then
		echo "  … NIMBUS_SIGN_IDENTITY / NIMBUS_NOTARY_PROFILE は未設定（dry run なので続けます）"
	else
		fail "NIMBUS_SIGN_IDENTITY と NIMBUS_NOTARY_PROFILE を設定してください（このファイルの先頭に手順があります）"
	fi
else
	security find-identity -v -p codesigning | grep -q "$IDENTITY" ||
		fail "証明書「$IDENTITY」がキーチェーンにありません"
	echo "  ✔ 証明書: $IDENTITY"
fi

# .app は中身ごと署名する。dmg は署名済みの .app を包んだだけなので、包みだけ署名する
case "$TARGET" in
*.app)
	SIGN_ARGS=(--force --options runtime --timestamp --deep)
	;;
*)
	SIGN_ARGS=(--force --options runtime --timestamp)
	;;
esac

echo ""
echo "== 署名 =="
if [ -n "$DRY_RUN" ]; then
	echo "  (dry run) codesign ${SIGN_ARGS[*]} --sign \"\$NIMBUS_SIGN_IDENTITY\" \"$TARGET\""
else
	codesign "${SIGN_ARGS[@]}" --sign "$IDENTITY" "$TARGET"
	codesign --verify --strict --verbose=2 "$TARGET"
fi

echo ""
echo "== 提出 =="
if [ -n "$DRY_RUN" ]; then
	echo "  (dry run) xcrun notarytool submit \"$TARGET\" --keychain-profile \"\$NIMBUS_NOTARY_PROFILE\" --wait"
else
	# --wait を付ける。付けないと、通ったかどうかを別途取りに行くことになる
	xcrun notarytool submit "$TARGET" --keychain-profile "$PROFILE" --wait
fi

echo ""
echo "== 添付（staple）=="
# これをしないと、**ネットワークが無い環境で初回起動が弾かれる**。
# 公証の結果は Apple のサーバにあり、staple で成果物の中へ写しておく
if [ -n "$DRY_RUN" ]; then
	echo "  (dry run) xcrun stapler staple \"$TARGET\""
else
	xcrun stapler staple "$TARGET"
	xcrun stapler validate "$TARGET"
fi

echo ""
echo "== 確認 =="
if [ -n "$DRY_RUN" ]; then
	echo "  (dry run) spctl -a -vv -t install \"$TARGET\""
	echo ""
	echo "dry run はここまでです。実際に通すには NIMBUS_SIGN_IDENTITY と NIMBUS_NOTARY_PROFILE を設定してください。"
else
	# 受け入れられるかを、配る前にここで見る
	spctl -a -vv -t install "$TARGET" 2>&1 | tee /dev/stderr | grep -q "accepted" ||
		fail "spctl が受け入れませんでした。上の出力を確認してください"
	echo ""
	echo "完了。初回起動の「右クリック → 開く」は要らなくなります。"
fi
