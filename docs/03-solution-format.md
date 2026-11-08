# 03. 解データの形式 (Solution format v1)

目的: 事前計算した解を **小さく・必要な分だけ・オフラインで** 読み込めること。

```
/solutions/
  index.json                    ← PWAがオフライン用に事前キャッシュするファイル一覧
  <id>/                         例: cash6max-100bb
    manifest.json.gz            ← 木の構造(全ノード)・メタ情報
    chunk-<n>.bin.gz            ← ノードごとの手札データ(チャンク単位で遅延読込)
```
`.gz` は **gzip**。ブラウザは `DecompressionStream("gzip")` で展開する。
ホスティング側が `.gz` を自動展開して配信する場合に備え、ローダーは先頭2バイト(`1f 8b`)を見て展開するかを決める。

## manifest.json

```jsonc
{
  "format": 1,
  "id": "cash6max-100bb",
  "players": ["UTG","HJ","CO","BTN","SB","BB"],
  "stack": 100, "blinds": [0.5, 1],
  "info": { "solver": "tessera-cfr+", "iterations": 2000, "polish": 4000, "brGainMax": 0.001, "real": {…} },
  "chunks": ["root","sb-limp","sb-open","btn-open","co-open","hj-open","utg-open"],
  "nodes": [
    // [actor, reach, chunkIndex, [[kind, to, child, term], ...]]
    [0, 1.0, 0, [[0,0,1,-1],[2,2.5,158,-1]]]
  ]
}
```

| フィールド | 意味 |
|-----------|------|
| `actor` | 判断する席 0..5（UTG,HJ,CO,BTN,SB,BB） |
| `reach` | そのラインに到達する確率（全員のレンジを掛けたもの）。出題の重み付けに使う |
| `kind` | 0 fold / 1 call(check, limp) / 2 raise / 3 all-in |
| `to` | レイズ後の総額(bb)。コールは合わせる額。フォールドは0 |
| `child` | 次のノードID。`-1`=終端、`-2`=ほぼ選ばれず枝刈り |
| `term` | 終端の種類: 0 全員フォールド / 1 ヘッズアップでフロップ / 2 オールイン / 3 3人でフロップ / `-1` 非終端 |

ポット・各人の投入額・フォールド状況は、ルートからアクションを再生して**クライアントで計算**する（`web/src/lib/solution/tree.ts`）。マニフェストが小さく保てる。

## chunk-N.bin （リトルエンディアン）

```
"TSR1" | u32 nodeCount | record × nodeCount

record:
  u32  nodeId
  u8   nActions
  u8   flags            bit0 = EQRあり
  u8   weight[169]      このハンドクラスが自分のレンジとしてここに来る確率 ×255
  u8   equity[169]      対 相手(直前にレイズした人)レンジの生エクイティ ×255。レイズ前なら対ランダム
  u8   freq[nA][169]    アクション頻度 ×255（ハンドごとの合計が255になるよう量子化）
  i16  ev[nA][169]      そのアクションのEV(bb) ×256。「その手の配布からの最終損益」
  u8   eqr[169]         (flagsありの時) コール時のEQR ×100
```
- ハンドクラス番号 = `row*13 + col`（A=0 … 2=12）。対角=ペア、上三角=スーテッド、下三角=オフスート。
- **EVの定義**: そのハンドを配られてからの最終損益(bb)で、すでに投入した額を含む。したがって「UTGでフォールド」は0、「SBでフォールド」は−0.5、「BBでフォールド」は−1。2つのアクションのEV差がそのまま**EV損失**になる。
- 量子化誤差: 頻度 ≤0.4%、EV ≤0.004bb。
- 実測サイズ: 6-max 100bb 全体で約 0.17 MB(gzip後)。ほぼ全部をオフラインに事前キャッシュできる。

## チャンク分割
最初に非フォールドの行動をした人で分ける: `root`（全員フォールドの先頭ライン）、`utg-open`、…、`sb-limp`。
例: UTGオープンへのHJの判断を見るには `utg-open` だけで足りる。

## ポストフロップ: `TSP1` v2（1フロップ=1ファイル）

```
/postflop/
  index.json                         フロップ一覧・シナリオ・集計統計（プレーンJSON、数KB）
  <scenario>/<flopIndex>.bin.gz      例: srp-btn-bb/3.bin.gz  （gzip、1つ約0.15〜0.3MB）
```
バイナリ（リトルエンディアン）:
```
"TSP1" | u8 version=2 | u8 nBoard(3) | u8 board[nBoard] | f32 pot | f32 stack | u16 nNodes
node × nNodes (DFS順):
  u8 street(0 flop,1 turn,2 river) | f32 inv0 | f32 inv1      ← ポストフロップで各自が入れた額
  u8 kind(0 decision,1 chance) | u8 actor(0 OOP,1 IP | 255) | f32 reach | u8 nEdges
  edge × nEdges:  u8 kind | f32 amount | i32 code
        decision: kind 0 fold / 1 check・call / 2 bet・raise / 3 all-in、amount=そのストリートの自分の総投入額
        chance  : kind=カード(rank*4+suit, suit 0..3=c,d,h,s)
        code    : >=0 子ノード / -1 フォールドで終了 / -2 書き出し対象外(稀なライン) / -3 ショーダウン / -4 オールインのランアウト
  decision のみ続けて:
    u8 bitmap[166]            このノードのレンジにいるコンボ(1326bit)
    u8 weight[n]  u8 eq[n]    レンジ重み×255 / 対 相手レンジの生エクイティ×255
    u8 freq[nA][n]            頻度×255（ハンドごとに合計255）
    i16 best[n]               最善アクションのEV(bb)×64
    u8 loss[nA][n]            最善との差: 1/64bb刻み(〜3.1bb)、それ以上は1bb刻み(〜58bb)
```
- コンボ番号は `a<b` の順に 0..1325（`a=rank*4+suit`）。ボードと重なるコンボはレンジに入らない。
- EV(action) = `best − loss`。ハンド単位で「その手でこのノードに来た条件付き」の期待値（初期ポットの取り分を含む）。
- 1フロップ(全ライン)で約0.15〜0.3MB(gzip)、2シナリオ×16フロップで計7.2MB。PWAでは `index.json` のみ事前キャッシュし、各フロップは開いたときにキャッシュする。

## 前方互換
- `format` を上げて互換を管理する。ローダーは未知の `format` を拒否する。
- ポストフロップは上記 `TSP1` で実装済み（Phase 3）。集計レポート用の要約は `index.json` の `stats` に入っている。
  - 同型(スート置換)で1,755種に縮約する案は、計算量の都合で未実装。
- Solve（Phase 4）の結果は同じ形式で書き出し、IndexedDB/Supabase Storage に保存して Study で開く。
