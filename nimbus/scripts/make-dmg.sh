#!/bin/bash
# 配布用の .dmg を作る。
#
#   npm run gulp vscode-darwin-arm64      # 先に .app を作っておく
#   bash nimbus/scripts/make-dmg.sh 0.6.0
#
# 署名は ad-hoc のまま（Apple Developer Program に入っていないため）。
# **開発者の実名が署名に載らないこと**を必ず確認する。過去に実名が入った実績がある。
set -euo pipefail

VERSION="${1:?使い方: make-dmg.sh <version>}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$(dirname "$ROOT")/Nimbus-darwin-arm64/Nimbus.app"
OUT="$ROOT/.build/dist"
DMG="$OUT/nimbus-${VERSION}-darwin-arm64.dmg"

[ -d "$APP" ] || { echo "先に .app をビルドしてください: $APP が見つかりません"; exit 1; }
mkdir -p "$OUT"
rm -f "$DMG"

echo "== 署名の確認 =="
codesign -dv "$APP" 2>&1 | grep -E "Signature|TeamIdentifier" || true
# 既定は ad-hoc のまま。**実名が署名に載らないこと**を確かめる（過去に載った実績がある）。
# 公証する（T-006）ときだけ、NIMBUS_SIGN_IDENTITY を置いて明示的に切り替える。
# 公証には Developer ID 証明書が要り、その署名にはチーム名が載る — それを承知で選ぶ。
if [ -z "${NIMBUS_SIGN_IDENTITY:-}" ]; then
	if codesign -dvvv "$APP" 2>&1 | grep -qiE "^Authority=.*(Developer ID|Apple Development)"; then
		echo "!! 個人名を含む署名が付いています。ad-hoc で署名し直してください" >&2
		echo "   （公証したい場合は NIMBUS_SIGN_IDENTITY を設定してください）" >&2
		exit 1
	fi
else
	echo "  公証あり: $NIMBUS_SIGN_IDENTITY で署名します（署名にチーム名が載ります）"
	bash "$ROOT/nimbus/scripts/notarize.sh" "$APP"
fi

echo "== dmg を作成 =="
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/Nimbus.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Nimbus ${VERSION}" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

# .app を公証しても、包んだ .dmg 自体は未公証のまま。
# **配る対象は dmg なので、こちらも通す**（通さないと、ダウンロード直後に警告が出る）
if [ -n "${NIMBUS_SIGN_IDENTITY:-}" ]; then
	echo "== dmg を公証 =="
	bash "$ROOT/nimbus/scripts/notarize.sh" "$DMG"
fi

echo "== 完成 =="
ls -lh "$DMG" | awk '{print $9, $5}'
shasum -a 256 "$DMG"
