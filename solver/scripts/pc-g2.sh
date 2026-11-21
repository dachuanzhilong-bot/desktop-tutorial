#!/usr/bin/env bash
# REFACTOR_PLAN 3-3-7: G2'（端末でリバーを解き直したときの、配るラインの中での最適応答。docs/14 §11-9）を、
# srp-btn-bb の 3 フロップ（#0 As7d2c・#8 Td9d8d・#12 8c8d3s）で測る。出荷した v3 のデータと同じ戦略を、同じ手順
# （同じ反復数・平均を 500 反復目に 1 回だけ取り直す）で解き直し、リバーを N = 1,000 反復で解き直して測る。
#
#   bash solver/scripts/pc-g2.sh
#
# 1 フロップ 約 1〜2 時間（3 つで 4〜6 時間の見込み）。止まったら同じコマンドで続きから。メモリは 1 フロップ 約 8 GB。
# 環境変数（どれも省略できる）: SOLVE_THREADS（既定 nproc）、OUT_DIR（既定 out）、NO_PUSH=1（結果を送らない）、
#   SPECS（"フロップ番号 反復数 G1" の並び。既定は下）、AVG_RESTART（既定 500）、N（既定 1000）、EXTRA_ARGS（動作確認用）
# 終わると $OUT_DIR/pc-g2-report.txt を書き、結果（g2.jsonl）をブランチ data/3-3-7-g2 に送る（gh auth login が済んでいること）。
set -u
cd "$(dirname "$0")/.." || exit 1   # solver/
root=$(cd .. && pwd)
threads=${SOLVE_THREADS:-$(nproc 2>/dev/null || echo 4)}
out_dir=${OUT_DIR:-out}
pre="$out_dir/pre/cash6max-100bb"
jsonl="$out_dir/g2.jsonl"
report="$out_dir/pc-g2-report.txt"
avg_restart=${AVG_RESTART:-500}
n=${N:-1000}
extra=${EXTRA_ARGS:-}
specs=${SPECS:-"0 1500 0.4544 8 2500 0.4013 12 3000 0.4777"}

command -v cargo > /dev/null || { echo "Rust が見つかりません（. \"\$HOME/.cargo/env\"）"; exit 1; }
mkdir -p "$out_dir" "$pre" "$out_dir/g2"

report() {
  {
    echo "== $(date -u +%FT%TZ)  commit $(git rev-parse --short HEAD 2> /dev/null)"
    echo "CPU: $(lscpu 2> /dev/null | sed -n 's/^Model name: *//p')  nproc: $(nproc 2> /dev/null)  solve-threads: $threads"
    echo "--- 測定の行（mode、全カードの値 fullPct、G2' = resolve-dealt の fullPctSum）。shipped G1 と all-cards の fullPct が一致すれば、同じ戦略を作り直せている"
    set -- $specs
    while [ $# -ge 3 ]; do
      echo "flop #$1  (iterations $2, shipped G1 $3%)"
      grep -h "\"flopIndex\":$1," "$jsonl" 2> /dev/null | while read -r l; do echo "  $(echo "$l" | grep -o '"mode":"[^"]*"\|"fullPct":\(\[[^]]*\]\|[0-9.eE+-]*\)\|"fullPctSum":[0-9.eE+-]*\|"riverOnlyPct":[0-9.eE+-]*' | tr '\n' ' ')"; done
      shift 3
    done
    echo "--- the lines"
    cat "$jsonl" 2> /dev/null
  } > "$report" 2>&1
  echo
  echo "=> $report を貼ってください（送れていれば、送ったと表示されます）。"
}
trap report EXIT

echo "ビルド中..."
cargo build --release --bin measure_exploit || exit 1
if [ -z "$(ls -A "$pre" 2> /dev/null)" ]; then
  for f in ../web/public/solutions/cash6max-100bb/*.gz; do gzip -dc "$f" > "$pre/$(basename "$f" .gz)"; done
fi

set -- $specs
while [ $# -ge 3 ]; do
  fi=$1
  it=$2
  echo "=== flop #$fi: $it 反復で解き、リバーを $n 反復で解き直して測る"
  # shellcheck disable=SC2086 # EXTRA_ARGS is a list of arguments
  ./target/release/measure_exploit --all-cards-solve --resolve-river "$n" --dealt \
    --pre "$pre" --scenario srp-btn-bb --only-flop "$fi" --iters "$it" --avg-restart "$avg_restart" --river-average \
    --solve-threads "$threads" --checkpoint "$out_dir/g2/srp-btn-bb-$fi" --checkpoint-every 100 --out "$jsonl" $extra 2>&1 | tee -a "$out_dir/g2-$fi.log"
  rc=${PIPESTATUS[0]}
  if [ "$rc" -ne 0 ]; then
    echo "flop #$fi が終了コード $rc で止まりました。同じコマンドをもう一度実行すると、続きから回します。"
    exit "$rc"
  fi
  shift 3
done
echo "3 フロップとも済みました。"

if [ -z "${NO_PUSH:-}" ]; then
  report # the report first: it goes into the branch
  cd "$root" || exit 1
  dest=data-import/g2
  rm -rf "$dest"
  mkdir -p "$dest"
  cp "solver/$jsonl" "solver/$report" "$dest/"
  git config user.name > /dev/null || git config user.name "pc-run"
  git config user.email > /dev/null || git config user.email "pc-run@localhost"
  git checkout -B data/3-3-7-g2
  git add "$dest"
  git commit -q -m "3-3-7: G2' の測定結果（srp-btn-bb の 3 フロップ）" || true
  if git push -u origin data/3-3-7-g2; then echo "送りました: ブランチ data/3-3-7-g2。そう伝えてください。"; else echo "送れませんでした（gh auth login が要ります）。同じコマンドをもう一度。"; fi
fi
