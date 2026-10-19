/* 静的データ：能力・クラス・習慣プリセット・種目ライブラリ */
(function (G) {
  'use strict';

  const CHALLENGE_DAYS = 66;

  const STATS = [
    { key: 'wis', label: '知恵', color: 'var(--st-wis)', icon: 'brain' },
    { key: 'con', label: '自信', color: 'var(--st-con)', icon: 'rise' },
    { key: 'str', label: '強さ', color: 'var(--st-str)', icon: 'lift' },
    { key: 'dis', label: '自制心', color: 'var(--st-dis)', icon: 'lock' },
    { key: 'foc', label: '集中', color: 'var(--st-foc)', icon: 'target' }
  ];
  const STAT = Object.fromEntries(STATS.map(s => [s.key, s]));

  // 最も高い能力でクラスが決まる。2番目の能力が副題になる。
  const CLASSES = {
    wis: { name: 'セージ', line: '知ることは、強くなること。' },
    con: { name: 'パラディン', line: '迷わず前に出る者が道を作る。' },
    str: { name: 'ウォリアー', line: '昨日の自分を、今日超えていけ。' },
    dis: { name: 'モンク', line: '静かな継続こそ最強の技。' },
    foc: { name: 'ローグ', line: '最高の日こそ、本当のあなた。' }
  };

  const SCENES = ['dawn', 'run', 'dojo', 'study', 'night', 'water', 'peak', 'city'];

  // 習慣プリセット（オンボーディングと追加シートで使用）
  const PRESETS = [
    { title: '午前7時に起きる', detail: '二度寝せずに起きる', time: '07:00', stat: 'dis', scene: 'dawn', type: 'check' },
    { title: '5km走る', detail: 'ゾーン2ペース', time: '16:00', stat: 'str', scene: 'run', type: 'check' },
    { title: '腕立て伏せ20回', detail: '10回×2セット', time: '', stat: 'str', scene: 'dojo', type: 'count', target: 20, unit: '回' },
    { title: '20ページ読む', detail: '寝る前の読書', time: '22:00', stat: 'wis', scene: 'study', type: 'count', target: 20, unit: 'ページ' },
    { title: '瞑想10分', detail: '呼吸だけに集中', time: '07:15', stat: 'foc', scene: 'peak', type: 'check' },
    { title: '水を2L飲む', detail: 'コップ8杯', time: '', stat: 'dis', scene: 'water', type: 'count', target: 8, unit: '杯' },
    { title: '日記を書く', detail: '今日の勝ちを3つ', time: '23:00', stat: 'con', scene: 'night', type: 'check' },
    { title: '深い集中ブロック', detail: '通知オフで50分', time: '09:00', stat: 'foc', scene: 'city', type: 'check' },
    { title: '冷水シャワー', detail: '最後の30秒', time: '', stat: 'con', scene: 'water', type: 'check' },
    { title: 'SNSは夜9時まで', detail: '寝る前のスクロール禁止', time: '21:00', stat: 'dis', scene: 'night', type: 'check' },
    { title: '英単語30個', detail: 'アプリで復習', time: '', stat: 'wis', scene: 'study', type: 'count', target: 30, unit: '個' },
    { title: '人に話しかける', detail: '自分から挨拶する', time: '', stat: 'con', scene: 'city', type: 'check' }
  ];

  // 種目ライブラリ（kind はアイコンと推定時間に使う）
  const EXERCISES = [
    { name: 'ベンチプレス', kind: 'barbell', part: '胸' },
    { name: 'インクラインダンベルプレス', kind: 'dumbbell', part: '胸' },
    { name: 'ショルダープレス', kind: 'dumbbell', part: '肩' },
    { name: 'サイドレイズ', kind: 'dumbbell', part: '肩' },
    { name: '腕立て伏せ', kind: 'body', part: '胸' },
    { name: 'ディップス', kind: 'body', part: '胸' },
    { name: 'トライセプスプッシュダウン', kind: 'cable', part: '腕' },
    { name: 'デッドリフト', kind: 'barbell', part: '背中' },
    { name: '懸垂', kind: 'body', part: '背中' },
    { name: 'ベントオーバーロウ', kind: 'barbell', part: '背中' },
    { name: 'ラットプルダウン', kind: 'cable', part: '背中' },
    { name: 'フェイスプル', kind: 'cable', part: '肩' },
    { name: 'バーベルカール', kind: 'barbell', part: '腕' },
    { name: 'スクワット', kind: 'barbell', part: '脚' },
    { name: 'ルーマニアンデッドリフト', kind: 'barbell', part: '脚' },
    { name: 'ブルガリアンスクワット', kind: 'dumbbell', part: '脚' },
    { name: 'レッグプレス', kind: 'machine', part: '脚' },
    { name: 'カーフレイズ', kind: 'machine', part: '脚' },
    { name: 'プランク(秒)', kind: 'body', part: '体幹' },
    { name: 'ハンギングレッグレイズ', kind: 'body', part: '体幹' }
  ];
  const EX_KIND = Object.fromEntries(EXERCISES.map(e => [e.name, e.kind]));

  const TEMPLATES = [
    {
      id: 'push', name: 'プッシュデイ', short: 'プッシュ', hue: 'var(--st-str)', scene: 'dojo',
      exercises: [
        { name: 'ベンチプレス', sets: 4, reps: 8, w: 60 },
        { name: 'ショルダープレス', sets: 4, reps: 6, w: 18 },
        { name: '腕立て伏せ', sets: 3, reps: 12, w: 0 },
        { name: 'ディップス', sets: 3, reps: 8, w: 0 }
      ]
    },
    {
      id: 'pull', name: 'プルデイ', short: 'プル', hue: 'var(--st-dis)', scene: 'city',
      exercises: [
        { name: 'デッドリフト', sets: 3, reps: 5, w: 100 },
        { name: '懸垂', sets: 4, reps: 8, w: 0 },
        { name: 'ベントオーバーロウ', sets: 4, reps: 10, w: 50 },
        { name: 'フェイスプル', sets: 3, reps: 15, w: 20 },
        { name: 'バーベルカール', sets: 3, reps: 10, w: 25 }
      ]
    },
    {
      id: 'legs', name: 'レッグデイ', short: 'レッグ', hue: 'var(--st-foc)', scene: 'run',
      exercises: [
        { name: 'スクワット', sets: 4, reps: 6, w: 80 },
        { name: 'ルーマニアンデッドリフト', sets: 3, reps: 10, w: 60 },
        { name: 'ブルガリアンスクワット', sets: 3, reps: 10, w: 14 },
        { name: 'カーフレイズ', sets: 4, reps: 15, w: 40 }
      ]
    }
  ];

  // 実績（トロフィー）。test は集計済みサマリーを受け取る。
  const ACHIEVEMENTS = [
    { id: 'first', name: '最初の一歩', desc: 'タスクを1つ完了', goal: 1, val: s => s.totalDone },
    { id: 'streak3', name: '3日坊主卒業', desc: '3日連続でやり切る', goal: 3, val: s => s.bestStreak },
    { id: 'streak7', name: '一週間の誓い', desc: '7日連続でやり切る', goal: 7, val: s => s.bestStreak },
    { id: 'streak21', name: '習慣の芽', desc: '21日連続でやり切る', goal: 21, val: s => s.bestStreak },
    { id: 'done50', name: 'エターナル', desc: 'タスクを50回完了', goal: 50, val: s => s.totalDone },
    { id: 'gym1', name: '鉄の洗礼', desc: 'ワークアウトを1回記録', goal: 1, val: s => s.workouts },
    { id: 'gym10', name: 'ジムの住人', desc: 'ワークアウトを10回記録', goal: 10, val: s => s.workouts },
    { id: 'ton', name: '10トンの男', desc: '総挙上量10,000kg', goal: 10000, val: s => s.totalVolume },
    { id: 'lv10', name: '覚醒', desc: 'レベル10に到達', goal: 10, val: s => s.level },
    { id: 'done200', name: 'レジェンド', desc: 'タスクを200回完了', goal: 200, val: s => s.totalDone },
    { id: 'day33', name: '折り返し', desc: '33日目に到達', goal: 33, val: s => s.day },
    { id: 'day66', name: '66日の覇者', desc: '66日を走り切る', goal: 66, val: s => s.day }
  ];

  // 習慣のヒント（インサイト「あなたへのヒント」）
  const TIPS = [
    { h: '2分ルール', b: 'やる気が出ない日は「2分だけ」始める。始めた時点で勝ち。' },
    { h: 'スキップは戦略', b: '休むと決めた日はスキップ。連続記録は途切れない。黙ってサボるのとは違う。' },
    { h: '時間を固定する', b: '「いつ・どこで」を決めた習慣は続く確率が上がる。タスクに時間を入れよう。' },
    { h: '66日の理由', b: 'ロンドン大学の研究では、新しい行動が自動化するまで平均66日かかった。' },
    { h: '休息も練習', b: '同じ部位は48時間空ける。プッシュ→プル→レッグの順番は理にかなっている。' },
    { h: '積み重ね', b: '既存の習慣の直後に新しい習慣をつなげる。「歯を磨いたら腕立て」。' }
  ];

  G.D = { CHALLENGE_DAYS, STATS, STAT, CLASSES, SCENES, PRESETS, EXERCISES, EX_KIND, TEMPLATES, ACHIEVEMENTS, TIPS };
})(window);
