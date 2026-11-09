# 公開（ホスティング）

アプリは静的ファイルだけ（`web/out/`、約18MB・224ファイル）なので、HTTPSで配れる静的ホスティングならどこでも動きます。
**まだどこにも公開していません**（このセッションの作業用マシンの中でしか動かしていません）。公開先を選ぶのは持ち主の判断です。

## 確認済みのこと
- ルート直下（`https://example.com/`）とサブパス（`https://<owner>.github.io/<repo>/`）の両方で、同じ書き出しが動く。
  - サブパスのビルドは `NEXT_PUBLIC_BASE_PATH=/<repo>` を付けるだけ（`next.config.ts`）。手書きのURL（`fetch`・Worker・manifest・Service Worker）は `lib/util/base.ts` の `withBase()` を通す。Service Worker と Solve の Worker は、自分が配信されている場所からパスを決めるので、ビルド時の設定は要らない。
  - `npm run e2e:subpath`: サブパスでビルド → そのパス配下だけで配信（外は404）→ ブラウザで、初回の説明・各種データ・ポストフロップの Worker・WebAssembly の Worker・Service Worker の範囲・オフライン動作を通しで確認（CIでも実行）。`lib/__tests__/basepath.test.ts` は、手書きの「/」始まりのURLが入り込んだらテストで落とす。
- 確認していないこと: 実際のホスティングサービス上での動作（このセッションからは公開できないため）、実機のブラウザ。

## 公開先の選び方

| 公開先 | 向いている場合 | 設定 |
|--------|----------------|------|
| **GitHub Pages** | 同じリポジトリから自動で公開したい | `.github/workflows/pages.yml` を用意済み。**リポジトリが非公開の場合、Pagesは有料プラン（Pro/Team 等）が必要**。無料で使うならリポジトリを公開にする（ソースが誰でも読めるようになる。MITライセンス・解データを含む） |
| Vercel / Netlify / Cloudflare Pages | 非公開のままGitHubと連携して公開したい（無料枠あり） | Root（Base）directory: `web`、Build command: `npm run build`、Output（Publish）directory: `out`（Vercel は `web` を Root にして Next.js を選べば自動）。Node 22 |
| 自分のPC・社内サーバー | とりあえず手元で触る | `cd web && npm ci && npm run build && node scripts/serve-static.mjs 3100` → http://localhost:3100 （スマホで見るには同じLANから `http://<PCのIP>:3100`。ただし Service Worker・オフライン・インストールは HTTPS か localhost が必要） |

### GitHub Pages の手順（1回だけ）
1. リポジトリの Settings → Pages → Build and deployment → Source を **GitHub Actions** にする。
2. PR を main にマージする（main への push で `Pages` ワークフローが走る）。マージせずに試すなら、Settings → Environments → `github-pages` の Deployment branches に作業ブランチを足し、Actions から `Pages` を手動実行する（ワークフローが既定ブランチに無いと「Run workflow」は出ないので、普通はマージが早い）。
3. 公開先は `https://<owner>.github.io/<repo>/`（このリポジトリなら `https://dachuanzhilong-bot.github.io/desktop-tutorial/`）。Actions の `Pages` の実行結果にも表示される。

ワークフローは、サブパス用にビルドしたものを `npm run e2e:subpath` でブラウザ確認してから、その同じフォルダを公開する（確認に落ちたら公開されない）。

## 公開するときの注意
- **HTTPS 必須**（Service Worker・オフライン・ホーム画面への追加）。上の公開先はどれも標準でHTTPS。
- `*.github.io` は同じアカウントの他のプロジェクトサイトと同じオリジン。端末内のデータ（`localStorage` / IndexedDB のキー名は `tessera…`）は他のサイトと名前がぶつからないが、同じアカウントの別サイトからは読めてしまう。独自ドメインにするとこの心配はない。
- クラウド同期（Supabase）を使うなら、ビルド時に `NEXT_PUBLIC_SUPABASE_URL` と `NEXT_PUBLIC_SUPABASE_ANON_KEY` を環境変数で渡し、Supabase 側の認証の「サイトURL / リダイレクトURL」に公開先のURLを登録する（[10](10-analyze-and-sync.md)）。設定しなければ、ログインなしの端末内モードで動く。
- 名称 "Tessera" は仮の名前です。公開の前に商標・ドメインの確認をしてください（README）。
