/*
 * Build Crew: blanks the current page, then a crew of coloured "agent" cursors
 * rebuilds it layer by layer: dragging out wireframe boxes with size badges,
 * typing the text, then swapping in the real element.
 *
 * Injected by background.js. Running it a second time toggles it off.
 * Nothing leaves the page: no network, no storage.
 */
(() => {
  'use strict';

  if (window.__buildCrew) { window.__buildCrew.toggle(); return; }

  // ---------------------------------------------------------------- config
  const COLORS = ['#4dd4ff', '#ff5c7a', '#ffe066', '#7bed9f', '#c77dff', '#ffb84d', '#ff7ae0', '#5cffc8',
    '#7c8cff', '#ff8f5c', '#a3ff5c', '#5c9dff', '#ff5cf0', '#5cf2ff', '#ffd35c', '#b07cff',
    '#ff6b6b', '#6bffb8', '#6bc5ff', '#ffa96b', '#d46bff', '#c6ff6b', '#ff6bb5', '#6b8aff'];
  const NAMES = ['Atlas', 'Byte', 'Cleo', 'Dash', 'Echo', 'Flux', 'Gizmo', 'Hex', 'Iris', 'Jinx', 'Kilo', 'Lumen',
    'Mochi', 'Nova', 'Orbit', 'Pixel', 'Quark', 'Rune', 'Sable', 'Tango', 'Unit', 'Vibe', 'Widget', 'Zest'];
  const START_AGENTS = 16;
  const MAX_AGENTS = 24;
  const MAX_LAYERS = 1500;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'BR', 'WBR', 'TITLE', 'SOURCE',
    'TRACK', 'PARAM', 'OPTION', 'OPTGROUP', 'DATALIST', 'AREA', 'MAP', 'HEAD']);
  const MEDIA = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'IFRAME', 'OBJECT', 'EMBED']);
  const CONTROLS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'PROGRESS', 'METER']);
  const STOP = Symbol('stop');

  let S = null; // state of the current run, null when idle

  window.__buildCrew = { toggle() { S ? stop() : start(); } };

  // --------------------------------------------------------------- helpers
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // Runs step(t) every frame for ms (scaled by build speed). Rejects with STOP
  // if the run is cancelled, so every agent's await chain unwinds cleanly.
  function animate(ms, step) {
    const s = S;
    return new Promise((resolve, reject) => {
      if (!s || s.dead) { reject(STOP); return; }
      const t0 = performance.now();
      const dur = Math.max(1, ms / s.speed);
      const tick = (now) => {
        if (s.dead) { reject(STOP); return; }
        const t = clamp((now - t0) / dur, 0, 1);
        step(t);
        if (t < 1) requestAnimationFrame(tick); else resolve();
      };
      requestAnimationFrame(tick);
    });
  }
  const wait = (ms) => animate(ms, () => {});

  function el(tag, cls, parent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }

  function opaque(color) {
    if (!color || color === 'transparent') return false;
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return true;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    return parts.length < 4 || parseFloat(parts[3]) > 0.02;
  }

  function docRect(node) {
    const r = node.getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
  }

  function pageBackground() {
    for (const n of [document.body, document.documentElement]) {
      const c = getComputedStyle(n).backgroundColor;
      if (opaque(c)) return c;
    }
    return '#ffffff';
  }

  // ---------------------------------------------------------- page layers
  function hasBox(node, cs) {
    if (opaque(cs.backgroundColor) || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true;
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      if (parseFloat(cs['border' + side + 'Width']) > 0 && cs['border' + side + 'Style'] !== 'none' &&
          opaque(cs['border' + side + 'Color'])) return true;
    }
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(node, pseudo);
      if (ps.content && ps.content !== 'none' && ps.content !== 'normal' &&
          (opaque(ps.backgroundColor) || ps.backgroundImage !== 'none' || ps.content.length > 2)) return true;
    }
    return false;
  }

  function hasOwnText(node) {
    for (const c of node.childNodes) if (c.nodeType === 3 && c.nodeValue.trim()) return true;
    return false;
  }

  // Walks the page once and turns every visible thing into a "layer": an
  // element with its own box (background, border, media, control) and/or its
  // own text. Inline children (<a>, <strong>, <span>…) inside a text block are
  // folded into that block so a paragraph is typed as one piece.
  function collectLayers() {
    const layers = [];
    const offscreen = [];
    const folded = new Set();
    const byEl = new Map();
    const vw = innerWidth;

    for (const node of document.body.querySelectorAll('*')) {
      if (folded.has(node)) continue;
      const tag = node.tagName.toUpperCase();
      if (SKIP.has(tag)) continue;
      if (node instanceof SVGElement && tag !== 'SVG') continue; // only the <svg> root
      if (node.closest('[data-bc-host]')) continue;

      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility !== 'visible' || parseFloat(cs.opacity) === 0) continue;
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;

      const media = MEDIA.has(tag);
      const control = CONTROLS.has(tag);
      const text = (!media && (!control || tag === 'BUTTON')) && hasOwnText(node);
      const box = media || control || hasBox(node, cs);
      if (!box && !text) continue;

      const layer = {
        el: node, box, media, members: [node], text: '',
        y0: r.top + scrollY, b0: r.bottom + scrollY,
        parent: null, claimed: false, built: false,
      };

      if (text) {
        for (const d of node.querySelectorAll('*')) {
          const dd = getComputedStyle(d).display;
          if (dd === 'inline' || dd === 'contents') { folded.add(d); layer.members.push(d); }
        }
        const own = new Set(layer.members);
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let t = '';
        while (walker.nextNode()) {
          if (own.has(walker.currentNode.parentElement)) t += walker.currentNode.nodeValue;
        }
        layer.text = t.replace(/\s+/g, ' ').trim();
      }

      // Nearest ancestor layer, so boxes get drawn before what sits inside them.
      for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) {
        if (byEl.has(p)) { layer.parent = byEl.get(p); break; }
      }
      byEl.set(node, layer);

      // Things scrolled sideways out of view (carousels, off-canvas menus)
      // just appear; there is nothing to watch there.
      if (r.right < 0 || r.left > vw + 40 || layers.length >= MAX_LAYERS) offscreen.push(layer);
      else layers.push(layer);
    }
    return { layers, offscreen };
  }

  function findLogo() {
    const sel = 'header img, header svg, nav img, nav svg, [class*="logo" i], [id*="logo" i], ' +
      'img[alt*="logo" i], img[src*="logo" i], a[href="/"] img, a[href="/"] svg';
    for (const n of document.querySelectorAll(sel)) {
      if (n.closest('[data-bc-host]')) continue;
      const r = n.getBoundingClientRect();
      if (r.width > 6 && r.height > 6 && r.top < innerHeight * 0.4 && r.bottom > 0) return n;
    }
    return null;
  }

  function reveal(L, instant) {
    if (L.built) return;
    L.built = true;
    L.claimed = true;
    for (const m of L.members) m.setAttribute('data-bc-shown', '');
    if (!instant) {
      L.el.setAttribute('data-bc-pop', '');
      setTimeout(() => L.el.removeAttribute('data-bc-pop'), 450);
    }
    if (S) S.built++;
  }

  // ---------------------------------------------------------------- agents
  const ARROW = '<svg class="arrow" viewBox="0 0 24 24" width="22" height="22"><path d="M3 2 L3 19 L8 14.5 L11.5 22 L14.6 20.6 L11.2 13.3 L18 13.3 Z" fill="var(--c)" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  const CROSS = '<svg class="cross" viewBox="-12 -12 24 24" width="24" height="24"><path d="M0 -10 V10 M-10 0 H10" stroke="#fff" stroke-width="3.5"/><path d="M0 -10 V10 M-10 0 H10" stroke="var(--c)" stroke-width="1.6"/></svg>';
  const BEAM = '<svg class="beam" viewBox="-6 -11 12 22" width="12" height="22"><path d="M-4 -9 Q0 -9 0 -6 V6 Q0 9 -4 9 M4 -9 Q0 -9 0 -6 M0 6 Q0 9 4 9" fill="none" stroke="#fff" stroke-width="3.2"/><path d="M-4 -9 Q0 -9 0 -6 V6 Q0 9 -4 9 M4 -9 Q0 -9 0 -6 M0 6 Q0 9 4 9" fill="none" stroke="var(--c)" stroke-width="1.5"/></svg>';

  function addAgent(x, y) {
    const i = S.agents.length;
    const color = COLORS[i % COLORS.length];
    const node = el('div', 'agent', S.doc);
    node.style.setProperty('--c', color);
    node.innerHTML = ARROW + CROSS + BEAM + `<span class="tag">${NAMES[i % NAMES.length]}</span>`;
    const a = { i, color, node, x, y, phase: rand(0, Math.PI * 2), radius: rand(38, 92), spin: rand(0.7, 1.3) };
    place(a);
    S.agents.push(a);
    renderDots();
    return a;
  }

  function place(a) { a.node.style.transform = `translate(${a.x}px, ${a.y}px)`; }
  function mode(a, m) { a.node.dataset.mode = m; }

  // Flies along a gentle curve, like a hand moving a mouse.
  function moveTo(a, x, y, ms) {
    const x0 = a.x, y0 = a.y, dx = x - x0, dy = y - y0;
    const dist = Math.hypot(dx, dy) || 1;
    const dur = ms ?? clamp(200 + dist * 0.5, 240, 1000);
    const bend = rand(-0.22, 0.22) * dist;
    const cx = x0 + dx / 2 - (dy / dist) * bend;
    const cy = y0 + dy / 2 + (dx / dist) * bend;
    return animate(dur, (t) => {
      const e = easeInOut(t), u = 1 - e;
      a.x = u * u * x0 + 2 * u * e * cx + e * e * x;
      a.y = u * u * y0 + 2 * u * e * cy + e * e * y;
      place(a);
    });
  }

  // Drags out a wireframe box over the element with a live size badge.
  async function drawBox(a, L) {
    let r = docRect(L.el);
    mode(a, 'cross');
    await moveTo(a, r.x, r.y);
    r = docRect(L.el); // layout may have shifted while flying

    const g = el('div', 'ghost', S.doc);
    g.style.setProperty('--c', a.color);
    g.style.left = r.x + 'px';
    g.style.top = r.y + 'px';
    if (L.media) g.classList.add('media');
    for (const k of ['tl', 'tr', 'bl', 'br']) el('i', k, g);
    const badge = el('b', 'badge', g);

    const sx = a.x, sy = a.y;
    const ex = r.x + r.w;
    const ey = Math.min(r.y + r.h, Math.max(r.y + 30, scrollY + innerHeight - 50));
    a.node.dataset.down = '';
    await animate(clamp(280 + Math.hypot(r.w, Math.min(r.h, innerHeight)) * 0.45, 320, 900), (t) => {
      const e = easeOut(t);
      const w = r.w * e, h = r.h * e;
      g.style.width = w + 'px';
      g.style.height = h + 'px';
      badge.textContent = `${Math.round(w)} × ${Math.round(h)}`;
      a.x = sx + (ex - sx) * e;
      a.y = sy + (ey - sy) * e;
      place(a);
    });
    delete a.node.dataset.down;
    g.classList.add('done');
    await wait(110);
    return g;
  }

  // Types the element's text into a look-alike overlay, caret and all, so the
  // real element's layout is never touched until it is revealed.
  async function typeText(a, L) {
    const node = L.el;
    const cs = getComputedStyle(node);
    const r = node.getBoundingClientRect();
    const padL = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
    const padR = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth);
    const padT = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
    const x = r.left + scrollX + padL;
    const y = r.top + scrollY + padT;
    const w = Math.max(8, r.width - padL - padR + 2);

    mode(a, 'beam');
    await moveTo(a, x, y + parseFloat(cs.fontSize) * 0.55);

    const c = el('div', 'clone', S.doc);
    c.style.setProperty('--c', a.color);
    Object.assign(c.style, {
      left: x + 'px', top: y + 'px', width: w + 'px',
      font: cs.font, letterSpacing: cs.letterSpacing, wordSpacing: cs.wordSpacing,
      textTransform: cs.textTransform, textAlign: cs.textAlign, lineHeight: cs.lineHeight,
      color: opaque(cs.color) ? cs.color : '#888', fontFeatureSettings: cs.fontFeatureSettings,
      webkitTextStroke: cs.webkitTextStroke,
      webkitTextFillColor: opaque(cs.webkitTextFillColor) ? cs.webkitTextFillColor : (cs.webkitTextStrokeWidth !== '0px' ? 'transparent' : ''),
    });
    if (!c.style.webkitTextFillColor && !opaque(cs.color)) c.style.color = '#888';
    const caret = el('span', 'caret');

    const text = L.text;
    const n = text.length;
    let shown = -1;
    await animate(clamp(n * 16, 220, 1500), (t) => {
      const k = Math.round(n * t);
      if (k === shown) return;
      shown = k;
      c.textContent = text.slice(0, k);
      c.appendChild(caret);
      const cr = caret.getBoundingClientRect();
      a.x = cr.left + scrollX + 3;
      a.y = cr.top + scrollY + cr.height * 0.5;
      place(a);
    });
    return c;
  }

  function fadeAway(node, ms = 320) {
    node.classList.add('out');
    setTimeout(() => node.remove(), ms);
  }

  async function build(a, L) {
    let g = null, c = null;
    try {
      if (L.box) g = await drawBox(a, L);
      if (L.text) c = await typeText(a, L);
    } catch (e) {
      if (g) g.remove();
      if (c) c.remove();
      throw e;
    }
    reveal(L);
    if (g) fadeAway(g);
    if (c) fadeAway(c, 160);
    mode(a, 'arrow');
  }

  // Next layer for an agent: the first unclaimed one in view, preferring
  // layers whose parent box is already built.
  function claimNext() {
    if (S.logo && !S.logo.claimed) { S.logo.claimed = true; return S.logo; }
    const top = scrollY - 60;
    const bottom = scrollY + innerHeight * 1.02;
    let fallback = null;
    for (const L of S.layers) {
      if (L.claimed || L.b0 < top || L.y0 > bottom) continue;
      if (!L.parent || L.parent.built) { L.claimed = true; return L; }
      if (!fallback) fallback = L;
    }
    if (fallback) fallback.claimed = true;
    return fallback;
  }

  function available() {
    const top = scrollY - 60, bottom = scrollY + innerHeight * 1.02;
    let n = 0;
    for (const L of S.layers) if (!L.claimed && L.b0 >= top && L.y0 <= bottom) n++;
    return n;
  }

  async function agentLoop(a) {
    const s = S;
    try {
      while (!s.done && !s.dead) {
        const L = claimNext();
        if (L) {
          try { await build(a, L); } catch (e) { if (e === STOP) throw e; reveal(L, true); }
        } else {
          // Nothing in view: drift a little while waiting for a scroll.
          mode(a, 'arrow');
          await moveTo(a, a.x + rand(-70, 70), clamp(a.y + rand(-50, 50), scrollY + 40, scrollY + innerHeight - 60), rand(450, 750));
        }
      }
    } catch (e) {
      if (e !== STOP) console.error('[Build Crew]', e);
    }
  }

  function launch(a) { S.loops.push(agentLoop(a)); }

  function spawnPoint() {
    const side = Math.floor(Math.random() * 4);
    const w = innerWidth, h = innerHeight;
    const [x, y] = [[rand(0, w), -30], [w + 30, rand(0, h)], [rand(0, w), h + 30], [-30, rand(0, h)]][side];
    return { x: x + scrollX, y: y + scrollY };
  }

  // -------------------------------------------------------------------- hud
  function renderDots() {
    if (!S.hud) return;
    const dots = S.hud.querySelector('.dots');
    dots.textContent = '';
    for (const a of S.agents.slice(0, 7)) el('span', '', dots).style.background = a.color;
  }

  function updateHud() {
    const label = S.hud.querySelector('.label');
    if (S.phase === 'scan') return;
    label.textContent = S.done
      ? `Rebuilt ${S.total} layers`
      : `${S.agents.length} agents · ${Math.min(S.built, S.total)} / ${S.total} layers`;
    S.hud.querySelector('.bar i').style.width = (S.total ? (100 * S.built) / S.total : 0) + '%';
  }

  function buildHud() {
    const hud = el('div', 'hud', S.fixed);
    hud.innerHTML = `<div class="dots"></div><div class="status"><span class="label">Scanning page…</span><div class="bar"><i></i></div></div>
      <button data-act="tour" title="Auto-scroll at the crew's pace">Tour</button>
      <button data-act="speed" title="Build speed">1×</button>
      <button data-act="live" hidden>Go live</button>
      <button data-act="replay" hidden>Replay</button>
      <button data-act="exit" title="Exit (Esc)">✕</button>`;
    hud.addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b || !S) return;
      const act = b.dataset.act;
      if (act === 'tour') { S.tour = !S.tour; b.classList.toggle('on', S.tour); }
      if (act === 'speed') { S.speed = S.speed >= 3 ? 1 : S.speed + 1; b.textContent = S.speed + '×'; }
      if (act === 'exit') stop();
      if (act === 'live') goLive();
      if (act === 'replay') { stop(); start(); }
    });
    S.hud = hud;
  }

  // ------------------------------------------------------------------ flow
  function start() {
    S = {
      dead: false, done: false, phase: 'scan', speed: 1, tour: false,
      agents: [], loops: [], layers: [], total: 0, built: 0, logo: null,
      mouse: null, lastScrollY: scrollY, lastScrollT: performance.now(), lastSpawn: 0,
    };

    S.style = el('style');
    S.style.textContent = PAGE_CSS;
    document.head.appendChild(S.style);

    S.host = document.createElement('div');
    S.host.setAttribute('data-bc-host', '');
    S.host.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483647;pointer-events:none;';
    const root = S.host.attachShadow({ mode: 'open' });
    el('style', '', root).textContent = SHADOW_CSS;
    S.doc = el('div', 'doc', root);     // positioned in page coordinates
    S.fixed = el('div', 'fixed', root); // pinned to the viewport
    document.documentElement.appendChild(S.host);
    buildHud();

    S.onKey = (e) => { if (e.key === 'Escape') stop(); };
    S.onMouse = (e) => { if (S) S.mouse = { x: e.clientX, y: e.clientY }; };
    S.onScroll = onScroll;
    addEventListener('keydown', S.onKey, true);
    addEventListener('mousemove', S.onMouse, { passive: true });
    addEventListener('scroll', S.onScroll, { passive: true });

    run().catch((e) => { if (e !== STOP) console.error('[Build Crew]', e); });
  }

  async function run() {
    // 1. Fade the page out to its own background colour.
    const veil = el('div', 'veil', S.fixed);
    veil.style.background = pageBackground();
    await animate(420, (t) => { veil.style.opacity = t; });

    // 2. Scan the page while it is covered, then hide everything.
    const { layers, offscreen } = collectLayers();
    S.layers = layers;
    S.total = layers.length + offscreen.length;
    for (const L of offscreen) reveal(L, true);
    const logoEl = findLogo();
    if (logoEl) S.logo = layers.find((L) => L.el === logoEl || L.el.contains(logoEl)) || null;
    document.documentElement.setAttribute('data-bc-on', '');
    veil.remove();

    // 3. The crew flies in and circles a tile with the site's icon while "scanning".
    const centre = { x: scrollX + innerWidth / 2, y: scrollY + innerHeight * 0.45 };
    const tile = makeTile(centre);
    for (let i = 0; i < START_AGENTS; i++) { const p = spawnPoint(); addAgent(p.x, p.y); }
    const bar = S.hud.querySelector('.bar i');
    await animate(1700, (t) => {
      bar.style.width = t * 100 + '%';
      const pull = 0.05 + t * 0.12;
      for (const a of S.agents) {
        const ang = a.phase + a.spin * t * 7;
        const rad = a.radius * (1.15 - 0.35 * t);
        const tx = centre.x + Math.cos(ang) * rad;
        const ty = centre.y + Math.sin(ang) * rad * 0.8;
        a.x += (tx - a.x) * pull;
        a.y += (ty - a.y) * pull;
        place(a);
      }
    });
    fadeAway(tile, 400);

    // 4. Get to work.
    S.phase = 'build';
    bar.style.width = '0%';
    updateHud();
    for (const a of S.agents) launch(a);
    requestAnimationFrame(tick);
  }

  function makeTile(c) {
    const tile = el('div', 'tile', S.doc);
    tile.style.left = c.x + 'px';
    tile.style.top = c.y + 'px';
    const icon = document.querySelector('link[rel~="icon"]');
    const img = el('img', '', tile);
    img.src = icon ? icon.href : location.origin + '/favicon.ico';
    img.onerror = () => {
      img.remove();
      tile.textContent = (location.hostname.replace(/^www\./, '')[0] || '•').toUpperCase();
    };
    return tile;
  }

  function onScroll() {
    if (!S || S.phase !== 'build' || S.done) return;
    const now = performance.now();
    const v = Math.abs(scrollY - S.lastScrollY) / Math.max(1, now - S.lastScrollT) * 1000;
    S.lastScrollY = scrollY;
    S.lastScrollT = now;
    // Scrolling fast calls in reinforcements.
    if (v > 1800 && S.agents.length < MAX_AGENTS && now - S.lastSpawn > 220) {
      S.lastSpawn = now;
      const p = spawnPoint();
      launch(addAgent(p.x, p.y));
    }
  }

  function tick(now) {
    const s = S;
    if (!s || s.dead) return;
    const dt = Math.min(64, now - (s.lastTick || now));
    s.lastTick = now;

    // Anything the user has scrolled well past just appears.
    const cut = scrollY - 400;
    for (const L of s.layers) if (!L.claimed && L.b0 < cut) reveal(L, true);

    if (s.tour && !s.done) {
      const max = document.documentElement.scrollHeight - innerHeight;
      if (scrollY < max - 1 && available() < 3) {
        window.scrollTo({ top: Math.min(max, scrollY + 0.14 * dt * s.speed), behavior: 'instant' });
      }
    }

    if (!s.done && s.built >= s.total) finish();
    updateHud();
    requestAnimationFrame(tick);
  }

  async function finish() {
    const s = S;
    s.done = true;
    s.tour = false;
    s.hud.querySelector('[data-act="tour"]').hidden = true;
    s.hud.querySelector('[data-act="speed"]').hidden = true;
    s.hud.querySelector('[data-act="live"]').hidden = false;
    s.hud.querySelector('[data-act="replay"]').hidden = false;
    await Promise.allSettled(s.loops);
    if (s.dead) return;

    // The crew gathers around your mouse until you go live or replay.
    const n = s.agents.length;
    const flock = (now) => {
      if (s.dead) return;
      const m = s.mouse || { x: innerWidth / 2, y: innerHeight / 2 };
      s.agents.forEach((a, i) => {
        mode(a, 'arrow');
        const ang = now / 1100 + (i / n) * Math.PI * 2;
        const rad = 40 + (i % 3) * 16;
        const tx = m.x + scrollX + Math.cos(ang) * rad;
        const ty = m.y + scrollY + Math.sin(ang) * rad;
        a.x += (tx - a.x) * 0.07;
        a.y += (ty - a.y) * 0.07;
        place(a);
      });
      requestAnimationFrame(flock);
    };
    requestAnimationFrame(flock);
  }

  function goLive() {
    const s = S;
    s.doc.classList.add('out');
    s.hud.classList.add('out');
    setTimeout(() => { if (S === s) stop(); }, 350);
  }

  function stop() {
    const s = S;
    if (!s) return;
    s.dead = true;
    S = null;
    document.documentElement.removeAttribute('data-bc-on');
    for (const n of document.querySelectorAll('[data-bc-shown],[data-bc-pop]')) {
      n.removeAttribute('data-bc-shown');
      n.removeAttribute('data-bc-pop');
    }
    s.host.remove();
    s.style.remove();
    removeEventListener('keydown', s.onKey, true);
    removeEventListener('mousemove', s.onMouse);
    removeEventListener('scroll', s.onScroll);
  }

  // ----------------------------------------------------------------- styles
  const PAGE_CSS = `
    html[data-bc-on] body *:not([data-bc-shown]) { visibility: hidden !important; }
    html[data-bc-on] body [data-bc-shown] { visibility: visible !important; }
    html[data-bc-on] body [data-bc-pop] { animation: bc-pop .4s ease-out both !important; }
    @keyframes bc-pop { from { opacity: 0; } to { opacity: 1; } }
  `;

  const SHADOW_CSS = `
    .doc { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: visible; transition: opacity .3s; }
    .fixed { position: fixed; inset: 0; pointer-events: none; }
    .out { opacity: 0 !important; transition: opacity .3s ease !important; }

    .agent { position: absolute; left: 0; top: 0; z-index: 5; will-change: transform; }
    .agent svg { position: absolute; left: 0; top: 0; overflow: visible; filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); transition: transform .08s; }
    .agent .cross { left: -12px; top: -12px; display: none; }
    .agent .beam { left: -6px; top: -11px; display: none; }
    .agent[data-mode="cross"] .arrow, .agent[data-mode="beam"] .arrow { display: none; }
    .agent[data-mode="cross"] .cross, .agent[data-mode="beam"] .beam { display: block; }
    .agent[data-down] svg { transform: scale(.82); }
    .tag { position: absolute; left: 15px; top: 19px; background: var(--c); color: #0b0b10; white-space: nowrap;
      font: 600 10px/1 ui-sans-serif, system-ui, -apple-system, sans-serif; padding: 3px 6px;
      border-radius: 2px 7px 7px 7px; box-shadow: 0 1px 3px rgba(0,0,0,.3); }

    .ghost { position: absolute; box-sizing: border-box; border: 1px solid var(--c); z-index: 1;
      background: color-mix(in srgb, var(--c) 12%, transparent); }
    .ghost.media { background-image:
      linear-gradient(to top right, transparent calc(50% - .6px), color-mix(in srgb, var(--c) 55%, transparent) 50%, transparent calc(50% + .6px)),
      linear-gradient(to bottom right, transparent calc(50% - .6px), color-mix(in srgb, var(--c) 55%, transparent) 50%, transparent calc(50% + .6px)); }
    .ghost i { position: absolute; width: 6px; height: 6px; background: #fff; border: 1px solid var(--c); opacity: 0; transition: opacity .15s; }
    .ghost i.tl { left: -4px; top: -4px; } .ghost i.tr { right: -4px; top: -4px; }
    .ghost i.bl { left: -4px; bottom: -4px; } .ghost i.br { right: -4px; bottom: -4px; }
    .ghost.done i { opacity: 1; }
    .badge { position: absolute; left: 50%; top: 100%; transform: translate(-50%, 6px); background: var(--c); color: #0b0b10;
      font: 600 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 3px 5px; border-radius: 4px; white-space: nowrap; }

    .clone { position: absolute; z-index: 2; margin: 0; padding: 0; white-space: normal; overflow-wrap: break-word; }
    .caret { display: inline-block; width: 2px; height: 1em; margin-left: 1px; vertical-align: -0.12em;
      background: var(--c); -webkit-text-fill-color: initial; animation: blink 1s steps(1) infinite; }
    @keyframes blink { 50% { opacity: 0; } }

    .veil { position: fixed; inset: 0; opacity: 0; }
    .tile { position: absolute; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 12px;
      display: grid; place-items: center; background: rgba(28,28,36,.9); border: 1px solid rgba(255,255,255,.14);
      color: #fff; font: 700 18px/1 ui-sans-serif, system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.35);
      transition: opacity .4s; }
    .tile img { width: 24px; height: 24px; border-radius: 5px; }

    .hud { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 10; pointer-events: auto;
      display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 12px; border-radius: 999px;
      background: rgba(16,16,22,.88); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255,255,255,.1); box-shadow: 0 10px 34px rgba(0,0,0,.4);
      color: #ececf3; font: 500 12px/1 ui-sans-serif, system-ui, -apple-system, sans-serif; white-space: nowrap; }
    .dots { display: flex; padding-left: 3px; }
    .dots span { width: 10px; height: 10px; border-radius: 50%; margin-left: -3px; border: 1.5px solid #101016; }
    .status { display: flex; flex-direction: column; gap: 5px; min-width: 170px; }
    .bar { height: 3px; background: rgba(255,255,255,.12); border-radius: 2px; overflow: hidden; }
    .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #4dd4ff, #c77dff, #ff5c7a); transition: width .2s; }
    button { all: unset; cursor: pointer; padding: 7px 11px; border-radius: 999px; background: rgba(255,255,255,.08); }
    button:hover { background: rgba(255,255,255,.17); }
    button.on { background: #ececf3; color: #101016; }
    button[hidden] { display: none; }
  `;

  window.__buildCrew.toggle();
})();
