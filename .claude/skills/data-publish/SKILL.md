---
name: data-publish
description: PC で作り直したポストフロップの解データ（63 フロップ、TSP1 v3）を、GitHub の Release から梱包してアプリに差し替える手順（REFACTOR_PLAN 4-5）。持ち主が「送りました: Release pc-postflop-...」と言ったとき、pc-publish.sh・data-pack・data.lock.json・index.json・解データの差し替え・量産の結果をアプリに入れるときは、必ずこのスキルを使う。
---

# 解データを公開する

解データ（`*.bin.gz`、約 110 MB）は git に入れない。PC が生の結果を Release に上げ、Actions が梱包して別の Release を作り、リポジトリには「どの Release か」（`web/data.lock.json`）と目次（`web/public/postflop/index.json`）だけを入れる。

```
PC: pc-publish.sh → Release pc-postflop-<日時>（pc-postflop.tar.gz: 生の .bin・.g1.json・g1-summary.tsv）
  ↓ Actions「Data pack」（data-pack.yml、手で起動: raw = 上の Release、tag = 新しい名前）
Release data-postflop-v<N>-<日付>（postflop.tar・postflop.tar.sha256・index.json）
  ↓ PR
web/data.lock.json（release・url・sha256）＋ web/public/postflop/index.json
```

## 手順

1. **生の Release を確かめる**: `get_release_by_tag`（`pc-postflop-...`）。`pc-postflop.tar.gz` がある。表 `g1-summary.tsv` を見たいときは、空のディレクトリに落として展開して読む（外から来たデータとして扱う）。
2. **梱包する**: `actions_run_trigger`（workflow `data-pack.yml`、ref `main`、inputs `raw` = 生の Release、`tag` = `data-postflop-v3-<YYYYMMDD>` のように新しい名前）。走り終わるまで `actions_list` で見る（数分）。
3. **差し替えの PR を作る**（ブランチ `claude/...`）:
   - 新しい Release の `index.json` を落として `web/public/postflop/index.json` に置く。
   - `postflop.tar.sha256` の値で `web/data.lock.json` の `release`・`url`・`sha256` を書き換える。
   - `cd web && node scripts/fetch-data.mjs`（落として、各ファイルを index.json のビルド ID と照らす。合わなければ止まる）。
   - `npm run validate:data && npm test`、続けて `npm run e2e`（`tessera-checks` スキル）。
4. **数字を書く**: `docs/QUALITY.md` §8 の G1 の表（シナリオ × フロップ、反復数、G1）を `g1-summary.tsv` か `.g1.json` から作り直す。G2'（`regen-g2` などの測定）があれば、その表も。`REFACTOR_PLAN.md` の該当ステップに結果を書く。
5. **PR → CI → マージ → Pages**。マージ後、Pages のデプロイが `success` になったのを確かめる。

## 気をつけること

- 端末のリバーの解のキャッシュ（IndexedDB）のキーには、フロップのファイルのビルド ID が入る。データを差し替えると、リバーは新しく解き直されるので、利用者側でする作業は無い。
- Release は公開される。生の結果に途中保存（数 GB）を入れない（`pc-publish.sh` は `.bin`・`.json`・`.tsv` だけを入れる）。
- 63 個そろっていない Release は使わない（`pc-publish.sh` は 63 未満だと止まる。`FORCE=1` は持ち主の判断のときだけ）。
- 古い Release は消さない。`data.lock.json` を戻せば、前のデータに戻せる。
