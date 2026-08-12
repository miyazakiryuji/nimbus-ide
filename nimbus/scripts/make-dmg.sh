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
if codesign -dvvv "$APP" 2>&1 | grep -qiE "^Authority=.*(Developer ID|Apple Development)"; then
	echo "!! 個人名を含む署名が付いています。ad-hoc で署名し直してください" >&2
	exit 1
fi

echo "== dmg を作成 =="
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/Nimbus.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Nimbus ${VERSION}" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

echo "== 完成 =="
ls -lh "$DMG" | awk '{print $9, $5}'
shasum -a 256 "$DMG"
