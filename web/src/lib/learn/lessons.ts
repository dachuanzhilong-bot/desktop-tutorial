import type { Lang } from "../settings";

/**
 * The learning path: short lessons that tie the app's screens together. Each lesson says what to look for and then sends the
 * reader to the screen where it can be tried (a Study position, a Practice preset, a calculator).
 * Text is kept here in both languages (not in the i18n tables): a lesson is one piece of writing.
 * The numbers named in the text are rules of thumb; the solutions in the app are approximations (the lessons say so).
 */
export interface LessonText {
  title: string;
  /** one sentence for the list */
  lead: string;
  /** the key points, in the order to read them */
  points: string[];
  /** why it matters for using the app */
  why: string;
}

export interface LessonTry {
  /** an app path: <Link> adds the hosting sub-path */
  href: string;
  ja: string;
  en: string;
}

export interface Lesson {
  id: string;
  /** minutes to read */
  minutes: number;
  ja: LessonText;
  en: LessonText;
  tries: LessonTry[];
}

export const LESSONS: Lesson[] = [
  {
    id: "positions",
    minutes: 3,
    ja: {
      title: "ポジションを知る",
      lead: "同じハンドでも、座る場所で正解が変わります。まず席の名前と順番をつかみます。",
      points: [
        "6人卓の席は、プリフロップで動く順に UTG → HJ → CO → BTN → SB → BB です。UTG が最初に、BB が最後に動きます。",
        "フロップ以降は、SB が最初、BTN が最後に動きます。後ろで動ける席ほど、相手の動きを見てから決められるので有利です。",
        "後ろの席ほど、広いハンドでプレーできます。UTG は強いハンドを中心に、BTN は多くのハンドで参加するのが基本です。",
        "SB と BB はブラインドを払っているので少ないチップで続けられますが、フロップ以降は先に動く不利な位置になりがちです。",
      ],
      why: "このアプリのレンジ表は、すべて「どの席から、どんな状況で」という前提つきです。席の感覚があると、表の形が自然に読めるようになります。",
    },
    en: {
      title: "Know the positions",
      lead: "The same hand is played differently from different seats. Start with the names and the order.",
      points: [
        "At a 6-handed table the seats act in this order before the flop: UTG, HJ, CO, BTN, SB, BB. UTG acts first, BB last.",
        "After the flop SB acts first and BTN last. The later you act, the more you have seen before you decide, which is an advantage.",
        "The later the seat, the wider the range it plays. UTG plays mostly strong hands; BTN joins with a large share of its hands.",
        "SB and BB have posted blinds, so continuing is cheap, but after the flop they act first, which is a disadvantage.",
      ],
      why: "Every range chart in this app belongs to a seat and a situation. Once you have a feel for the seats, the shape of the charts reads naturally.",
    },
    tries: [
      { href: "/study/", ja: "スタディで UTG の最初のレンジを見る", en: "See UTG's first range in Study" },
      { href: "/practice/#seat=3&spot=rfi", ja: "BTN のオープンを練習する", en: "Practise opening from the BTN" },
    ],
  },
  {
    id: "open",
    minutes: 4,
    ja: {
      title: "最初にレイズする（オープン）",
      lead: "誰も参加していないときの最初のレイズがオープンです。席ごとの広さの違いがポイントです。",
      points: [
        "オープンの基本は「レイズで入る」ことです。コールだけで入るリンプは、このアプリの解ではほとんど選ばれません。",
        "席が後ろになるほどレンジが広がります。目安として、UTG は上位の2割弱、BTN は半分近くのハンドで入ります（解の近似による目安です）。",
        "ハンドの価値は強さだけでは決まりません。同じマークのスーテッドや、数字がつながったハンドは、完成したときの強さとプレーのしやすさで価値が上がります。A5s や 76s がレンジに入るのはそのためです。",
        "解は「頻度」で答えます。同じハンドでレイズ60%・フォールド40% のように混ざることがあります。",
      ],
      why: "最初のオープンの形を覚えると、そこから先の局面（3ベットされたとき、ポストフロップ）の土台になります。",
    },
    en: {
      title: "Opening the pot (raise first in)",
      lead: "The first raise when nobody has entered is an open. How wide to open depends on the seat.",
      points: [
        "The basic way to enter is to raise. Limping (just calling) is almost never chosen in this app's solutions.",
        "The later the seat, the wider the range. As a rule of thumb UTG opens a little under a fifth of the hands and BTN close to half (approximate, from the solutions).",
        "A hand's value is not only its strength. Suited hands and connected hands gain value from how they make strong hands and how easy they are to play, which is why A5s and 76s are in the range.",
        "The solution answers in frequencies: the same hand can raise 60% and fold 40%.",
      ],
      why: "Knowing the shape of the opening ranges is the base for everything after it: facing a 3-bet and the post-flop play.",
    },
    tries: [
      { href: "/practice/#spot=rfi", ja: "オープンの局面だけを練習する", en: "Practise only opening spots" },
      { href: "/builder/", ja: "レンジ作成で、自分のオープンレンジを描いて解と比べる", en: "Draw your own opening range in the Builder and compare it with the solution" },
    ],
  },
  {
    id: "potodds",
    minutes: 4,
    ja: {
      title: "ポットオッズと必要な勝率",
      lead: "「コールして得か」は、払う額と勝てる額の比で決まります。計算機で数字を確かめます。",
      points: [
        "ポット100に対して50のベットが来たとします。コールに50を払い、勝てば150（ポット＋ベット）を得ます。必要な勝率は 50 ÷ (100 + 50 + 50) = 25% です。",
        "式は「ベット ÷ （ポット ＋ ベット×2）」です。ポットの半分のベットなら25%、ポットと同じ額なら約33%が必要です。",
        "手の勝率（エクイティ）がこれより高ければコールが得、低ければ降りるのが得です。後の街でさらに稼げる分（インプライドオッズ）は別に考えます。",
        "ドローは「アウツ（完成するカードの枚数）」で見積もれます。フロップからリバーまでなら、おおよそ アウツ × 4 %（ターンからは × 2 %）です。",
      ],
      why: "練習の解説に出る「ポットオッズ」や「必要エクイティ」は、この式です。意味が分かると、解の理由が見えてきます。",
    },
    en: {
      title: "Pot odds and the equity you need",
      lead: "Whether a call pays depends on the ratio of what you pay to what you can win. Check the numbers in the calculator.",
      points: [
        "Say a bet of 50 comes into a pot of 100. A call costs 50 and wins 150 (pot plus bet). The equity you need is 50 / (100 + 50 + 50) = 25%.",
        "The formula is bet / (pot + 2 x bet). A half-pot bet needs 25%; a pot-sized bet needs about 33%.",
        "If your equity is higher than that, calling pays; if lower, folding does. What you may win on later streets (implied odds) is counted separately.",
        "Draws can be estimated by outs (the cards that complete the hand): from the flop to the river about outs x 4 %, from the turn about outs x 2 %.",
      ],
      why: "The \"pot odds\" and \"required equity\" in the practice explanations are this formula. Once you know what they mean, the reason for an answer shows.",
    },
    tries: [
      { href: "/odds/", ja: "計算機で、ポットオッズと MDF を確かめる", en: "Check pot odds and MDF in the calculator" },
      { href: "/equity/", ja: "勝率計算で、ハンドの勝率を調べる", en: "Look up a hand's equity in the equity calculator" },
    ],
  },
  {
    id: "vsopen",
    minutes: 4,
    ja: {
      title: "オープンへの対応（コール・3ベット・フォールド）",
      lead: "誰かがオープンしたとき、選べるのはフォールド・コール・3ベットの3つです。",
      points: [
        "ブラインドが1ベット目、オープンが2ベット目、その再レイズが3ベットです。",
        "BB はすでにチップを払っていて、コールに必要な額が少ないので、広いレンジで守ります（フォールドしすぎると、相手に広くオープンされてしまいます）。",
        "強いハンドは3ベットで価値を取ります。A や K を持って相手の強いハンドを減らせるスーテッドのハンドは、ブラフの3ベットにも使われます。",
        "コールするのは、フロップ以降で勝つ見込みを取り切りやすいハンドが中心です。スーテッドや、つながったハンドが多くなります。",
      ],
      why: "「守る頻度」は、相手のオープンの大きさと位置で変わります。練習で何度も出会うほど、頻度の感覚がつきます。",
    },
    en: {
      title: "Facing an open (call, 3-bet or fold)",
      lead: "When someone opens you can fold, call or 3-bet.",
      points: [
        "The blinds are the first bet, the open is the second, and the re-raise is the 3-bet.",
        "The big blind has already paid and needs little to call, so it defends a wide range (folding too much lets opponents open very wide).",
        "Strong hands 3-bet for value. Suited hands holding an ace or king, which also remove some of the opponent's strong hands, are used as bluff 3-bets.",
        "Calling hands are mostly those that realise their equity well after the flop: many suited and connected hands.",
      ],
      why: "How often to defend depends on the open size and the seat. The more such spots you meet in practice, the better the feel for the frequencies.",
    },
    tries: [{ href: "/practice/#seat=5&spot=vsOpen", ja: "BB でオープンに対応する局面を練習する", en: "Practise defending from the BB against an open" }],
  },
  {
    id: "vs3bet",
    minutes: 4,
    ja: {
      title: "3ベットされたとき",
      lead: "オープンに3ベットで返されると、続けられるハンドが一気に絞られます。",
      points: [
        "オープンしたハンドの多くは、3ベットに対してフォールドします。続けるのは強いハンドと、ブラフとして使いやすい一部のハンドです。",
        "選べるのは、コール・4ベット・フォールドです。強いハンドは4ベットで価値を取り、A5s のようなハンドを4ベットのブラフに混ぜることがあります。",
        "位置を持ってコールできるときは、続けられるハンドが増えます。",
        "スタックが浅い（40bb以下）と、4ベットはほぼオールインになり、選択肢が単純になります。",
      ],
      why: "3ベットへの対応は、ミスが大きくなりやすい場面です。EV損失の大きいミスは、ここに集まりがちです。",
    },
    en: {
      title: "When you are 3-bet",
      lead: "A 3-bet in reply to your open narrows what you can continue with a lot.",
      points: [
        "Most opening hands fold to a 3-bet. You continue with strong hands and some hands that work well as bluffs.",
        "You can call, 4-bet or fold. Strong hands 4-bet for value, and a hand like A5s is sometimes mixed in as a 4-bet bluff.",
        "When you can call in position, more hands can continue.",
        "With a shallow stack (40bb or less) a 4-bet is almost all-in and the choice becomes simple.",
      ],
      why: "Facing a 3-bet is where mistakes tend to be expensive: the big EV losses often come from here.",
    },
    tries: [{ href: "/practice/#spot=vs3bet", ja: "3ベットへの対応を練習する", en: "Practise facing a 3-bet" }],
  },
  {
    id: "flop",
    minutes: 5,
    ja: {
      title: "フロップの読み方とCベット",
      lead: "フロップ（最初の3枚）の性質で、ベットの頻度とサイズが変わります。",
      points: [
        "ボードの性質は、ハイカード（A や K など高い札）、同じマーク（フラッシュのしやすさ）、つながり（ストレートのしやすさ）、ペアの有無で見ます。",
        "プリフロップでレイズしたほう（アグレッサー）が、フロップで続けてベットするのがCベットです。A72 のように高くて乾いたボードは、レイズしたほうのレンジが有利になりやすく、小さいサイズで高い頻度で打てます。",
        "9♥8♥7♦ のようにつながって同じマークが多いボードは、相手のレンジにも当たりやすく、チェックが増えます。",
        "集計レポートでは、ボードの種類ごとのチェック頻度・Cベット頻度の傾向を並べて見比べられます。",
      ],
      why: "ポストフロップの解は、プリフロップのレンジと、フロップの性質の組み合わせで決まります。傾向をつかむと、個別の局面が覚えやすくなります。",
    },
    en: {
      title: "Reading the flop and the continuation bet",
      lead: "The texture of the flop (the first three cards) changes how often and how big to bet.",
      points: [
        "Look at the board for high cards (aces, kings), suits (how easy a flush is), connectedness (how easy a straight is) and pairs.",
        "The player who raised before the flop (the aggressor) betting again on the flop is a continuation bet. On a high, dry board such as A72 the raiser's range tends to be ahead and bets small and often.",
        "A connected, suited board such as 9h 8h 7d hits the other range as well, and there are more checks.",
        "The aggregate report puts the check and continuation-bet frequencies of each board type side by side.",
      ],
      why: "Post-flop solutions come from the pre-flop ranges and the flop texture together. Knowing the tendencies makes single spots easier to remember.",
    },
    tries: [
      { href: "/study/postflop/", ja: "ポストフロップのスタディで、フロップごとの戦略を見る", en: "See the strategy of each flop in the post-flop Study" },
      { href: "/study/report/", ja: "フロップの読み方ドリルで、ボードの特徴を当てる（集計レポートの上にあります）", en: "Name the features of a flop in the flop-reading drill (above the aggregate report)" },
      { href: "/study/report/", ja: "集計レポートで、ボードの種類ごとの傾向を見る", en: "See the tendencies by board type in the aggregate report" },
      { href: "/practice/#mode=postSpot", ja: "ポストフロップの局面を練習する", en: "Practise post-flop spots" },
    ],
  },
  {
    id: "mixed",
    minutes: 3,
    ja: {
      title: "混合戦略と頻度",
      lead: "GTOの答えは「ひとつの正解」ではなく「頻度」です。",
      points: [
        "同じハンド・同じ局面でも、レイズ60%・コール40% のように、複数の行動を頻度で混ぜます。相手に読まれないためです。",
        "混合になるのは、2つの行動の期待値がほぼ同じときです。どちらを選んでも損失が小さいので、EV損失で見ると差はわずかです。",
        "練習の採点は、期待値の差（EV損失）で行います。頻度の低い行動でも、損失が小さければ「正解」に入ります。",
        "RNGモードは、実戦のようにサイコロの目で行動を決める練習です。頻度どおりに混ぜる感覚が身につきます。",
      ],
      why: "「正解がひとつでない」ことを受け入れると、混合のハンドで間違えたと感じることが減ります。",
    },
    en: {
      title: "Mixed strategies and frequencies",
      lead: "A GTO answer is not one correct action but a set of frequencies.",
      points: [
        "Even the same hand in the same spot mixes several actions, for example raise 60% and call 40%, so that opponents cannot read you.",
        "A mix appears when two actions have almost the same expected value: either choice costs little, so the EV loss differs only slightly.",
        "Practice is graded by the difference in expected value (EV loss). A low-frequency action still counts as correct when its loss is small.",
        "RNG mode decides the action with a die, as at the table, to build the feel of mixing by the frequencies.",
      ],
      why: "Once you accept that there is not one correct answer, a mixed hand stops feeling like a mistake.",
    },
    tries: [{ href: "/practice/", ja: "練習で、「混合ハンドのみ」と「RNGモード」を試す", en: "Try \"mixed hands only\" and RNG mode in Practice" }],
  },
  {
    id: "icm",
    minutes: 4,
    ja: {
      title: "トーナメントのICMとプッシュ/フォールド",
      lead: "トーナメントでは、チップの価値が賞金の分け方で変わります。",
      points: [
        "ICM は、チップの分布から各プレイヤーの賞金の期待値を計算する考え方です。チップを失う痛みが、同じ量を増やす嬉しさより大きくなります。",
        "入賞の直前（バブル）では、コールが慎重になります。同じハンドでも、キャッシュゲームのチップEVとは答えが変わります。",
        "スタックが浅いとき（目安は10〜15bb以下）は、オールイン（ジャム）かフォールドの二択になることが多くなります。",
        "このアプリの ICM 画面は、プッシュ/フォールドだけを扱う簡易版です。オーバーコールや将来のブラインドの先読みは含みません。",
      ],
      why: "賞金の構造と各席のスタックを入れると、ジャムとコールの範囲が計算されます。練習では、賞金に対する％でEV損失を採点します。",
    },
    en: {
      title: "Tournaments: ICM and push/fold",
      lead: "In a tournament the value of a chip depends on how the prizes are paid.",
      points: [
        "ICM turns the chip distribution into each player's expected prize. Losing chips hurts more than winning the same amount helps.",
        "Near the money (the bubble) calls get tighter. The same hand has a different answer from the chip-EV answer of a cash game.",
        "With a short stack (roughly 10 to 15bb or less) the choice is often just all-in (a jam) or fold.",
        "The ICM screen of this app is a simple version that covers push/fold only: no overcalls and no look-ahead to future blinds.",
      ],
      why: "Enter the prize structure and each seat's stack and the jam and call ranges are calculated. In practice the EV loss is graded in % of the prize pool.",
    },
    tries: [{ href: "/icm/", ja: "ICM 画面で、バブルの場面を計算して練習する", en: "Calculate and practise a bubble spot on the ICM screen" }],
  },
  {
    id: "review",
    minutes: 3,
    ja: {
      title: "自分のハンドを振り返る",
      lead: "上達の近道は、自分のミスを見つけて直すことです。",
      points: [
        "Analyze に PokerStars などのハンド履歴を貼ると、プリフロップの各判断を解と比べて、EV損失で採点します。処理は端末内で行われ、外には送りません。",
        "成績画面の「ミスノート」と「苦手スポット」から、間違えた局面をスタディや練習でやり直せます。",
        "「今日の復習」は、間違えたハンドや忘れかけたハンドを、間隔をあけて出題します。毎日少しずつ続けるのが効果的です。",
        "気になった局面は、スタディの星で保存して、メモを残せます。",
      ],
      why: "解を眺めるだけでなく、自分の判断と照らし合わせることで、癖が見えてきます。",
    },
    en: {
      title: "Review your own hands",
      lead: "The shortest way to improve is to find your mistakes and fix them.",
      points: [
        "Paste hand histories (for example from PokerStars) into Analyze and each pre-flop decision is compared with the solution and graded by EV loss. It is processed on this device and nothing is sent out.",
        "From the mistake notebook and the weak spots on the Stats screen you can go back over the spots you got wrong, in Study or in Practice.",
        "\"Today's review\" asks the hands you missed or are about to forget, spaced out over time. A little every day works best.",
        "Positions that catch your eye can be saved with a star in Study, with a note.",
      ],
      why: "Looking at solutions is one thing; comparing them with your own decisions shows your habits.",
    },
    tries: [
      { href: "/analyze/", ja: "Analyze で、自分のハンド履歴を採点する", en: "Grade your own hand histories in Analyze" },
      { href: "/stats/", ja: "成績画面で、ミスノートを見る", en: "Open the mistake notebook on the Stats screen" },
    ],
  },
];

export const lessonById = (id: string): Lesson | undefined => LESSONS.find((l) => l.id === id);

export const lessonText = (l: Lesson, lang: Lang): LessonText => (lang === "en" ? l.en : l.ja);

/** the first lesson that is not done yet (in the order of the path), or null when all are */
export function nextLesson(done: ReadonlySet<string>): Lesson | null {
  return LESSONS.find((l) => !done.has(l.id)) ?? null;
}
