/* 状態・永続化・集計。UIはここの関数だけを通してデータに触る。 */
(function (G) {
  'use strict';

  const { CHALLENGE_DAYS, STATS, TEMPLATES, ACHIEVEMENTS, PRESETS } = G.D;
  const LS_KEY = 'sixtysix.v1';
  const MAX_DOC = 240 * 1024;

  /* ---------- 日付 ---------- */
  const pad = n => String(n).padStart(2, '0');
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
  function today() { return keyOf(new Date()); }
  function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }
  function diffDays(a, b) { return Math.round((parseKey(b) - parseKey(a)) / 86400000); }
  const WD = ['日', '月', '火', '水', '木', '金', '土'];

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---------- 状態 ---------- */
  function blank() {
    return {
      v: 1, demo: false, name: '', startDate: today(),
      base: { wis: 10, con: 10, str: 10, dis: 10, foc: 10 },
      habits: [], logs: {}, metrics: {}, workouts: [], active: null,
      dismissed: [], rest: 90, nextTpl: null, updatedAt: 0,
      templates: [], seasons: [], carryXp: 0, carryDone: 0
    };
  }

  let S = null;
  let version = 0;
  const listeners = [];

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) { S = Object.assign(blank(), JSON.parse(raw)); return; }
    } catch (e) { /* 保存領域が使えない環境ではメモリのみで動く */ }
    S = seedDemo();
  }

  function commit(opts) {
    version++;
    S.updatedAt = Date.now();
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* noop */ }
    Cloud.schedule();
    if (!(opts && opts.silent)) listeners.forEach(fn => fn());
  }

  function replace(next, opts) {
    S = Object.assign(blank(), next);
    commit(opts);
  }

  /* ---------- クラウド同期（claude.ai 上で開いたときだけ） ---------- */
  const Cloud = {
    ref: null, status: 'off', timer: 0, saving: false, again: false,
    async init() {
      if (!(window.claude && typeof window.claude.use === 'function')) return;
      try {
        const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        if (!db || !user) return;
        const id = await user.id();
        if (!id) return;
        this.ref = db.doc('data/users/' + id + '/state');
        const snap = await this.ref.get();
        this.status = 'on';
        if (snap.exists) {
          const remote = snap.data();
          const body = remote && remote.json ? JSON.parse(remote.json) : null;
          if (body && (body.updatedAt || 0) > (S.updatedAt || 0)) {
            S = Object.assign(blank(), body);
            try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) { /* noop */ }
            version++;
            listeners.forEach(fn => fn());
            return;
          }
        }
        if (!S.demo) this.schedule(0);
        else listeners.forEach(fn => fn());
      } catch (e) {
        this.status = 'error';
      }
    },
    schedule(delay) {
      if (!this.ref || S.demo) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), delay == null ? 1200 : delay);
    },
    async flush() {
      if (!this.ref) return;
      if (this.saving) { this.again = true; return; }
      const json = JSON.stringify(S);
      if (json.length > MAX_DOC) { this.status = 'full'; return; }
      this.saving = true;
      try {
        await this.ref.set({ json, updatedAt: S.updatedAt });
        this.status = 'on';
      } catch (e) {
        this.status = e && e.code === 'quota_exceeded' ? 'full' : 'error';
      }
      this.saving = false;
      if (this.again) { this.again = false; this.flush(); }
    }
  };

  /* ---------- 習慣 ---------- */
  const wdCache = {};
  function weekdayOf(k) { return wdCache[k] != null ? wdCache[k] : (wdCache[k] = parseKey(k).getDay()); }
  // days が未設定（または7日すべて）なら毎日
  function scheduledOn(h, k) { return !h.days || !h.days.length || h.days.length === 7 || h.days.includes(weekdayOf(k)); }
  function habitsOn(k) {
    return S.habits.filter(h => h.created <= k && (!h.archivedAt || h.archivedAt > k) && scheduledOn(h, k));
  }
  function logOf(k, id) { return (S.logs[k] && S.logs[k][id]) || null; }
  function setLog(k, id, entry) {
    if (!S.logs[k]) S.logs[k] = {};
    if (entry) S.logs[k][id] = entry; else delete S.logs[k][id];
    if (!Object.keys(S.logs[k]).length) delete S.logs[k];
  }

  function addHabit(h) {
    const habit = Object.assign({ id: uid(), detail: '', time: '', stat: 'dis', scene: 'night', type: 'check', target: 1, unit: '', created: today() }, h);
    if (habit.type !== 'count') { habit.target = 1; habit.unit = ''; }
    S.habits.push(habit);
    commit();
    return habit;
  }
  function updateHabit(id, patch) {
    const h = S.habits.find(x => x.id === id);
    if (!h) return;
    Object.assign(h, patch);
    if (h.type !== 'count') { h.target = 1; h.unit = ''; }
    commit();
  }
  function removeHabit(id) {
    // 過去の記録は残し、今日以降は表示しない
    const h = S.habits.find(x => x.id === id);
    if (!h) return;
    if (h.created >= today()) {
      S.habits = S.habits.filter(x => x.id !== id);
      Object.keys(S.logs).forEach(k => setLog(k, id, null));
    } else {
      h.archivedAt = today();
    }
    commit();
  }

  /* ---------- 集計（version 単位でメモ化） ---------- */
  let memo = { v: -1 };
  function cache(name, fn) {
    if (memo.v !== version) memo = { v: version };
    if (!(name in memo)) memo[name] = fn();
    return memo[name];
  }

  function dayIndex(k) { return diffDays(S.startDate, k) + 1; }

  function dayStatus(k) {
    const hs = habitsOn(k);
    let done = 0, skip = 0;
    hs.forEach(h => { const l = logOf(k, h.id); if (l && l.s === 'done') done++; else if (l && l.s === 'skip') skip++; });
    return { total: hs.length, done, skip, rate: hs.length ? done / Math.max(1, hs.length - skip) : 0 };
  }
  // 全タスクを「完了 or スキップ」し、1つ以上完了した日
  function dayComplete(k) {
    const st = dayStatus(k);
    return st.total > 0 && st.done > 0 && st.done + st.skip === st.total;
  }

  function streakInfo() {
    return cache('streak', () => {
      const t = today();
      let best = 0, run = 0;
      for (let k = S.startDate; k <= t; k = addDays(k, 1)) {
        if (dayComplete(k)) { run++; best = Math.max(best, run); }
        else if (k !== t) run = 0;
      }
      return { current: run, best };
    });
  }

  // その日までの連続完了日数（スキップと予定のない曜日は途切れないが加算もしない）
  function habitStreak(h, k) {
    let n = 0, d = k;
    const l0 = logOf(d, h.id);
    if (!l0 || l0.s !== 'done') d = addDays(d, -1);
    while (d >= h.created && d >= S.startDate) {
      if (!scheduledOn(h, d)) { d = addDays(d, -1); continue; }
      const l = logOf(d, h.id);
      if (l && l.s === 'done') n++;
      else if (!(l && l.s === 'skip')) break;
      d = addDays(d, -1);
    }
    return n;
  }

  function volumeOf(w) {
    let v = 0, sets = 0;
    w.ex.forEach(e => e.sets.forEach(s => { if (s.done) { sets++; v += (+s.w || 0) * (+s.r || 0); } }));
    return { volume: Math.round(v), sets };
  }

  function workoutXP(w) {
    const { volume, sets } = volumeOf(w);
    return 40 + sets * 4 + Math.min(80, Math.floor(volume / 150));
  }

  /*
   * XP と能力値を1日ずつ積み上げる。
   * 完了: 20XP + 連続日数ボーナス(最大30)、対応する能力 +2
   * 完璧な日: +30XP、自制心と自信 +1
   * ワークアウト: workoutXP、強さ +3、自制心 +1
   * 記録（水分2L以上）: 自制心 +1
   */
  function ledger() {
    return cache('ledger', () => {
      const t = today();
      const stats = Object.assign({}, S.base);
      // 前のシーズンから引き継いだ分を足して始める
      let xp = S.carryXp || 0, totalDone = S.carryDone || 0;
      const daily = [];
      const wByDay = {};
      S.workouts.forEach(w => { (wByDay[w.date] = wByDay[w.date] || []).push(w); });
      const end = t > S.startDate ? t : S.startDate;
      for (let k = S.startDate; k <= end; k = addDays(k, 1)) {
        let dxp = 0, dDone = 0;
        habitsOn(k).forEach(h => {
          const l = logOf(k, h.id);
          if (l && l.s === 'done') {
            dDone++;
            dxp += 20 + Math.min(30, 2 * habitStreak(h, addDays(k, -1)));
            stats[h.stat] = (stats[h.stat] || 0) + 2;
          }
        });
        if (dayComplete(k)) { dxp += 30; stats.dis++; stats.con++; }
        (wByDay[k] || []).forEach(w => { dxp += workoutXP(w); stats.str += 3; stats.dis += 1; });
        const m = S.metrics[k];
        if (m && +m.water >= 2) stats.dis++;
        xp += dxp; totalDone += dDone;
        daily.push({ k, xp: dxp, done: dDone, cum: totalDone - (S.carryDone || 0), cumXp: xp, stats: Object.assign({}, stats) });
      }
      return { xp, stats, totalDone, seasonDone: totalDone - (S.carryDone || 0), daily };
    });
  }

  function levelOf(xp) { return Math.floor(Math.sqrt(xp / 40)) + 1; }
  function xpForLevel(l) { return 40 * (l - 1) * (l - 1); }

  function totals() {
    return cache('totals', () => {
      const L = ledger();
      let totalVolume = 0;
      S.workouts.forEach(w => { totalVolume += volumeOf(w).volume; });
      return {
        totalDone: L.totalDone, xp: L.xp, level: levelOf(L.xp),
        bestStreak: Math.max(streakInfo().best, ...S.seasons.map(x => x.best || 0)), streak: streakInfo().current,
        workouts: S.workouts.length, totalVolume, day: Math.min(CHALLENGE_DAYS, Math.max(1, dayIndex(today())))
      };
    });
  }

  function achievements() {
    const s = totals();
    return ACHIEVEMENTS.map(a => {
      const v = a.val(s);
      return Object.assign({}, a, { value: v, done: v >= a.goal });
    });
  }

  /* ---------- ワークアウト ---------- */
  function allTemplates() { return TEMPLATES.concat((S && S.templates) || []); }
  function templateById(id) { return allTemplates().find(t => t.id === id) || TEMPLATES[0]; }

  // 終えたワークアウトをマイテンプレートとして保存する（各種目の最後のセットを基準にする）
  function saveTemplate(w) {
    const base = w.tpl ? templateById(w.tpl) : null;
    const t = {
      id: 'c' + uid(), custom: true, name: w.name, short: w.name.slice(0, 5), hue: '#e2b552',
      scene: base ? base.scene : 'city',
      exercises: w.ex.map(e => { const last = e.sets[e.sets.length - 1] || {}; return { name: e.name, sets: e.sets.length, reps: +last.r || 10, w: +last.w || 0 }; })
    };
    S.templates.push(t);
    commit();
    return t;
  }
  function removeTemplate(id) {
    S.templates = S.templates.filter(t => t.id !== id);
    if (S.nextTpl === id) S.nextTpl = null;
    commit();
  }

  function suggestedTemplate() {
    if (S.nextTpl) return templateById(S.nextTpl);
    const last = S.workouts.slice().sort((a, b) => b.start - a.start).find(w => w.tpl && TEMPLATES.some(t => t.id === w.tpl));
    if (!last) return TEMPLATES[0];
    const i = TEMPLATES.findIndex(t => t.id === last.tpl);
    return TEMPLATES[(i + 1) % TEMPLATES.length];
  }

  function lastSetsFor(name) {
    const ws = S.workouts.slice().sort((a, b) => b.start - a.start);
    for (const w of ws) {
      const e = w.ex.find(x => x.name === name);
      if (e && e.sets.some(s => s.done)) return e.sets.filter(s => s.done);
    }
    return null;
  }

  function bestE1RM(name, excludeId) {
    let best = 0;
    S.workouts.forEach(w => {
      if (w.id === excludeId) return;
      w.ex.forEach(e => {
        if (e.name !== name) return;
        e.sets.forEach(s => { if (s.done && +s.w > 0) best = Math.max(best, e1rm(+s.w, +s.r)); });
      });
    });
    return best;
  }
  function e1rm(w, r) { return w * (1 + Math.min(r, 15) / 30); }

  function startWorkout(tpl) {
    const t = tpl ? templateById(tpl) : null;
    S.active = {
      id: uid(), tpl: t ? t.id : null, name: t ? t.name : '自由セッション', start: Date.now(),
      ex: t ? t.exercises.map(e => {
        const prev = lastSetsFor(e.name);
        return { name: e.name, sets: Array.from({ length: e.sets }, (_, i) => ({ w: prev && prev[i] ? prev[i].w : e.w, r: prev && prev[i] ? prev[i].r : e.reps, done: false })) };
      }) : []
    };
    commit();
  }

  function finishWorkout() {
    const a = S.active;
    if (!a) return null;
    a.ex = a.ex.map(e => Object.assign({}, e, { sets: e.sets.filter(s => s.done) })).filter(e => e.sets.length);
    if (!a.ex.length) { S.active = null; commit(); return null; }
    const records = [];
    a.ex.forEach(e => {
      const prev = bestE1RM(e.name);
      const now = Math.max(0, ...e.sets.filter(s => +s.w > 0).map(s => e1rm(+s.w, +s.r)));
      if (now > 0 && now > prev) records.push({ name: e.name, value: Math.round(now), first: prev === 0 });
    });
    const w = { id: a.id, tpl: a.tpl, name: a.name, date: keyOf(new Date(a.start)), start: a.start, dur: Math.max(1, Math.round((Date.now() - a.start) / 60000)), ex: a.ex };
    S.workouts.push(w);
    S.active = null;
    S.nextTpl = null;
    commit();
    return { w, records, xp: workoutXP(w), ...volumeOf(w) };
  }

  /* ---------- シーズン（66日ごとの区切り） ---------- */
  function seasonOver() { return dayIndex(today()) > CHALLENGE_DAYS; }

  // 能力値・XP・タスクを引き継いで、今日から次の66日を始める
  function startNextSeason() {
    const L = ledger(), t = totals();
    const end = addDays(S.startDate, CHALLENGE_DAYS - 1);
    let perfect = 0;
    for (let k = S.startDate; k <= end; k = addDays(k, 1)) if (dayComplete(k)) perfect++;
    S.seasons.push({
      n: S.seasons.length + 1, start: S.startDate, end,
      xp: L.xp - (S.carryXp || 0), done: L.seasonDone, best: streakInfo().best, perfect, level: t.level
    });
    const tk = today();
    S.base = Object.assign({}, L.stats);
    S.carryXp = L.xp;
    S.carryDone = L.totalDone;
    S.startDate = tk;
    S.habits = S.habits.filter(h => !h.archivedAt).map(h => Object.assign({}, h, { created: tk }));
    S.dismissed = [];
    commit();
  }

  /* ---------- 記録（ビフォーアフター） ---------- */
  function metricSeries(field) {
    return Object.keys(S.metrics).sort().filter(k => S.metrics[k][field] != null && S.metrics[k][field] !== '').map(k => ({ k, v: S.metrics[k][field] }));
  }
  function toMin(hhmm) { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); }
  function fromMin(m) { m = Math.round(m); return Math.floor(m / 60) + ':' + pad(m % 60); }

  /* ---------- デモデータ ---------- */
  function seedDemo() {
    const s = blank();
    const t = today();
    const start = addDays(t, -13);
    s.demo = true; s.name = 'サンプル'; s.startDate = start;
    s.base = { wis: 12, con: 16, str: 20, dis: 9, foc: 14 };
    const r = G.Scenes.rng(66);
    const mk = (i, over) => Object.assign({ id: 'demo' + i, created: start, target: 1, unit: '' }, PRESETS[i], over);
    s.habits = [
      mk(0, { title: '午前8時に起きる', time: '08:00' }),
      mk(1, { created: addDays(start, 4), days: [1, 3, 5, 6] }),
      mk(2, { created: addDays(start, 1) }),
      mk(3, { created: addDays(start, 6) }),
      mk(4, {}),
      mk(5, {}),
      mk(6, {})
    ];
    // 画面の雰囲気が出るよう、直近の連続記録を固定する
    const forced = { demo0: 14, demo1: 9, demo2: 12, demo3: 7 };
    for (let d = 0; d < 13; d++) {
      const k = addDays(start, d);
      s.habits.forEach(h => {
        if (h.created > k) return;
        const fromEnd = 13 - d;
        let st = null;
        if (forced[h.id] && fromEnd <= forced[h.id]) st = 'done';
        else if (fromEnd <= 8) st = r() < 0.85 ? 'done' : 'skip';
        else { const x = r(); st = x < 0.78 ? 'done' : x < 0.85 ? 'skip' : null; }
        if (st) {
          if (!s.logs[k]) s.logs[k] = {};
          s.logs[k][h.id] = { s: st, v: st === 'done' ? h.target : 0 };
        }
      });
    }
    s.logs[t] = { demo0: { s: 'done', v: 1 }, demo3: { s: 'open', v: 8 }, demo5: { s: 'open', v: 5 } };
    // ワークアウトはプッシュ→プル→レッグの順に回す
    const plan = [[-12, 'push'], [-10, 'pull'], [-8, 'legs'], [-6, 'push'], [-4, 'pull'], [-1, 'legs']];
    plan.forEach(([off, id], i) => {
      const tpl = templateById(id);
      const date = addDays(t, off);
      const st = parseKey(date); st.setHours(7, 10 - i * 5 + 20, 0);
      const bump = Math.floor(i / 3) * 2.5;
      s.workouts.push({
        id: 'dw' + i, tpl: id, name: tpl.name, date, start: st.getTime(), dur: 44 + Math.round(r() * 10),
        ex: tpl.exercises.map(e => ({ name: e.name, sets: Array.from({ length: e.sets }, () => ({ w: e.w ? e.w + bump : 0, r: e.reps, done: true })) }))
      });
    });
    // 記録：水分・起床・スクリーンタイム
    for (let d = 0; d <= 13; d++) {
      const k = addDays(start, d), p = d / 13;
      s.metrics[k] = {
        water: Math.round((0.7 + p * 1.4 + (r() - 0.5) * 0.2) * 10) / 10,
        wake: fromMin(648 - p * 113 + (r() - 0.5) * 12),
        screen: Math.round(262 - p * 32 + (r() - 0.5) * 14),
        weight: Math.round((68.4 - p * 1.5 + (r() - 0.5) * 0.4) * 10) / 10
      };
    }
    s.metrics[start] = { water: 0.7, wake: '10:48', screen: 262, weight: 68.4 };
    s.metrics[t] = { water: 2.1, wake: '8:55', screen: 230, weight: 66.9 };
    return s;
  }

  G.Store = {
    get S() { return S; },
    get version() { return version; },
    Cloud, load, commit, replace, blank, seedDemo, on: fn => listeners.push(fn),
    keyOf, parseKey, today, addDays, diffDays, WD, uid, pad,
    habitsOn, scheduledOn, logOf, setLog, addHabit, updateHabit, removeHabit, seasonOver, startNextSeason,
    dayIndex, dayStatus, dayComplete, streakInfo, habitStreak,
    ledger, totals, levelOf, xpForLevel, achievements,
    volumeOf, workoutXP, templateById, allTemplates, saveTemplate, removeTemplate, suggestedTemplate, lastSetsFor, bestE1RM, startWorkout, finishWorkout,
    metricSeries, toMin, fromMin, STATS, LS_KEY
  };
})(window);
