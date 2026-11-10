# 02. データモデル

方針: **端末内(IndexedDB)が正**。クラウド(Supabase)は「複数端末で同じ記録を使う」ための複製。
同期は追記型（イベントログ）なので競合がほぼ起きない。

## 1. 端末内 (IndexedDB `tessera` v1) — 実装済み

| ストア | キー | 内容 |
|--------|------|------|
| `attempts` | `id` (auto) / index `ts` | 1回の判断の記録 |
| `srs` | `key = "<nodeId>:<handClass>"` | 間隔反復の状態（Leitnerボックス） |
| `meta` | 任意キー | 設定の同期用スナップショットなど |

`Attempt`（`web/src/lib/storage/types.ts`）

| フィールド | 型 | 説明 |
|-----------|----|------|
| `ts` | number | 回答時刻 (epoch ms) |
| `sessionId` | string | 練習セッションID |
| `mode` | `spot`｜`hand` | スポット練習 / 通しプレイ |
| `solution` | string | 解のID（例 `cash6max-100bb`） |
| `nodeId`, `hand` | number | 局面ノードと手札クラス(0–168) |
| `seat`, `spot` | number, SpotType | 自分の席、局面の種類（集計用に非正規化） |
| `chosen`, `best` | number | 選んだ/最善のアクション番号 |
| `grade`, `evLoss`, `score` | enum, bb, 0–100 | 判定・EV損失・スコア |
| `ms`, `rng`, `timeout`, `hint` | | 反応時間、RNGモード、時間切れ、ヒント使用 |

`SrsItem`: `box`(0–5)、`due`、`seen`、`lapses`、`lastGrade`、`updated`。
ボックス間隔は 0 / 10分 / 1日 / 3日 / 7日 / 21日。ミスで box 0 に戻る。

- 設定（言語・テーマ等）は `localStorage["tessera.settings.v1"]`。起動前スクリプトでちらつきを防ぐ。
- IndexedDBが使えない環境（プライベートモード等）は `MemoryRepo` にフォールバック。
- 書き出し/読み込み: JSON（`ExportBlob`）。読み込みは `ts:nodeId:hand` で重複排除、SRSは新しい方を採用。

## 2. Supabase (Postgres) — Phase 5 で実装

```sql
-- 認証は Supabase Auth (auth.users)。アプリのテーブルは user_id で所有者を持つ。
create table public.attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  client_id    text not null,                -- 端末ごとのID。重複排除に使う
  ts           timestamptz not null,
  session_id   text not null,
  mode         text not null check (mode in ('spot','hand')),
  solution     text not null,
  node_id      int  not null,
  hand         smallint not null check (hand between 0 and 168),
  seat         smallint not null check (seat between 0 and 5),
  spot         text not null,
  chosen       smallint not null,
  best         smallint not null,
  grade        text not null check (grade in ('best','correct','inaccurate','mistake','blunder')),
  ev_loss      real not null check (ev_loss >= 0),
  score        smallint not null check (score between 0 and 100),
  ms           int,
  flags        smallint not null default 0,  -- bit0 rng, bit1 timeout, bit2 hint
  unique (user_id, client_id, ts, node_id, hand)
);
create index on public.attempts (user_id, ts desc);

create table public.srs_items (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null,                  -- "<solution>:<nodeId>:<hand>"
  box        smallint not null, due timestamptz not null,
  seen       int not null, lapses int not null,
  last_grade text not null, updated timestamptz not null,
  primary key (user_id, key)
);

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

### 同期アルゴリズム（Phase 5, 実装済み）
実装済みの仕様は [10-analyze-and-sync.md](10-analyze-and-sync.md)、テーブル定義は `supabase/schema.sql`（このページのSQLから、`attempts.mode` に `post`/`postSpot` を追加、`srs_items` に `node_id`/`hand` を追加、`range_presets` を `(user_id, id text)` キーに変更している）。

> 秘密鍵はクライアントに置かない。使うのは `anon` キー＋RLSのみ。`service_role` キーは使わない。

## 3. 解データ
`03-solution-format.md` を参照。ユーザーのデータとは分離された静的ファイルで、DBには入れない。
