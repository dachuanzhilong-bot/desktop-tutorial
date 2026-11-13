# 02. データモデル

方針: **端末内(IndexedDB)が正**。クラウド(Supabase)は「複数端末で同じ記録を使う」ための複製。
練習/ICMのログは追記型。間隔反復・レンジ・保存局面・設定は更新時刻で競合を解決する（[同期仕様](10-analyze-and-sync.md)）。

## 1. 端末内 (IndexedDB `tessera` v4) — 実装済み

| ストア | キー | 内容 |
|--------|------|------|
| `attempts` | `id` (auto) / index `ts` | 1回の判断の記録 |
| `srs` | `key = "k:<solution>:<pos>:<hand>"`（[03](03-solution-format.md)「記録が持つ局面」） | 間隔反復の状態（Leitnerボックス）。`solution`・`pos`（必須）と `build` を持つ |
| `meta` | 任意キー | 下の「`meta` のキー」 |
| `solves` / `ranges` / `hands` | `id` | Solve の保存結果 / 保存レンジ / 取り込んだハンド履歴（v2・v3 で追加） |

`Attempt`（`web/src/lib/storage/types.ts`）

| フィールド | 型 | 説明 |
|-----------|----|------|
| `ts` | number | 回答時刻 (epoch ms) |
| `sessionId` | string | 練習セッションID |
| `mode` | `spot`｜`hand` | スポット練習 / 通しプレイ |
| `solution` | string | 解のID（例 `cash6max-100bb`。ポストフロップは `post:<シナリオ>`） |
| `pos` | string（必須） | 局面キー（[03](03-solution-format.md)「記録が持つ局面」）。局面はこれで特定する |
| `build` | string（任意） | 採点に使った解データのビルド ID |
| `nodeId`, `hand` | number | 回答時のノード番号（参考値。同期テーブルの列のために書くだけで、読むときは使わない）と、手札クラス(0–168) / コンボ(0–1325) |
| `seat`, `spot` | number, SpotType | 自分の席、局面の種類（集計用に非正規化） |
| `chosen`, `best` | number | 選んだ/最善のアクション番号 |
| `grade`, `evLoss`, `score` | enum, bb, 0–100 | 判定・EV損失・スコア |
| `ms`, `rng`, `timeout`, `hint` | | 反応時間、RNGモード、時間切れ、ヒント使用 |

`SrsItem`: `box`(0–5)、`due`、`seen`、`lapses`、`lastGrade`、`updated`。
ボックス間隔は 0 / 10分 / 1日 / 3日 / 7日 / 21日。ミスで box 0 に戻る。

- 設定（言語・テーマ等）は `localStorage["tessera.settings.v1"]`。起動前スクリプトでちらつきを防ぐ。
- IndexedDBが使えない環境（プライベートモード等）は `MemoryRepo` にフォールバック。
- 書き出し/読み込み: JSON（`ExportBlob`）。読み込みは `ts:pos:hand` で重複排除、SRSは新しい方を採用。局面キーの無い記録（下の「古い形式の記録」）は取り込まず、除いた件数を画面に出す。
- `meta` の `icm.log` は新しい2,000件、`study.bookmarks` は保存局面、`study.bookmarkDeletions` は同期/バックアップ用の削除墓標を保持する。バックアップ取り込みでは端末データと統合する。

### `meta` のキー

| キー | 中身 | v4 への更新 | バックアップの読み込み |
|------|------|-------------|------------------------|
| `icm.log` | ICM 練習の回答ログ（局面キーを使わない） | 残す | 統合 |
| `learn.done` | 終えたレッスン | 残す | 統合 |
| `study.bookmarks` | Study の保存局面。`href` は局面キー（`p=`）を持つ | **消す**（`href` が番号だった） | 統合。番号を含む `href` のものは捨てる |
| `study.bookmarkDeletions` | 保存局面の削除墓標 | **消す** | 統合 |
| `sync.state.<userId>` | 同期のカーソルと端末 ID | **消す**（次の同期は最初から。重複は排除される） | 取り込まない |
| `practiceSet:<id>` | 用意した出題リスト（復習の 1 ラウンド、Analyze のミス）。問題は `{ pos, hand }` | **消す**（必要なときに作り直される） | 取り込まない |
| `stats.daily.v1` | 成績・ホームの集計（全体・日ごと・席×スポットごとの合計、判定ごとの件数、ミスノートの 8 件）。`attempts` から作る派生データ（REFACTOR_PLAN ステップ 2-7、`lib/storage/statsCache.ts`） | （v4 より後にできたキー） | 書き出さない・取り込まない。同期もしない |
| その他 | – | 残す | 置き換え |

`stats.daily.v1` は正本ではない。数えた件数 `n` と最後の記録の `id`（`lastId`）とタイムゾーンを持ち、読むときに `lastId` より後の記録（この端末の回答・別タブ・バックアップの読み込み・同期の取得）を足す。足したあとの `n` が記録の件数と合わない（記録が消えた、2 つのタブが同時に書いた）、無い（この仕組みより前からの利用者、`clear()` の後）、形が読めない、別のタイムゾーンで作った、のどれかなら全件から 1 回作り直す。回答のたびに `recordAnswer` が同じ処理をするので、ふだんは 1 件足すだけ。数字は全件から集計した場合と完全に同じ（`statsCache.test.ts`）。

### 古い形式の記録（v4 で消す。REFACTOR_PLAN ステップ 1-4）

局面キー（`pos`）の無い記録は、解を作り直すと別の局面を指してしまうので読めない。変換はせず、消す（持ち主の方針: 既存の学習記録は残さなくてよい）。規則は `web/src/lib/storage/obsolete.ts` の 1 か所にあり、次の 3 つが同じものを使う。

- **DB の更新（v1〜v3 → v4、1 度だけ）**: `attempts`・`srs`・`hands` のうち `pos` の無い行（`srs` は `solution` も必要。`hands` は解析に解 ID が無いか、採点した判断に `pos` の無いもの）と、上の表で「消す」の `meta` キーを消す。`pos` 付きの行、`ranges`、`solves`、残りの `meta`、`localStorage` の設定はそのまま。更新のトランザクションの中で行うので、途中で失敗すれば全体が中止され、DB は元の版のまま何も失わない。
- **バックアップの読み込み**: 古い記録は取り込まない（件数を返す）。
- **同期の取得**: `pos` が null の行（更新前の端末が上げた行）は取り込まない。サーバーの行は消さない。

利用者への通知は出さない（消えるのは持ち主が不要とした記録だけ）。

## 2. Supabase (Postgres) — Phase 5 で実装

```sql
-- 認証は Supabase Auth (auth.users)。アプリのテーブルは user_id で所有者を持つ。
create table public.attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  client_id    text not null,                -- 端末ごとのID。重複排除に使う
  ts           timestamptz not null,
  session_id   text not null,
  mode         text not null check (mode in ('spot','hand','post','postSpot')),
  solution     text not null,
  node_id      int  not null,
  hand         smallint not null check (hand between 0 and 1325),   -- プリフロップ: ハンドクラス 0..168 / ポストフロップ: コンボ 0..1325
  seat         smallint not null check (seat between 0 and 5),
  spot         text not null,
  chosen       smallint not null,
  best         smallint not null,
  grade        text not null check (grade in ('best','correct','inaccurate','mistake','blunder')),
  ev_loss      real not null check (ev_loss >= 0),
  score        smallint not null check (score between 0 and 100),
  ms           int,
  flags        smallint not null default 0,  -- bit0 rng, bit1 timeout, bit2 hint
  pos          text,                         -- 局面キー（03-solution-format.md）。これがある行の node_id は参考値
  build        text,                         -- 採点に使った解データのビルド ID
  unique (user_id, client_id, ts, node_id, hand)
);
create index on public.attempts (user_id, ts desc);
-- 最初の版は hand を 0..168 に制限していた（ポストフロップの回答が全部拒否される）。既存のテーブル向けの冪等な修正は supabase/schema.sql にある:
--   alter table public.attempts drop constraint if exists attempts_hand_check;
--   alter table public.attempts add constraint attempts_hand_check check (hand between 0 and 1325);

create table public.srs_items (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null,                  -- "k:<solution>:<pos>:<hand>"。更新前の端末が上げた古い行（"<solution>:<nodeId>:<hand>" など、pos が null）は取得しない
  box        smallint not null, due timestamptz not null,
  seen       int not null, lapses int not null,
  last_grade text not null, updated timestamptz not null,
  solution   text, pos text, build text,     -- 局面キーを持つ項目だけ（古い項目は null）
  primary key (user_id, key)
);
-- 既存のテーブル向けの列追加（alter table … add column if not exists）は supabase/schema.sql にある。

create table public.user_settings (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  data     jsonb not null, updated timestamptz not null default now()
);

-- Phase 4/5: 自分で計算した解・レンジ・取り込んだハンド履歴
create table public.custom_solves (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, config jsonb not null, storage_path text, created_at timestamptz default now());
create table public.range_presets (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null, range jsonb not null, updated timestamptz default now());
create table public.hand_imports (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  site text not null, imported_at timestamptz default now(), summary jsonb);

-- 行レベルセキュリティ: 自分の行だけ読み書きできる
alter table public.attempts       enable row level security;
alter table public.srs_items      enable row level security;
alter table public.user_settings  enable row level security;
alter table public.custom_solves  enable row level security;
alter table public.range_presets  enable row level security;
alter table public.hand_imports   enable row level security;
-- 各テーブル共通:
create policy "own rows" on public.attempts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- (他のテーブルも同じ形のポリシー)
```

### 同期アルゴリズム（Phase 5、拡張中）
実装仕様は [10-analyze-and-sync.md](10-analyze-and-sync.md)。現行PR #3で ICM練習ログとStudy保存局面/削除墓標を追加している。`supabase/schema.sql` がテーブル定義の正本（このページの古い概念SQLから `attempts.mode` に `post`/`postSpot`、`srs_items` に `node_id`/`hand` を追加し、`range_presets` を `(user_id, id text)` キーに変更済み）。現行PRのSQLは実Supabaseにはまだ適用していない。

> 秘密鍵はクライアントに置かない。使うのは `anon` キー＋RLSのみ。`service_role` キーは使わない。

## 3. 解データ
`03-solution-format.md` を参照。ユーザーのデータとは分離された静的ファイルで、DBには入れない。
