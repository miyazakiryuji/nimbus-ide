#!/bin/bash
# Nimbus のテストをまとめて走らせる入口。
#
#   bash nimbus/scripts/test.sh            # unit + doctor（GUI は含めない）
#   bash nimbus/scripts/test.sh unit       # モジュールテストだけ
#   bash nimbus/scripts/test.sh gui        # GUI を実際に操作するテスト（ウィンドウが開く）
#   bash nimbus/scripts/test.sh all        # 全部
#   bash nimbus/scripts/test.sh gui --with-claude   # 実セッションの往復も確認する（課金が発生する）
#
# GUI を既定に含めないのは、ウィンドウが前面に出て作業を邪魔するため。
# 意図して走らせるときだけ `gui` を指定する。
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLCHAIN="$(dirname "$ROOT")/.toolchain/node-v24.18.0-darwin-arm64/bin"
[ -d "$TOOLCHAIN" ] && PATH="$TOOLCHAIN:$PATH"
export PATH
cd "$ROOT"

MODE="${1:-default}"
shift 2>/dev/null || true
EXTRA_ARGS=("$@")
failed=()

run_step() {
	local label="$1"
	shift
	echo ""
	echo "──────── $label"
	# NODE_OPTIONS は外す。子プロセスが引き継ぐと Electron 側が無言で止まる（実測）
	if env -u NODE_OPTIONS "$@"; then
		echo "  ✔ $label"
	else
		echo "  ✖ $label"
		failed+=("$label")
	fi
}

compile_if_needed() {
	if [ ! -f extensions/nimbus/out/extension.js ] || [ -n "$(find extensions/nimbus/src -newer extensions/nimbus/out/extension.js -name '*.ts' -print -quit 2>/dev/null)" ]; then
		echo "── 変更があるのでコンパイルします"
		env -u NODE_OPTIONS npm run compile > /tmp/nimbus-test-compile.log 2>&1 || {
			echo "  ✖ コンパイル失敗（/tmp/nimbus-test-compile.log）"
			grep -iE "error TS" /tmp/nimbus-test-compile.log | head -10
			exit 1
		}
	fi
}

case "$MODE" in
	unit)
		compile_if_needed
		run_step "モジュールテスト" node --test "extensions/nimbus/out/test/"*.test.js
		run_step "スクリプトのテスト" node --test "nimbus/tests/scripts/"*.test.mjs
		;;
	doctor)
		run_step "ドクター（不要ファイル・仕様ズレ）" node nimbus/scripts/doctor.mjs
		;;
	degrade)
		# 基準（nimbus/tests/baseline.json）との突き合わせ（T-335）。減りがあれば赤
		run_step "デグレチェック" node nimbus/scripts/degrade.mjs check "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
		;;
	gui)
		compile_if_needed
		run_step "GUI テスト" node nimbus/tests/gui/run.mjs "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
		;;
	all)
		compile_if_needed
		run_step "モジュールテスト" node --test "extensions/nimbus/out/test/"*.test.js
		run_step "スクリプトのテスト" node --test "nimbus/tests/scripts/"*.test.mjs
		run_step "ドクター（不要ファイル・仕様ズレ）" node nimbus/scripts/doctor.mjs
		run_step "GUI テスト" node nimbus/tests/gui/run.mjs "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
		;;
	default)
		compile_if_needed
		run_step "モジュールテスト" node --test "extensions/nimbus/out/test/"*.test.js
		run_step "スクリプトのテスト" node --test "nimbus/tests/scripts/"*.test.mjs
		run_step "ドクター（不要ファイル・仕様ズレ）" node nimbus/scripts/doctor.mjs
		echo ""
		echo "（GUI テストは含めていません。走らせるなら: bash nimbus/scripts/test.sh gui）"
		;;
	*)
		echo "使い方: test.sh [unit|doctor|degrade|gui|all] [--with-claude]" >&2
		exit 2
		;;
esac

echo ""
if [ ${#failed[@]} -eq 0 ]; then
	echo "════ すべて通りました"
	exit 0
fi
echo "════ 失敗: ${failed[*]}"
exit 1
