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
env -u NODE_OPTIONS "$CLI" --user-data-dir "$UD" --extensions-dir "$EXT" --install-extension redhat.vscode-yaml 2>&1 | grep -viE "DeprecationWarning|trace-deprecation" | tail -3
echo "  インストール済み: $(env -u NODE_OPTIONS "$CLI" --user-data-dir "$UD" --extensions-dir "$EXT" --list-extensions 2>/dev/null | tr '\n' ' ')"

echo "== 3. 起動して Nimbus 拡張と実セッションを確認 =="
# NODE_OPTIONS は必ず外す。Electron の main は無視するが、拡張ホストなどの子 Node プロセスは
# 引き継いでしまい、`--require` が解決できないと**ウィンドウが出ないまま無言で止まる**（実測）。
# --disable-workspace-trust: Nimbus 拡張は未信頼フォルダでは無効化される設計のため、確認時は信頼した状態で動かす。
( nohup env -u NODE_OPTIONS NIMBUS_SMOKE=1 NIMBUS_SMOKE_PROMPT='Reply with exactly: NIMBUS_PACKAGED_OK' \
	"$APP/Contents/MacOS/Nimbus" --disable-workspace-trust --user-data-dir "$UD" --extensions-dir "$EXT" "$WS" > /tmp/nimbus-smoke-run.log 2>&1 & )
n=0
until pgrep -f "VSCode-darwin-arm64/Nimbus.app/Contents/MacOS/Nimbus" >/dev/null 2>&1 || [ $n -ge 60 ]; do sleep 1; n=$((n+1)); done

# 拡張のログでセッションの往復まで待つ（GUI を操作せずに経路全体を確認する）
n=0
while [ $n -lt 60 ]; do
	NIMBUS_LOG=$(find "$UD/logs" -name Nimbus.log 2>/dev/null | head -1)
	if [ -n "${NIMBUS_LOG}" ] && grep -q "ターン終了" "${NIMBUS_LOG}"; then break; fi
	sleep 2
	n=$((n+1))
done
NIMBUS_LOG=$(find "$UD/logs" -name Nimbus.log 2>/dev/null | head -1)
if [ -n "${NIMBUS_LOG}" ]; then
	echo "  --- Nimbus 拡張ログ ---"
	sed 's/^/  /' "${NIMBUS_LOG}"
else
	echo "  Nimbus 拡張のログが見つかりません（拡張が有効化されていない可能性）"
fi
sleep 4
open -a "$APP"
sleep 3

FRONT=""
BOUNDS=""
# ウィンドウ情報は起動直後だと取れないことがあるので数回粘る
for _ in 1 2 3 4 5; do
	FRONT=$(osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null)
	BOUNDS=$(osascript -e 'tell application "System Events" to tell process "Nimbus" to get {position of window 1, size of window 1}' 2>/dev/null | tr -d ' ')
	if [ "$FRONT" = "Nimbus" ] && [ -n "$BOUNDS" ]; then break; fi
	sleep 2
done
if [ "$FRONT" = "Nimbus" ] && [ -n "$BOUNDS" ]; then
  screencapture -x -R"$BOUNDS" "$OUT/packaged.png" && echo "  撮影: $OUT/packaged.png"
else
  # 変数展開は必ず ${} で囲む。macOS の bash 3.2 は直後の全角文字を変数名の一部と解釈する
  echo "  撮影を中止（frontmost=${FRONT}）— 別ウィンドウが写る危険があるため"
fi

echo "== 4. 例外の有無 =="
echo "  uncaught exception: $(grep -icE 'uncaught exception' /tmp/nimbus-smoke-run.log)"
