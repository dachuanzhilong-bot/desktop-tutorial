/* 画面の描画とイベント。データは Store 経由でのみ変更する。 */
(function (G) {
  'use strict';

  const { D, Store: T, Scenes } = G;
  const { STATS, STAT, CLASSES, SCENES, PRESETS, EXERCISES, EX_KIND, TEMPLATES, TIPS, CHALLENGE_DAYS, MOODS } = D;

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const fmt = n => Math.round(n).toLocaleString('ja-JP');

  /* ---------- アイコン ---------- */
  const P = d => d.split(' M').map((x, i) => `<path d="${i ? 'M' + x : x}"/>`).join('');
  const ICONS = {
    flame: '<path d="M12 2.5c.9 3.3 5.5 5.6 5.5 10.6a5.5 5.5 0 0 1-11 0c0-2.6 1.3-4.4 2.7-5.5.2 1.8 1.1 2.9 2.2 3.3 0-3.3.6-5.6.6-8.4z" fill="currentColor" stroke="none"/>',
    trophy: P('M8 4h8v5a4 4 0 0 1-8 0V4z M8 6H5a3 3 0 0 0 3 4 M16 6h3a3 3 0 0 1-3 4 M12 13v4 M8 20h8 M9 17h6'),
    spark: '<path d="M12 2.5l2.3 7.2 7.2 2.3-7.2 2.3L12 21.5l-2.3-7.2L2.5 12l7.2-2.3z" fill="currentColor" stroke="none"/>',
    gear: P('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'),
    chevL: P('M15 18l-6-6 6-6'),
    chevR: P('M9 18l6-6-6-6'),
    chevD: P('M6 9l6 6 6-6'),
    plus: P('M12 5v14 M5 12h14'),
    minus: P('M5 12h14'),
    check: P('M5 12.5l4.5 4.5L19 7'),
    x: P('M6 6l12 12 M18 6L6 18'),
    brain: P('M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 0V6a2 2 0 0 0-3-2z M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 0 M9 9h1 M14 9h1'),
    rise: P('M12 3v5 M9 6l3-3 3 3 M3 19h18 M6 19a6 6 0 0 1 12 0 M3.5 13.5l2 1 M20.5 13.5l-2 1'),
    lift: P('M3 5h18 M5.5 3v4 M18.5 3v4 M12 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M8.5 5l3.5 6.5L15.5 5 M12 11.5V16 M12 16l-3 5 M12 16l3 5'),
    lock: P('M6 11h12v10H6z M8 11V8a4 4 0 0 1 8 0v3 M12 15v2'),
    target: P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'),
    barbell: P('M2 12h20 M5 8v8 M8 6v12 M16 6v12 M19 8v8'),
    dumbbell: P('M6 9v6 M9 7v10 M15 7v10 M18 9v6 M9 12h6 M3 12h3 M18 12h3'),
    body: P('M3 18h18 M5 18l5-5h6l3 5 M17 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'),
    cable: P('M12 3v9 M8 12h8l-1 9H9z M10 3h4'),
    machine: P('M4 4v16 M4 8h10 M14 5v6 M8 20h12 M18 12v8'),
    chart: P('M4 20V11 M10 20V4 M16 20v-7 M21 20H3'),
    medal: P('M8 3l4 6 4-6 M12 21a6 6 0 1 0 0-12 6 6 0 0 0 0 12z M12 13.2l1 2h2.1l-1.6 1.4.6 2.1-2.1-1.2-2.1 1.2.6-2.1-1.6-1.4H11z'),
    drop: P('M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z'),
    sun: P('M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4'),
    phone: P('M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M11 18h2'),
    clock: P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2'),
    play: '<path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none"/>',
    trash: P('M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13'),
    edit: P('M4 20h4L19 9l-4-4L4 16z M13 7l4 4'),
    skip: P('M5 5l10 7-10 7z M19 5v14'),
    arrow: P('M5 12h14 M13 6l6 6-6 6'),
    flask: P('M9 3h6 M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3'),
    run: P('M14 5.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M6 21l3-6 3 2v4 M9 15l1-5 4 2 3-1 M10 10l-3 1-2 3'),
    copy: P('M8 8h12v12H8z M4 16V4h12'),
    cloud: P('M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6 9.5 4.25 4.25 0 0 0 7 18z'),
    diamond: '<path d="M12 3l9 9-9 9-9-9z" fill="currentColor" stroke="none"/>',
    wave: P('M3 12h2 M7 9v6 M10 6v12 M14 8v8 M17 10v4 M21 12h-2'),
    pause: P('M8 5v14 M16 5v14'),
    stop: '<rect x="6" y="6" width="12" height="12" fill="currentColor" stroke="none"/>',
    share: P('M12 3v12 M7 8l5-5 5 5 M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6'),
    scale: P('M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M8.5 10a3.5 3.5 0 0 1 7 0z M12 10l1.5-2'),
    restart: P('M4 4v6h6 M4.5 15a8 8 0 1 0 1.9-8.3L4 10')
  };
  // 気分の顔（1=しかめ面 … 5=笑顔）
  function face(v) {
    const c = (v - 3) * 2.6;
    return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r=".6" fill="currentColor"/><circle cx="15" cy="10" r=".6" fill="currentColor"/><path d="M8 ${(15.5 - c / 3).toFixed(1)} Q12 ${(15.5 + c).toFixed(1)} 16 ${(15.5 - c / 3).toFixed(1)}"/></svg>`;
  }
  const icon = (n, extra) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" ${extra || ''}>${ICONS[n] || ''}</svg>`;
  const STAT_ICON = { wis: 'brain', con: 'rise', str: 'lift', dis: 'lock', foc: 'target' };

  const sceneCache = new Map();
  function scene(kind, seed, opts) {
    const key = kind + '|' + seed + '|' + (opts && opts.tone === false ? 0 : 1);
    if (!sceneCache.has(key)) sceneCache.set(key, Scenes.scene(kind, seed, opts));
    return sceneCache.get(key);
  }

  /* ---------- UI 状態 ---------- */
  const ui = {
    tab: 'today', viewDate: T.today(), filter: 'todo', rating: 'now', sgIdx: 0,
    pop: null, sessionMin: false, rest: null, onb: null, confirm: null, draft: null
  };
  try {
    const saved = JSON.parse(localStorage.getItem('sixtysix.ui') || '{}');
    if (saved.tab) ui.tab = saved.tab;
  } catch (e) { /* noop */ }
  const hashTab = (location.hash || '').slice(1);
  if (['today', 'train', 'insight', 'rating'].includes(hashTab)) ui.tab = hashTab;
  function saveUI() { try { localStorage.setItem('sixtysix.ui', JSON.stringify({ tab: ui.tab })); } catch (e) { /* noop */ } }

  /* ---------- 共通 ---------- */
  function toast(html) {
    const box = $('#toasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  // 進捗の変化（XP・レベル・実績）を検出して演出する
  function progress(fn) {
    const before = T.totals();
    const doneBefore = new Set(T.achievements().filter(a => a.done).map(a => a.id));
    const out = fn();
    const after = T.totals();
    const gained = after.xp - before.xp;
    if (gained > 0) toast(`${icon('spark')}<span class="num">+${fmt(gained)} XP</span>`);
    T.achievements().filter(a => a.done && !doneBefore.has(a.id)).forEach((a, i) => {
      setTimeout(() => toast(`${icon('trophy')} 実績解除「${esc(a.name)}」`), 400 + i * 300);
    });
    if (after.level > before.level) setTimeout(() => levelUp(after.level), 450);
    return out;
  }

  function haptic(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* noop */ } }

  let audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18, 0.36].forEach((t, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'square'; o.frequency.value = i === 2 ? 1320 : 880;
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.14);
        o.connect(g).connect(audioCtx.destination);
        o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.16);
      });
    } catch (e) { /* 音が出せない環境 */ }
  }

  function durLabel(min) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    return h ? `${h}時間${m ? m + '分' : ''}` : `${m}分`;
  }
  // 大きな数字の横に小さな単位を添える（3時間50分 → 3<small>時間</small>50<small>分</small>）
  function durHTML(min) {
    min = Math.max(0, Math.round(min));
    const h = Math.floor(min / 60), m = min % 60;
    return (h ? `${h}<small class="u">時間</small>` : '') + `${m}<small class="u">分</small>`;
  }
  const WEEK = [1, 2, 3, 4, 5, 6, 0];
  function daysLabel(h) {
    if (!h.days || !h.days.length || h.days.length === 7) return '';
    return WEEK.filter(d => h.days.includes(d)).map(d => T.WD[d]).join('・');
  }
  function dateLabel(k) {
    const d = T.parseKey(k);
    return `${d.getMonth() + 1}月${d.getDate()}日（${T.WD[d.getDay()]}）`;
  }

  /* ======================================================================
   * 今日
   * ==================================================================== */
  function cheer(k, st) {
    const t = T.today();
    if (k > t) return 'まだ来ていない日。今日に集中しよう。';
    if (!st.total) return 'タスクを追加して、66日を始めよう。';
    if (k < t) return `${st.done}/${st.total} 完了${st.skip ? `・${st.skip} スキップ` : ''}の日。`;
    if (st.done + st.skip === st.total && st.done) return '完璧な一日。これが本当のあなた。';
    const streak = T.streakInfo().current;
    if (st.done / st.total >= 0.5) return '順調だね、その調子！';
    if (streak >= 3) return `${streak}日連続中。今日も途切れさせるな。`;
    if (st.done) return 'いい出だし。次の一つへ。';
    return '一つ目を片付けよう。勢いはそこから。';
  }

  function strip(k) {
    const S = T.S, t = T.today();
    let out = '';
    for (let i = 0; i < CHALLENGE_DAYS; i++) {
      const d = T.addDays(S.startDate, i);
      let cls = '';
      if (d <= t) {
        const st = T.dayStatus(d);
        if (T.dayComplete(d)) cls = 'p3';
        else if (st.rate >= 0.5) cls = 'p2';
        else if (st.done > 0) cls = 'p1';
      }
      if (d === t) cls += ' today';
      if (d === k) cls += ' view';
      out += `<i class="${cls}" title="${i + 1}日目"></i>`;
    }
    return out;
  }

  function habitCard(h, l, k) {
    const isDone = l && l.s === 'done', isSkip = l && l.s === 'skip';
    const streak = T.habitStreak(h, k);
    const v = l ? +l.v || 0 : 0;
    const meta = [daysLabel(h), h.time ? `<span class="num">${esc(h.time)}</span>` : '', esc(h.detail)].filter(Boolean).join(' · ');
    const running = T.S.timer && T.S.timer.id === h.id && T.S.timer.k === k;
    const count = T.isAmount(h)
      ? `<p class="meta">${running ? `<span class="live-tag">${icon('clock')}計測中</span> ` : h.type === 'timer' ? icon('clock') + ' ' : ''}<span class="num">${isDone ? h.target : v} / ${h.target}</span>${esc(h.unit)}${h.detail ? ' · ' + esc(h.detail) : ''}</p><div class="bar"><i style="width:${Math.min(100, ((isDone ? h.target : v) / h.target) * 100)}%"></i></div>`
      : `<p class="meta">${meta || '&nbsp;'}</p>`;
    return `
      <div class="hcard ${isDone ? 'is-done' : ''} ${isSkip ? 'is-skip' : ''} ${ui.pop === h.id ? 'pop' : ''}" data-act="habit" data-id="${h.id}" role="button" tabindex="0" aria-label="${esc(h.title)}の詳細">
        ${scene(h.scene, h.id)}
        <span class="badge ${streak ? '' : 'cold'}">${icon('flame')}${streak}日</span>
        <span class="statpip" style="--c:${STAT[h.stat].color}">${STAT[h.stat].label}</span>
        ${isDone ? '<span class="stamp">完了</span>' : isSkip ? '<span class="stamp">休</span>' : ''}
        <div class="body"><h3>${esc(h.title)}</h3>${count}</div>
        <button class="check" data-act="toggle" data-id="${h.id}" aria-label="${isDone ? '完了を取り消す' : '完了にする'}">${isSkip ? icon('skip') : icon('check')}</button>
      </div>`;
  }

  function viewToday() {
    const S = T.S, k = ui.viewDate, t = T.today();
    const tot = T.totals();
    const day = T.dayIndex(k);
    const st = T.dayStatus(k);
    const items = T.habitsOn(k).map(h => ({ h, l: T.logOf(k, h.id) }));
    const byTime = (a, b) => (a.h.time || '99') < (b.h.time || '99') ? -1 : 1;
    const groups = {
      todo: items.filter(x => !x.l || (x.l.s !== 'done' && x.l.s !== 'skip')).sort(byTime),
      done: items.filter(x => x.l && x.l.s === 'done'),
      skip: items.filter(x => x.l && x.l.s === 'skip')
    };
    const list = groups[ui.filter];
    const trophies = T.achievements().filter(a => a.done).length;
    const m = S.metrics[k] || {};
    const j = S.journal[k] || {};
    const resting = S.habits.filter(h => h.created <= k && (!h.archivedAt || h.archivedAt > k) && !T.scheduledOn(h, k));
    const over = T.seasonOver();
    const emptyMsg = {
      todo: items.length ? ['全部片付いた。', '今日のあなたは強い。明日もこの調子で。'] : ['まだタスクがありません', '右上の＋から、66日間続けたいことを追加しよう。'],
      done: ['まだ完了なし', 'チェックボタンを押すとここに並びます。'],
      skip: ['スキップなし', '休むと決めた日は、タスクを開いてスキップ。連続記録は守られます。']
    }[ui.filter];

    return `
      ${over && !S.demo ? `<button class="season-card" data-act="season">${scene('peak', 'season-' + S.seasons.length, { tone: false })}<span class="in"><span class="eyebrow hot">シーズン${S.seasons.length + 1} 完走</span><strong>66日を走り切った。</strong><small>結果を見て、次の66日へ ${icon('arrow')}</small></span></button>` : ''}
      ${S.demo ? `<div class="demo-bar"><p><strong>サンプルデータを表示中。</strong>触って試せます。</p><button class="btn small primary" data-act="onboard">自分の66日を始める</button></div>` : ''}
      <div class="topbar">
        <span class="chip hot" title="連続日数">${icon('flame')}<span class="num">${tot.streak}</span></span>
        <span class="chip" title="実績">${icon('trophy')}<span class="num">${trophies}</span></span>
        <span class="chip" title="獲得XP">${icon('spark')}<span class="num">${fmt(tot.xp)}</span></span>
        <span class="spacer"></span>
        <button class="icon-btn" data-act="settings" aria-label="設定">${icon('gear')}</button>
      </div>

      <section class="dayhead">
        <div class="left">
          <div class="daynum"><span class="num">${Math.max(1, day)}</span><span class="of">${day > CHALLENGE_DAYS ? '日目 · 延長戦' : `日目 / ${CHALLENGE_DAYS}`}</span></div>
          <p class="cheer">${cheer(k, st)}</p>
          <div class="date-label">${dateLabel(k)}${k === t ? ' · 今日' : ''}</div>
        </div>
        <div class="navs">
          <button class="icon-btn" data-act="day" data-d="-1" aria-label="前の日" ${k <= S.startDate ? 'disabled' : ''}>${icon('chevL')}</button>
          <button class="icon-btn" data-act="day" data-d="1" aria-label="次の日" ${k >= t ? 'disabled' : ''}>${icon('chevR')}</button>
        </div>
      </section>

      <div>
        <div class="strip" aria-label="66日間の進み具合">${strip(k)}</div>
        <div class="strip-legend"><span>1日目</span><span>${Math.round((Math.min(tot.day, CHALLENGE_DAYS) / CHALLENGE_DAYS) * 100)}% 経過</span><span>66日目</span></div>
      </div>

      <div class="filterbar">
      <div class="filters" role="group" aria-label="表示の切り替え">
        <button class="f" data-act="filter" data-f="todo" aria-pressed="${ui.filter === 'todo'}">やること <small>${groups.todo.length}</small></button>
        <button class="f" data-act="filter" data-f="done" aria-pressed="${ui.filter === 'done'}">完了 <small>${groups.done.length}</small></button>
        <button class="f" data-act="filter" data-f="skip" aria-pressed="${ui.filter === 'skip'}">スキップ済み <small>${groups.skip.length}</small></button>
      </div>
        <button class="icon-btn" data-act="add-habit" aria-label="タスクを追加">${icon('plus')}</button>
      </div>

      ${resting.length && ui.filter === 'todo' ? `<p class="muted small" style="margin:-8px 0 0">${k === t ? '今日' : 'この日'}は予定なし：${resting.map(h => esc(h.title)).join('、')}</p>` : ''}
      <div class="cards">
        ${list.length ? list.map(x => habitCard(x.h, x.l, k)).join('') : `<div class="empty"><strong>${emptyMsg[0]}</strong><span>${emptyMsg[1]}</span>${!items.length ? `<button class="btn primary" data-act="add-habit">${icon('plus')}タスクを追加</button>` : ''}</div>`}
      </div>

      <div class="section-head"><p class="eyebrow">${k === t ? '今日の記録' : 'この日の記録'}</p><button class="more" data-act="metrics">記録する${icon('chevR')}</button></div>
      <div class="checkin">
        <button data-act="metrics"><small style="color:var(--st-foc)">${icon('drop')}水分</small>${m.water != null && m.water !== '' ? `<span class="num">${m.water}<small class="u">L</small></span>` : '<span class="unset">未記録</span>'}</button>
        <button data-act="metrics"><small style="color:#e2b552">${icon('sun')}起床</small>${m.wake ? `<span class="num">${esc(m.wake)}</span>` : '<span class="unset">未記録</span>'}</button>
        <button data-act="metrics"><small style="color:var(--st-dis)">${icon('phone')}スマホ</small>${m.screen != null && m.screen !== '' ? `<span class="num">${durHTML(m.screen)}</span>` : '<span class="unset">未記録</span>'}</button>
        <button data-act="metrics"><small style="color:var(--st-con)">${icon('scale')}体重</small>${m.weight ? `<span class="num">${m.weight}<small class="u">kg</small></span>` : '<span class="unset">未記録</span>'}</button>
      </div>

      <div class="section-head"><p class="eyebrow">ひとこと日記</p>${j.mood || j.text ? `<span class="more">${icon('check')}+10 XP</span>` : ''}</div>
      <div class="journal">
        <div class="moods" role="group" aria-label="今日の気分">${MOODS.map(x => `<button data-act="mood" data-v="${x.v}" aria-pressed="${j.mood === x.v}" style="--c:${x.color}">${face(x.v)}<small>${x.label}</small></button>`).join('')}</div>
        <label class="field"><span class="sr">ひとこと</span><input type="text" id="jr-text" maxlength="80" value="${esc(j.text || '')}" placeholder="${k === t ? '今日いちばんの出来事は？' : 'この日のひとこと'}" enterkeyhint="done"></label>
      </div>`;
  }

  function toggleHabit(id) {
    const k = ui.viewDate;
    if (k > T.today()) { toast('まだその日は来ていません'); return; }
    const h = T.S.habits.find(x => x.id === id);
    if (!h) return;
    const l = T.logOf(k, h.id);
    progress(() => {
      if (l && (l.s === 'done' || l.s === 'skip')) {
        T.setLog(k, h.id, T.isAmount(h) && l.s === 'done' ? { s: 'open', v: Math.max(0, h.target - (h.type === 'timer' ? 5 : 1)) } : null);
        ui.pop = null;
      } else {
        T.setLog(k, h.id, { s: 'done', v: h.target });
        if (T.S.timer && T.S.timer.id === h.id) T.S.timer = null;
        ui.pop = h.id;
        haptic(30);
      }
      T.commit();
    });
    setTimeout(() => { ui.pop = null; }, 700);
  }

  /* ---------- 習慣の詳細シート ---------- */
  function habitSheet(id) {
    openSheet({
      live: true,
      render() {
        const h = T.S.habits.find(x => x.id === id);
        if (!h) { setTimeout(closeSheet); return ''; }
        const k = ui.viewDate, l = T.logOf(k, h.id);
        const isDone = l && l.s === 'done', isSkip = l && l.s === 'skip';
        const v = isDone ? h.target : l ? +l.v || 0 : 0;
        const streak = T.habitStreak(h, k);
        let best = 0, run = 0, doneCount = 0, hist = '';
        for (let i = 0; i < CHALLENGE_DAYS; i++) {
          const d = T.addDays(T.S.startDate, i);
          const x = T.logOf(d, h.id);
          let c = '';
          if (d < h.created || d > T.today() || !T.scheduledOn(h, d)) c = 'n';
          else if (x && x.s === 'done') { c = 'd'; run++; doneCount++; best = Math.max(best, run); }
          else if (x && x.s === 'skip') c = 's';
          else if (d !== T.today()) run = 0;
          hist += `<i class="${c}"></i>`;
        }
        const confirmDel = ui.confirm === 'del-' + h.id;
        return `
          <div class="art">${scene(h.scene, h.id)}<h3>${esc(h.title)}</h3></div>
          <div class="kv">
            <div><small>連続</small><span class="num">${streak}</span><small>日</small></div>
            <div><small>最長</small><span class="num">${best}</span><small>日</small></div>
            <div><small>累計</small><span class="num">${doneCount}</span><small>回</small></div>
          </div>
          <p class="muted small" style="margin:0">${daysLabel(h) ? daysLabel(h) + ' · ' : '毎日 · '}${esc(h.detail) || '詳細なし'}${h.time ? ` · ${esc(h.time)}` : ''} · <span style="color:${STAT[h.stat].color}">${STAT[h.stat].label}</span>が伸びる</p>
          ${h.type === 'timer' && !isDone && !isSkip && k === T.today() ? focusBlock(h, v) : ''}
          ${T.isAmount(h) && !isSkip ? `
            <div class="stepper ${h.type === 'timer' ? 'slim' : ''}">
              <button data-act="step" data-id="${h.id}" data-d="${h.type === 'timer' ? -5 : -1}" aria-label="減らす">${icon('minus')}</button>
              <div class="val"><span class="num">${v}</span><small>/ ${h.target} ${esc(h.unit)}${h.type === 'timer' ? '（手動で記録）' : ''}</small></div>
              <button data-act="step" data-id="${h.id}" data-d="${h.type === 'timer' ? 5 : 1}" aria-label="増やす">${icon('plus')}</button>
            </div>` : ''}
          <div class="acts">
            <button class="btn ${isDone ? '' : 'primary'}" data-act="toggle" data-id="${h.id}">${isDone ? '完了を取り消す' : isSkip ? 'スキップを取り消す' : `${icon('check')}完了`}</button>
            ${!isDone && !isSkip ? `<button class="btn quiet" data-act="skip" data-id="${h.id}">${icon('skip')}今日は休む</button>` : ''}
          </div>
          <div><p class="eyebrow" style="margin-bottom:8px">66日の記録</p><div class="hist">${hist}</div></div>
          ${confirmDel ? `
            <div class="confirm"><p>「${esc(h.title)}」を削除します。過去の記録とXPは残ります。</p>
              <div class="acts"><button class="btn quiet small" data-act="confirm-cancel">やめる</button><button class="btn danger small" data-act="habit-del" data-id="${h.id}">削除する</button></div></div>` : `
            <div class="acts">
              <button class="btn quiet small" data-act="habit-edit" data-id="${h.id}">${icon('edit')}編集</button>
              <button class="btn quiet small" data-act="confirm" data-c="del-${h.id}">${icon('trash')}削除</button>
            </div>`}`;
      }
    });
  }

  /* ---------- 集中タイマー（タイマー型タスク） ---------- */
  function timerLeft(tm) { return tm.end ? Math.max(0, (tm.end - Date.now()) / 1000) : tm.left; }
  function mmss(sec) { sec = Math.ceil(sec); return Math.floor(sec / 60) + ':' + T.pad(sec % 60); }

  function focusBlock(h, v) {
    const tm = T.S.timer && T.S.timer.id === h.id ? T.S.timer : null;
    const other = T.S.timer && !tm ? T.S.habits.find(x => x.id === T.S.timer.id) : null;
    const total = tm ? tm.total : Math.max(1, h.target - v) * 60;
    const left = tm ? timerLeft(tm) : total;
    const off = (264 * (1 - left / total)).toFixed(1);
    let btns;
    if (!tm) btns = other ? `<p class="muted small" style="margin:0">「${esc(other.title)}」のタイマーが動いています</p>` : `<button class="btn primary" data-act="ft-start" data-id="${h.id}">${icon('play')}${Math.round(total / 60)}分 開始</button>`;
    else if (tm.end) btns = `<button class="btn" data-act="ft-pause">${icon('pause')}一時停止</button>`;
    else btns = `<button class="btn primary" data-act="ft-resume">${icon('play')}再開</button><button class="btn quiet" data-act="ft-log">ここまで記録</button><button class="btn quiet" data-act="ft-reset" aria-label="リセット">${icon('restart')}</button>`;
    return `
      <div class="ftimer">
        <svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" stroke-width="6"/><circle id="ft-ring" cx="50" cy="50" r="42" fill="none" stroke="var(--ember)" stroke-width="6" stroke-dasharray="264" stroke-dashoffset="${off}" transform="rotate(-90 50 50)"/></svg>
        <div class="t"><span class="num" id="ft-left">${mmss(left)}</span><small>${tm ? (tm.end ? '集中しています' : '一時停止中') : 'タイマーで記録'}</small></div>
        <div class="acts">${btns}</div>
      </div>`;
  }

  function startFocus(id) {
    const h = T.S.habits.find(x => x.id === id);
    const k = T.today();
    const l = T.logOf(k, id);
    const v = l ? +l.v || 0 : 0;
    const total = Math.max(1, h.target - v) * 60;
    T.S.timer = { id, k, total, end: Date.now() + total * 1000, left: null, base: v };
    T.commit();
    ensureFocusTick();
  }
  function logFocus(finished) {
    const tm = T.S.timer;
    if (!tm) return;
    const h = T.S.habits.find(x => x.id === tm.id);
    T.S.timer = null;
    if (!h) { T.commit(); return; }
    const mins = finished ? Math.ceil(tm.total / 60) : Math.floor((tm.total - timerLeft(tm)) / 60);
    const v = Math.min(h.target, (tm.base || 0) + mins);
    progress(() => {
      if (v >= h.target) { T.setLog(tm.k, h.id, { s: 'done', v: h.target }); ui.pop = h.id; }
      else T.setLog(tm.k, h.id, v ? { s: 'open', v } : null);
      T.commit();
    });
    setTimeout(() => { ui.pop = null; }, 700);
    if (finished) { beep(); haptic([200, 100, 200]); toast(`${icon('target')} 「${esc(h.title)}」完了。よく集中した`); }
    else if (mins) toast(`${mins}分を記録しました`);
  }
  let focusTimer = 0;
  function ensureFocusTick() {
    if (focusTimer || !T.S.timer) return;
    focusTimer = setInterval(() => {
      const tm = T.S.timer;
      if (!tm) { clearInterval(focusTimer); focusTimer = 0; renderFocusPill(); return; }
      const left = timerLeft(tm);
      if (tm.end && left <= 0) { logFocus(true); return; }
      const a = $('#ft-left'); if (a) a.textContent = mmss(left);
      const r = $('#ft-ring'); if (r) r.style.strokeDashoffset = String(264 * (1 - left / tm.total));
      const b = $('#fp-left'); if (b) b.textContent = mmss(left);
    }, 500);
  }
  // シートを閉じても、動いているタイマーをタブバーの上に出しておく
  function renderFocusPill() {
    const tm = T.S.timer;
    const h = tm && T.S.habits.find(x => x.id === tm.id);
    let el = $('#focuspill');
    if (!h || sheet || T.S.active) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('button'); el.id = 'focuspill'; el.className = 'focuspill'; document.body.appendChild(el); }
    el.dataset.act = 'habit-focus';
    el.dataset.id = h.id;
    el.innerHTML = `${icon(tm.end ? 'clock' : 'pause')}<span class="t">${esc(h.title)}</span><span class="num" id="fp-left">${mmss(timerLeft(tm))}</span>`;
  }

  function stepHabit(id, d) {
    const k = ui.viewDate;
    if (k > T.today()) return;
    const h = T.S.habits.find(x => x.id === id);
    const l = T.logOf(k, id);
    const cur = l ? (l.s === 'done' ? h.target : +l.v || 0) : 0;
    const next = Math.max(0, cur + d);
    progress(() => {
      if (next >= h.target) { T.setLog(k, id, { s: 'done', v: h.target }); if (!(l && l.s === 'done')) { ui.pop = id; haptic(30); } }
      else T.setLog(k, id, next ? { s: 'open', v: next } : null);
      T.commit();
    });
    setTimeout(() => { ui.pop = null; }, 700);
  }

  /* ---------- 習慣の追加・編集 ---------- */
  function habitForm(id) {
    const h = id ? T.S.habits.find(x => x.id === id) : null;
    ui.draft = h ? Object.assign({}, h) : { title: '', detail: '', time: '', stat: 'dis', scene: 'dawn', type: 'check', target: 10, unit: '回' };
    ui.draftId = id || null;
    openSheet({
      render() {
        const d = ui.draft;
        const used = new Set(T.S.habits.filter(x => !x.archivedAt).map(x => x.title));
        return `
          <div class="sheet-head"><h2>${h ? 'タスクを編集' : 'タスクを追加'}</h2><button class="icon-btn ghost" data-act="close" aria-label="閉じる">${icon('x')}</button></div>
          ${h ? '' : `<div class="field"><span>テンプレートから選ぶ</span><div class="opts">${PRESETS.filter(p => !used.has(p.title)).map(p => `<button type="button" data-act="preset" data-i="${PRESETS.indexOf(p)}"><i class="sw" style="--c:${STAT[p.stat].color}"></i>${esc(p.title)}</button>`).join('')}</div></div>`}
          <form data-form="habit" class="field" style="gap:14px">
            <label class="field"><span>タイトル</span><input type="text" id="hf-title" data-draft="title" value="${esc(d.title)}" maxlength="24" required placeholder="例：5km走る"></label>
            <label class="field"><span>詳細</span><input type="text" id="hf-detail" data-draft="detail" value="${esc(d.detail)}" maxlength="40" placeholder="例：ゾーン2ペース"></label>
            <label class="field"><span>時間（任意）</span><input type="time" id="hf-time" data-draft="time" value="${esc(d.time)}"></label>
            <div class="field"><span>伸びる能力</span><div class="opts">${STATS.map(s => `<button type="button" data-act="draft" data-k="stat" data-v="${s.key}" aria-pressed="${d.stat === s.key}"><i class="sw" style="--c:${s.color}"></i>${s.label}</button>`).join('')}</div></div>
            <div class="field"><span>やる曜日</span><div class="opts week">
              <button type="button" data-act="draft-everyday" aria-pressed="${!d.days || !d.days.length || d.days.length === 7}">毎日</button>
              ${WEEK.map(w => `<button type="button" data-act="draft-day" data-v="${w}" aria-pressed="${!!(d.days && d.days.length && d.days.length < 7 && d.days.includes(w))}">${T.WD[w]}</button>`).join('')}
            </div></div>
            <div class="field"><span>記録の仕方</span><div class="opts">
              <button type="button" data-act="draft" data-k="type" data-v="check" aria-pressed="${d.type !== 'count' && d.type !== 'timer'}">${icon('check')}チェック</button>
              <button type="button" data-act="draft" data-k="type" data-v="count" aria-pressed="${d.type === 'count'}">${icon('plus')}回数・量</button>
              <button type="button" data-act="draft" data-k="type" data-v="timer" aria-pressed="${d.type === 'timer'}">${icon('clock')}タイマー</button>
            </div></div>
            ${d.type === 'timer' ? `<label class="field"><span>目標（分）</span><input type="number" id="hf-target" data-draft="target" value="${esc(d.target)}" min="1" max="600" inputmode="numeric" required></label>` : ''}
            ${d.type === 'count' ? `<div class="row2">
              <label class="field"><span>目標</span><input type="number" id="hf-target" data-draft="target" value="${esc(d.target)}" min="1" max="9999" inputmode="numeric" required></label>
              <label class="field"><span>単位</span><input type="text" id="hf-unit" data-draft="unit" value="${esc(d.unit)}" maxlength="6" placeholder="回"></label>
            </div>` : ''}
            <div class="field"><span>背景</span><div class="scenes">${SCENES.map(s => `<button type="button" data-act="draft" data-k="scene" data-v="${s}" aria-pressed="${d.scene === s}" aria-label="${s}">${scene(s, 'pick', { tone: false })}</button>`).join('')}</div></div>
            <button class="btn primary block" type="submit">${h ? '保存する' : '追加する'}</button>
          </form>`;
      }
    });
  }

  function saveHabitForm() {
    const d = ui.draft;
    if (!d.title.trim()) { toast('タイトルを入力してください'); return; }
    const data = {
      title: d.title.trim(), detail: (d.detail || '').trim(), time: d.time || '', stat: d.stat, scene: d.scene, type: d.type,
      target: Math.max(1, Math.min(9999, parseInt(d.target, 10) || 1)), unit: (d.unit || '').trim(),
      days: d.days && d.days.length && d.days.length < 7 ? d.days.slice().sort() : null
    };
    if (ui.draftId) { T.updateHabit(ui.draftId, data); toast('保存しました'); }
    else {
      data.created = ui.viewDate < T.today() ? ui.viewDate : T.today();
      T.addHabit(data);
      ui.filter = 'todo';
      toast(`「${esc(data.title)}」を追加しました`);
    }
    closeSheet();
  }

  /* ---------- 記録シート ---------- */
  function metricsSheet() {
    const k = ui.viewDate;
    const m = Object.assign({}, T.S.metrics[k] || {});
    ui.metricDraft = m;
    openSheet({
      render() {
        const d = ui.metricDraft;
        return `
          <div class="sheet-head"><h2>${k === T.today() ? '今日の記録' : dateLabel(k) + 'の記録'}</h2><button class="icon-btn ghost" data-act="close" aria-label="閉じる">${icon('x')}</button></div>
          <p class="muted small" style="margin:0">インサイトの「ビフォーアフター」に使います。毎日でなくても大丈夫。</p>
          <form data-form="metrics" class="field" style="gap:16px">
            <div class="field"><span>${icon('drop')} 水分（L）</span>
              <div class="stepper">
                <button type="button" data-act="water" data-d="-0.25" aria-label="減らす">${icon('minus')}</button>
                <div class="val"><span class="num" id="water-val">${d.water != null && d.water !== '' ? d.water : '—'}</span><small>リットル</small></div>
                <button type="button" data-act="water" data-d="0.25" aria-label="増やす">${icon('plus')}</button>
              </div></div>
            <label class="field"><span>${icon('sun')} 起床時間</span><input type="time" id="mf-wake" data-mdraft="wake" value="${esc(d.wake && d.wake.length === 4 ? '0' + d.wake : d.wake || '')}"></label>
            <div class="field"><span>${icon('phone')} スクリーンタイム</span>
              <div class="row2">
                <label class="field"><span class="small muted">時間</span><input type="number" id="mf-sh" data-mdraft="sh" min="0" max="24" inputmode="numeric" value="${d.screen != null && d.screen !== '' ? Math.floor(d.screen / 60) : ''}"></label>
                <label class="field"><span class="small muted">分</span><input type="number" id="mf-sm" data-mdraft="sm" min="0" max="59" inputmode="numeric" value="${d.screen != null && d.screen !== '' ? d.screen % 60 : ''}"></label>
              </div></div>
            <label class="field"><span>${icon('scale')} 体重（kg・任意）</span><input type="number" id="mf-weight" step="0.1" min="20" max="300" inputmode="decimal" value="${d.weight || ''}" placeholder="例：66.9"></label>
            <button class="btn primary block" type="submit">記録する</button>
          </form>`;
      }
    });
  }

  function saveMetrics() {
    const k = ui.viewDate, d = ui.metricDraft;
    const sh = $('#mf-sh').value, sm = $('#mf-sm').value;
    const wake = $('#mf-wake').value;
    const out = {};
    if (d.water != null && d.water !== '') out.water = Math.round(d.water * 100) / 100;
    if (wake) out.wake = wake.replace(/^0(\d):/, '$1:');
    if (sh !== '' || sm !== '') out.screen = (parseInt(sh, 10) || 0) * 60 + (parseInt(sm, 10) || 0);
    const wt = parseFloat($('#mf-weight').value);
    if (wt >= 20 && wt <= 300) out.weight = Math.round(wt * 10) / 10;
    progress(() => {
      if (Object.keys(out).length) T.S.metrics[k] = out; else delete T.S.metrics[k];
      T.commit();
    });
    toast('記録しました');
    closeSheet();
  }

  /* ======================================================================
   * ワークアウト
   * ==================================================================== */
  function exIcon(name) {
    const k = EX_KIND[name] || 'dumbbell';
    return icon(k === 'machine' ? 'machine' : k);
  }

  function viewTrain() {
    const S = T.S, a = S.active;
    const tpl = T.suggestedTemplate();
    const sets = tpl.exercises.reduce((n, e) => n + e.sets, 0);
    const mins = Math.round(sets * 3);
    const recent = S.workouts.slice().sort((x, y) => y.start - x.start).slice(0, 6);
    // 自己ベスト（推定1RM）
    const prs = {};
    S.workouts.forEach(w => w.ex.forEach(e => e.sets.forEach(s => {
      if (!s.done || !(+s.w > 0)) return;
      const v = (+s.w) * (1 + Math.min(+s.r, 15) / 30);
      if (!prs[e.name] || v > prs[e.name].v) prs[e.name] = { v, w: +s.w, r: +s.r };
    })));
    const prList = Object.entries(prs).sort((x, y) => y[1].v - x[1].v).slice(0, 6);
    // 直近7日と、その前の7日の総挙上量
    const t = T.today();
    let wk = 0, prev = 0;
    S.workouts.forEach(w => {
      const dd = T.diffDays(w.date, t);
      const v = T.volumeOf(w).volume;
      if (dd < 7) wk += v; else if (dd < 14) prev += v;
    });
    const delta = prev ? Math.round(((wk - prev) / prev) * 100) : null;

    const hero = a ? `
      <article class="session-hero">
        ${scene(a.tpl ? T.templateById(a.tpl).scene : 'night', 'tpl-' + (a.tpl || 'free'))}
        <span class="tag l">進行中</span>
        <span class="tag r">${a.ex.length}種目 · ${a.ex.reduce((n, e) => n + e.sets.filter(s => s.done).length, 0)}/${a.ex.reduce((n, e) => n + e.sets.length, 0)}セット</span>
        <h2>${esc(a.name)}</h2>
        <span class="live" data-clock>${clockText(a.start)}</span>
      </article>
      <button class="btn primary block" data-act="resume">${icon('play')}ワークアウトに戻る</button>` : `
      <article class="session-hero">
        ${scene(tpl.scene, 'tpl-' + tpl.id)}
        <span class="tag l">${mins}分</span>
        <span class="tag r">${tpl.exercises.length}種目 · ${sets}セット</span>
        <h2>${esc(tpl.name)}</h2>
      </article>
      <div class="trio">
        <div><small>時間</small><span class="num">${mins}分</span></div>
        <div><small>セット</small><span class="num">${sets}</span></div>
        <div><small>種目</small><span class="num">${tpl.exercises.length}</span></div>
      </div>
      <button class="btn primary block" data-act="start" data-tpl="${tpl.id}">ワークアウト開始</button>
      <hr class="rule">
      <div class="exchips">${tpl.exercises.map((e, i) => `<span><b>${i + 1}.</b>${exIcon(e.name)}${esc(e.name)}·${e.sets}×${e.reps}</span>`).join('')}</div>`;

    return `
      <div class="pagehead"><h1 class="page-title">ワークアウトトラッカー</h1></div>
      <p class="eyebrow hot">${a ? 'セッション中' : '今日のセッション'}</p>
      ${hero}
      <p class="eyebrow">クイックスタート</p>
      <div class="quick">
        <button data-act="start-free"><span class="ico">${icon('plus')}</span>新規</button>
        ${T.allTemplates().map(x => `<button data-act="pick-tpl" data-tpl="${x.id}" aria-pressed="${!a && x.id === tpl.id}"><span class="ico" style="--c:${x.hue}">${icon(x.custom ? 'diamond' : 'wave')}</span>${esc(x.short)}</button>`).join('')}
      </div>
      <button class="create-row" data-act="start-free">
        <span class="sq">${icon('diamond')}</span>
        <span class="txt"><strong>セッションを作る</strong><small>新しい記録を開いて、種目はその場で追加。</small></span>
        ${icon('chevR')}
      </button>
      <div class="duo">
        <div class="mini"><h4>今週の総挙上量</h4><span class="big num" style="font-size:28px">${fmt(wk)}<small style="font-size:13px"> kg</small></span><span class="sub">${delta == null ? '先週の記録なし' : `先週比 <b style="color:${delta >= 0 ? 'var(--good)' : 'var(--bad)'}">${delta >= 0 ? '+' : ''}${delta}%</b>`}</span></div>
        <div class="mini"><h4>累計</h4><span class="big num" style="font-size:28px">${S.workouts.length}<small style="font-size:13px"> 回</small></span><span class="sub">${fmt(T.totals().totalVolume)} kg 挙げた</span></div>
      </div>
      ${S.templates.length ? `<div class="section-head"><p class="eyebrow">マイテンプレート</p></div>
      <div class="list">${S.templates.map(x => `<button class="row" data-act="tpl-open" data-id="${x.id}"><span class="txt"><strong>${esc(x.name)}</strong><small>${x.exercises.length}種目 · ${x.exercises.reduce((n, e) => n + e.sets, 0)}セット · ${x.exercises.map(e => esc(e.name)).join('、')}</small></span>${icon('chevR')}</button>`).join('')}</div>` : ''}
      ${prList.length ? `<div class="section-head"><p class="eyebrow">自己ベスト（推定1RM）</p></div>
      <div class="prs">${prList.map(([n, p]) => `<button data-act="ex-hist" data-n="${esc(n)}"><small>${esc(n)}</small><span class="num">${Math.round(p.v)}<em>kg</em></span><small class="mono" style="font-weight:400">${p.w}kg × ${p.r}</small></button>`).join('')}</div>` : ''}
      <p class="eyebrow">最近</p>
      <div class="list">
        ${recent.length ? recent.map(w => {
          const v = T.volumeOf(w);
          const dd = new Date(w.start);
          return `<button class="row" data-act="workout" data-id="${w.id}"><span class="txt"><strong>${esc(w.name)}</strong><small>${T.WD[dd.getDay()]}·${dd.getHours()}:${T.pad(dd.getMinutes())}·${v.sets}セット·${w.dur}分</small></span><span class="pill">${fmt(v.volume)} kg</span></button>`;
        }).join('') : '<div class="empty"><strong>記録はまだありません</strong><span>最初の1セットが、66日後の自分をつくる。</span></div>'}
      </div>`;
  }

  function clockText(start) {
    const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + T.pad(m) : m) + ':' + T.pad(x);
  }

  /* ---------- セッション画面 ---------- */
  let clockTimer = 0;
  function renderSession() {
    const a = T.S.active;
    let el = $('#session');
    if (!a || ui.sessionMin) {
      if (el) el.remove();
      clearInterval(clockTimer); clockTimer = 0;
      if (!a) hideRest();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'session'; el.className = 'session'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'ワークアウト記録');
      document.body.appendChild(el);
    }
    const scroll = el.scrollTop;
    const confirmDiscard = ui.confirm === 'discard';
    el.innerHTML = `<div class="session-in">
      <div class="session-top">
        <button class="icon-btn ghost" data-act="minimize" aria-label="閉じる（記録は続く）">${icon('chevD')}</button>
        <div class="t"><input type="text" id="ss-name" value="${esc(a.name)}" data-sname maxlength="20" aria-label="セッション名"><span class="clock" data-clock>${clockText(a.start)}</span></div>
        <button class="btn small primary" data-act="finish">終了</button>
      </div>
      ${a.ex.map((e, ei) => {
        const prev = T.lastSetsFor(e.name);
        const best = T.bestE1RM(e.name);
        return `<section class="ex">
          <div class="ex-head">${exIcon(e.name)}<h3>${esc(e.name)}</h3>${best ? `<span class="best">PR ${Math.round(best)}kg</span>` : ''}<button class="icon-btn ghost" style="width:36px;height:36px;font-size:16px" data-act="ex-remove" data-e="${ei}" aria-label="${esc(e.name)}を外す">${icon('x')}</button></div>
          <table class="sets"><thead><tr><th>SET</th><th>前回</th><th>kg</th><th>回</th><th><span class="sr">完了</span></th></tr></thead><tbody>
          ${e.sets.map((s, si) => `<tr class="${s.done ? 'done' : ''}">
            <td class="idx">${si + 1}</td>
            <td class="prev">${prev && prev[si] ? `${prev[si].w}×${prev[si].r}` : '—'}</td>
            <td><input type="number" inputmode="decimal" step="0.5" min="0" id="w-${ei}-${si}" data-set="w" data-e="${ei}" data-s="${si}" value="${esc(s.w)}" aria-label="重量"></td>
            <td><input type="number" inputmode="numeric" min="0" id="r-${ei}-${si}" data-set="r" data-e="${ei}" data-s="${si}" value="${esc(s.r)}" aria-label="回数"></td>
            <td><button class="tick" data-act="set-done" data-e="${ei}" data-s="${si}" aria-label="セット${si + 1}を完了">${icon('check')}</button></td>
          </tr>`).join('')}
          </tbody></table>
          <div class="ex-foot"><button class="btn quiet small" data-act="set-add" data-e="${ei}">${icon('plus')}セット追加</button>${e.sets.length > 1 ? `<button class="btn quiet small" data-act="set-del" data-e="${ei}">${icon('minus')}最後を削除</button>` : ''}</div>
        </section>`;
      }).join('')}
      <button class="btn block" data-act="ex-add">${icon('plus')}種目を追加</button>
      <div class="field"><span>休憩タイマー</span><div class="opts">${[60, 90, 120, 180].map(s => `<button data-act="rest-len" data-v="${s}" aria-pressed="${T.S.rest === s}">${s}秒</button>`).join('')}<button data-act="rest-len" data-v="0" aria-pressed="${!T.S.rest}">オフ</button></div></div>
      ${confirmDiscard ? `<div class="confirm"><p>このセッションを破棄します。記録したセットは保存されません。</p><div class="acts"><button class="btn quiet small" data-act="confirm-cancel">続ける</button><button class="btn danger small" data-act="discard">破棄する</button></div></div>` : `<button class="btn danger block" data-act="confirm" data-c="discard">${icon('trash')}セッションを破棄</button>`}
    </div>`;
    el.scrollTop = scroll;
    if (!clockTimer) clockTimer = setInterval(() => {
      if (!T.S.active) return;
      $$('[data-clock]').forEach(n => { n.textContent = clockText(T.S.active.start); });
    }, 1000);
  }

  /* ---------- 休憩タイマー ---------- */
  let restTimer = 0;
  function startRest(sec) {
    if (!sec) return;
    ui.rest = { end: Date.now() + sec * 1000, total: sec };
    drawRest();
    clearInterval(restTimer);
    restTimer = setInterval(tickRest, 250);
  }
  function tickRest() {
    if (!ui.rest) return;
    const left = Math.ceil((ui.rest.end - Date.now()) / 1000);
    if (left <= 0) {
      hideRest();
      beep(); haptic([200, 100, 200]);
      toast(`${icon('lift')} 休憩終了。次のセットへ！`);
      return;
    }
    const n = $('#rest-left');
    if (n) n.textContent = Math.floor(left / 60) + ':' + T.pad(left % 60);
    const ring = $('#rest-ring');
    if (ring) ring.style.strokeDashoffset = String(150.8 * (1 - left / ui.rest.total));
  }
  function drawRest() {
    let el = $('#restbar');
    if (!el) {
      el = document.createElement('div');
      el.id = 'restbar'; el.className = 'restbar';
      el.innerHTML = `<div class="restbar-in">
        <svg class="ring" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="24" fill="none" stroke="rgba(25,19,15,.15)" stroke-width="5"/><circle id="rest-ring" cx="27" cy="27" r="24" fill="none" stroke="#ff6b0a" stroke-width="5" stroke-dasharray="150.8" stroke-dashoffset="0" transform="rotate(-90 27 27)" stroke-linecap="butt"/></svg>
        <div class="txt"><small>賢く休む</small><span class="num" id="rest-left">0:00</span></div>
        <button data-act="rest-add" data-v="-15">−15</button><button data-act="rest-add" data-v="15">+15</button><button class="go" data-act="rest-skip">次へ</button>
      </div>`;
      document.body.appendChild(el);
    }
    requestAnimationFrame(() => el.classList.add('on'));
    tickRest();
  }
  function hideRest() {
    clearInterval(restTimer); restTimer = 0;
    ui.rest = null;
    const el = $('#restbar');
    if (el) { el.classList.remove('on'); setTimeout(() => { if (!ui.rest) el.remove(); }, 350); }
  }

  function exerciseSheet() {
    ui.exQuery = '';
    openSheet({
      render() {
        const parts = [...new Set(EXERCISES.map(e => e.part))];
        return `
          <div class="sheet-head"><h2>種目を追加</h2><button class="icon-btn ghost" data-act="close" aria-label="閉じる">${icon('x')}</button></div>
          <form data-form="custom-ex" class="row2" style="grid-template-columns:1fr auto">
            <label class="field"><span class="sr">種目名</span><input type="text" id="ex-custom" placeholder="自由入力（例：ケトルベルスイング）" maxlength="24"></label>
            <button class="btn small" type="submit">追加</button>
          </form>
          <div class="lib">${parts.map(p => `<p class="eyebrow" style="margin-top:6px">${p}</p>` + EXERCISES.filter(e => e.part === p).map(e => `<button data-act="ex-pick" data-n="${esc(e.name)}">${exIcon(e.name)}${esc(e.name)}<small>${T.bestE1RM(e.name) ? 'PR ' + Math.round(T.bestE1RM(e.name)) + 'kg' : ''}</small></button>`).join('')).join('')}</div>`;
      }
    });
  }

  function addExercise(name) {
    const a = T.S.active;
    if (!a || !name) return;
    const prev = T.lastSetsFor(name);
    a.ex.push({ name, sets: Array.from({ length: prev ? prev.length : 3 }, (_, i) => ({ w: prev ? prev[i].w : 0, r: prev ? prev[i].r : 10, done: false })) });
    T.commit();
    closeSheet();
    setTimeout(() => { const s = $('#session'); if (s) s.scrollTop = s.scrollHeight; }, 30);
  }

  function finish() {
    const a = T.S.active;
    const anyDone = a.ex.some(e => e.sets.some(s => s.done));
    if (!anyDone) { toast('完了したセットがありません。✓を押して記録しよう'); return; }
    hideRest();
    let res;
    progress(() => { res = T.finishWorkout(); });
    ui.sessionMin = false;
    if (!res) return;
    ui.savedTpl = false;
    openSheet({
      live: true,
      render() {
        return `
          <div class="art">${scene(res.w.tpl ? T.templateById(res.w.tpl).scene : 'night', 'tpl-' + (res.w.tpl || 'free'))}<h3>${esc(res.w.name)} 完了</h3></div>
          <div class="kv">
            <div><small>時間</small><span class="num">${res.w.dur}</span><small>分</small></div>
            <div><small>セット</small><span class="num">${res.sets}</span></div>
            <div><small>総挙上量</small><span class="num">${fmt(res.volume)}</span><small>kg</small></div>
          </div>
          ${res.records.length ? `<div class="records">${res.records.map(r => `<div>${icon('trophy')}<span>${esc(r.name)}</span>${r.first ? '初記録' : '自己ベスト更新'} ${r.value}kg</div>`).join('')}</div>` : ''}
          <p class="muted" style="margin:0">強さ <b style="color:var(--st-str)">+3</b>・自制心 <b style="color:var(--st-dis)">+1</b>・<b style="color:var(--ember-2)">+${res.xp} XP</b>。追い込んだら、賢く休もう。</p>
          ${ui.savedTpl ? `<p class="muted small" style="margin:0">${icon('check')} マイテンプレートに保存しました。トレーニング画面のクイックスタートから開始できます。</p>` : `<button class="btn block" data-act="tpl-save" data-id="${res.w.id}">${icon('diamond')}このメニューをマイテンプレートに保存</button>`}
          <button class="btn primary block" data-act="close">閉じる</button>`;
      }
    });
  }

  function workoutSheet(id) {
    openSheet({
      live: true,
      render() {
        const w = T.S.workouts.find(x => x.id === id);
        if (!w) { setTimeout(closeSheet); return ''; }
        const v = T.volumeOf(w);
        const dd = new Date(w.start);
        return `
          <div class="sheet-head"><h2>${esc(w.name)}</h2><button class="icon-btn ghost" data-act="close" aria-label="閉じる">${icon('x')}</button></div>
          <p class="muted small" style="margin:0">${dateLabel(w.date)} ${dd.getHours()}:${T.pad(dd.getMinutes())}</p>
          <div class="kv">
            <div><small>時間</small><span class="num">${w.dur}</span><small>分</small></div>
            <div><small>セット</small><span class="num">${v.sets}</span></div>
            <div><small>総挙上量</small><span class="num">${fmt(v.volume)}</span><small>kg</small></div>
          </div>
          <div class="list">${w.ex.map(e => `<button class="row" data-act="ex-hist" data-n="${esc(e.name)}"><span class="txt"><strong>${esc(e.name)}</strong><small class="mono">${e.sets.map(s => (+s.w ? s.w + 'kg×' : '') + s.r).join('  ')}</small></span>${icon('chart')}</button>`).join('')}</div>
          ${ui.confirm === 'wdel' ? `<div class="confirm"><p>この記録を削除します。獲得したXPも取り消されます。</p><div class="acts"><button class="btn quiet small" data-act="confirm-cancel">やめる</button><button class="btn danger small" data-act="workout-del" data-id="${w.id}">削除する</button></div></div>` : `<button class="btn quiet block" data-act="confirm" data-c="wdel">${icon('trash')}記録を削除</button>`}`;
      }
    });
  }

  function exerciseHistorySheet(name) {
    openSheet({
      render() {
        const hs = T.exerciseHistory(name);
        const weighted = hs.some(x => x.e1rm > 0);
        const vals = hs.map(x => weighted ? x.e1rm : x.reps);
        const unit = weighted ? 'kg' : '回';
        let chart = '';
        if (hs.length >= 2) {
          const W = 320, H = 140, pl = 34, pr = 10, pt = 14, pb = 22;
          const lo = Math.floor(Math.min(...vals) * 0.95), hi = Math.ceil(Math.max(...vals) * 1.03) || 1;
          const x = i => pl + (i / (hs.length - 1)) * (W - pl - pr);
          const y = v => pt + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - pt - pb);
          const best = Math.max(...vals);
          const dl = k => { const d = T.parseKey(k); return `${d.getMonth() + 1}/${d.getDate()}`; };
          chart = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)}の推移">
            ${[lo, hi].map(v => `<line x1="${pl}" y1="${y(v).toFixed(1)}" x2="${W - pr}" y2="${y(v).toFixed(1)}" stroke="var(--line)"/><text x="${pl - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('')}
            <polyline points="${vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--ember)" stroke-width="2.5" stroke-linejoin="round"/>
            ${vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${v === best ? 5 : 3}" fill="${v === best ? 'var(--paper)' : 'var(--ember)'}"/>`).join('')}
            <text x="${pl}" y="${H - 4}">${dl(hs[0].date)}</text><text x="${W - pr}" y="${H - 4}" text-anchor="end">${dl(hs[hs.length - 1].date)}</text>
          </svg>`;
        }
        const first = vals[0], last = vals[vals.length - 1];
        return `
          <div class="sheet-head">${exIcon(name)}<h2>${esc(name)}</h2><button class="icon-btn ghost" data-act="close" aria-label="閉じる">${icon('x')}</button></div>
          ${hs.length ? `
          <div class="kv">
            <div><small>${weighted ? '推定1RM' : '最大回数'}</small><span class="num">${Math.round(Math.max(...vals))}</span><small>${unit}</small></div>
            <div><small>はじめ→今</small><span class="num">${hs.length > 1 ? (last - first >= 0 ? '+' : '−') + Math.abs(Math.round((last - first) * 10) / 10) : '—'}</span><small>${unit}</small></div>
            <div><small>記録</small><span class="num">${hs.length}</span><small>回</small></div>
          </div>
          ${chart || '<p class="muted small" style="margin:0">2回以上記録すると推移のグラフが出ます。</p>'}
          <div class="list">${hs.slice().reverse().map(x => `<div class="row"><span class="txt"><strong>${dateLabel(x.date)}</strong><small class="mono">${x.sets}セット · ベスト ${x.w ? x.w + 'kg×' : ''}${x.r}回${x.volume ? ` · ${fmt(x.volume)}kg` : ''}</small></span>${weighted ? `<span class="pill">${x.e1rm}kg</span>` : ''}</div>`).join('')}</div>` : '<p class="muted">まだ記録がありません。</p>'}`;
      }
    });
  }

  /* ======================================================================
   * インサイト
   * ==================================================================== */
  function topStats(stats) {
    return STATS.map(s => ({ k: s.key, v: stats[s.key] })).sort((a, b) => b.v - a.v);
  }

  function suggestions() {
    const S = T.S, t = T.today();
    const titles = new Set(S.habits.filter(h => !h.archivedAt).map(h => h.title));
    const statsUsed = new Set(S.habits.filter(h => !h.archivedAt).map(h => h.stat));
    const out = [];
    const wk = S.workouts.filter(w => T.diffDays(w.date, t) < 7);
    let vol = 0, prevVol = 0;
    S.workouts.forEach(w => { const dd = T.diffDays(w.date, t), v = T.volumeOf(w).volume; if (dd < 7) vol += v; else if (dd < 14) prevVol += v; });
    const wts = T.metricSeries('weight');
    const bw = wts.length ? +wts[wts.length - 1].v : null;
    const protein = bw ? Math.round((bw * 1.6) / 5) * 5 : 120;
    if (wk.length >= 2) {
      const reasons = [`今は週${wk.length}回の筋トレ`];
      if (bw) reasons.unshift(`体重${bw}kg×1.6g`);
      if (prevVol) reasons.push(`筋負荷が先週より${Math.round(((vol - prevVol) / prevVol) * 100)}%${vol >= prevVol ? '増' : '減'}`);
      out.push({ id: 'protein', big: `${protein}g`, sub: 'タンパク質 / 日', reasons: reasons.slice(0, 3), habit: { title: `タンパク質${protein}g`, detail: '体重×1.6gが目安', stat: 'str', scene: 'dojo', type: 'count', target: protein, unit: 'g' } });
    }
    const water = T.metricSeries('water').slice(-3);
    if (water.length && water.reduce((n, x) => n + +x.v, 0) / water.length < 2) {
      out.push({ id: 'water', big: '2.0L', sub: '水分 / 日', reasons: [`直近の平均は${(water.reduce((n, x) => n + +x.v, 0) / water.length).toFixed(1)}L`, '脱水は集中力を落とす'], habit: PRESETS[5] });
    }
    const wake = T.metricSeries('wake').slice(-3);
    if (wake.length && wake.reduce((n, x) => n + T.toMin(x.v), 0) / wake.length > 8 * 60) {
      out.push({ id: 'wake', big: '7:30', sub: '起床目標', reasons: [`平均起床 ${T.fromMin(wake.reduce((n, x) => n + T.toMin(x.v), 0) / wake.length)}`, '15分ずつ前倒しが続くコツ'], habit: { title: '7時半に起きる', detail: '毎週15分ずつ前倒し', time: '07:30', stat: 'dis', scene: 'dawn', type: 'check' } });
    }
    const scr = T.metricSeries('screen').slice(-3);
    if (scr.length && scr.reduce((n, x) => n + +x.v, 0) / scr.length > 180) {
      out.push({ id: 'screen', big: '21:00', sub: 'SNS終了時刻', reasons: [`平均 ${durLabel(scr.reduce((n, x) => n + +x.v, 0) / scr.length)} / 日`, '寝る前の画面は睡眠を浅くする'], habit: PRESETS[9] });
    }
    if (!statsUsed.has('wis')) out.push({ id: 'read', big: '20p', sub: '読書 / 日', reasons: ['知恵を伸ばすタスクがまだない', '1日20ページで年に約25冊'], habit: PRESETS[3] });
    if (!statsUsed.has('foc')) out.push({ id: 'med', big: '10分', sub: '瞑想 / 日', reasons: ['集中を伸ばすタスクがまだない', '短くても毎日が効く'], habit: PRESETS[4] });
    if (!statsUsed.has('con')) out.push({ id: 'journal', big: '3つ', sub: '今日の勝ち', reasons: ['自信を伸ばすタスクがまだない', '小さな勝ちを言葉にする'], habit: PRESETS[6] });
    if (!S.workouts.length) out.push({ id: 'gym', big: '週3', sub: 'ワークアウト', reasons: ['まだ筋トレの記録がない', 'プッシュ・プル・レッグを回そう'], habit: null, tab: 'train' });
    return out.filter(x => !S.dismissed.includes(x.id) && !(x.habit && titles.has(x.habit.title)));
  }

  function completionChart() {
    const L = T.ledger();
    const S = T.S;
    const days = L.daily;
    const n = days.length;
    const W = 160, H = 74;
    const pace = days.map((d, i) => T.habitsOn(d.k).length * 0.7);
    let cum = 0;
    const paceCum = pace.map(p => (cum += p));
    const max = Math.max(4, days.length ? days[n - 1].cum : 0, paceCum[n - 1] || 0);
    const x = i => n <= 1 ? W : (i / (n - 1)) * W;
    const y = v => H - (v / max) * (H - 6);
    const you = days.map((d, i) => `${x(i).toFixed(1)},${y(d.cum).toFixed(1)}`);
    const avg = paceCum.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const lastY = n ? y(days[n - 1].cum) : H;
    const todayDone = n ? days[n - 1].done : 0;
    return `
      <svg class="chart" viewBox="-2 -16 ${W + 6} ${H + 20}" role="img" aria-label="累計完了数の推移">
        <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#47d17b" stop-opacity=".45"/><stop offset="1" stop-color="#47d17b" stop-opacity="0"/></linearGradient></defs>
        <line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="var(--line)" stroke-width="1"/>
        <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 4"/>
        ${n > 1 ? `<polygon points="0,${H} ${you.join(' ')} ${W},${H}" fill="url(#cg)"/>
        <polyline points="${avg.join(' ')}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3"/>
        <polyline points="${you.join(' ')}" fill="none" stroke="#47d17b" stroke-width="2.5" stroke-linejoin="round"/>` : ''}
        <circle cx="${x(n - 1)}" cy="${lastY}" r="5" fill="var(--panel)" stroke="#47d17b" stroke-width="2.5"/>
        ${todayDone ? `<g transform="translate(${Math.min(W - 30, x(n - 1) - 40)} ${Math.max(-14, lastY - 22)})"><rect width="30" height="14" rx="3" fill="#2f9a56"/><text x="15" y="10.5" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">+${todayDone}</text></g>` : ''}
      </svg>`;
  }

  function beforeAfter() {
    const fields = [
      { k: 'water', label: '毎日の水分', ico: 'drop', c: 'var(--st-foc)', show: v => `${(+v).toFixed(1)} L`, big: v => `${(+v).toFixed(1)}<small class="u">L</small>`, delta: (a, b) => { const d = b - a; return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} L`; } },
      { k: 'wake', label: '起床時間', ico: 'sun', c: '#e2b552', show: v => String(v), big: v => esc(v), delta: (a, b) => { const d = T.toMin(a) - T.toMin(b); return d === 0 ? '変化なし' : `${durLabel(Math.abs(d))}${d > 0 ? '早く' : '遅く'}`; } },
      { k: 'screen', label: 'スクリーンタイム', ico: 'phone', c: 'var(--st-dis)', show: v => durLabel(v), big: v => durHTML(v), delta: (a, b) => { const d = b - a; return `${d > 0 ? '+' : '−'}${durLabel(Math.abs(d))}`; } }
    ];
    let changes = 0;
    const cells = fields.map(f => {
      const s = T.metricSeries(f.k);
      if (s.length < 2) return `<div style="--c:${f.c}"><span class="hd"><span class="ico">${icon(f.ico)}</span>${f.label}</span><span class="was">記録が2日分そろうと比較できます</span><button class="btn quiet small" data-act="metrics" style="margin-top:auto">記録する</button></div>`;
      changes++;
      const a = s[0], b = s[s.length - 1];
      const ago = T.diffDays(a.k, b.k);
      return `<div style="--c:${f.c}"><span class="hd"><span class="ico">${icon(f.ico)}</span>${f.label}</span><span class="was">${f.show(a.v)}<br>${ago}日前</span><span class="now num">${f.big(b.v)}</span><span class="delta">${f.delta(a.v, b.v)}</span></div>`;
    });
    return { html: cells.join(''), changes };
  }

  function weightChart() {
    const s = T.metricSeries('weight').map(x => ({ k: x.k, v: +x.v }));
    if (s.length < 2) return '';
    const W = 320, H = 120, padL = 34, padR = 10, padT = 12, padB = 22;
    const vs = s.map(x => x.v);
    const lo = Math.floor(Math.min(...vs) - 0.5), hi = Math.ceil(Math.max(...vs) + 0.5);
    const span = Math.max(1, T.diffDays(s[0].k, s[s.length - 1].k));
    const x = k => padL + (T.diffDays(s[0].k, k) / span) * (W - padL - padR);
    const y = v => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const pts = s.map(p => `${x(p.k).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const first = s[0], last = s[s.length - 1];
    const d = Math.round((last.v - first.v) * 10) / 10;
    const mid = Math.round(((lo + hi) / 2) * 10) / 10;
    const dl = k => { const dt = T.parseKey(k); return `${dt.getMonth() + 1}/${dt.getDate()}`; };
    return `
      <div class="section-head"><p class="eyebrow">体重の推移</p><span class="more mono">${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)} kg</span></div>
      <div class="panel weight">
        <div class="wt-head"><span class="num">${last.v}<small class="u">kg</small></span><span class="muted small">${dl(first.k)}は${first.v}kg</span></div>
        <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="体重の推移">
          ${[lo, mid, hi].map(v => `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" stroke="var(--line)" ${v === mid ? 'stroke-dasharray="2 4"' : ''}/><text x="${padL - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('')}
          <polyline points="${pts}" fill="none" stroke="var(--st-con)" stroke-width="2.5" stroke-linejoin="round"/>
          ${s.map(p => `<circle cx="${x(p.k).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.5" fill="var(--st-con)"/>`).join('')}
          <circle cx="${x(last.k).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="5" fill="var(--panel)" stroke="var(--st-con)" stroke-width="2.5"/>
          <text x="${padL}" y="${H - 4}">${dl(first.k)}</text><text x="${W - padR}" y="${H - 4}" text-anchor="end">${dl(last.k)}</text>
        </svg>
      </div>`;
  }

  function moodSection() {
    const S = T.S, t = T.today();
    const days = Object.keys(S.journal).filter(k => k >= S.startDate && k <= t).sort();
    const withMood = days.filter(k => S.journal[k].mood);
    if (withMood.length < 3) return `
      <div class="section-head"><p class="eyebrow">気分と達成率</p></div>
      <p class="muted small" style="margin:0">「今日」画面のひとこと日記で気分を3日分つけると、気分と達成率の関係がここに出ます。</p>`;
    const sum = [0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0];
    withMood.forEach(k => { const st = T.dayStatus(k); if (!st.total) return; const m = S.journal[k].mood; sum[m] += Math.min(1, st.rate); cnt[m]++; });
    const notes = days.filter(k => S.journal[k].text).slice(-3).reverse();
    return `
      <div class="section-head"><p class="eyebrow">気分と達成率</p><span class="more mono">${withMood.length}日分</span></div>
      <div class="wkbars moodbars">${MOODS.map(x => {
        const r = cnt[x.v] ? sum[x.v] / cnt[x.v] : null;
        return `<div style="--c:${x.color}"><em>${r == null ? '—' : Math.round(r * 100) + '%'}</em><span class="b" style="height:${r == null ? 0 : Math.max(3, r * 80)}px"></span><small>${face(x.v)}</small></div>`;
      }).join('')}</div>
      ${notes.length ? `<div class="notes">${notes.map(k => { const x = S.journal[k]; const mo = MOODS.find(m => m.v === x.mood); return `<button class="note" data-act="goto-day" data-k="${k}"><span style="color:${mo ? mo.color : 'var(--dim)'}">${x.mood ? face(x.mood) : icon('edit')}</span><span class="txt"><small>${dateLabel(k)}</small>${esc(x.text)}</span></button>`; }).join('')}</div>` : ''}`;
  }

  function weekdayBars() {
    const S = T.S, t = T.today();
    const sum = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0];
    for (let k = S.startDate; k <= t; k = T.addDays(k, 1)) {
      const st = T.dayStatus(k);
      if (!st.total || (k === t && !st.done)) continue;
      const wd = T.parseKey(k).getDay();
      sum[wd] += Math.min(1, st.rate); cnt[wd]++;
    }
    const order = [1, 2, 3, 4, 5, 6, 0];
    const rates = order.map(i => cnt[i] ? sum[i] / cnt[i] : null);
    const best = Math.max(...rates.filter(r => r != null), 0);
    return `<div class="wkbars">${order.map((wd, i) => {
      const r = rates[i];
      return `<div><em>${r == null ? '—' : Math.round(r * 100) + '%'}</em><span class="b ${r != null && r === best && best > 0 ? 'best' : ''}" style="height:${r == null ? 0 : Math.max(3, r * 80)}px"></span><small>${T.WD[wd]}</small></div>`;
    }).join('')}</div>`;
  }

  function heatmap() {
    const S = T.S, t = T.today();
    let out = '';
    for (let i = 0; i < CHALLENGE_DAYS; i++) {
      const d = T.addDays(S.startDate, i);
      let cls = '';
      if (d > t) cls = 'future';
      else {
        const st = T.dayStatus(d);
        if (T.dayComplete(d)) cls = 'p3'; else if (st.rate >= 0.5) cls = 'p2'; else if (st.done) cls = 'p1';
      }
      if (d === t) cls += ' today';
      out += `<button class="c ${cls}" data-act="goto-day" data-k="${d}" aria-label="${i + 1}日目を開く" ${d > t ? 'disabled' : ''}>${i + 1}</button>`;
    }
    return out;
  }

  function viewInsight() {
    const S = T.S;
    const L = T.ledger(), tot = T.totals();
    const ach = T.achievements();
    const next = ach.filter(a => !a.done).sort((a, b) => (b.value / b.goal) - (a.value / a.goal))[0];
    const tops = topStats(L.stats);
    const cls = CLASSES[tops[0].k];
    // 最も伸びた能力
    const growth = STATS.map(s => ({ s, g: L.stats[s.key] - S.base[s.key] })).sort((a, b) => b.g - a.g)[0];
    const sg = suggestions();
    const idx = sg.length ? ui.sgIdx % sg.length : 0;
    const cur = sg[idx];
    const ba = beforeAfter();
    const tipStart = Math.max(0, tot.day) % TIPS.length;
    const tips = [TIPS[tipStart], TIPS[(tipStart + 1) % TIPS.length]];
    const firstDay = L.daily.length ? L.daily[L.daily.length - 1].done : 0;

    return `
      <div class="pagehead" style="justify-content:space-between">
        <h1 class="page-title">インサイト</h1>
        ${next ? `<div class="nextach"><small>次・${esc(next.name)}</small><span class="num">${fmt(Math.min(next.value, next.goal))}<em>/${fmt(next.goal)}</em></span><span class="meter"><i style="width:${Math.min(100, (next.value / next.goal) * 100)}%"></i></span></div>` : ''}
      </div>

      <article class="classcard">
        ${scene('peak', 'class-' + tops[0].k)}
        <div class="in">
          <div class="hd"><span>あなたの分析 · ${tot.day}日目</span>${growth.g > 0 ? `<span class="tagline">最も伸びた：${growth.s.label}</span>` : ''}</div>
          <h2>${cls.name}</h2>
          <p class="line">${cls.line}</p>
          <div class="lab">クラスプロフィール</div>
          <div class="statrow">${STATS.map(s => `<div class="${s.key === tops[0].k ? 'top' : ''}" style="--c:${s.color}">${icon(STAT_ICON[s.key])}<span class="num">${L.stats[s.key]}</span><small>${s.label}</small></div>`).join('')}</div>
          <button class="btn block" data-act="tab" data-tab="rating">詳しい分析 ${icon('arrow')}</button>
        </div>
      </article>

      <div class="duo">
        <div class="mini">
          <h4>完了数</h4>
          <span class="big num">${fmt(L.seasonDone)}</span>
          <span class="sub">1日目から</span>
          ${completionChart()}
          <div class="legend"><span><i></i>あなた</span><span><i class="dash"></i>目標ペース</span><span style="margin-left:auto">今日 +${firstDay}</span></div>
        </div>
        ${cur ? `<div class="mini suggest">
          <h4><span>タスク提案</span><span class="mono">${idx + 1}/${sg.length}</span></h4>
          <span class="big num">${cur.big}</span>
          <span class="sub">${cur.sub}</span>
          <ul>${cur.reasons.map((r, i) => `<li>${icon(i ? 'flask' : 'run')}<span>${esc(r)}</span></li>`).join('')}</ul>
          <div class="acts"><button class="add" data-act="sg-add" data-id="${cur.id}">${cur.habit ? '追加' : '始める'}</button><button data-act="sg-skip" data-id="${cur.id}">スキップ</button></div>
        </div>` : `<div class="mini suggest"><h4>タスク提案</h4><span class="big num" style="font-size:26px">OK</span><span class="sub">今の組み立てはバランスがいい。このまま続けよう。</span></div>`}
      </div>

      <div class="section-head"><p class="eyebrow">ビフォーアフター</p><button class="more" data-act="metrics">${ba.changes}つの変化${icon('chevR')}</button></div>
      <div class="ba">${ba.html}</div>

      ${weightChart()}

      <div class="section-head"><p class="eyebrow">66日マップ</p></div>
      <div class="heat" aria-label="66日間の達成状況">${heatmap()}</div>

      ${moodSection()}

      <div class="section-head"><p class="eyebrow">曜日別の達成率</p></div>
      ${weekdayBars()}

      <div class="section-head"><p class="eyebrow">あなたへのヒント</p></div>
      <div class="tips">${tips.map(t => `<div class="tip"><strong>${t.h}</strong><p>${t.b}</p></div>`).join('')}</div>`;
  }

  /* ======================================================================
   * 評価
   * ==================================================================== */
  function radar(cur, base) {
    const cx = 160, cy = 150, R = 110;
    const max = Math.max(...STATS.map(s => Math.max(cur[s.key], base[s.key]))) * 1.1 || 1;
    const pt = (i, v) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / STATS.length;
      return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v];
    };
    const poly = vals => STATS.map((s, i) => pt(i, vals[s.key] / max).map(n => n.toFixed(1)).join(',')).join(' ');
    let rings = '';
    [0.33, 0.66, 1].forEach(r => { rings += `<polygon points="${STATS.map((s, i) => pt(i, r).map(n => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="var(--line)" stroke-width="1"/>`; });
    const spokes = STATS.map((s, i) => { const [x, y] = pt(i, 1); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)"/>`; }).join('');
    const labels = STATS.map((s, i) => { const [x, y] = pt(i, 1.2); return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="middle">${s.label}</text>`; }).join('');
    return `<svg class="radar" viewBox="0 0 320 300" role="img" aria-label="能力のバランス（1日目と現在）">
      ${rings}${spokes}
      <polygon points="${poly(base)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3"/>
      <polygon points="${poly(cur)}" fill="rgba(255,107,10,.25)" stroke="var(--ember)" stroke-width="2.5" stroke-linejoin="round"/>
      ${STATS.map((s, i) => { const [x, y] = pt(i, cur[s.key] / max); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="var(--paper)"/>`; }).join('')}
      ${labels}
    </svg>`;
  }

  function viewRating() {
    const S = T.S, L = T.ledger(), tot = T.totals();
    const first = L.daily[0] || { stats: S.base, xp: 0 };
    const elapsed = Math.max(1, L.daily.length);
    const remain = Math.max(0, CHALLENGE_DAYS - tot.day);
    let stats, xp, gainBase, note = '';
    if (ui.rating === 'day1') {
      stats = first.stats; xp = first.xp; gainBase = S.base;
      note = '1日目を終えた時点のあなた。';
    } else if (ui.rating === 'day66') {
      stats = {};
      STATS.forEach(s => { stats[s.key] = Math.round(L.stats[s.key] + ((L.stats[s.key] - S.base[s.key]) / elapsed) * remain); });
      xp = Math.round(L.xp + (L.xp / elapsed) * remain); gainBase = S.base;
      note = remain ? `今のペースを続けた場合の66日目の予測。あと${remain}日。` : '66日を走り切ったあなた。';
    } else {
      stats = L.stats; xp = L.xp; gainBase = S.base;
    }
    const lv = T.levelOf(xp);
    const lo = T.xpForLevel(lv), hi = T.xpForLevel(lv + 1);
    const frac = (xp - lo) / (hi - lo);
    const blocks = Array.from({ length: 24 }, (_, i) => `<i class="${i < Math.floor(frac * 24) ? 'on' : ''}"></i>`).join('');
    const ach = T.achievements();

    return `
      <div class="pagehead"><h1 class="page-title">あなたの評価</h1></div>
      <div class="seg" role="group" aria-label="時点">
        <button data-act="rating" data-v="now" aria-pressed="${ui.rating === 'now'}">現在</button>
        <button data-act="rating" data-v="day1" aria-pressed="${ui.rating === 'day1'}">1日目</button>
        <button data-act="rating" data-v="day66" aria-pressed="${ui.rating === 'day66'}">66日目</button>
      </div>
      ${note ? `<p class="muted small" style="margin:-6px 0 0">${note}</p>` : ''}
      <div class="levelcard">
        <div class="lv"><span class="num">${lv}</span><small>レベル</small></div>
        <div class="xp"><span class="num">${fmt(xp)}</span><small>獲得したXP</small></div>
        <div class="blocks">${blocks}</div>
        <div class="next">レベル${lv + 1}まであと${fmt(hi - xp)} XP</div>
      </div>
      ${ui.rating === 'now' ? `<button class="btn block" data-act="share">${icon('share')}シェア画像を作る</button>` : ''}
      <div class="statlist">
        ${STATS.map(s => {
          const g = stats[s.key] - gainBase[s.key];
          return `<div style="--c:${s.color}"><span class="ico">${icon(STAT_ICON[s.key])}</span><span class="lab">${s.label}</span><span class="num">${stats[s.key]}</span><span class="up ${g > 0 ? '' : 'zero'}">${g > 0 ? `▲${g}` : '—'}</span></div>`;
        }).join('')}
      </div>
      <div class="section-head"><p class="eyebrow">バランス</p></div>
      ${radar(stats, S.base)}
      <div class="legend" style="justify-content:center"><span><i style="background:var(--ember)"></i>${ui.rating === 'day66' ? '66日目（予測）' : ui.rating === 'day1' ? '1日目' : '現在'}</span><span><i class="dash"></i>スタート時</span></div>
      <div class="section-head"><p class="eyebrow">実績</p><span class="more mono">${ach.filter(a => a.done).length}/${ach.length}</span></div>
      <div class="trophies">${ach.map(a => `<div class="trophy ${a.done ? 'on' : ''}">${icon('trophy')}<strong>${esc(a.name)}</strong><small>${esc(a.desc)}</small>${a.done ? '' : `<span class="meter"><i style="width:${Math.min(100, (a.value / a.goal) * 100)}%"></i></span>`}</div>`).join('')}</div>
      <div class="section-head"><p class="eyebrow">XPの仕組み</p></div>
      <div class="tips">
        <div class="tip"><strong>タスク完了 20XP＋連続ボーナス</strong><p>連続日数×2XP（最大+30）。対応する能力が+2。</p></div>
        <div class="tip"><strong>完璧な日 +30XP</strong><p>全タスクを完了かスキップで締めた日。自制心と自信が+1。</p></div>
        <div class="tip"><strong>ワークアウト 40XP〜</strong><p>セット数と総挙上量でボーナス。強さ+3、自制心+1。</p></div>
        <div class="tip"><strong>ひとこと日記 +10XP</strong><p>気分かひとことを残した日。知恵が+1。</p></div>
      </div>`;
  }

  /* ======================================================================
   * シェア画像（canvas で描いて <img> に。長押しで保存できる）
   * ==================================================================== */
  async function makeShareImage() {
    try { await Promise.all(['400 120px "Dela Gothic One"', '700 32px "Zen Kaku Gothic New"'].map(f => document.fonts.load(f))); } catch (e) { /* フォールバックで描く */ }
    const S = T.S, L = T.ledger(), tot = T.totals();
    const W = 1080, H = 1350;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const DISP = '"Dela Gothic One", "Hiragino Sans", sans-serif';
    const BODY = '"Zen Kaku Gothic New", "Hiragino Sans", sans-serif';
    x.fillStyle = '#0e0c0b'; x.fillRect(0, 0, W, H);
    const g = x.createRadialGradient(W / 2, H + 200, 50, W / 2, H + 200, 900);
    g.addColorStop(0, 'rgba(255,107,10,.55)'); g.addColorStop(1, 'rgba(255,107,10,0)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // 火の粉
    const r = Scenes.rng(tot.xp + 7);
    for (let i = 0; i < 70; i++) { x.fillStyle = `rgba(255,${120 + Math.floor(r() * 80)},40,${(0.2 + r() * 0.6).toFixed(2)})`; x.beginPath(); x.arc(r() * W, H * 0.45 + r() * H * 0.55, 1 + r() * 4, 0, 7); x.fill(); }
    // 枠
    x.strokeStyle = '#efe3cc'; x.lineWidth = 6; x.strokeRect(48, 48, W - 96, H - 96);
    x.textBaseline = 'alphabetic';
    // 日数
    x.fillStyle = '#ff6b0a'; x.font = `400 260px ${DISP}`;
    const dayTxt = String(tot.day);
    x.fillText(dayTxt, 96, 340);
    const dw = x.measureText(dayTxt).width;
    x.fillStyle = '#a69684'; x.font = `400 64px ${DISP}`;
    x.fillText(`日目 / ${CHALLENGE_DAYS}`, 96 + dw + 24, 330);
    // 進捗バー
    for (let i = 0; i < CHALLENGE_DAYS; i++) {
      const d = T.addDays(S.startDate, i);
      const on = d <= T.today() && T.dayStatus(d).done > 0;
      x.fillStyle = on ? (T.dayComplete(d) ? '#ff6b0a' : 'rgba(255,107,10,.5)') : '#342c27';
      x.fillRect(96 + (i % 33) * 27, 380 + Math.floor(i / 33) * 22, 22, 14);
    }
    // クラスとレベル
    const tops = topStats(L.stats);
    const cls = CLASSES[tops[0].k];
    x.fillStyle = '#ff6b0a'; x.fillRect(96, 470, 230, 150);
    x.fillStyle = '#fff'; x.font = `400 100px ${DISP}`; x.fillText(String(tot.level), 120, 580);
    x.font = `700 30px ${BODY}`; x.fillText('レベル', 230, 600);
    x.fillStyle = '#f5eee3'; x.font = `400 92px ${DISP}`; x.fillText(cls.name, 360, 570);
    x.fillStyle = '#a69684'; x.font = `700 34px ${BODY}`; x.fillText(cls.line, 362, 618);
    // 能力値
    const max = Math.max(...STATS.map(s => L.stats[s.key]));
    const COL = { wis: '#b48cff', con: '#8fcf5a', str: '#ec6a52', dis: '#7f84ff', foc: '#3fc2b8' };
    STATS.forEach((s, i) => {
      const yy = 700 + i * 82;
      x.fillStyle = '#a69684'; x.font = `700 34px ${BODY}`; x.fillText(s.label, 96, yy + 30);
      x.fillStyle = '#342c27'; x.fillRect(250, yy + 6, 560, 30);
      x.fillStyle = COL[s.key]; x.fillRect(250, yy + 6, 560 * (L.stats[s.key] / max), 30);
      x.fillStyle = '#f5eee3'; x.font = `400 46px ${DISP}`; x.textAlign = 'right'; x.fillText(String(L.stats[s.key]), W - 96, yy + 38); x.textAlign = 'left';
    });
    // 3つの数字
    [['連続', tot.streak + '日'], ['完了', fmt(L.seasonDone) + '回'], ['ワークアウト', tot.workouts + '回']].forEach(([k, v], i) => {
      const xx = 96 + i * 300;
      x.fillStyle = '#a69684'; x.font = `700 30px ${BODY}`; x.fillText(k, xx, 1150);
      x.fillStyle = '#f5eee3'; x.font = `400 64px ${DISP}`; x.fillText(v, xx, 1225);
    });
    x.fillStyle = '#6e6258'; x.font = `700 28px ${BODY}`;
    x.fillText(`${S.name ? S.name + ' · ' : ''}66日間 · ${dateLabel(T.today())}`, 96, H - 84);
    return new Promise(res => c.toBlob(b => res({ url: c.toDataURL('image/png'), blob: b }), 'image/png'));
  }

  function shareSheet() {
    ui.shareImg = null;
    openSheet({
      render() {
        return `
          <div class="sheet-head"><h2>シェア画像</h2><button class="icon-btn ghost" data-act="close" aria-label="閉じる">${icon('x')}</button></div>
          ${ui.shareImg ? `<img class="shareimg" src="${ui.shareImg.url}" alt="今の進み具合をまとめた画像">
          <p class="muted small" style="margin:0">画像を長押しすると、写真に保存したり送ったりできます。</p>
          ${navigator.share ? `<button class="btn primary block" data-act="share-send">${icon('share')}共有する</button>` : ''}` : '<p class="muted">画像を作っています…</p>'}`;
      }
    });
    makeShareImage().then(img => { ui.shareImg = img; if (sheet) drawSheet(); }).catch(() => toast('画像を作れませんでした'));
  }

  /* ======================================================================
   * シーズン完走
   * ==================================================================== */
  function seasonSheet() {
    openSheet({
      render() {
        const S = T.S, L = T.ledger(), tot = T.totals();
        const end = T.addDays(S.startDate, CHALLENGE_DAYS - 1);
        let perfect = 0;
        for (let k = S.startDate; k <= end; k = T.addDays(k, 1)) if (T.dayComplete(k)) perfect++;
        const tops = topStats(L.stats);
        const growth = STATS.map(s => ({ s, g: L.stats[s.key] - S.base[s.key] })).sort((a, b) => b.g - a.g);
        return `
          <div class="art">${scene('peak', 'season-' + S.seasons.length)}<h3>シーズン${S.seasons.length + 1} 完走</h3></div>
          <div class="kv">
            <div><small>完了</small><span class="num">${fmt(L.seasonDone)}</span><small>回</small></div>
            <div><small>完璧な日</small><span class="num">${perfect}</span><small>/ 66日</small></div>
            <div><small>最長連続</small><span class="num">${T.streakInfo().best}</span><small>日</small></div>
          </div>
          <p style="margin:0">クラスは<b>${CLASSES[tops[0].k].name}</b>、レベル<b>${tot.level}</b>。いちばん伸びたのは<b style="color:${growth[0].s.color}">${growth[0].s.label}（+${growth[0].g}）</b>。</p>
          <p class="muted small" style="margin:0">次のシーズンでは、今のレベル・能力値・タスクを引き継いで1日目から数え直します。過去の記録は消えません。</p>
          <button class="btn primary block" data-act="season-next">${icon('flame')}次の66日を始める</button>
          <button class="btn quiet block" data-act="close">あとで</button>`;
      }
    });
  }

  /* ======================================================================
   * 設定
   * ==================================================================== */
  function settingsSheet() {
    ui.confirm = null;
    ui.io = null;
    openSheet({
      live: true,
      render() {
        const S = T.S;
        const cloud = { on: 'claude.ai に同期中', off: 'この端末にのみ保存', error: '同期に失敗。この端末には保存済み', full: '容量オーバー。この端末にのみ保存' }[T.Cloud.status] || '';
        return `
          <div class="sheet-head"><h2>設定</h2><button class="icon-btn ghost" data-act="close" aria-label="閉じる">${icon('x')}</button></div>
          ${S.demo ? `<div class="demo-bar"><p><strong>サンプルデータです。</strong>自分の記録を始めると置き換わります。</p></div>` : ''}
          <form data-form="settings" class="field" style="gap:14px">
            <label class="field"><span>名前</span><input type="text" id="st-name" value="${esc(S.name)}" maxlength="16" placeholder="あなた"></label>
            <label class="field"><span>チャレンジ開始日（1日目）</span><input type="date" id="st-start" value="${esc(S.startDate)}" max="${T.today()}"></label>
            <button class="btn block" type="submit">保存</button>
          </form>
          <div class="field"><span>データ</span>
            <p class="muted small" style="margin:0">${icon('cloud')} ${cloud}</p>
            <div class="acts">
              <button class="btn quiet small" data-act="export">${icon('copy')}書き出す</button>
              <button class="btn quiet small" data-act="import-open">読み込む</button>
            </div>
            ${ui.io === 'import' ? `<label class="field"><span class="sr">バックアップ</span><textarea id="io-text" placeholder="コピーしたバックアップを貼り付け"></textarea></label><button class="btn primary small" data-act="import">このデータで置き換える</button>` : ''}
            ${ui.io === 'export' ? `<label class="field"><span class="small muted">コピーできない場合は、下の文字を全選択してコピー</span><textarea id="io-text" readonly>${esc(JSON.stringify(S))}</textarea></label>` : ''}
          </div>
          ${S.seasons.length ? `<div class="field"><span>過去のシーズン</span><div class="list">${S.seasons.map(x => `<div class="row"><span class="txt"><strong>シーズン${x.n}</strong><small>${x.start} 〜 ${x.end} · 完了${fmt(x.done)}回 · 最長${x.best}日 · 完璧な日${x.perfect}</small></span><span class="pill hot">Lv${x.level}</span></div>`).join('')}</div></div>` : ''}
          <div class="field"><span>やり直す</span>
            ${ui.confirm === 'reset' ? `<div class="confirm"><p>すべての記録を消して、1日目から始めます。元に戻せません。先に「書き出す」でバックアップしておくと安心です。</p><div class="acts"><button class="btn quiet small" data-act="confirm-cancel">やめる</button><button class="btn danger small" data-act="reset">消して始める</button></div></div>` : `
            <div class="acts">
              <button class="btn quiet small" data-act="${S.demo ? 'onboard' : 'confirm'}" data-c="reset">${icon('restart')}最初から始める</button>
              ${S.demo ? '' : `<button class="btn quiet small" data-act="demo">サンプルを見る</button>`}
            </div>`}
          </div>
          <p class="muted small" style="margin:0">66日間 — 習慣が自動化するまでの平均日数をもとにしたチャレンジ。</p>`;
      }
    });
  }

  /* ======================================================================
   * オンボーディング
   * ==================================================================== */
  function openOnboarding() {
    closeSheet();
    ui.onb = { step: 0, name: T.S.demo ? '' : T.S.name, rate: { wis: 2, con: 2, str: 2, dis: 2, foc: 2 }, picks: [0, 2, 3, 4] };
    renderOnb();
  }
  const RATE_HINT = {
    wis: ['ほぼ読まない', '月1冊', '月2〜3冊', '週1冊', '毎日学ぶ'],
    con: ['人前が苦手', 'やや苦手', 'ふつう', '堂々とできる', '自分を信じ切れる'],
    str: ['運動ゼロ', '月に数回', '週1〜2回', '週3回以上', 'アスリート級'],
    dis: ['誘惑に負けがち', 'たまに勝てる', '半々', 'だいたい勝てる', '鋼の意志'],
    foc: ['5分ももたない', '15分くらい', '30分くらい', '1時間いける', '何時間でも']
  };
  function renderOnb() {
    const o = ui.onb;
    let el = $('#onb');
    if (!o) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'onb'; el.className = 'onb'; el.setAttribute('role', 'dialog'); document.body.appendChild(el); }
    const steps = `<div class="steps">${[0, 1, 2].map(i => `<i class="${i <= o.step ? 'on' : ''}"></i>`).join('')}</div>`;
    let body = '';
    if (o.step === 0) {
      body = `
        <div class="big66"><span class="n">66</span><span class="k">日<br>間</span><span class="bars"><i></i><i></i><i></i></span></div>
        <h1 class="hero">追い込んで、<br><em>賢く</em>休む。</h1>
        <p class="muted" style="margin:0;max-width:34ch">新しい行動が「当たり前」になるまで、平均66日。毎日のタスクと筋トレを記録して、現実でレベルアップしよう。</p>
        <label class="field"><span>なんて呼べばいい？</span><input type="text" id="onb-name" value="${esc(o.name)}" maxlength="16" placeholder="名前（任意）"></label>`;
    } else if (o.step === 1) {
      body = `
        <h1 class="hero" style="font-size:32px">今のあなたを<br><em>自己評価</em>する</h1>
        <p class="muted" style="margin:0">ここが1日目の能力値になる。正直なほど、66日後の伸びがはっきり見える。</p>
        ${STATS.map(s => `<label class="slider" style="--c:${s.color}"><span class="t">${icon(STAT_ICON[s.key])}${s.label}<span class="num">${o.rate[s.key] * 10 + 5}</span></span><input type="range" min="0" max="4" step="1" value="${o.rate[s.key]}" data-rate="${s.key}" id="rate-${s.key}"><small id="hint-${s.key}">${RATE_HINT[s.key][o.rate[s.key]]}</small></label>`).join('')}`;
    } else {
      body = `
        <h1 class="hero" style="font-size:32px">66日間、<br><em>毎日やること</em>を選ぶ</h1>
        <p class="muted" style="margin:0">3〜5個がおすすめ。あとから追加・編集できます。</p>
        <div class="presets">${PRESETS.map((p, i) => `<button data-act="onb-pick" data-i="${i}" aria-pressed="${o.picks.includes(i)}"><i class="sw" style="--c:${STAT[p.stat].color}"></i><span class="t"><strong>${esc(p.title)}</strong><small>${esc(p.detail)} · ${STAT[p.stat].label}</small></span><span class="ck">${icon('check')}</span></button>`).join('')}</div>`;
    }
    el.innerHTML = `<div class="onb-in">${steps}${body}
      <div class="foot">
        <button class="btn quiet" data-act="onb-back">${o.step ? '戻る' : 'あとで'}</button>
        <button class="btn primary" data-act="onb-next">${o.step === 2 ? `${o.picks.length}個で始める` : '次へ'}</button>
      </div></div>`;
    el.scrollTop = 0;
  }
  function finishOnb() {
    const o = ui.onb;
    if (!o.picks.length) { toast('1つ以上選んでください'); return; }
    const t = T.today();
    const next = T.blank();
    next.name = o.name.trim();
    next.startDate = t;
    STATS.forEach(s => { next.base[s.key] = o.rate[s.key] * 10 + 5; });
    next.habits = o.picks.map(i => Object.assign({ id: T.uid(), created: t, target: 1, unit: '' }, PRESETS[i]));
    hideRest();
    T.replace(next);
    ui.onb = null; ui.viewDate = t; ui.filter = 'todo'; ui.tab = 'today'; ui.sgIdx = 0;
    renderOnb();
    render(true);
    toast(`${icon('flame')} 1日目スタート。${next.name ? esc(next.name) + '、' : ''}始めよう。`);
  }

  /* ---------- レベルアップ演出 ---------- */
  function levelUp(lv) {
    const el = document.createElement('div');
    el.className = 'levelup';
    el.setAttribute('role', 'alertdialog');
    el.innerHTML = `<div class="box"><span class="lbl">LEVEL UP</span><span class="n">${lv}</span><p>レベル${lv}に到達。現実で、強くなっている。</p><button class="btn primary" data-act="lv-close">続ける</button></div>`;
    el.addEventListener('click', () => el.remove());
    document.body.appendChild(el);
    haptic([60, 40, 120]);
    confetti();
  }

  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const c = document.createElement('canvas');
    c.className = 'fx';
    document.body.appendChild(c);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const cols = ['#ff6b0a', '#ff9443', '#efe3cc', '#ffd27a'];
    const ps = Array.from({ length: 120 }, () => ({
      x: innerWidth / 2, y: innerHeight * 0.45, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
      s: 3 + Math.random() * 5, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: cols[Math.floor(Math.random() * cols.length)]
    }));
    const t0 = performance.now();
    (function frame(now) {
      const t = now - t0;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ps.forEach(p => {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - t / 2200);
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      });
      if (t < 2200) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  /* ======================================================================
   * シート管理
   * ==================================================================== */
  let sheet = null;
  function openSheet(def) {
    ui.confirm = def.keepConfirm ? ui.confirm : null;
    sheet = def;
    drawSheet();
    renderFocusPill();
  }
  function drawSheet() {
    if (!sheet) { const s = $('#scrim'); if (s) s.remove(); return; }
    let sc = $('#scrim');
    if (!sc) {
      sc = document.createElement('div');
      sc.id = 'scrim'; sc.className = 'scrim';
      sc.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"></div>';
      sc.addEventListener('click', e => { if (e.target === sc) closeSheet(); });
      document.body.appendChild(sc);
    }
    const box = $('.sheet', sc);
    const top = box.scrollTop;
    box.innerHTML = '<div class="grab"></div>' + sheet.render();
    box.scrollTop = top;
  }
  function closeSheet() {
    sheet = null; ui.confirm = null;
    const s = $('#scrim');
    if (s) s.remove();
    renderFocusPill();
  }

  /* ======================================================================
   * 描画
   * ==================================================================== */
  const VIEWS = { today: viewToday, train: viewTrain, insight: viewInsight, rating: viewRating };
  let lastTab = null;
  function render(force) {
    const v = $('#view');
    if (!v) return;
    v.innerHTML = VIEWS[ui.tab]();
    if (lastTab !== ui.tab || force) {
      v.classList.remove('view'); void v.offsetWidth; v.classList.add('view');
      if (lastTab !== null) window.scrollTo(0, 0);
      lastTab = ui.tab;
    }
    $$('.tab').forEach(b => {
      if (b.dataset.tab === ui.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const dot = $('.tab[data-tab="train"] .dot');
    if (dot) dot.hidden = !T.S.active;
    renderSession();
    if (sheet && sheet.live) drawSheet();
    renderFocusPill();
    ensureFocusTick();
  }

  function buildTabbar() {
    const nav = document.createElement('nav');
    nav.className = 'tabbar';
    nav.setAttribute('aria-label', 'メイン');
    nav.innerHTML = `<div class="tabbar-inner">
      <button class="tab" data-act="tab" data-tab="today">${icon('flame')}今日</button>
      <button class="tab" data-act="tab" data-tab="train">${icon('dumbbell')}トレーニング<span class="dot" hidden></span></button>
      <button class="tab" data-act="tab" data-tab="insight">${icon('chart')}インサイト</button>
      <button class="tab" data-act="tab" data-tab="rating">${icon('medal')}評価</button>
    </div>`;
    document.body.appendChild(nav);
  }

  /* ======================================================================
   * イベント
   * ==================================================================== */
  const A = {
    tab(el) { ui.tab = el.dataset.tab; saveUI(); closeSheet(); render(); },
    day(el) { ui.viewDate = T.addDays(ui.viewDate, +el.dataset.d); render(); },
    filter(el) { ui.filter = el.dataset.f; render(); },
    toggle(el) { toggleHabit(el.dataset.id); },
    habit(el) { habitSheet(el.dataset.id); },
    step(el) { stepHabit(el.dataset.id, +el.dataset.d); },
    skip(el) {
      const k = ui.viewDate;
      if (k > T.today()) return;
      T.setLog(k, el.dataset.id, { s: 'skip', v: 0 });
      T.commit();
      toast('今日は休み。連続記録は守られます');
      closeSheet();
    },
    'habit-edit'(el) { habitForm(el.dataset.id); },
    'habit-del'(el) { progress(() => T.removeHabit(el.dataset.id)); closeSheet(); toast('削除しました'); },
    'add-habit'() { habitForm(null); },
    preset(el) {
      const p = PRESETS[+el.dataset.i];
      ui.draft = Object.assign({ target: 10, unit: '回', time: '' }, p);
      drawSheet();
    },
    draft(el) {
      ui.draft[el.dataset.k] = el.dataset.v;
      if (el.dataset.k === 'type' && el.dataset.v === 'timer' && !(+ui.draft.target > 1)) ui.draft.target = 10;
      drawSheet();
    },
    metrics() { metricsSheet(); },
    water(el) {
      const d = ui.metricDraft;
      const cur = d.water != null && d.water !== '' ? +d.water : (+el.dataset.d > 0 ? 0 : 0.25);
      d.water = Math.max(0, Math.round((cur + +el.dataset.d) * 100) / 100);
      const n = $('#water-val');
      if (n) n.textContent = d.water;
    },
    close() { closeSheet(); },
    confirm(el) { ui.confirm = el.dataset.c; if (sheet) drawSheet(); renderSession(); },
    'confirm-cancel'() { ui.confirm = null; if (sheet) drawSheet(); renderSession(); },
    settings() { settingsSheet(); },
    export() {
      const json = JSON.stringify(T.S);
      const done = () => toast('バックアップをコピーしました');
      try {
        navigator.clipboard.writeText(json).then(done, () => { ui.io = 'export'; drawSheet(); selectIO(); });
      } catch (e) { ui.io = 'export'; drawSheet(); selectIO(); }
    },
    'import-open'() { ui.io = ui.io === 'import' ? null : 'import'; drawSheet(); },
    import() {
      const txt = ($('#io-text') || {}).value || '';
      try {
        const data = JSON.parse(txt);
        if (!data || !Array.isArray(data.habits) || !data.startDate) throw new Error('形式');
        data.demo = false;
        T.replace(data);
        closeSheet();
        ui.viewDate = T.today();
        render(true);
        toast('バックアップを読み込みました');
      } catch (e) {
        toast('読み込めませんでした。コピーした文字を丸ごと貼り付けてください');
      }
    },
    reset() { closeSheet(); openOnboarding(); },
    demo() { closeSheet(); T.replace(T.seedDemo()); ui.viewDate = T.today(); render(true); toast('サンプルを表示中。設定からいつでも戻れます'); },
    onboard() { openOnboarding(); },
    'onb-back'() {
      if (ui.onb.step === 0) { ui.onb = null; renderOnb(); return; }
      ui.onb.step--; renderOnb();
    },
    'onb-next'() {
      const o = ui.onb;
      if (o.step === 0) { o.name = ($('#onb-name') || {}).value || ''; }
      if (o.step === 2) { finishOnb(); return; }
      o.step++; renderOnb();
    },
    'onb-pick'(el) {
      const i = +el.dataset.i, o = ui.onb;
      o.picks = o.picks.includes(i) ? o.picks.filter(x => x !== i) : o.picks.concat(i);
      renderOnb();
    },
    // ワークアウト
    start(el) { hideRest(); closeSheet(); ui.sessionMin = false; T.startWorkout(el.dataset.tpl); },
    'start-free'() {
      if (T.S.active) { ui.sessionMin = false; render(); return; }
      ui.sessionMin = false; T.startWorkout(null); setTimeout(exerciseSheet, 50);
    },
    'pick-tpl'(el) {
      if (T.S.active) { toast('進行中のセッションがあります'); return; }
      T.S.nextTpl = el.dataset.tpl; T.commit();
    },
    resume() { ui.sessionMin = false; render(); },
    minimize() { ui.sessionMin = true; render(); },
    finish() { finish(); },
    discard() { T.S.active = null; ui.confirm = null; hideRest(); T.commit(); toast('セッションを破棄しました'); },
    'set-done'(el) {
      const s = T.S.active.ex[+el.dataset.e].sets[+el.dataset.s];
      s.done = !s.done;
      T.commit();
      if (s.done) { haptic(20); startRest(T.S.rest); }
    },
    'set-add'(el) {
      const e = T.S.active.ex[+el.dataset.e];
      const last = e.sets[e.sets.length - 1] || { w: 0, r: 10 };
      e.sets.push({ w: last.w, r: last.r, done: false });
      T.commit();
    },
    'set-del'(el) { const e = T.S.active.ex[+el.dataset.e]; if (e.sets.length > 1) { e.sets.pop(); T.commit(); } },
    'ex-add'() { exerciseSheet(); },
    'ex-pick'(el) { addExercise(el.dataset.n); },
    'ex-remove'(el) { T.S.active.ex.splice(+el.dataset.e, 1); T.commit(); },
    'rest-len'(el) { T.S.rest = +el.dataset.v; T.commit(); },
    'rest-add'(el) { if (!ui.rest) return; ui.rest.end += +el.dataset.v * 1000; ui.rest.total = Math.max(ui.rest.total, Math.ceil((ui.rest.end - Date.now()) / 1000)); tickRest(); },
    'rest-skip'() { hideRest(); },
    workout(el) { workoutSheet(el.dataset.id); },
    'workout-del'(el) { progress(() => { T.S.workouts = T.S.workouts.filter(w => w.id !== el.dataset.id); T.commit(); }); closeSheet(); toast('記録を削除しました'); },
    // インサイト
    rating(el) { ui.rating = el.dataset.v; render(); },
    'sg-skip'(el) { T.S.dismissed.push(el.dataset.id); T.commit(); },
    'sg-add'(el) {
      const sg = suggestions().find(x => x.id === el.dataset.id);
      if (!sg) return;
      if (sg.tab) { ui.tab = sg.tab; saveUI(); render(); return; }
      T.addHabit(Object.assign({ created: T.today() }, sg.habit));
      toast(`「${esc(sg.habit.title)}」を追加しました`);
    },
    'lv-close'() { /* 背景クリックで閉じる */ },
    'draft-day'(el) {
      const v = +el.dataset.v, d = ui.draft;
      let days = d.days && d.days.length && d.days.length < 7 ? d.days.slice() : [];
      days = days.includes(v) ? days.filter(x => x !== v) : days.concat(v);
      d.days = days.length && days.length < 7 ? days : null;
      drawSheet();
    },
    'draft-everyday'() { ui.draft.days = null; drawSheet(); },
    'tpl-save'(el) {
      const w = T.S.workouts.find(x => x.id === el.dataset.id);
      if (!w) return;
      T.saveTemplate(w);
      ui.savedTpl = true;
      drawSheet();
    },
    'tpl-open'(el) {
      const id = el.dataset.id;
      openSheet({
        live: true,
        render() {
          const x = T.S.templates.find(t => t.id === id);
          if (!x) { setTimeout(closeSheet); return ''; }
          return `
            <div class="sheet-head"><h2>${esc(x.name)}</h2><button class="icon-btn ghost" data-act="close" aria-label="閉じる">${icon('x')}</button></div>
            <div class="list">${x.exercises.map(e => `<div class="row">${exIcon(e.name)}<span class="txt"><strong>${esc(e.name)}</strong><small class="mono">${e.sets}セット × ${e.reps}回${e.w ? ` · ${e.w}kg` : ''}</small></span></div>`).join('')}</div>
            <button class="btn primary block" data-act="start" data-tpl="${x.id}">${icon('play')}このメニューで開始</button>
            ${ui.confirm === 'tdel' ? `<div class="confirm"><p>「${esc(x.name)}」を削除します。過去のワークアウト記録は残ります。</p><div class="acts"><button class="btn quiet small" data-act="confirm-cancel">やめる</button><button class="btn danger small" data-act="tpl-del" data-id="${x.id}">削除する</button></div></div>` : `<button class="btn quiet block" data-act="confirm" data-c="tdel">${icon('trash')}テンプレートを削除</button>`}`;
        }
      });
    },
    'tpl-del'(el) { T.removeTemplate(el.dataset.id); closeSheet(); toast('テンプレートを削除しました'); },
    season() { seasonSheet(); },
    'ft-start'(el) { startFocus(el.dataset.id); },
    'ft-pause'() { const tm = T.S.timer; if (!tm) return; tm.left = timerLeft(tm); tm.end = null; T.commit(); },
    'ft-resume'() { const tm = T.S.timer; if (!tm) return; tm.end = Date.now() + tm.left * 1000; tm.left = null; T.commit(); ensureFocusTick(); },
    'ft-log'() { logFocus(false); },
    'ft-reset'() { T.S.timer = null; T.commit(); },
    'habit-focus'(el) { ui.tab = 'today'; ui.viewDate = T.S.timer ? T.S.timer.k : T.today(); saveUI(); render(); habitSheet(el.dataset.id); },
    mood(el) {
      const v = +el.dataset.v, cur = (T.S.journal[ui.viewDate] || {}).mood;
      const txt = $('#jr-text');
      saveJournal(ui.viewDate, { mood: cur === v ? 0 : v, text: txt ? txt.value.trim() : undefined });
    },
    'goto-day'(el) {
      const k = el.dataset.k;
      if (!k || k > T.today() || k < T.S.startDate) return;
      ui.tab = 'today'; ui.viewDate = k; ui.filter = 'todo'; saveUI(); closeSheet(); render();
    },
    'ex-hist'(el) { exerciseHistorySheet(el.dataset.n); },
    share() { shareSheet(); },
    'share-send'() {
      const img = ui.shareImg;
      if (!img) return;
      const file = img.blob ? new File([img.blob], '66days.png', { type: 'image/png' }) : null;
      const data = file && navigator.canShare && navigator.canShare({ files: [file] }) ? { files: [file], title: '66日間' } : { title: '66日間', text: `66日間チャレンジ ${T.totals().day}日目 · レベル${T.totals().level}` };
      Promise.resolve().then(() => navigator.share(data)).catch(() => toast('共有できない環境です。画像を長押しして保存してください'));
    },
    'season-next'() {
      T.startNextSeason();
      closeSheet();
      ui.viewDate = T.today(); ui.filter = 'todo';
      render(true);
      confetti();
      toast(`${icon('flame')} シーズン${T.S.seasons.length + 1}、1日目スタート`);
    }
  };

  function selectIO() { const t = $('#io-text'); if (t) { t.focus(); t.select(); } }

  function onClick(e) {
    // 日記の入力中に別の操作をしても、書いた内容を落とさない
    const ae = document.activeElement;
    if (ae && ae.id === 'jr-text' && !e.target.closest('#jr-text')) onChange({ target: ae });
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = A[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn(el, e);
  }

  function onKey(e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); onClick(e); }
    if (e.key === 'Enter' && e.target.id === 'jr-text') e.target.blur();
    if (e.key === 'Escape') {
      if ($('.levelup')) $('.levelup').remove();
      else if (sheet) closeSheet();
      else if (ui.onb) { ui.onb = null; renderOnb(); }
      else if (T.S.active && !ui.sessionMin) { ui.sessionMin = true; render(); }
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.dataset.draft && ui.draft) ui.draft[t.dataset.draft] = t.value;
    if (t.dataset.set && T.S.active) {
      const s = T.S.active.ex[+t.dataset.e].sets[+t.dataset.s];
      s[t.dataset.set] = t.value === '' ? '' : +t.value;
      T.commit({ silent: true });
    }
    if (t.hasAttribute('data-sname') && T.S.active) { T.S.active.name = t.value || 'セッション'; T.commit({ silent: true }); }
    if (t.dataset.rate && ui.onb) {
      ui.onb.rate[t.dataset.rate] = +t.value;
      const lab = t.parentElement.querySelector('.num');
      if (lab) lab.textContent = +t.value * 10 + 5;
      const hint = $('#hint-' + t.dataset.rate);
      if (hint) hint.textContent = RATE_HINT[t.dataset.rate][+t.value];
    }
  }

  function saveJournal(k, patch) {
    if (k > T.today()) return;
    const cur = Object.assign({}, T.S.journal[k] || {}, patch);
    if (!cur.mood) delete cur.mood;
    if (!cur.text) delete cur.text;
    progress(() => {
      if (Object.keys(cur).length) T.S.journal[k] = cur; else delete T.S.journal[k];
      T.commit();
    });
  }
  function onChange(e) {
    if (e.target.id === 'jr-text') {
      const v = e.target.value.trim();
      if (v !== ((T.S.journal[ui.viewDate] || {}).text || '')) saveJournal(ui.viewDate, { text: v });
    }
  }

  function onSubmit(e) {
    const f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    const kind = f.dataset.form;
    if (kind === 'habit') saveHabitForm();
    else if (kind === 'metrics') saveMetrics();
    else if (kind === 'custom-ex') { const v = ($('#ex-custom').value || '').trim(); if (v) addExercise(v); }
    else if (kind === 'settings') {
      const start = $('#st-start').value;
      T.S.name = $('#st-name').value.trim();
      if (start && start <= T.today()) T.S.startDate = start;
      if (ui.viewDate < T.S.startDate) ui.viewDate = T.S.startDate;
      T.commit();
      toast('保存しました');
      closeSheet();
    }
  }

  /* ---------- 起動 ---------- */
  function boot() {
    T.load();
    buildTabbar();
    T.on(() => render());
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
    // 日付をまたいだら「今日」を進める
    let lastDay = T.today();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      const t = T.today();
      if (t !== lastDay) { if (ui.viewDate === lastDay) ui.viewDate = t; lastDay = t; render(); }
    });
    if (ui.viewDate < T.S.startDate) ui.viewDate = T.S.startDate;
    render(true);
    T.Cloud.init();
    if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.claude) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* オフライン非対応でも動く */ });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
