/* 手続き生成のアニメ風背景（SVG）。外部画像なしでカードの「一枚絵」を作る。 */
(function (G) {
  'use strict';

  let uid = 0;

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  const f = n => Math.round(n * 10) / 10;

  function skyline(r, baseY, minH, maxH, fill, lit, litChance) {
    let x = -10, out = '';
    while (x < 410) {
      const w = 18 + r() * 34, h = minH + r() * (maxH - minH), top = baseY - h;
      out += `<rect x="${f(x)}" y="${f(top)}" width="${f(w)}" height="${f(h + 4)}" fill="${fill}"/>`;
      if (r() > 0.6) out += `<rect x="${f(x + w * 0.4)}" y="${f(top - 8)}" width="1.5" height="8" fill="${fill}"/>`;
      if (lit) {
        for (let wy = top + 5; wy < baseY - 4; wy += 7) {
          for (let wx = x + 4; wx < x + w - 4; wx += 6) {
            if (r() < litChance) out += `<rect x="${f(wx)}" y="${f(wy)}" width="2.4" height="3" fill="${lit}" opacity="${f(0.5 + r() * 0.5)}"/>`;
          }
        }
      }
      x += w + r() * 3;
    }
    return out;
  }

  function cloud(cx, cy, s, body, light) {
    const parts = [[0, 0, 34], [-30, 8, 24], [30, 6, 26], [-54, 16, 16], [56, 16, 16], [0, 16, 30]];
    let o = '';
    parts.forEach(([dx, dy, rr]) => { o += `<circle cx="${f(cx + dx * s)}" cy="${f(cy + dy * s)}" r="${f(rr * s)}" fill="${body}"/>`; });
    parts.slice(0, 3).forEach(([dx, dy, rr]) => { o += `<circle cx="${f(cx + dx * s - 4 * s)}" cy="${f(cy + dy * s - 6 * s)}" r="${f(rr * s * 0.7)}" fill="${light}" opacity=".55"/>`; });
    return o;
  }

  function stars(r, n, maxY) {
    let o = '';
    for (let i = 0; i < n; i++) o += `<circle cx="${f(r() * 400)}" cy="${f(r() * maxY)}" r="${f(0.4 + r() * 1.1)}" fill="#fff" opacity="${f(0.3 + r() * 0.7)}"/>`;
    return o;
  }

  function embers(r, n, color) {
    let o = '';
    for (let i = 0; i < n; i++) o += `<circle cx="${f(r() * 400)}" cy="${f(60 + r() * 140)}" r="${f(0.6 + r() * 1.8)}" fill="${color}" opacity="${f(0.35 + r() * 0.6)}"/>`;
    return o;
  }

  function speedLines(p, cx, cy, n, r, color) {
    let o = `<g opacity=".18" stroke="${color}" stroke-linecap="round">`;
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, r1 = 70 + r() * 40, r2 = 260 + r() * 80;
      o += `<line x1="${f(cx + Math.cos(a) * r1)}" y1="${f(cy + Math.sin(a) * r1)}" x2="${f(cx + Math.cos(a) * r2)}" y2="${f(cy + Math.sin(a) * r2)}" stroke-width="${f(0.5 + r() * 1.5)}"/>`;
    }
    return o + '</g>';
  }

  const BUILDERS = {
    dawn(p, r) {
      return `
        <defs><linearGradient id="${p}sk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2b1d3f"/><stop offset=".45" stop-color="#d4603a"/><stop offset=".8" stop-color="#ffb46a"/><stop offset="1" stop-color="#ffe2a8"/></linearGradient>
          <radialGradient id="${p}sun"><stop offset="0" stop-color="#fff6d8"/><stop offset=".35" stop-color="#ffd37a" stop-opacity=".9"/><stop offset="1" stop-color="#ff8a3a" stop-opacity="0"/></radialGradient></defs>
        <rect width="400" height="200" fill="url(#${p}sk)"/>
        <circle cx="250" cy="150" r="90" fill="url(#${p}sun)"/>
        <circle cx="250" cy="150" r="22" fill="#fff4d6"/>
        ${cloud(110, 70, 1.1, '#e8845e', '#ffd2a0')}${cloud(330, 52, 0.8, '#d9705a', '#ffc590')}${cloud(40, 110, 0.6, '#f0946a', '#ffd9a8')}
        <g fill="#6b3448" opacity=".85">${skyline(r, 182, 14, 46, '#6b3448', null, 0)}</g>
        ${skyline(r, 200, 20, 60, '#2a141e', '#ffcc7a', 0.08)}
        <rect x="0" y="0" width="34" height="200" fill="#1a1012"/><rect x="34" y="0" width="5" height="200" fill="#3a2422"/>
        <rect x="360" y="0" width="40" height="200" fill="#1a1012" opacity=".92"/><rect x="356" y="0" width="5" height="200" fill="#3a2422"/>
        <polygon points="39,0 120,0 260,200 39,200" fill="#fff1c8" opacity=".08"/>`;
    },
    run(p, r) {
      const vx = 200, vy = 112;
      let bl = '', br = '';
      for (let i = 0; i < 6; i++) {
        const t = i / 6, x1 = f(-20 + t * 170), x2 = f(-20 + (t + 1 / 6) * 170);
        const h1 = 160 - t * 100, h2 = 160 - (t + 1 / 6) * 100;
        bl += `<polygon points="${x1},${f(vy - h1 * 0.55)} ${x2},${f(vy - h2 * 0.55)} ${x2},${f(vy + h2 * 0.3)} ${x1},${f(vy + h1 * 0.45)}" fill="${i % 2 ? '#3a2228' : '#2c1a20'}"/>`;
        const rx1 = f(420 - t * 170), rx2 = f(420 - (t + 1 / 6) * 170);
        br += `<polygon points="${rx1},${f(vy - h1 * 0.6)} ${rx2},${f(vy - h2 * 0.6)} ${rx2},${f(vy + h2 * 0.3)} ${rx1},${f(vy + h1 * 0.45)}" fill="${i % 2 ? '#40242a' : '#311c22'}"/>`;
        if (r() > 0.3) br += `<rect x="${f(Math.min(rx1, rx2) + 6)}" y="${f(vy - h1 * 0.3)}" width="${f(Math.abs(rx1 - rx2) * 0.5)}" height="${f(h1 * 0.1)}" fill="#ffb066" opacity=".55"/>`;
      }
      return `
        <defs><linearGradient id="${p}sk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3b2a4a"/><stop offset=".55" stop-color="#e07a42"/><stop offset="1" stop-color="#ffc98a"/></linearGradient></defs>
        <rect width="400" height="200" fill="url(#${p}sk)"/>
        ${cloud(90, 40, 0.9, '#c66a52', '#ffbf8a')}${cloud(300, 30, 1.1, '#b85e50', '#ffb47e')}
        <circle cx="${vx}" cy="${vy - 8}" r="16" fill="#fff0c8" opacity=".9"/>
        <polygon points="${vx - 6},${vy} ${vx + 6},${vy} 470,200 -70,200" fill="#4a3236"/>
        <polygon points="${vx - 1},${vy} ${vx + 1},${vy} 214,200 186,200" fill="#ffd6a0" opacity=".5"/>
        ${bl}${br}
        <path d="M-10 30 Q 100 60 ${vx} ${vy - 30}" stroke="#1a0e12" stroke-width="1" fill="none"/>
        <path d="M410 22 Q 300 55 ${vx} ${vy - 30}" stroke="#1a0e12" stroke-width="1" fill="none"/>
        ${speedLines(p, vx, vy, 46, r, '#fff')}`;
    },
    dojo(p, r) {
      let planks = '';
      for (let i = -8; i <= 8; i++) planks += `<line x1="${200 + i * 8}" y1="128" x2="${200 + i * 60}" y2="200" stroke="#3a2a20" stroke-width="1"/>`;
      let shoji = '';
      for (let i = 1; i < 4; i++) shoji += `<line x1="${250 + i * 32}" y1="10" x2="${250 + i * 32}" y2="128" stroke="#6b5a4a" stroke-width="2"/>`;
      for (let i = 1; i < 4; i++) shoji += `<line x1="250" y1="${10 + i * 30}" x2="380" y2="${10 + i * 30}" stroke="#6b5a4a" stroke-width="1.5"/>`;
      return `
        <defs><linearGradient id="${p}w" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a3330"/><stop offset="1" stop-color="#6e6258"/></linearGradient>
        <linearGradient id="${p}fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a4434"/><stop offset="1" stop-color="#2a1e18"/></linearGradient></defs>
        <rect width="400" height="200" fill="url(#${p}w)"/>
        <rect x="250" y="10" width="130" height="118" fill="#e9dcc4"/>${shoji}
        <rect x="246" y="6" width="138" height="126" fill="none" stroke="#2a221e" stroke-width="6"/>
        <rect x="60" y="0" width="10" height="128" fill="#2a221e"/><rect x="150" y="0" width="10" height="128" fill="#2a221e"/>
        <rect y="128" width="400" height="72" fill="url(#${p}fl)"/>${planks}
        <polygon points="250,10 380,10 260,200 40,200" fill="#fff3d6" opacity=".14"/>
        <polygon points="290,10 340,10 210,200 120,200" fill="#fff3d6" opacity=".12"/>
        <g fill="#1e1714"><rect x="60" y="160" width="70" height="5" rx="2"/><rect x="58" y="150" width="8" height="25" rx="2"/><rect x="124" y="150" width="8" height="25" rx="2"/></g>
        ${embers(r, 18, '#fff1c8')}`;
    },
    study(p, r) {
      let books = '', x = 30;
      const cols = ['#7a2e2e', '#2e4a6a', '#a07a3a', '#3e5a3e', '#5a3e6a', '#8a4a2a'];
      while (x < 170) {
        const w = 6 + r() * 8, h = 34 + r() * 22;
        books += `<rect x="${f(x)}" y="${f(110 - h)}" width="${f(w)}" height="${f(h)}" fill="${cols[Math.floor(r() * cols.length)]}" opacity=".85"/>`;
        x += w + 1;
      }
      return `
        <defs><linearGradient id="${p}sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1430"/><stop offset="1" stop-color="#26305a"/></linearGradient>
        <radialGradient id="${p}lamp" cx="300" cy="150" r="140" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffb35a" stop-opacity=".75"/><stop offset="1" stop-color="#ffb35a" stop-opacity="0"/></radialGradient></defs>
        <rect width="400" height="200" fill="#171a2a"/>
        <rect x="210" y="14" width="170" height="104" fill="url(#${p}sk)"/>
        <svg x="210" y="14" width="170" height="104" viewBox="0 0 400 245" preserveAspectRatio="xMidYMid slice">
          ${stars(r, 40, 140)}
          <circle cx="280" cy="70" r="34" fill="#f5ecd0"/><circle cx="294" cy="60" r="32" fill="#1a2350"/>
          ${skyline(r, 245, 20, 90, '#0a0c18', '#ffd27a', 0.12)}
        </svg>
        <rect x="206" y="10" width="178" height="112" fill="none" stroke="#0c0e18" stroke-width="7"/><line x1="295" y1="10" x2="295" y2="122" stroke="#0c0e18" stroke-width="5"/>
        <rect x="24" y="110" width="160" height="5" fill="#3a2a22"/>${books}
        <rect y="150" width="400" height="50" fill="#2a1e1a"/>
        <rect width="400" height="200" fill="url(#${p}lamp)"/>
        <path d="M286 150 L300 112 L316 112 L328 150 Z" fill="#c76b2a"/><rect x="304" y="150" width="4" height="12" fill="#2a1e1a"/>
        <g transform="translate(150 140) rotate(-6)"><rect width="70" height="16" fill="#e9dcc4"/><rect y="12" width="70" height="6" fill="#7a2e2e"/></g>`;
    },
    night(p, r) {
      return `
        <defs><linearGradient id="${p}sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#07070c"/><stop offset=".6" stop-color="#2a1208"/><stop offset="1" stop-color="#7a2e0a"/></linearGradient>
        <radialGradient id="${p}g" cx=".5" cy="1" r=".8"><stop offset="0" stop-color="#ff6a00" stop-opacity=".55"/><stop offset="1" stop-color="#ff6a00" stop-opacity="0"/></radialGradient></defs>
        <rect width="400" height="200" fill="url(#${p}sk)"/>${stars(r, 40, 90)}
        <rect width="400" height="200" fill="url(#${p}g)"/>
        ${skyline(r, 170, 30, 110, '#140a08', '#ff9a3a', 0.22)}
        ${skyline(r, 205, 20, 60, '#0a0605', '#ffb45a', 0.15)}
        ${embers(r, 40, '#ff8a2a')}`;
    },
    water(p, r) {
      let rain = '';
      for (let i = 0; i < 60; i++) { const x = r() * 420, y = r() * 200; rain += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x - 6)}" y2="${f(y + 18)}" stroke="#cfe8ff" stroke-width=".8" opacity="${f(0.2 + r() * 0.4)}"/>`; }
      let rip = '';
      for (let i = 0; i < 7; i++) { const x = r() * 400, y = 150 + r() * 45, s = 6 + r() * 22; rip += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(s)}" ry="${f(s * 0.25)}" fill="none" stroke="#bfe0ff" stroke-width="1" opacity=".5"/><ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(s * 0.5)}" ry="${f(s * 0.12)}" fill="none" stroke="#bfe0ff" stroke-width="1" opacity=".4"/>`; }
      return `
        <defs><linearGradient id="${p}sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16324a"/><stop offset=".7" stop-color="#2f6e8a"/><stop offset="1" stop-color="#7cc0d0"/></linearGradient></defs>
        <rect width="400" height="200" fill="url(#${p}sk)"/>
        ${skyline(r, 140, 20, 70, '#14283a', '#9ad6ff', 0.1)}
        <rect y="140" width="400" height="60" fill="#1d4a62"/>
        <g opacity=".3" transform="translate(0 280) scale(1 -1)">${skyline(r, 140, 20, 50, '#0e2232', null, 0)}</g>
        ${rip}${rain}`;
    },
    peak(p, r) {
      return `
        <defs><linearGradient id="${p}sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e2a4a"/><stop offset=".5" stop-color="#7a5a8a"/><stop offset="1" stop-color="#f2a070"/></linearGradient>
        <linearGradient id="${p}mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6d6c0" stop-opacity="0"/><stop offset="1" stop-color="#f6d6c0" stop-opacity=".7"/></linearGradient></defs>
        <rect width="400" height="200" fill="url(#${p}sk)"/>${stars(r, 18, 50)}
        <circle cx="120" cy="120" r="30" fill="#ffe6b8" opacity=".9"/>
        <path d="M0 140 L60 92 L100 118 L170 54 L230 112 L280 80 L340 120 L400 96 L400 200 L0 200 Z" fill="#4a3a5e"/>
        <path d="M170 54 L186 70 L176 68 L168 78 L160 66 Z" fill="#f2e6f0" opacity=".7"/>
        <rect y="120" width="400" height="60" fill="url(#${p}mist)"/>
        <path d="M0 170 L80 128 L150 160 L220 120 L300 158 L360 136 L400 150 L400 200 L0 200 Z" fill="#2a2036"/>
        <path d="M0 190 L120 160 L220 186 L320 166 L400 182 L400 200 L0 200 Z" fill="#160f1e"/>
        <g stroke="#160f1e" stroke-width="1.4" fill="none"><path d="M250 50 q4 -4 8 0 q4 -4 8 0"/><path d="M272 62 q3 -3 6 0 q3 -3 6 0"/></g>`;
    },
    city(p, r) {
      return `
        <defs><linearGradient id="${p}sk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f5d8a"/><stop offset=".7" stop-color="#8ab4d0"/><stop offset="1" stop-color="#f0c79a"/></linearGradient></defs>
        <rect width="400" height="200" fill="url(#${p}sk)"/>
        ${cloud(90, 70, 1.5, '#f4efe8', '#ffffff')}${cloud(290, 50, 1.2, '#e9e2dc', '#ffffff')}${cloud(380, 110, 0.8, '#efe6dc', '#ffffff')}
        <g opacity=".55">${skyline(r, 170, 30, 90, '#5a7090', null, 0)}</g>
        ${skyline(r, 205, 30, 80, '#1c2232', '#ffd890', 0.08)}
        <line x1="0" y1="96" x2="400" y2="120" stroke="#1c2232" stroke-width=".8"/><line x1="0" y1="100" x2="400" y2="128" stroke="#1c2232" stroke-width=".8"/>`;
    }
  };

  /**
   * kind: SCENES のいずれか。seedKey: 同じ習慣なら同じ絵になるように。
   * opts.tone: 下部のスクリーントーン（漫画のトーン）を重ねるか
   */
  function scene(kind, seedKey, opts) {
    const o = opts || {};
    const p = 'sc' + (++uid) + '_';
    const r = rng(hash((seedKey || '') + kind));
    const build = BUILDERS[kind] || BUILDERS.night;
    const tone = o.tone === false ? '' : `
      <defs><pattern id="${p}dot" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1" fill="#000"/></pattern>
      <linearGradient id="${p}fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".9"/></linearGradient>
      <mask id="${p}m"><rect width="400" height="200" fill="url(#${p}fade)"/></mask>
      <linearGradient id="${p}shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".72"/></linearGradient></defs>
      <rect width="400" height="200" fill="url(#${p}dot)" mask="url(#${p}m)" opacity=".35"/>
      <rect width="400" height="200" fill="url(#${p}shade)"/>`;
    return `<svg class="scene" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${build(p, r)}${tone}</svg>`;
  }

  G.Scenes = { scene, rng, hash };
})(window);
