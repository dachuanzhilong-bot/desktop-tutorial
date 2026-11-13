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

### ビルド ID（`build`）

梱包した解には、中身から決まる ID を付ける（`web/scripts/build-id.mjs`。`npm run solutions:pack` が書く。梱包済みのデータに付け直すだけなら `npm run solutions:stamp`）。

- 値: 梱包後のファイル（gzip のバイト列）の SHA-256 の先頭 12 桁（16 進）。日時やファイルの列挙順には依存しない。
- プリフロップ: 1 つの解（`<id>/` の全ファイルをファイル名の昇順に連結）ごとに 1 つ。`/solutions/index.json` の `solutions[].build`。
- ポストフロップ: シナリオ × フロップのファイル 1 つごとに 1 つ。`/postflop/index.json` の `build["<scenario>/<flopIndex>"]`（`stats` と同じキー）。
- ローダーと Service Worker は、解のファイルを `?b=<build>` 付きの URL で取得・キャッシュする。キャッシュは URL 全体で照合されるので、別の世代のファイルが混ざらない。`index.json` 自体にはクエリを付けない。
- Service Worker（`web/public/sw.js`）は解データを版なしの `tessera-data` に入れ、アプリ本体（`tessera-core-<VERSION>-<BUILD>`、デプロイごとに替わる）とは分ける。`?b=` 付きの URL は中身が変わらないので cache-first、2 つの `index.json` は network-first。新しい SW の activate 時に、ネットワークから取った `index.json` に無い `build` のエントリだけを消す（取れなければ何も消さない）。アプリを更新しても、開いたフロップはオフラインで開ける（`e2e/offline.spec.ts`）。
- 2 つの `index.json` はアプリのビルドに取り込まれる（`lib/solution/catalog.ts` の `SOLUTIONS`、`lib/postflop/loader.ts` の `PF_INDEX`）。`data.validate.test.ts` が「`build` が実ファイルのハッシュと一致する」を検査する。

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

席の数は `players` の長さ n で決まる（REFACTOR_PLAN 2-5、`web/src/lib/solution/seats.ts`）。席番号はプリフロップの手番順で、後ろ 2 席がブラインド（SB = n-2、BB = n-1）、BTN は SB の 1 つ前（2 人のときは SB が BTN）。フロップ以降は SB から（2 人のときは BB から）。今の出荷データは 6 席だけで、記録の席番号（0 = UTG … 5 = BB）の意味は変わらない。プリフロップソルバー（`solver/src/preflop.rs`）はまだ 6 席固定。

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

### 解の一覧（カタログ。`/solutions/index.json`）

`solutions[]` の各項目（REFACTOR_PLAN 2-4。`npm run solutions:pack` がマニフェストから書く）:

| 項目 | 中身 |
|------|------|
| `id` | 解のディレクトリ名。記録の `solution` にもこの値が入る（意味を変えない） |
| `files` | 梱包したファイル（Service Worker の事前キャッシュ用） |
| `game` | `"cash"`（プリフロップソルバーはキャッシュゲームだけを作る。マニフェストには項目が無い） |
| `players` | 席の数（`manifest.players` の長さ） |
| `stack` | 有効スタック（bb、`manifest.stack`） |
| `build` | ビルド ID（上記。各項目の最後に書く） |

アプリの深度の一覧（`DEPTHS`）・解の ID（`solutionId`）・深度（`depthOf`）・「プリフロップの解か」は、すべて `lib/solution/catalog.ts` がこの一覧から作る。解の ID の文字列をほかで組み立てたり、正規表現で深度を取り出したりしない。今は 1 深度に 1 つの解（`data` のテストが検査する）。

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
- 1フロップ(全ライン)で約0.15〜0.3MB(gzip)、3シナリオ×21フロップで計14.3MB。PWAでは `index.json` のみ事前キャッシュし、各フロップは開いたときにキャッシュする。

### シナリオの接続条件（`scenarios[].pre`）

各シナリオは、どのプリフロップのラインの続きかを `pre` に持つ（REFACTOR_PLAN 2-4。`gen_postflop` が `SCENARIOS` とプリフロップ解の金額から書く）。

```json
"pre": { "stack": 100, "oopSeat": "BB", "ipSeat": "BTN", "oopPath": "F-F-F-R2.5-F-C", "ipPath": "F-F-F-R2.5" }
```

- `stack`: 続き元のプリフロップ解の深度（bb）。この深度の解でだけ接続する（同じ 2.5bb オープンでも 40bb の解からは、100bb 前提のこのシナリオには入らない）。
- `oopSeat` / `ipSeat`: 席の名前（マニフェストの `players`）。
- `oopPath` / `ipPath`: そのプレイヤーの**最後のプリフロップのアクションまで**のライン。書式は下の「局面キー」と同じトークン列（`F`・`X`・`C`・`R<to>`・`A<to>` を `-` でつなぐ）。片方がもう片方の頭の部分になる（後に動いた人のラインが全体）。
- 通しプレイ（`lib/postflop/link.ts`）は、プリフロップのハンドがヘッズアップのフロップで終わったとき、残った 2 人の席と、各自の「最後のアクションまでのライン」がこの 2 本と一致するシナリオへ続ける。投入額は直書きしない。プリフロップのサイズを変えたら、`pre` を作り直せば接続も追従する（作り直さなければ接続が切れるだけで、誤ったシナリオには入らない）。

## 局面キー（ノード番号に依存しない局面の名前）

ノード番号・チャンク番号・フロップの添字（`<flopIndex>`）は、解を作り直すと変わりうる。記録やリンクに使う安定した名前として、**アクション列とボードだけで決まる文字列**を使う（`web/src/lib/solution/positionKey.ts`、`web/src/lib/postflop/positionKey.ts`）。バイナリ形式には含まれず、木から計算する。

| 記号 | 意味 | 金額 |
|------|------|------|
| `F` | フォールド | — |
| `X` | チェック（払う額が無いとき。プリフロップではリンプ後の BB） | — |
| `C` | コール（プリフロップのリンプを含む） | — |
| `B<額>` | ベット（ポストフロップのみ。相手のベットが無いとき） | 下記 |
| `R<額>` | レイズ | 下記 |
| `A<額>` | オールイン | 下記 |
| `Td` など | ターン / リバーのカード（ポストフロップのみ。ランク `2-9TJQKA` + スート `cdhs`） | — |

- 金額は **総額**（bb）。プリフロップは「そのアクション後の自分の投入総額（raise-to）」、ポストフロップは「そのストリートでの自分の投入総額」（`TSP1` の `amount` と同じ）。0.01bb に丸め、末尾の 0 を落とす（`2.5`、`11`、`13.25`）。
- 同じストリートのアクションは `-` でつなぐ。カードの前後は `/`。アクションが 1 つも無い局面（ルート）は `root`（キーが空文字になることはない）。
- プリフロップの例: `root`（UTG の判断）、`F-F-R2.5-F-F`（CO の 2.5bb オープンに BB が判断）、`F-F-F-F-C`（SB リンプに BB が判断）、`F-F-F-R2.5-F-R11-R25.5-A100`。プリフロップを終わらせるアクション（例 `F-F-R2.5-F-F-C`、リンプ後の BB のチェック）の先には判断が無いので、そのキーは `null` になる（今の出荷データでは `X` を含むキーは現れない）。
- ポストフロップの例: `X-B1.75-C`（フロップが終わり、ターンのカードを配る所）、`X-B1.75-C/Td`（ターン Td の最初の判断）、`X-B1.75-C/Td/X-X/2c/B4.25`。
- プリフロップのキーは 1 つの解（深度）の中で一意。深度は解の ID（`cash6max-100bb`）で別に持つ。ポストフロップのキーは 1 シナリオ × 1 フロップの中で一意。
- フロップは添字ではなくボード文字列で識別する: `flopKey(board)` = 3 枚を空白なしで、ランクの高い順、同じランクはスート `s > h > d > c` の順（カード番号 `rank*4+suit` の降順）。`"As 7d 2c"` → `As7d2c`、`"8c 8d 3s"` → `8d8c3s`。カードの並びが違っても同じ文字列になる。
- キーから番号を引く関数（`resolvePreflopKey` / `resolvePostflopKey`）は、その局面が木に無ければ `null` を返す（例外は投げない）。出荷データはターン / リバーのカードを一部だけ持ち、稀なラインを省くので、「そのカードやラインが木に無い」も `null`。表記が正規形でないもの（小文字、区切りの間違い、`2.50`）も `null`。

### 記録が持つ局面（`pos` / `solution` / `build`）

練習の記録（`Attempt`）、間隔反復の項目（`SrsItem`）、取り込んだハンドの判断（`DecisionInfo`）、練習セットの問題は、局面を次の 3 つで持つ（`web/src/lib/practice/position.ts`）。`solution` と `pos` は必須。ノード番号（`nodeId`）も書く記録があるが参考値で、読むときは必ず `pos` から現在の番号を引き直す（練習セットの問題は番号を持たない）。

| 項目 | プリフロップ | ポストフロップ |
|------|--------------|----------------|
| `solution` | `cash6max-<深度>bb` | `post:<シナリオ>`（フロップの添字を含めない） |
| `pos` | 上の局面キー（例 `F-F-R2.5-F-F`） | `<flopKey>@<局面キー>`（例 `As7d2c@X-B1.75-C/Td`、フロップの最初の判断は `As7d2c@root`） |
| `build` | その深度のビルド ID（`public/solutions/index.json`） | そのフロップのファイルのビルド ID（`public/postflop/index.json`） |

- 区切りの `@` は 1 つだけ。フロップの文字列にも局面キーにも現れない（使う文字は英数字と `.` `-` `/`）。
- ポストフロップの `pos` の解決: `@` の前を `index.json` の `flops`（ボード文字列の一覧）から `flopKey` で探して現在の添字を得る → そのフロップを読み込む → `@` の後ろを `resolvePostflopKey` にかける。どこかで見つからなければ「引けない」（`null`）。
- 引けない記録（今の解にその局面が無い）は、成績の集計には数えるが、Study へのリンクは出さず、復習や練習セットの問題にもしない。
- `build` は「どのデータで採点したか」の記録で、局面の解決には使わない。
- 間隔反復の主キーは `k:<solution>:<pos>:<hand>`（番号を含まない）。キー文字列は分解せず、項目の `solution`・`pos`・`hand` を読む。
- **古い記録**（`pos` が無い。ポストフロップは `solution` が `post:<シナリオ>/<フロップの添字>`、間隔反復のキーは `<node>:<hand>` / `<solution>:<node>:<hand>` / `p:<シナリオ>/<添字>:<node>:<combo>`）は読まない。IndexedDB を v4 に上げるときに消し、バックアップと同期からも取り込まない（[02](02-data-model.md)「古い形式の記録」、`web/src/lib/storage/obsolete.ts`）。変換はしない。

### Study のリンク（`web/src/lib/study/links.ts`）

Study 画面のアドレスと保存局面の `href` も、番号ではなく局面キーで局面を持つ。

| 画面 | 形 | 例 |
|------|----|----|
| プリフロップ | `/study/#d=<深度>&p=<局面キー>[&h=<ハンドクラス>]` | `/study/#d=100&p=F-F-R2.5-F-F&h=14` |
| ポストフロップ | `/study/postflop/#s=<シナリオ>&p=<flopKey>@<局面キー>` | `/study/postflop/#s=srp-btn-bb&p=QsJd6s@X-B1.75-C/Td` |

- Study 画面は `p=` を読み込んだ解で引き直す（`preflopTarget`、`postflopTargetFlop` → `postflopTarget`）。今の解に無い局面・フロップは、エラーにせずルート（フロップが無ければ最初のフロップ）を開く。
- 画面が書き出すアドレスと保存する `href` は `p=` だけ。`p=` の無い `href`、`n=`・`f=` を含む `href` は保存局面として受け付けない（`isPositionHref`）。
- 以前の形（`#d=40&n=12`、`#s=…&f=2&n=0`）は**読み取りだけ**続ける。手で書かれた・共有されたアドレスが残りうるため。番号なので、解を作り直した後は別の局面を開くことがある。ポストフロップは開いた後にアドレスを `p=` の形に書き直す。

## 前方互換
- `format` を上げて互換を管理する。ローダーは未知の `format` を拒否する。
- ポストフロップは上記 `TSP1` で実装済み（Phase 3）。集計レポート用の要約は `index.json` の `stats` に入っている。
  - 同型(スート置換)で1,755種に縮約する案は、計算量の都合で未実装。
- Solve（Phase 4）の結果は同じ形式で書き出し、IndexedDB/Supabase Storage に保存して Study で開く。
