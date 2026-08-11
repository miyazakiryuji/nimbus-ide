#!/bin/bash
# パッケージ版 Nimbus の受け入れ確認。
#
# 個人情報を写さないため、スクリーンショットは
#   「アプリを前面化 → frontmost が Nimbus であることを確認 → そのウィンドウ矩形だけを撮る」
# の順を必ず守る（前面でないまま座標指定で撮ると、裏の別ウィンドウが写る）。
#
#   bash nimbus/branding/smoke-packaged.sh [出力先ディレクトリ]
set -uo pipefail

APP="$(cd "$(dirname "$0")/../.." && pwd)/../VSCode-darwin-arm64/Nimbus.app"
OUT="${1:-/tmp/nimbus-smoke}"
UD=/tmp/nimbus-smoke-userdata
EXT=/tmp/nimbus-smoke-ext
WS=/tmp/nimbus-smoke-ws

mkdir -p "$OUT"
pkill -f "VSCode-darwin-arm64/Nimbus.app" 2>/dev/null
sleep 2
rm -rf "$UD" "$EXT" "$WS"
mkdir -p "$UD/User" "$EXT" "$WS"

printf '# Nimbus\n\nWebview が動いているかを確認するための markdown です。\n\n- 箇条書き\n- **強調**\n' > "$WS/webview-check.md"
# markdown を必ずプレビュー（= webview）で開かせる
cat > "$UD/User/settings.json" <<'JSON'
{
  "workbench.editorAssociations": { "*.md": "vscode.markdown.preview.editor" }
}
JSON

echo "== 1. アプリの身元 =="
for key in CFBundleName CFBundleIdentifier CFBundleExecutable CFBundleIconFile; do
  printf '  %-20s %s\n' "$key" "$(/usr/libexec/PlistBuddy -c "Print :$key" "$APP/Contents/Info.plist" 2>/dev/null)"
done
printf '  %-20s %s\n' "CLI" "$(ls "$APP/Contents/Resources/app/bin/" 2>/dev/null | tr '\n' ' ')"

echo "== 2. Open VSX から拡張をインストール =="
CLI="$APP/Contents/Resources/app/bin/$(ls "$APP/Contents/Resources/app/bin/" | head -1)"
"$CLI" --user-data-dir "$UD" --extensions-dir "$EXT" --install-extension redhat.vscode-yaml 2>&1 | grep -viE "DeprecationWarning|trace-deprecation" | tail -3
echo "  インストール済み: $("$CLI" --user-data-dir "$UD" --extensions-dir "$EXT" --list-extensions 2>/dev/null | tr '\n' ' ')"

echo "== 3. 起動して webview を確認 =="
( nohup "$APP/Contents/MacOS/Nimbus" --user-data-dir "$UD" --extensions-dir "$EXT" "$WS/webview-check.md" > /tmp/nimbus-smoke-run.log 2>&1 & )
n=0
until pgrep -f "VSCode-darwin-arm64/Nimbus.app/Contents/MacOS/Nimbus" >/dev/null 2>&1 || [ $n -ge 60 ]; do sleep 1; n=$((n+1)); done
sleep 14
open -a "$APP"
sleep 3

FRONT=$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null)
BOUNDS=$(osascript -e 'tell application "System Events" to tell process "Nimbus" to get {position of window 1, size of window 1}' 2>/dev/null | tr -d ' ')
if [ "$FRONT" = "Nimbus" ] && [ -n "$BOUNDS" ]; then
  screencapture -x -R"$BOUNDS" "$OUT/packaged.png" && echo "  撮影: $OUT/packaged.png"
else
  echo "  撮影を中止（frontmost=$FRONT）— 別ウィンドウが写る危険があるため"
fi

echo "== 4. 例外の有無 =="
echo "  uncaught exception: $(grep -icE 'uncaught exception' /tmp/nimbus-smoke-run.log)"
