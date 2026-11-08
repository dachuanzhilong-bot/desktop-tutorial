# 01. 画面遷移図

## 全体

```mermaid
flowchart TD
  Splash([起動 / PWA]) -->|初回のみ| Tour[オンボーディング 3分ツアー]
  Splash --> Home
  Tour --> Home
  Tour -->|練習をはじめる| PracticeSetup

  Home[ホーム: 今日の目標・連続日数・苦手] --> Study
  Home --> PracticeSetup
  Home --> Stats
  Home -->|苦手スポット| PracticeSetup

  subgraph Tabs[下部タブ]
    Home
    Study[Study: 解の閲覧]
    PracticeSetup[Practice: 条件設定]
    Stats[成績ダッシュボード]
    Settings[設定]
  end

  PracticeSetup --> Session[練習セッション]
  Session --> Summary[セッション結果]
  Summary --> Stats
  Summary --> PracticeSetup
  Stats -->|苦手スポットで練習| PracticeSetup
  Settings --> Glossary[用語集]
  Settings --> Roadmap[ロードマップ]
  Settings --> Tour

  %% Phase 3+
  Study --> Post[ポストフロップ Study]
  Study --> Report[集計レポート]
  Report -->|フロップを開く| Post
  Post -->|フロップ・ターン・リバー| Post
  Study -.->|Phase4| Solve[Solve: カスタム計算]
  Solve -.-> Study
  Home -.->|Phase4| Builder[Range Builder]
  Home -.->|Phase5| Analyze[Analyze: ハンド履歴]
  Analyze -.->|練習セット| PracticeSetup
  Settings -.->|Phase5| Login[ログイン/同期]
```
実線＝Phase 2で実装済み、点線＝予定。

## Practice セッションの状態遷移

```mermaid
stateDiagram-v2
  [*] --> loading: 開始 / 次のハンド
  loading --> animating: 局面と手札を決定
  loading --> empty: 条件に合う局面なし
  animating --> animating: 相手のアクションを1手ずつ再生
  animating --> asking: 自分の番
  animating --> handEnd: (通しプレイ) 決着
  asking --> answered: 選択 / 時間切れ(自動フォールド)
  answered --> animating: (通しプレイ) 続きの局面
  answered --> loading: 次のハンド
  handEnd --> loading: 次のハンド
  answered --> summary: 終了
  asking --> summary: 終了
  summary --> loading: もう一度
  summary --> [*]
```

- **スポット練習**: 毎回ランダムな局面で1手だけ判断。
- **通しプレイ**: 手札が配られ、相手は解の頻度に従って自動で動き、自分の番ごとに採点。決着まで続く。
- **ポストフロップ練習**: スポット(ストリート指定)と通しプレイ(フロップ〜リバー、相手は解どおり)。プリフロップの通しプレイがヘッズアップのフロップに着くと「フロップへ進む」で続きから。
- **RNGモード**: 頻度と乱数(1–100)を表示し、乱数が指すアクションを選ぶ練習。乱数に従わなかった場合は判定が「不正確」以下に制限される。

## Study の操作

```mermaid
flowchart LR
  Line[アクションライン\nパンくずチップ] -->|タップで巻き戻し| Node
  Node[ノード: 判断するプレイヤーの戦略] -->|次のアクションボタン| Node
  Node --> Grid[13×13 レンジ表]
  Grid -->|タップ| Hand[ハンド詳細: 頻度・EV・エクイティ・EQR]
  Grid -->|長押し| Peek[頻度のポップアップ]
  Node --> Modes{表示切替}
  Modes --> S[戦略] & E[EV] & Q[エクイティ] & W[レンジの濃さ]
  Node --> Filters[ハンド種別 / ブロッカー]
  Node --> Cmp[レンジ比較 / エクイティ分布]
```
URLの `#n=<ノードID>` で局面を共有できる。
