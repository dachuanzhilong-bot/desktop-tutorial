# HANDOFF

## 今の目的
Claude Code セッション `session_019wsd5hJFvXwVL3RsR8cCxN` から Tessera の開発を引き継ぐ。PR #3 の現状を検証し、監査順位に沿って不足機能を実装する。マージ・公開・リポジトリ設定変更はしない。

## 完了したこと（コミットのハッシュ、検証結果つき）
- 作業ブランチ `claude/practical-volta-fv0rdo` は PR #3。引き継ぎ/監査計画のコミットは `e42872a`、`dd716bd`、E2E失敗の記録は `7c1df9e`。いずれも作業ブランチに push 済み。
- PR head `cd6543e` の GitHub Actions run `42741582421` は solver/web とも success。監査記録を含む `dd716bd` の run `42742404780` と `42742409212` も両ジョブ success。
- 静的書き出し修正を実装中。`web/scripts/prepare-static-export.mjs` が Next の nested route payload から静的ホスト向け dotted `.txt` 別名を生成し、`npm run build` 後に呼び出す。ユニットテスト2件を追加。`docs/13-hosting.md` に説明を追加。
- 修正後の検証結果（Windows / Node v26.12.1 / npm 11.20.0）: `npm run typecheck` 成功、`npm run lint` 警告0、`npm test` 30 files / 291 tests passed、`npm run e2e` 233 passed・1 skipped、`npm run e2e:subpath` 2 passed。コンソール検査の再実行もmobile/desktop各1件成功。
- 初回 E2E は 231 passed・2 failed・1 skipped。Next のRSCプリフェッチが `/practice/__next.practice.__PAGE__.txt` 等を要求する一方、Next export は `out/practice/__next.practice/__PAGE__.txt` を生成して404になっていた。テストは変更せず、build成果物に要求URLのpayloadを複製して解決した。
- `npm ci` 成功。npm監査は10件（8 moderate、2 critical）とESLint非推奨を報告。依存更新は未実施。

## 作業中のこと（どのファイルを、どこまで、何が残っているか）
- 以下を P0静的書き出し修正としてまとめてコミットする直前: `web/package.json`、`web/scripts/prepare-static-export.mjs`、`web/scripts/prepare-static-export.d.mts`、`web/src/lib/__tests__/staticExport.test.ts`、`docs/13-hosting.md`、この `HANDOFF.md`。
- まだ P0修正コミットを作成/pushしていない。作成後にGitHub Actionsを確認する。
- 次の機能候補は P1: 保存局面とICM練習記録のクラウド同期。優先順位: P0検証→P1同期→P2新しい練習種目→P3 HU/9-max→P4全フロップ→P5実環境手動確認。

## 失敗しているテストと、その原因の見立て
- 現在失敗しているローカルテストはない。最初のE2E失敗は上記の静的route payload 404で、修正後に全件成功。
- 新しいP0修正をまだGitHub CI上では実行していない。push後に確認する。
- GitHub ActionsのNode 22/LinuxとローカルのNode 26/Windowsには差がある。両環境の結果を分けて記録する。

## 次にやること（優先順）
1. `git diff --check` を確認し、P0修正とこのHANDOFFをコミットして作業ブランチへpushする。
2. 最新コミットのGitHub Actionsでsolver/webが成功することを確認する。
3. HANDOFFを更新/コミットしてから P1同期の設計・実装を始める。IndexedDB `meta` を使い、DB版は上げない。
4. Supabaseテーブル/RLS、同期型/エンジン、英日文言、偽サーバーの単体/E2Eを追加する。既存同期の削除非同期の制約を明記する。
5. README・docs/AUDIT・同期設計書を更新し、390×844とPC幅の画面を確認する。
6. 区切りごとにHANDOFFを更新して小さくコミット/pushする。PR #3 はドラフトのままにする。

## 決めたことと、その理由（採用しなかった案も）
- `claude/practical-volta-fv0rdo` を継続する。PR #3の4機能とURL競合修正、CI成功が揃っている。
- P0はテストを無効化せず、ビルド成果物に静的配信可能なroute payload別名を足す。GitHub Pages等のrewrite非対応ホストでも画面遷移の404を防ぐ。
- P1は保存局面/ICM練習ログの同期を選ぶ。既存のlocal-first同期・`meta`保存・バックアップを再利用できる。実Supabaseのアカウントが無いため、偽サーバーでプロトコルを検証し実環境未確認と記載する。
- pushは作業ブランチのみ。PRのマージ・Pages公開・設定変更は行わない。

## 未確認のこと・注意
- P0コミットのGitHub Actions結果は未確認（push前）。
- 実Supabase、スマホ実機、VoiceOver/TalkBack、GGPoker実履歴は未確認。
- npm監査の脆弱性詳細と依存更新は今回の作業範囲外。
- PR #3をマージ/公開しない。
