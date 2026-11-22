#!/usr/bin/env bash
# REFACTOR_PLAN 3-3-7: 量産の測定と本番を、この PC で回す（Linux / macOS / Windows は WSL2 の中で）。
#
#   bash solver/scripts/pc-run.sh measure   # As7d2c の 1 フロップだけ。秒/反復・反復数・G1 の推移を測る
#   bash solver/scripts/pc-run.sh all       # 3 シナリオ × 21 フロップ。止まったら同じコマンドで続きから
#
# 環境変数（どれも省略できる）:
#   SOLVE_THREADS  1 フロップを解くスレッド数（既定: nproc）。12 コア 24 スレッドの CPU なら 12 と 24 を比べるとよい
#   FLOPS_AT_ONCE  同時に解くフロップ数（既定: 1。メモリは 1 フロップ約 8 GB）
#   OUT_DIR        出力先（既定: out）
#   POSTFLOP_DIR   結果を書くディレクトリの名前（OUT_DIR の下。既定: postflop-v3）
#   G1_TARGET      G1 の目標（% of pot、既定: 0.5）。解き方は gen_postflop --all-cards の既定（2026-11-22 から alt-dcfr）
#   EXTRA_ARGS     gen_postflop にそのまま渡す引数（動作確認用）
#
# 終わっても、Ctrl-C で止めても、$OUT_DIR/pc-report.txt（機械の情報・秒/反復・G1 の推移）を書く。それを貼ってください。
# 長く回すときは tmux の中か nohup で（例: nohup bash solver/scripts/pc-run.sh all > run.log 2>&1 &）。電源に繋ぎ、スリープしない設定に。
set -u
cd "$(dirname "$0")/.." || exit 1   # solver/
mode=${1:-measure}
threads=${SOLVE_THREADS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}
at_once=${FLOPS_AT_ONCE:-1}
out_dir=${OUT_DIR:-out}
pre="$out_dir/pre/cash6max-100bb"
out="$out_dir/${POSTFLOP_DIR:-postflop-v3}"
g1_target=${G1_TARGET:-0.5}
report="$out_dir/pc-report.txt"
extra=${EXTRA_ARGS:-}

command -v cargo >/dev/null || { echo "Rust が見つかりません。次を実行してから、ターミナルを開き直してください:"; echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; exit 1; }
case "$mode" in measure | all) ;; *) echo "使い方: bash solver/scripts/pc-run.sh measure|all"; exit 1 ;; esac
mkdir -p "$out_dir" "$pre" "$out" "$out_dir/ck"

mem_gb=""
[ -r /proc/meminfo ] && mem_gb=$(awk '/MemAvailable/ { printf "%d", $2 / 1048576 }' /proc/meminfo)
disk_gb=$(df -Pk . | awk 'NR == 2 { printf "%d", $4 / 1048576 }')
echo "空きメモリ ${mem_gb:-?} GB（1 フロップあたり約 8 GB）、空きディスク ${disk_gb:-?} GB（途中保存に 16 GB 前後）、スレッド $threads、同時フロップ $at_once"
[ -n "$mem_gb" ] && [ "$mem_gb" -lt $((8 * at_once + 2)) ] && echo "警告: メモリが足りないかもしれません（他のアプリを閉じるか、WSL2 なら .wslconfig の memory を増やす）"
[ -n "$disk_gb" ] && [ "$disk_gb" -lt 20 ] && echo "警告: ディスクの空きが 20 GB 未満です"

report() {
  {
    echo "== $(date -u +%FT%TZ)  mode $mode  commit $(git rev-parse --short HEAD 2>/dev/null)"
    echo "CPU: $(lscpu 2>/dev/null | sed -n 's/^Model name: *//p')  nproc: $(nproc 2>/dev/null)  solve-threads: $threads  flops at once: $at_once"
    echo "RAM: $(grep MemTotal /proc/meminfo 2>/dev/null)  available at start: ${mem_gb:-?} GB   disk free at start: ${disk_gb:-?} GB"
    command -v nvidia-smi >/dev/null && echo "GPU: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null)"
    echo "--- the logs (s/iteration, G1 values, misses)"
    for l in "$out_dir"/gen-*.log; do
      [ -f "$l" ] || continue
      echo "# $l"
      grep -E "s/iteration|value |NOT REACHED|iterations: |resumed" "$l" | tail -n 25
    done
    echo "--- the .g1.json of the flops written"
    for f in "$out"/*/*.g1.json; do [ -f "$f" ] && echo "$f: $(cat "$f")"; done
  } > "$report" 2>&1
  echo
  echo "=> $report を、そのまま貼ってください。"
}
trap report EXIT

echo "ビルド中..."
cargo build --release --bin gen_postflop || exit 1
# 出荷済みのプリフロップ解（100bb）を展開する（済んでいれば飛ばす）
if [ -z "$(ls -A "$pre" 2>/dev/null)" ]; then
  for f in ../web/public/solutions/cash6max-100bb/*.gz; do gzip -dc "$f" > "$pre/$(basename "$f" .gz)"; done
fi

run() { # scenario [more gen_postflop arguments]
  local sc=$1
  shift
  # shellcheck disable=SC2086 # EXTRA_ARGS is a list of arguments
  ./target/release/gen_postflop --all-cards --g1-target "$g1_target" --pre "$pre" --out "$out" --scenario "$sc" "$@" \
    --threads "$at_once" --solve-threads "$threads" --checkpoint "$out_dir/ck" --checkpoint-every 100 $extra 2>&1 | tee -a "$out_dir/gen-$sc.log"
  return "${PIPESTATUS[0]}"
}

if [ "$mode" = measure ]; then
  run srp-btn-bb --only-flop 0
  exit $?
fi
for sc in srp-btn-bb srp-co-bb 3bp-btn-bb; do
  run "$sc"
  rc=$?
  # 3 = 目標に届かないフロップがあった（書いてあるので先へ進む。最後に報告に載る）。それ以外は止める
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 3 ]; then
    echo "$sc が終了コード $rc で止まりました。同じコマンドをもう一度実行すると、続きから回します。"
    exit "$rc"
  fi
done
echo "全シナリオが済みました。"
