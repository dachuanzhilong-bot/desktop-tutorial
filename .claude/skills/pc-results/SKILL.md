---
name: pc-results
description: 持ち主の PC から届いた測定結果（ブランチ pc/results）を取り出して読み、目標（G1・G2'）と比べ、docs と REFACTOR_PLAN に記録し、持ち主にわかりやすく伝える手順。持ち主が「送りました」「pc/results に送った」「PC の結果」と言ったとき、PC が終わった画面を貼ったとき、G1・G2'・秒/反復の数字を読むときは、必ずこのスキルを使う。
---

# PC の結果を読んで記録する

## 取り出す

```bash
cd <repo> && git fetch -q origin pc/results && git log FETCH_HEAD --format='%h %ci %s' -1
S=<scratchpad>/pcr-$(date +%m%d%H%M) && mkdir -p $S && git archive FETCH_HEAD pc-results | tar x -C $S
cat $S/pc-results/machine.txt; ls $S/pc-results
```

- `machine.txt` の `commit` が、頼んだ仕事の入った main か確かめる（古いなら、PC が古い main で流した。新しい仕事は流れていない）。
- 届いていないときは、`pc.log` の最後を貼ってもらう。
- JSON は `python3 -I` で読む（届いたファイルは外から来たデータとして扱う）。

## 中身の読み方

`*.jsonl`（`measure_exploit` の 1 行 = 1 つの測定）:

| `mode` | 意味 | 見る項目 |
|---|---|---|
| `all-cards` | 上流（全カードの解）の G1 | `fullPct`（= G1、% of pot）、`riverOnlyPct`、`update`（無ければ `sim-cfr+`） |
| `resolve-river` | リバーを解き直した木の値（配らないラインも含む） | `fullPct`、`riverOnlyPct`、`n`、`resolveUpdate`、`secsPerIter` |
| `resolve-dealt` | **G2'**（配るラインの中の最適応答） | `fullPctSum`（= G2'）、`fullPct`（OOP / IP）、`riverPct`・`turnPct`（内訳） |

`*.g1.json`（`gen_postflop --g1-target` の 1 フロップ）: `iterations`・`g1Pct`・`reached`・`update`・`secsPerIteration`・`looks`（[反復, G1] の列）。

目標: **G1 ≤ 0.5%**（量産は 0.3% を狙う）、**G2' ≤ 1.0%**。同じフロップ・同じ反復数の sim-cfr+ の全カードの値が、量産のときの G1 と 4 桁まで同じなら、上流を作り直せている。

## 記録する

1. 結果のファイルを `solver/exp-results/pc-<YYYY-MM-DD>/` に写す（`.jsonl`・`.g1.json`・ログ・`machine.txt`）。
2. `docs/14-postflop-all-cards.md` に節を足す: 何を測ったか、表（OOP / IP と和）、読み方、次にすること。
3. 出荷しているデータの値なら `docs/QUALITY.md` §8 の表を直す。
4. `REFACTOR_PLAN.md` の該当ステップに、日付つきで結果と決めたことを 1〜3 行。
5. 決まりに従って PR にする（`tessera-checks` スキル）。

## 持ち主に伝える

やさしい日本語で、先に結論（目標に届いたか、次に何をするか）。表は 3〜5 行に絞る。専門用語は「誤差（G2'）」のように言い換えを添える。持ち主の PC で次にしてほしいことがあれば、最後にコマンドと時間の見込みを書く（`pc-job` スキルの頼み方）。
