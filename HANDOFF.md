# HANDOFF

## 今の目的
Claude Code から Tessera を引き継ぎ、PR #3 の機能を検証してから不足機能を優先度順に実装する。現在はP1「保存した局面とICM練習記録のクラウド同期」を仕上げている。PRはドラフトのままにし、マージ・公開・リポジトリ設定変更はしない。

## 完了したこと（コミットのハッシュ、検証結果つき）
- `e42872a` 引き継ぎ記録、`dd716bd` 監査計画、`7c1df9e` E2E失敗の診断、`968e08a` 静的出力修正、`d5f46ba` 検証記録、`d59a960` P1同期設計をコミット済み。
- `968e08a` でNextのnested route payloadを静的ホスト向けdotted `.txt` URLにも複製し、Windows/Node 26でのプリフェッチ404を修正。
- P0修正後のローカル結果: `npm run typecheck` 成功、`npm run lint` 警告0、`npm test` 30 files / 291 tests passed、`npm run e2e` 233 passed・1 skipped、`npm run e2e:subpath` 2 passed。
- P0コミット `968e08a`、`d5f46ba`、`d59a960` のGitHub Actionsは全ジョブsuccess（`d59a960`: run `42745297588` / `42745291399`）。
- P1の現時点の未コミット変更: ICMログの追記同期、保存局面のLWWと削除墓標、バックアップ統合、Supabaseテーブル/RLS、設定画面の送受信数、英日文言、Vitest/E2Eを追加。保存局面は件数が少ないため毎回全件取得し、遅れた端末時計のカーソル取りこぼしを避ける。
- 直近検証: `npm run typecheck && npm run lint` 成功・警告0。対象Vitest（`sync.test.ts`, `bookmarks.test.ts`, `icmLog.test.ts`）23 passed。`npm run e2e -- --grep=login` はPC/モバイル2 passed。失敗していたPC側のICMアップロード確認はIndexedDBへの保存完了を待つようE2Eを修正して解消。

## 作業中のこと（どのファイルを、どこまで、何が残っているか）
- P1同期コードは実装済みだが未コミット。変更ファイル: `supabase/schema.sql`、`web/e2e/sync.spec.ts`、`web/src/components/sync/SyncPanel.tsx`、`web/src/lib/__tests__/bookmarks.test.ts`、`web/src/lib/__tests__/sync.test.ts`、`web/src/lib/i18n/{ja,en}.ts`、`web/src/lib/storage/{bookmarks,icmLog,metaMerge}.ts`、`web/src/lib/sync/{engine,supabase,types}.ts`。
- `README.md`、`docs/10-analyze-and-sync.md`、`docs/AUDIT.md`、`docs/05-roadmap.md` に新しい同期範囲と制限を反映する。
- コメントと同期UIの説明に残る古い「ICM/ブックマークは端末のみ」「削除は同期されない」を更新する。
- 全テスト・データ検証・390×844と1440×900の画面確認はP1コードに対して未実施。

## 失敗しているテストと、その原因の見立て
- 現在失敗中のテストはない。
- P0の初回E2Eは静的出力のRSC `.txt` 404だったが `968e08a` で修正し、その後の全E2Eは通過。
- P1のログインE2E初回はPC側でICM記録が同期前に存在しないことがあった。ICMのIndexedDB保存が非同期であることを確認し、E2Eで保存完了を待つようにして直近のPC/モバイル両方が成功。全体E2Eで再確認する。

## 次にやること（優先順）
1. README・`docs/10`・`docs/AUDIT`・`docs/05-roadmap` をP1の同期仕様と未確認事項に合わせて更新する。
2. `npm run typecheck && npm run lint`、`npm test`、`npm run validate:data`、`npm run e2e`、`npm run e2e:subpath` を実行する。e2eはpush前に全件成功させる。
3. 390×844と1440×900で画面を撮影して確認し、送受信数・保存局面・ICM同期表示に問題があれば直す。
4. P1を小さくコミットし、HANDOFFに結果とコミットハッシュを記録してpushする。
5. pushしたheadのGitHub Actions完了を確認する。PR #3はドラフトのまま、マージ/公開は行わない。
6. 次順位は練習モード拡張、HU/9人卓解、全フロップ計算、実履歴・実Supabase・実機確認。費用対効果から次の実装対象を再評価する。

## 決めたことと、その理由（採用しなかった案も）
- `claude/practical-volta-fv0rdo`（PR #3）を継続する。PR #3の4機能とStudy URL競合修正があり、既存CIもgreen。
- P0のE2E検査を弱めず、ビルド後にRSC payload別名を作る修正を採用した。
- ICMログは追記・重複排除、保存局面はIDごとの更新時刻で統合し削除墓標も送る。ICM記録や保存局面を端末限定にする案は、複数端末の学習データが揃わず復活/再同期の問題も残すため採用しない。
- 保存局面は少量データなので毎回全件取得し、時刻カーソルによる取りこぼしを避ける。大量データのICMログは追記で時刻カーソルを使う。
- IndexedDBはmetaストアを継続使用し、DB版は上げない。バックアップの既存マージ経路にも削除墓標を含める。
- 実Supabase環境はないため偽PostgREST/GoTrueとブラウザE2Eで検証し、実環境未確認を明記する。
- pushは作業ブランチのみ。マージ、Pages公開、リポジトリ設定変更は行わない。

## 未確認のこと・注意
- P1変更後の全E2E、`validate:data`、画面の目視確認、GitHub Actions結果。
- 実Supabase、スマホ実機、VoiceOver/TalkBack、GGPoker実履歴は未確認。
- `npm ci` は成功したがnpm auditが10件（8 moderate、2 critical）とESLint非推奨を報告。依存更新は未実施。
- SQLはスキーマ追加案。既存/実際のSupabaseプロジェクトへ適用していない。
- PR #3をマージ/公開しない。
