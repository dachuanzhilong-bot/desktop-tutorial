---
name: pc-job
description: 持ち主の PC（Ryzen 9 7900X・24 スレッド・WSL2 のメモリ 15.9 GB・RTX 4060 Ti）で流す仕事を、solver/scripts/pc-queue.txt に足して頼む手順。49×48 の全カードの解・G1/G2' の測定・量産（63 フロップ）・時間の測定など、クラウドのコンテナでは重すぎる計算をするとき、「PC で流して」「pc.sh」「pc-queue」「持ち主の PC で測る」と言うとき、PC に新しい測定を頼む前には、必ずこのスキルを使う。
---

# PC の仕事を足して頼む

クラウドのコンテナ（4 コア）では、49×48 の木（1 フロップ約 8 GB、数十分〜数時間）は重すぎる。こういう計算は `pc-queue.txt` に 1 行で書いて main に入れ、持ち主に `pc.sh` を 1 回流してもらう。結果はブランチ `pc/results` に届く（読み方は `pc-results` スキル）。

## pc.sh の動き（`solver/scripts/pc.sh`）

1. `git checkout -B main origin/main`（**PC は main しか見ない**。仕事を足した PR をマージしてから頼む）。
2. `cargo build --release --bin gen_postflop --bin measure_exploit`。出荷済みのプリフロップ解を `out/pre/cash6max-100bb` に展開。
3. `pc-queue.txt` を上から順に流す。済んだ仕事（`$OUT/pc-done/<名前>` がある）は飛ばす。
4. `$OUT/q/*/` の小さなファイル（`*.g1.json`・`*.stats.json`・`*.jsonl`・`index.json`、2 MB 未満）とログを `pc-results/` に集め、ブランチ `pc/results` に push する。

## 1 行の書き方

```
名前<TAB>コマンド
```

- コマンドは `solver/` で `bash -c` で流れる。使える変数は `$THREADS`（スレッド数）・`$OUT`（既定 `out`）・`$PRE`（プリフロップ解）。
- 終了コード 0 か 3 で「済み」になる（3 は `gen_postflop` の「目標に届かなかったフロップがある」で、結果は書いてある）。それ以外は失敗で、次に流したとき、もう一度流れる。
- 結果は `$OUT/q/<名前>/` に置くと送られる。大きなファイル（`.bin`、途中保存）は置かない。
- 仕事の前の行に `#` で、何を確かめる仕事か、どのくらいかかるかを日本語で書く。
- `gen_postflop --all-cards` の既定の解き方は `alt-dcfr`（2026-11-22 から）。比べる測定では `--update` を必ず書く。
- G2' は `scripts/pc-g2.sh` を使う（`SPECS`・`N`・`AVG_RESTART`・`EXTRA_ARGS`・`OUT_DIR`・`NO_PUSH=1`）。`measure_exploit` の `--resolve-update alt-dcfr` は、端末と同じリバーの解き直し。
- 量産は `scripts/pc-run.sh all`（`POSTFLOP_DIR`・`G1_TARGET`）、Release に上げるのは `scripts/pc-publish.sh`（`SRC`、`gh` のログインが要る）。

足したら、すべての行の文法を確かめる:

```bash
cd solver && grep -v '^#' scripts/pc-queue.txt | grep -v '^$' | while IFS=$'\t' read -r name cmd; do bash -n -c "$cmd" && echo "ok $name"; done
```

できれば同じコマンドを小さな木（`--turn-cards 3 --river-cards 2 --flop-runouts 24` など）でコンテナで一度流し、出力の形（`.g1.json`・`.jsonl` の項目、済んだ行が飛ばされること）を確かめる。

## メモリと時間

- 49×48 の 1 フロップは約 8 GB。WSL の上限は 15.9 GB なので、**2 つを同時に流さない**（2 フロップ同時や、`pc.sh` を 2 回貼った場合も同じ）。
- 時間の目安（24 スレッド）: `alt-dcfr` の全カードの解 1 反復 0.94 秒、`sim-cfr+` 0.75 秒。リバーの解き直し 1 反復 0.74〜0.97 秒。G2' は 1 フロップ 20〜80 分。

## 持ち主への頼み方（やさしい日本語で）

PR をマージしてから、次を送る。

```bash
cd ~/desktop-tutorial && nohup bash solver/scripts/pc.sh > pc.log 2>&1 &
```

- 1 回だけ貼る（2 回貼ると、同じ仕事が 2 つ動いてメモリが足りなくなる）。動いているかは `pgrep -c measure_exploit`（または `gen_postflop`）が `1`。
- 進み具合は `tail -f ~/desktop-tutorial/solver/out/pc-logs/<名前>.log`（Ctrl+C は表示を止めるだけ）。
- Windows Update の一時停止と、スリープしない設定。止まっても、同じ 1 行で続きから。
- 何がわかる仕事か、何時間かかるかを 1〜2 行で。終わったら「送りました」と出るので、そう伝えてもらう。
