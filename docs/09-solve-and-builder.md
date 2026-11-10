# 09. Solve（ブラウザ内計算）・ノードロック・Range Builder

Phase 4 の設計と実装メモ。

## 構成

```
solver/src/ffi.rs            C ABI (tsr_*) と Session（木＋ソルバー＋最後の書き出し）
solver/src/postflop.rs       ノードロック (lock_node/unlock_node)、export_with_map
web/public/wasm/tessera_solver.wasm   wasm32-unknown-unknown（依存なし, 約130KB）
web/public/solver-worker.js  Web Worker（WASMをメインスレッドの外で実行）
web/src/lib/solve/           SolverClient(Promise API)・設定のf32配列化・下書き保存
web/src/lib/ranges/          レンジのテキスト形式・比較スコア・プリフロップ解からのプリセット
web/src/app/solve/           Solve画面     web/src/app/builder/   Range Builder
web/src/components/postflop/PostflopViewer.tsx   Study(ポストフロップ)と共通の結果ビュー
```

WASMは `web/scripts/build-wasm.sh`（`npm run wasm`）で再生成する。ビルド済みの `.wasm` はリポジトリに含まれている。

## C ABI（`solver/src/ffi.rs`）

wasm-bindgen を使わない（crate取得が不要）。JSがWASMメモリにf32/u8配列を書き、ポインタを渡す。

| 関数 | 役割 |
|------|------|
| `tsr_alloc/free`, `tsr_alloc_f32/free_f32` | バッファ確保・解放 |
| `tsr_create(cfg, cfg_len, board, board_len, r0, r1) -> handle` | ゲーム木とソルバーを作る。負値はエラー（-1 設定, -2 ボード） |
| `tsr_run(h, n)` / `tsr_iterations(h)` / `tsr_node_count(h)` | n反復 |
| `tsr_reset_average(h)` | 戦略の合計を捨てる（平均の取り直し。リグレットは残す） |
| `tsr_exploit_pct(h)` | exploitability（初期ポットに対する％） |
| `tsr_export(h, min_reach) -> len` / `tsr_out_ptr` / `tsr_map_ptr,len` | TSP1 形式のバイト列と「書き出しノードID → 木のノードID」の対応 |
| `tsr_lock(h, node, strategy, len)` / `tsr_unlock(h, node)` | ノードロック |

設定（f32配列）: `[pot, stack, raise_mult, allin_ratio, allow_allin, raise?×3(flop/turn/river), turn_cards, river_cards, flop_runouts, seed]` に続けて、街ごとに `n, 比率×n`。

書き出しは Study が読む **TSP1 そのまま**なので、`decodeFlop` と `PostflopViewer` を共通で使える。

## Worker プロトコル（`public/solver-worker.js`）

`{req, type, ...}` を送ると、同じ `req` で `…done`/`error` が1回返る。`run` は途中で `progress {done,total,exploit}` を送る。

- `run`: `chunk` 反復ごとにイベントループへ戻る（`cancel` を受け付け、UIが固まらない）。`restartAt`（その反復で平均を取り直す）、`target`（exploitabilityがこれを下回ったら早期終了）、`checkEvery`（exploitabilityを測る間隔。測定は反復より重いので間引く）。
- 結果の `bytes`/`map` は Transferable で渡す（コピーなし）。

## 速度の実測（WASM, 単スレッド。この開発環境のCPUで測定）

既定のベットサイズ（フロップ50% / ターン66% / リバー50%・100%、いずれもオールイン付き、レイズなし、ターン4枚・リバー2枚サンプル）。ランダムな広いレンジ（OOP約35%・IP約45%）での計測で、実際の（構造のある）レンジより収束は遅めに出る。

| 計算の開始 | ノード数 | 1反復 | 書き出し |
|-----------|---------|-------|---------|
| リバー（ボード5枚） | 27 | 0.6 ms | 33 KB |
| ターン（ボード4枚） | 177 | 6.7 ms | 111 KB |
| フロップ（ボード3枚） | 2,139 | 約92 ms | 約0.4 MB |
| フロップ 出荷データと同じサイズ設定（2サイズ+レイズ、ターン6/リバー2枚） | 9,321 | 約410 ms | 0.45 MB |

収束（exploitability = ポットに対する％、反復の半分で平均を取り直した結果）:

| 反復 | リバー | ターン | フロップ(既定) |
|------|--------|--------|----------------|
| 100 | – | 8.5% | – |
| 200 | 2.3% | – | – |
| 250 | – | – | 3.1% (約22秒) |
| 400 | – | 2.1% | – |
| 600 | 1.2% | – | – |
| 1,000 | 0.9% (0.6秒) | 1.0% (6.7秒) | – |
| 2,000 | 0.5% | 0.44% (13秒) | – |
| 4,000 | 0.19% (2.6秒) | – | – |

→ **リバー・ターンは実用精度に収まる。フロップは概算**（出荷データの0.2〜0.8%は、より大きい木で1,400反復を4スレッドで約40分かけて得たもの）。SIMDは効果がなかったので入れていない（ベースラインのWASMのみ）。

画面の「目安: 約N秒」は `costHint`（ベット選択肢数とサンプルカード枚数からの粗い式）で、実行中は実測から「残り約N秒」を出す。精度プリセットの反復回数は 開始ストリート（フロップ/ターン/リバー）ごとに ドラフト 60/150/300・標準 250/600/1,000・高精度 600/2,000/4,000。

## ノードロックの意味

`lock_node(node, strategy)`: そのノード（その手番のプレイヤー）の戦略を `strategy`（アクション×1,326コンボ）に**固定**する。

- ロックされたノードでは リグレットも平均戦略も更新しない。
- 相手は固定された戦略に対する最適対応へ再収束する。ロックした側の**他のノード**も、その状況に合わせて再調整される（例: 「OOPは常にチェック」を固定すると、IPのベット頻度と、OOPの以降のノードでの対応が変わる）。
- exploitability の best-response 計算では、ロックされたノードは「選べない」ものとして扱う（ロックした側は最善手を選べないので、exploitabilityは“固定部分以外のずれ”を測る）。
- UI: 対象は「レンジ全体 / 絞り込み中のハンド（ハンド種類・ブロッカーのフィルター）/ 選択中のハンドクラス」。スライダーで頻度を決め（合計100%に自動で調整）、「ロックして再計算」で 50/150/400 反復を追加して再収束させる。ロック前の頻度は対象外のハンドにそのまま残す。再計算では平均を途中で取り直す。
- ロックは**計算中のソルバー**にだけ存在する（保存した結果からはロックできない。「設定を読み込む」で再計算）。

## 保存と下書き

- IndexedDB v2: `solves`（ボード・設定・レンジ文字列・結果のTSP1バイト列）、`ranges`（名前＋レンジ文字列）。書き出しJSONには `ranges` だけ含める（solvesは大きく、再計算できる）。
- Solve画面の入力は `localStorage`（`tessera.solveDraft.v1`）に下書き保存され、Range Builderとの往復や再訪で消えない。
- 保存した結果は `/study/postflop/#solve=<id>` で Study 形式（ライン移動・13×13・フィルター）で開ける。

## レンジのテキスト形式（PIO風）

`AA,KK:0.5,AKs,A5s-A2s,JTs+,77-55,T9s-54s,QJo:25%`

- ペア `QQ` / スーテッド `AKs` / オフスート `AKo` / `AK`（両方）
- `QQ+`（QQ,KK,AA）, `A5s+`（A5s〜AKs）, `ATo+`
- 範囲 `77-55`、`A5s-A2s`（同じハイカード）、`JTs-54s`（同じ間隔を下へ）
- 頻度 `:0.5` または `:50%`（1より大きい数は％として扱う）
- 区切りはカンマ・空白。読めない語は `errors` に返し、読めた部分は取り込む
- 書き出し（`formatRange`）は同じ頻度の連なりをまとめる。ランダムなレンジのラウンドトリップをテストしている

## GTO比較スコア

自分のレンジ `u` と基準レンジ `g`（プリフロップ解の `重み×選んだアクションの頻度`）の、**コンボ数で重み付けしたJaccard類似度** `Σ min(u,g) / Σ max(u,g) × 100`。不足 = `Σ max(0, g−u)`、余分 = `Σ max(0, u−g)`（コンボ）。チャート上では緑=一致・青=不足・赤=余分（模様付き）で重ねて表示できる。

## 限界

- ブラウザ内のフロップ計算は概算（上の表）。出荷データ（1,400反復）の精度を再現するにはデスクトップのCLI（`gen_postflop`）を使う。
- スレッド並列なし（WASM threads/SharedArrayBufferは配信ヘッダーが必要なため使っていない）。
- ベットサイズは街ごとに最大3つ+オールイン（レイズはサイズ1種類=3倍）。
- 3人以上のポットは扱えない（ポストフロップは常にヘッズアップ）。
