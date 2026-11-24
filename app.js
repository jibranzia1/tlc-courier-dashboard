/* TLC courier performance app. Data arrives encrypted (data.enc.json) and is opened in the browser with the password. */
(() => {
  'use strict';
  document.documentElement.classList.add('js');
  const $ = (id) => document.getElementById(id);
  const RM = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const DUR = () => (RM.matches ? 0 : 450);
  const KEY = 'tlc-courier-pw';
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode */ } },
    del() { try { localStorage.removeItem(KEY); } catch (e) { /* private mode */ } },
  };

  // ---------- decrypt ----------
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  async function fetchEnc(file) {
    let r;
    try { r = await fetch((file || 'data.enc.json') + '?t=' + Date.now(), { cache: 'no-store' }); } catch (e) { throw new Error('fetch'); }
    if (!r.ok) throw new Error('fetch');
    return r.json();
  }
  async function decrypt(pw, file) {
    const e = await fetchEnc(file);
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(e.salt), iterations: e.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(e.iv) }, key, b64(e.ct)); } catch (err) { throw new Error('password'); }
    return JSON.parse(new TextDecoder().decode(plain));
  }

  let D = null, A = null, OPEN = [], MIN = null, MAX = null, booted = false, PW = null;

  async function unlock(pw, remember) {
    const go = $('go');
    go.disabled = true; go.textContent = 'Opening'; $('prog').classList.add('on'); $('err').textContent = '';
    try {
      D = await decrypt(pw);
      PW = pw;
      if (remember) store.set(pw); else store.del();
      const lock = $('lock');
      $('app').hidden = false;
      boot();
      lock.classList.add('is-leaving');
      setTimeout(() => { lock.hidden = true; lock.classList.remove('is-leaving'); }, RM.matches ? 0 : 620);
    } catch (err) {
      store.del();
      $('pw').setAttribute('aria-invalid', 'true');
      $('err').textContent = err && err.message === 'fetch'
        ? 'The data file could not be loaded. Check your connection and try again.'
        : 'That password did not open the dashboard.';
      $('pw').focus();
    } finally {
      go.disabled = false; go.textContent = 'Open the dashboard'; $('prog').classList.remove('on');
    }
  }
  $('unlock').addEventListener('submit', (e) => { e.preventDefault(); if ($('pw').value) unlock($('pw').value, $('remember').checked); else { $('err').textContent = 'Enter the password.'; $('pw').focus(); } });
  $('pw').addEventListener('input', () => { $('pw').removeAttribute('aria-invalid'); $('err').textContent = ''; });
  $('lockout').addEventListener('click', () => {
    store.del(); D = null; booted = false; PW = null; BILL = null; billLoading = null; BL = null; FX = null;
    $('app').hidden = true; $('lock').hidden = false; $('pw').value = ''; $('pw').focus();
  });

  // ---------- formatting ----------
  const CS = ['QWQER', 'PostEx', 'Leopards'];
  const COL = { QWQER: 'var(--color-qwqer)', PostEx: 'var(--color-postex)', Leopards: 'var(--color-leopards)' };
  const KCLS = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5'];
  const KLAB = ['Same day', 'Next day', '2 days', '3 days', '4 days', '5 days or more'];
  const fInt = (v) => d3.format(',.0f')(v);
  const fPct = (v) => (v == null || isNaN(v)) ? 'n/a' : Math.round(v * 100) + '%';
  const fPct1 = (v) => (v == null || isNaN(v)) ? 'n/a' : (v * 100).toFixed(1) + '%';
  const fDay = (v) => (v == null || isNaN(v)) ? 'n/a' : v.toFixed(1);
  const fRs = (v) => 'Rs ' + d3.format(',.0f')(v);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const live = (c) => !!(A && A.live && A.live[c]);
  const anyLive = () => CS.some(live);

  // dates are 'YYYY-MM-DD' strings, handled in UTC so no timezone shifts them
  const P = (s) => new Date(s + 'T00:00:00Z');
  const S = (d) => d.toISOString().slice(0, 10);
  const add = (s, n) => { const d = P(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
  const span = (a, b) => Math.round((P(b) - P(a)) / 864e5) + 1;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fD = (s, y) => { const d = P(s); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + (y ? ' ' + d.getUTCFullYear() : ''); };
  const lo = (a, b) => (a < b ? a : b), hi = (a, b) => (a > b ? a : b);
  const monday = (s) => { const d = P(s); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return S(d); };

  function tween(node, to, fmt) {
    const from = node._v; node._v = to;
    cancelAnimationFrame(node._raf);
    if (to == null || isNaN(to)) { node.textContent = 'n/a'; return; }
    if (from == null || isNaN(from) || RM.matches || from === to) { node.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 450;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      node.textContent = fmt(from + (to - from) * e);
      if (k < 1) node._raf = requestAnimationFrame(step);
    };
    node._raf = requestAnimationFrame(step);
  }

  // ---------- tooltip ----------
  const tipEl = $('tip');
  const tip = {
    show(lines, ev) {
      tipEl.replaceChildren(...lines.map((l, i) => el(i === 0 ? 'b' : 'div', null, l)));
      const w = tipEl.offsetWidth || 200, h = tipEl.offsetHeight || 60;
      const x = Math.min(window.innerWidth - w - 8, ev.clientX + 14), y = ev.clientY - h - 12 < 8 ? ev.clientY + 16 : ev.clientY - h - 12;
      tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px'; tipEl.classList.add('on');
    },
    hide() { tipEl.classList.remove('on'); },
  };

  // ---------- state ----------
  const st = { tab: 'overview', p: '60', from: null, to: null, lc: 'all', la: '14', lq: '', shown: 50, bc: 'all', bk: 'claim', blc: 'all', bq: '', bshown: 50, fs: 'missing', fshown: 50 };
  const TABS = ['overview', 'qwqer', 'postex', 'leopards', 'late', 'speed', 'returns', 'pickups', 'costs', 'bills'];
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (TABS.includes(h.get('t'))) st.tab = h.get('t');
    if (['7', '30', '60', 'tm', 'lm', 'c'].includes(h.get('p'))) st.p = h.get('p');
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (st.p === 'c' && re.test(h.get('from') || '') && re.test(h.get('to') || '')) { st.from = h.get('from'); st.to = h.get('to'); }
  }
  function writeHash() {
    const h = new URLSearchParams({ t: st.tab, p: st.p });
    if (st.p === 'c') { h.set('from', st.from); h.set('to', st.to); }
    history.replaceState(null, '', '#' + h.toString());
  }
  function resolveRange() {
    let f, t = MAX;
    if (st.p === 'tm') f = MAX.slice(0, 8) + '01';
    else if (st.p === 'lm') { const d = P(MAX.slice(0, 8) + '01'); d.setUTCDate(0); t = S(d); f = t.slice(0, 8) + '01'; }
    else if (st.p === 'c') { f = st.from || add(MAX, -59); t = st.to || MAX; if (f > t) [f, t] = [t, f]; }
    else f = add(MAX, -(+st.p - 1));
    f = hi(f, MIN); t = lo(t, MAX); if (f > t) f = t;
    st.from = f; st.to = t;
  }

  // ---------- aggregation ----------
  const within = (r, f, t) => r.d >= f && r.d <= t;
  function zero() { return { n: 0, cx: 0, src: 0, sn: 0, scx: 0, sdl: 0, scdl: 0, sret: 0, ssrc: 0, sd: 0, sum: 0, b: [0, 0, 0, 0, 0, 0], fa: 0, fad: 0, pn: 0, po: 0, am: 0, amn: 0, amo: 0 }; }
  function addRow(o, r, settled) {
    o.n += r.n; o.cx += r.cx; o.src += r.src || 0;
    if (!settled) return;
    o.sn += r.n; o.scx += r.cx; o.sdl += r.dl; o.scdl += r.cdl || 0; o.sret += (r.ret || 0) + (r.rtn || 0); o.ssrc += r.src || 0;
    o.sd += r.sd; o.sum += r.sum; r.b.forEach((v, i) => { o.b[i] += v; });
    o.fa += r.fa || 0; o.fad += r.fad || 0;
    o.pn += r.pn || 0; o.po += r.po || 0; o.am += r.am || 0; o.amn += r.amn || 0; o.amo += r.amo || 0;
  }
  function finish(o, c) {
    o.nd = o.sd ? (o.b[0] + o.b[1]) / o.sd : null;
    o.same = o.sd ? o.b[0] / o.sd : null;
    o.avg = o.sd ? o.sum / o.sd : null;
    o.g5 = o.sd ? o.b[5] / o.sd : null;
    const out = o.scdl + o.sret;
    o.rr = c && live(c) && o.ssrc && out ? o.sret / out : null;
    o.far = o.fad ? o.fa / o.fad : null;
    o.op = o.pn ? o.po / o.pn : null;
    o.amr = o.amn ? o.amo / o.amn : null;
    return o;
  }
  function settleWindow(f, t) { return [hi(f, A.track_start), lo(t, add(MAX, -5))]; }
  const cache = new Map();
  function agg(f, t) {
    const k = f + t; if (cache.has(k)) return cache.get(k);
    const [sf, sl] = settleWindow(f, t);
    const by = {}, city = {}, all = zero();
    CS.forEach((c) => { by[c] = zero(); city[c] = {}; A.city_groups.forEach((g) => { city[c][g] = zero(); }); });
    for (const r of D.hand) {
      if (!within(r, f, t) || !by[r.c]) continue;
      const s = sf <= sl && r.d >= sf && r.d <= sl;
      addRow(by[r.c], r, s); addRow(all, r, s);
      if (city[r.c][r.g]) addRow(city[r.c][r.g], r, s);
    }
    const tot = CS.reduce((a, c) => a + by[c].n, 0);
    CS.forEach((c) => { finish(by[c], c); by[c].share = tot ? by[c].n / tot : null; A.city_groups.forEach((g) => finish(city[c][g], c)); });
    finish(all, null);
    const days = D.daily.filter((r) => within(r, f, t));
    const slot = (key) => {
      const v = days.map((r) => key === 'pm7' ? r.pm7_lhr + r.pm7_other : r[key]).sort(d3.ascending);
      return { avg: v.length ? d3.mean(v) : null, p90: v.length ? d3.quantile(v, 0.9) : null, max: v.length ? v[v.length - 1] : null };
    };
    const res = { f, t, sf, sl, by, city, all, tot, days, ndays: span(f, t),
      slots: { am9: slot('am9'), pm7_lhr: slot('pm7_lhr'), pm7_other: slot('pm7_other'), pm7: slot('pm7') },
      orders: d3.sum(days, (r) => r.orders), cancelled: d3.sum(days, (r) => r.cancelled) };
    cache.set(k, res);
    return res;
  }
  function prevOf(f, t) {
    const n = span(f, t), pt = add(f, -1), pf = add(f, -n);
    return pf < A.hist_start ? null : agg(pf, pt);
  }
  function bucketer(f, t) {
    const n = span(f, t);
    if (n <= 45) return { kind: 'day', key: (d) => d, label: (k) => fD(k), word: 'day' };
    if (n <= 200) return { kind: 'week', key: monday, label: (k) => fD(k), word: 'week' };
    return { kind: 'month', key: (d) => d.slice(0, 8) + '01', label: (k) => MON[P(k).getUTCMonth()] + ' ' + k.slice(2, 4), word: 'month' };
  }

  // ---------- open parcels ----------
  const SLA = (c, g) => (c === 'QWQER' ? 1 : g === 'Lahore' ? 2 : g === 'Other cities' ? 4 : 3);
  function prepOpen() {
    const k = D.open_keys || [];
    OPEN = (D.open || []).map((a) => { const o = {}; k.forEach((n, i) => { o[n] = a[i]; });
      if (o.due == null) { o.sla = SLA(o.c, o.g); o.over = o.age - o.sla; }
      o.late = o.over > 0 && o.st !== 'returning'; return o; });
  }
  const lateIn = (o, band) => o.late && (band === 'all' || (band === '7' ? o.age <= 7 : band === '14' ? o.age <= 14 : o.age >= 15));

  // ---------- figures ----------
  function figs(box, items) {
    if (box.children.length !== items.length) {
      box.replaceChildren(...items.map(() => {
        const f = el('div', 'fig');
        f.append(el('p', 'fig-label'), el('p', 'fig-value'), el('p', 'fig-sub'));
        f.children[1].append(el('span'), el('small'));
        return f;
      }));
    }
    items.forEach((it, i) => {
      const f = box.children[i];
      f.className = 'fig' + (it.hot ? ' is-hot' : '') + (it.alert ? ' is-alert' : '');
      f.children[0].textContent = it.label;
      tween(f.children[1].children[0], it.value, it.fmt || fInt);
      f.children[1].children[1].textContent = it.value == null ? '' : (it.unit || '');
      const sub = f.children[2]; sub.replaceChildren();
      if (it.delta) { sub.append(el('span', 'delta ' + (it.delta.cls || ''), it.delta.text), document.createTextNode(' ')); }
      if (it.sub) sub.append(document.createTextNode(it.sub));
    });
  }
  function delta(cur, prev, kind, goodUp, label) {
    if (cur == null || prev == null || isNaN(cur) || isNaN(prev)) return null;
    let d, txt;
    if (kind === 'pts') { d = (cur - prev) * 100; if (Math.abs(d) < 0.5) return { text: 'level with ' + label }; txt = (d > 0 ? '+' : '') + d.toFixed(0) + ' pts vs ' + label; }
    else if (kind === 'days') { d = cur - prev; if (Math.abs(d) < 0.05) return { text: 'level with ' + label }; txt = (d > 0 ? '+' : '') + d.toFixed(1) + ' days vs ' + label; }
    else { if (!prev) return null; d = (cur - prev) / prev; if (Math.abs(d) < 0.005) return { text: 'level with ' + label }; txt = (d > 0 ? '+' : '') + Math.round(d * 100) + '% vs ' + label; }
    return { text: txt, cls: kind === 'pct' ? '' : ((d > 0) === goodUp ? 'good' : 'bad') };
  }
  const prevLabel = (a) => 'previous ' + a.ndays + (a.ndays === 1 ? ' day' : ' days');

  function keys(box, list) {
    box.replaceChildren(...list.map(([label, color, cls]) => { const s = el('span'); const i = el('i', cls || null); if (color) i.style.background = color; s.append(i, document.createTextNode(label)); return s; }));
  }
  const ckeys = (box, cs) => keys(box, (cs || CS).map((c) => [c, COL[c]]));

  function table(tbl, head, rows, opt) {
    const thead = el('thead'), tr = el('tr');
    head.forEach(([t, cls]) => tr.append(el('th', cls || null, t)));
    thead.append(tr);
    const tb = el('tbody');
    rows.forEach((cells, i) => {
      const r = el('tr');
      if (opt && opt.animate && i < 14 && !RM.matches) { r.className = 'in'; r.style.animationDelay = (i * 28) + 'ms'; }
      cells.forEach((c) => r.append(c));
      tb.append(r);
    });
    tbl.replaceChildren(thead, tb);
  }
  const td = (content, cls) => { const t = el('td', cls || null); if (content instanceof Node) t.append(content); else if (content != null) t.textContent = content; return t; };
  function whoLink(c) { const b = el('button', 'who-link'); b.type = 'button'; b.title = 'Open the ' + c + ' tab'; b.append(who(c)); b.addEventListener('click', () => { showTab(CKEY[c]); window.scrollTo({ top: 0 }); }); return b; }
  function who(c) { const s = el('span', 'who'); const w = el('span', 'swatch'); w.style.background = COL[c]; s.append(w, document.createTextNode(c)); return s; }
  function split(b) {
    const tot = d3.sum(b), s = el('div', 'split');
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', tot ? b.map((v, i) => KLAB[i] + ' ' + fPct(v / tot)).join(', ') : 'No delivered parcels');
    b.forEach((v, i) => { const x = el('i', KCLS[i]); x.style.flexGrow = 0; x.dataset.g = tot ? v / tot : 0; s.append(x); });
    s.addEventListener('pointermove', (ev) => tip.show(['Days to deliver', ...b.map((v, i) => KLAB[i] + ': ' + fInt(v) + ' (' + fPct(tot ? v / tot : 0) + ')')], ev));
    s.addEventListener('pointerleave', tip.hide);
    return s;
  }
  function growSplits(root) {
    const go = () => root.querySelectorAll('.split i').forEach((x) => { x.style.flexGrow = x.dataset.g; });
    if (RM.matches) go(); else requestAnimationFrame(() => requestAnimationFrame(go));
  }
  function empty(box, title, text) {
    const e = el('div', 'empty'); const w = el('div'); w.append(el('b', null, title), el('span', null, text)); e.append(w); box.replaceChildren(e); box.__svg = null;
  }

  // ---------- charts ----------
  function frame(box, h, m) {
    const w = Math.max(280, box.clientWidth || 600);
    let svg = box.__svg;
    if (!svg || !box.contains(svg.node())) {
      box.replaceChildren();
      svg = d3.select(box).append('svg').attr('width', '100%').attr('role', 'img');
      svg.append('g').attr('class', 'gy'); svg.append('g').attr('class', 'gx'); svg.append('g').attr('class', 'plot'); svg.append('g').attr('class', 'over');
      box.__svg = svg;
    }
    svg.attr('viewBox', `0 0 ${w} ${h}`).attr('height', h);
    return { svg, w, h, m };
  }
  function yAxis(svg, y, w, m, fmt) {
    svg.select('.gy').attr('transform', `translate(${m.l},0)`).transition().duration(DUR())
      .call(d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r)).tickFormat(fmt)).call((g) => g.select('.domain').remove());
  }
  function xAxis(svg, x, h, m, fmt, every) {
    const ax = d3.axisBottom(x).tickSizeOuter(0).tickFormat((d, i) => (i % every === 0 ? fmt(d) : ''));
    svg.select('.gx').attr('transform', `translate(0,${h - m.b})`).call(ax).call((g) => g.selectAll('.tick line').remove());
  }

  // stacked bars over time buckets
  function stackBars(box, data, series, opt) {
    if (!data.length || !d3.sum(data, (d) => d3.sum(series, (s) => d[s]))) return empty(box, 'No parcels', 'Nothing was handed to a courier in this range.');
    const { svg, w, h, m } = frame(box, 260, { t: 12, r: 8, b: 28, l: 44 });
    svg.attr('aria-label', opt.aria);
    const x = d3.scaleBand().domain(data.map((d) => d.k)).range([m.l, w - m.r]).padding(data.length > 30 ? 0.18 : 0.3);
    const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d3.sum(series, (s) => d[s])) || 1]).nice().range([h - m.b, m.t]);
    yAxis(svg, y, w, m, d3.format('~s'));
    xAxis(svg, x, h, m, opt.label, Math.ceil(data.length / Math.max(2, Math.floor((w - m.l) / 64))));
    const stacked = d3.stack().keys(series)(data);
    const t = svg.transition().duration(DUR()).ease(d3.easeCubicOut);
    svg.select('.plot').selectAll('g.s').data(stacked, (s) => s.key).join('g').attr('class', 's').style('fill', (s) => COL[s.key])
      .selectAll('rect').data((s) => s.map((p) => Object.assign(p, { key: s.key })), (p) => p.data.k)
      .join(
        (en) => en.append('rect').attr('x', (p) => x(p.data.k)).attr('width', x.bandwidth()).attr('y', h - m.b).attr('height', 0).attr('rx', 1),
        (up) => up,
        (ex) => ex.transition(t).attr('y', h - m.b).attr('height', 0).remove(),
      )
      .on('pointermove', (ev, p) => tip.show(opt.tip(p.data), ev)).on('pointerleave', tip.hide)
      .transition(t).attr('x', (p) => x(p.data.k)).attr('width', x.bandwidth()).attr('y', (p) => y(p[1])).attr('height', (p) => Math.max(0, y(p[0]) - y(p[1])));
    const lines = opt.lines || [];
    const ov = svg.select('.over').selectAll('g.ref').data(lines, (l) => l.label).join((en) => { const g = en.append('g').attr('class', 'ref'); g.append('line'); g.append('text'); return g; });
    ov.select('line').attr('x1', m.l).attr('x2', w - m.r).style('stroke', 'var(--color-ink)').style('stroke-dasharray', '4 4').style('stroke-width', 1.25)
      .transition(t).attr('y1', (l) => y(l.v)).attr('y2', (l) => y(l.v));
    ov.select('text').attr('x', w - m.r).attr('text-anchor', 'end').attr('class', 'val').text((l) => l.label).transition(t).attr('y', (l) => y(l.v) - 5);
  }

  // lines over buckets, one per courier; lines draw themselves in
  function lineChart(box, rows, series, opt) {
    const pts = series.map((c) => ({ c, v: rows.filter((r) => r[c] != null).map((r) => ({ k: r.k, v: r[c], n: r['n_' + c] })) })).filter((s) => s.v.length);
    if (!pts.length) return empty(box, 'Not enough parcels yet', opt.emptyText || 'Pick a longer range, or one that ends at least a week ago.');
    const { svg, w, h, m } = frame(box, 260, { t: 14, r: 12, b: 28, l: 44 });
    svg.attr('aria-label', opt.aria);
    const x = d3.scalePoint().domain(rows.map((r) => r.k)).range([m.l + 8, w - m.r - 8]);
    const y = d3.scaleLinear().domain(opt.domain || [0, 1]).range([h - m.b, m.t]);
    yAxis(svg, y, w, m, opt.yfmt || d3.format('.0%'));
    xAxis(svg, x, h, m, opt.label, Math.ceil(rows.length / Math.max(2, Math.floor((w - m.l) / 64))));
    const line = d3.line().x((p) => x(p.k)).y((p) => y(p.v)).curve(d3.curveMonotoneX);
    const plot = svg.select('.plot');
    const g = plot.selectAll('g.ln').data(pts, (s) => s.c).join((en) => { const gg = en.append('g').attr('class', 'ln'); gg.append('path'); return gg; });
    g.select('path').attr('d', (s) => line(s.v)).style('fill', 'none').style('stroke', (s) => COL[s.c]).style('stroke-width', 2.5).style('stroke-linejoin', 'round')
      .each(function () {
        if (!DUR()) return;
        const L = this.getTotalLength ? this.getTotalLength() : 0;
        if (!L) return;
        d3.select(this).attr('stroke-dasharray', L + ' ' + L).attr('stroke-dashoffset', L).transition().duration(700).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0).on('end', function () { d3.select(this).attr('stroke-dasharray', null); });
      });
    g.selectAll('circle').data((s) => s.v.map((p) => Object.assign({ c: s.c }, p)), (p) => p.k).join('circle')
      .attr('r', 3.5).attr('cx', (p) => x(p.k)).attr('cy', (p) => y(p.v)).style('fill', 'var(--color-paper)').style('stroke', (p) => COL[p.c]).style('stroke-width', 2)
      .on('pointermove', (ev, p) => tip.show([p.c + ', ' + opt.label(p.k), opt.tipv(p)], ev)).on('pointerleave', tip.hide);
  }

  // horizontal bars
  function hbars(box, rows, opt) {
    if (!rows.length) return empty(box, opt.emptyTitle || 'Nothing to show', opt.emptyText || '');
    const rh = 34, bw = Math.max(280, box.clientWidth || 600);
    const lw = Math.min(Math.round(bw * 0.48), Math.max(opt.lw || 110, d3.max(rows, (r) => r.label.length) * 7 + 16));
    const { svg, w, h, m } = frame(box, rows.length * rh + 8, { t: 4, r: 70, b: 4, l: lw });
    svg.attr('aria-label', opt.aria);
    svg.select('.gx').selectAll('*').remove(); svg.select('.gy').selectAll('*').remove();
    const x = d3.scaleLinear().domain([0, opt.max || d3.max(rows, (r) => r.v) || 1]).range([lw, w - m.r]);
    const t = svg.transition().duration(DUR()).ease(d3.easeCubicOut);
    const g = svg.select('.plot').selectAll('g.hb').data(rows, (r) => r.label).join((en) => {
      const gg = en.append('g').attr('class', 'hb').attr('transform', (r, i) => `translate(0,${i * rh + 4})`);
      gg.append('text').attr('class', 'lbl').attr('x', 0).attr('y', 19);
      gg.append('rect').attr('x', lw).attr('y', 6).attr('height', 18).attr('rx', 2).attr('width', 0);
      gg.append('text').attr('class', 'val').attr('y', 19).attr('x', lw + 6);
      gg.append('rect').attr('class', 'hit').attr('width', w).attr('height', rh);
      return gg;
    });
    g.transition(t).attr('transform', (r, i) => `translate(0,${i * rh + 4})`);
    g.select('text.lbl').text((r) => r.label);
    g.select('rect:not(.hit)').style('fill', (r) => r.color || 'var(--color-ink)').transition(t).attr('width', (r) => Math.max(0, x(r.v) - lw));
    g.select('text.val').text((r) => r.txt).transition(t).attr('x', (r) => x(r.v) + 6);
    g.select('rect.hit').on('pointermove', (ev, r) => tip.show(r.tip || [r.label, r.txt], ev)).on('pointerleave', tip.hide);
  }

  // dot plot: one row per city, one dot per courier
  function dotPlot(box, rows, opt) {
    const dots = rows.flatMap((r) => r.dots.filter((d) => d.v != null).map((d) => ({ ...d, g: r.g })));
    if (!dots.length) return empty(box, 'Not enough parcels yet', 'Pick a range that ends at least a week ago.');
    const rh = 46, lw = 130;
    const { svg, w, h, m } = frame(box, rows.length * rh + 30, { t: 6, r: 16, b: 26, l: lw });
    svg.attr('aria-label', opt.aria);
    const x = d3.scaleLinear().domain([0, Math.max(4, d3.max(dots, (d) => d.v))]).nice().range([lw, w - m.r]);
    svg.select('.gy').selectAll('*').remove();
    svg.select('.gx').attr('transform', `translate(0,${h - m.b})`).transition().duration(DUR()).call(d3.axisBottom(x).ticks(6).tickSize(-(h - m.b - m.t)).tickFormat((v) => v + 'd')).call((g) => g.select('.domain').remove());
    const t = svg.transition().duration(DUR()).ease(d3.easeCubicOut);
    const yOf = (g) => rows.findIndex((r) => r.g === g) * rh + m.t + rh / 2;
    svg.select('.plot').selectAll('text.lbl').data(rows, (r) => r.g).join('text').attr('class', 'lbl').attr('x', 0).attr('y', (r) => yOf(r.g) + 4).text((r) => r.g);
    svg.select('.plot').selectAll('line.track').data(rows, (r) => r.g).join('line').attr('class', 'track').attr('x1', lw).attr('x2', w - m.r).attr('y1', (r) => yOf(r.g)).attr('y2', (r) => yOf(r.g)).style('stroke', 'var(--color-rule)');
    svg.select('.over').selectAll('circle').data(dots, (d) => d.g + d.c)
      .join((en) => en.append('circle').attr('r', 0).attr('cx', lw).attr('cy', (d) => yOf(d.g)))
      .style('fill', (d) => COL[d.c]).style('stroke', 'var(--color-paper)').style('stroke-width', 2)
      .on('pointermove', (ev, d) => tip.show([d.c + ', ' + d.g, fDay(d.v) + ' days on average', fInt(d.n) + ' delivered parcels'], ev)).on('pointerleave', tip.hide)
      .transition(t).attr('r', (d) => (d.n >= 20 ? 8 : 5)).attr('cx', (d) => x(d.v)).attr('cy', (d) => yOf(d.g)).style('opacity', (d) => (d.n >= 20 ? 1 : 0.45));
  }

  // grouped bars: days-to-deliver share per courier
  function groupBars(box, groups, series, opt) {
    if (!groups.some((g) => series.some((s) => g[s] != null))) return empty(box, 'Not enough parcels yet', 'Pick a range that ends at least a week ago.');
    const { svg, w, h, m } = frame(box, 260, { t: 14, r: 8, b: 28, l: 44 });
    svg.attr('aria-label', opt.aria);
    const x0 = d3.scaleBand().domain(groups.map((g) => g.k)).range([m.l, w - m.r]).padding(0.22);
    const x1 = d3.scaleBand().domain(series).range([0, x0.bandwidth()]).padding(0.12);
    const y = d3.scaleLinear().domain([0, Math.max(0.2, d3.max(groups, (g) => d3.max(series, (s) => g[s] || 0)))]).nice().range([h - m.b, m.t]);
    yAxis(svg, y, w, m, d3.format('.0%'));
    xAxis(svg, x0, h, m, (k) => k, 1);
    const t = svg.transition().duration(DUR()).ease(d3.easeCubicOut);
    const flat = groups.flatMap((g) => series.map((s) => ({ k: g.k, s, v: g[s] || 0 })));
    svg.select('.plot').selectAll('rect').data(flat, (d) => d.k + d.s)
      .join((en) => en.append('rect').attr('x', (d) => x0(d.k) + x1(d.s)).attr('width', x1.bandwidth()).attr('y', h - m.b).attr('height', 0).attr('rx', 1))
      .style('fill', (d) => COL[d.s])
      .on('pointermove', (ev, d) => tip.show([d.s + ', ' + d.k, fPct(d.v) + ' of delivered parcels'], ev)).on('pointerleave', tip.hide)
      .transition(t).attr('x', (d) => x0(d.k) + x1(d.s)).attr('width', x1.bandwidth()).attr('y', (d) => y(d.v)).attr('height', (d) => Math.max(0, h - m.b - y(d.v)));
  }

  // pickups: per bucket, a 9 AM bar and a stacked 7 PM bar (Lahore + other cities)
  function pickChart(box, data, opt) {
    if (!data.length) return empty(box, 'No orders', 'No orders in this range.');
    const { svg, w, h, m } = frame(box, 280, { t: 16, r: 8, b: 28, l: 44 });
    svg.attr('aria-label', opt.aria);
    const x0 = d3.scaleBand().domain(data.map((d) => d.k)).range([m.l, w - m.r]).padding(data.length > 30 ? 0.15 : 0.25);
    const x1 = d3.scaleBand().domain(['am9', 'pm7']).range([0, x0.bandwidth()]).padding(0.08);
    const y = d3.scaleLinear().domain([0, Math.max(d3.max(data, (d) => d.pm7_lhr + d.pm7_other), opt.plan7 || 0) * 1.05]).nice().range([h - m.b, m.t]);
    yAxis(svg, y, w, m, d3.format('~s'));
    xAxis(svg, x0, h, m, opt.label, Math.ceil(data.length / Math.max(2, Math.floor((w - m.l) / 64))));
    const t = svg.transition().duration(DUR()).ease(d3.easeCubicOut);
    const parts = data.flatMap((d) => [
      { k: d.k, id: 'a', x: x1('am9'), y0: 0, y1: d.am9, fill: 'var(--color-qwqer)', d },
      { k: d.k, id: 'l', x: x1('pm7'), y0: 0, y1: d.pm7_lhr, fill: 'color-mix(in oklab, var(--color-qwqer) 55%, var(--color-paper))', d },
      { k: d.k, id: 'o', x: x1('pm7'), y0: d.pm7_lhr, y1: d.pm7_lhr + d.pm7_other, fill: 'var(--color-postex)', d },
    ]);
    svg.select('.plot').selectAll('rect').data(parts, (p) => p.k + p.id)
      .join((en) => en.append('rect').attr('x', (p) => x0(p.k) + p.x).attr('width', x1.bandwidth()).attr('y', h - m.b).attr('height', 0))
      .style('fill', (p) => p.fill)
      .on('pointermove', (ev, p) => tip.show(opt.tip(p.d), ev)).on('pointerleave', tip.hide)
      .transition(t).attr('x', (p) => x0(p.k) + p.x).attr('width', x1.bandwidth()).attr('y', (p) => y(p.y1)).attr('height', (p) => Math.max(0, y(p.y0) - y(p.y1)));
    const lines = [{ v: opt.plan9, label: '9 AM plan, ' + opt.plan9 }, { v: opt.plan7, label: '7 PM plan, ' + opt.plan7 }];
    const ov = svg.select('.over').selectAll('g.ref').data(lines, (l) => l.label).join((en) => { const g = en.append('g').attr('class', 'ref'); g.append('line'); g.append('text'); return g; });
    ov.select('line').attr('x1', m.l).attr('x2', w - m.r).style('stroke', 'var(--color-ink)').style('stroke-dasharray', '4 4').style('stroke-width', 1.25).transition(t).attr('y1', (l) => y(l.v)).attr('y2', (l) => y(l.v));
    ov.select('text').attr('class', 'val').attr('x', w - m.r).attr('text-anchor', 'end').text((l) => l.label).transition(t).attr('y', (l) => y(l.v) - 5);
  }

  // ---------- time series helpers ----------
  function series(f, t, fn) {
    const bk = bucketer(f, t), map = new Map();
    for (const r of D.hand) {
      if (!within(r, f, t)) continue;
      const k = bk.key(r.d); if (!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    // keep empty buckets so the axis stays continuous
    const out = []; let d = bk.key(f);
    while (d <= t) { out.push({ k: d, rows: map.get(d) || [] }); d = bk.kind === 'day' ? add(d, 1) : bk.kind === 'week' ? add(d, 7) : S(new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 1))); }
    return { bk, rows: out.map((b) => fn(b.k, b.rows)) };
  }

  // ---------- the short version (plain English, built from the figures) ----------
  function say(parts) { const p = el('span', 'brief-t'); parts.forEach((x) => p.append(typeof x === 'string' ? document.createTextNode(x) : el('b', x[1] || null, x[0]))); return p; }
  const listJoin = (arr) => arr.flatMap((x, i) => [x, i < arr.length - 2 ? ', ' : i === arr.length - 2 ? ' and ' : '']);
  function renderBrief(a, first) {
    const by = a.by, items = [];
    const act = CS.filter((c) => by[c].n > 0).sort((x, y) => by[y].n - by[x].n);
    items.push(['Volume', [[fInt(a.tot) + ' parcels'], ' went out, about ' + fInt(a.tot / a.ndays) + ' a day. Split: ', ...listJoin(act.map((c) => [c + ' ' + fPct(by[c].share)])), '.'], 'overview']);
    const sp = CS.filter((c) => by[c].sd >= 20);
    if (sp.length) {
      const fast = sp.slice().sort((x, y) => by[y].op - by[x].op)[0], slow = sp.slice().sort((x, y) => by[y].avg - by[x].avg)[0];
      const parts = ['On promise (7 PM pickup delivered within 24 hours): ', ...listJoin(sp.map((c) => [c + ' ' + fPct(by[c].op), by[c].op < 0.5 ? 'warn' : ''])), '. ', [fast], ' is fastest at ' + fDay(by[fast].avg) + ' days on average.'];
      if (slow !== fast) parts.push(' ', [slow], ' averages ', [fDay(by[slow].avg) + ' days', by[slow].avg >= 3 ? 'warn' : ''], ' and ' + fPct(by[slow].g5) + ' of its parcels take 5 days or more.');
      const am = CS.reduce((t, c) => t + by[c].am, 0);
      parts.push(am ? ' The 9 AM same-day pickup carried ' + fInt(am) + ' parcels, ' + fPct(by.QWQER.amr) + ' delivered the same day.' : ' No parcel went out on a 9 AM same-day pickup.');
      items.push(['Speed', parts, 'speed']);
    } else items.push(['Speed', ['Too recent to judge speed. Parcels need 5 days to settle; pick a longer range.'], 'speed']);
    const rl = CS.filter((c) => by[c].rr != null);
    if (rl.length) {
      const parts = ['Came back: ', ...listJoin(rl.map((c) => [c + ' ' + fPct1(by[c].rr), by[c].rr >= 0.12 ? 'warn' : ''])), '.'];
      const why = d3.rollups((D.reasons || []).filter((r) => r.d >= a.sf && r.d <= a.sl), (v) => d3.sum(v, (r) => r.n), (r) => r.r).sort((x, y) => y[1] - x[1]);
      const tot = d3.sum(why, (w) => w[1]);
      if (why.length) parts.push(' Main reason: ', [why[0][0].toLowerCase() + ', ' + fPct(why[0][1] / tot)], ' of returns.');
      items.push(['Returns', parts, 'returns']);
    } else items.push(['Returns', ['Courier tracking is not connected yet, so returns show last known invoice figures only.'], 'returns']);
    const late = OPEN.filter((o) => lateIn(o, '14')), lb = d3.rollups(late, (v) => v.length, (o) => o.c).sort((x, y) => y[1] - x[1]);
    items.push(['Chase today', late.length
      ? [[fInt(late.length) + ' parcels are late', 'warn'], ' (past the promised day, sent in the last 14 days). Most are with ' + lb[0][0] + ': ' + fInt(lb[0][1]) + '.']
      : ['Nothing is late right now.'], 'late']);
    const s9 = a.slots.am9, s7 = a.slots.pm7, plan = D.plan[0];
    if (s9.avg != null) items.push(['Pickups', ['Morning pickup: ', [Math.round(s9.avg) + ' orders'], ' on an average day, ' + Math.round(s9.p90) + ' on a busy one (planned for ' + plan.plan_9am + '). Evening: ', [Math.round(s7.avg) + ' orders'], ', ' + Math.round(s7.p90) + ' on a busy one (planned for ' + plan.plan_7pm + ').'], 'pickups']);
    const LINK = { overview: 'See the sheet', speed: 'Speed by city', returns: 'Open returns', late: 'Open the chase list', pickups: 'Open pickups' };
    $('brief').replaceChildren(...items.map(([k, parts, tab], i) => {
      const li = el('li', first && !RM.matches ? 'in' : null); if (first) li.style.animationDelay = (i * 60) + 'ms';
      const go = el('button', 'brief-go', LINK[tab]); go.type = 'button';
      go.addEventListener('click', () => {
        if (tab === 'overview') $('sheet').scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'center' });
        else { showTab(tab); window.scrollTo({ top: 0 }); }
      });
      li.append(el('span', 'brief-k', k), say(parts), go);
      return li;
    }));
    $('brief-say').textContent = fD(a.f) + ' to ' + fD(a.t, true) + '. Change the dates above and this updates.';
  }

  // ---------- render: overview ----------
  function renderOverview(a, p, first) {
    renderBrief(a, first);
    const pl = p ? prevLabel(a) : '';
    const q = a.by.QWQER, x = a.by.PostEx;
    const late14 = OPEN.filter((o) => lateIn(o, '14'));
    figs($('figs'), [
      { label: 'Parcels handed to couriers', value: a.tot, sub: fInt(a.tot / a.ndays) + ' a day', delta: p && delta(a.tot, p.tot, 'pct', true, pl) },
      { label: 'QWQER, delivered on promise', value: q.op == null ? null : q.op * 100, fmt: (v) => Math.round(v), unit: '%', sub: q.avg == null ? 'No settled parcels in range' : 'Average ' + fDay(q.avg) + ' days to deliver', delta: p && delta(q.op, p.by.QWQER.op, 'pts', true, pl) },
      { label: 'PostEx, delivered on promise', value: x.op == null ? null : x.op * 100, fmt: (v) => Math.round(v), unit: '%', sub: x.avg == null ? 'No settled parcels in range' : 'Average ' + fDay(x.avg) + ' days to deliver', delta: p && delta(x.op, p.by.PostEx.op, 'pts', true, pl) },
      { label: 'Late now, chase today', value: late14.length, alert: late14.length > 0, sub: 'Past the promised day, handed over in the last 14 days' },
    ]);
    keys($('split-keys'), KLAB.map((l, i) => [l, null, KCLS[i]]));
    const openBy = d3.rollup(OPEN, (v) => v.length, (o) => o.c), lateBy = d3.rollup(late14, (v) => v.length, (o) => o.c);
    table($('sheet'), [['Courier'], ['Parcels sent', 'n'], ['Share', 'n'], ['On promise', 'n'], ['Average days', 'n'], ['Took 5+ days', 'n'], ['Days to deliver'], ['Came back', 'n'], ['Still out now', 'n'], ['Late now', 'n']],
      CS.map((c) => {
        const o = a.by[c], has = o.n > 0;
        return [
          td(whoLink(c)), td(fInt(o.n), 'n'), td(has ? fPct(o.share) : 'n/a', 'n' + (has ? '' : ' dim')),
          td(fPct(o.op), 'n cell-big' + (o.op == null ? ' dim' : '')), td(fDay(o.avg), 'n'), td(fPct(o.g5), 'n' + (o.g5 > 0.1 ? ' bad-t' : '')),
          td(o.sd ? split(o.b) : el('span', 'dim small', has ? 'Not settled yet' : 'No parcels in range')),
          td(live(c) ? fPct1(o.rr) : 'Not connected', 'n' + (live(c) ? '' : ' dim')),
          td(fInt(openBy.get(c) || 0), 'n'), td(fInt(lateBy.get(c) || 0), 'n' + ((lateBy.get(c) || 0) ? ' bad-t' : '')),
        ];
      }), { animate: first });
    growSplits($('sheet'));
    const [sf, sl] = [a.sf, a.sl];
    $('sheet-note').textContent = (sf <= sl ? 'Speed and returns use parcels handed over ' + fD(sf) + ' to ' + fD(sl, true) + '. ' : 'Speed needs parcels handed over at least 5 days ago; this range is too recent. ')
      + (A.track_start > a.f ? 'Shopify delivery dates start on ' + fD(A.track_start, true) + '. ' : '')
      + 'Not delivered yet and late now are live counts, not tied to the range.'
      + (CS.every(live) ? '' : ' Where courier tracking is not connected, delivery dates come from Shopify, which writes them when its courier sync runs (about 8 PM, 2 AM and 6 AM), so a parcel delivered in the evening counts one day late.');

    const sv = series(a.f, a.t, (k, rows) => { const o = { k }; CS.forEach((c) => { o[c] = d3.sum(rows.filter((r) => r.c === c), (r) => r.n); }); return o; });
    $('over-say').textContent = 'By ' + sv.bk.word + ', ' + fD(a.f) + ' to ' + fD(a.t, true) + '.';
    ckeys($('k-vol')); ckeys($('k-nd'), ['QWQER', 'PostEx', 'Leopards']);
    stackBars($('ch-vol'), sv.rows, CS, { aria: 'Parcels handed to each courier by ' + sv.bk.word, label: sv.bk.label,
      tip: (d) => [(sv.bk.kind === 'week' ? 'Week of ' : '') + sv.bk.label(d.k), ...CS.filter((c) => d[c]).map((c) => c + ': ' + fInt(d[c])), 'Total: ' + fInt(d3.sum(CS, (c) => d[c]))] });
    const nd = series(hi(a.f, A.track_start), lo(a.t, add(MAX, -5)), (k, rows) => {
      const o = { k };
      CS.forEach((c) => { const r = rows.filter((x) => x.c === c), pn = d3.sum(r, (x) => x.pn || 0), po = d3.sum(r, (x) => x.po || 0); o[c] = pn >= 20 ? po / pn : null; o['n_' + c] = pn; });
      return o;
    });
    if (hi(a.f, A.track_start) > lo(a.t, add(MAX, -5))) empty($('ch-nd'), 'Too recent', 'Parcels need 5 days to settle. Pick a range that ends a week or more ago.');
    else lineChart($('ch-nd'), nd.rows, CS, { aria: 'Share of parcels delivered on promise', label: nd.bk.label, tipv: (p) => fPct(p.v) + ' on promise, of ' + fInt(p.n) + ' parcels' });
  }

  // ---------- render: late ----------
  function lateList() {
    const q = st.lq.trim().toLowerCase();
    return OPEN.filter((o) => lateIn(o, st.la) && (st.lc === 'all' || o.c === st.lc) && (!q || [o.o, o.t, o.city].some((v) => (v || '').toLowerCase().includes(q))))
      .sort((x, y) => y.over - x.over || x.o.localeCompare(y.o));
  }
  function renderLate(first) {
    const L = OPEN.filter((o) => o.late);
    const c7 = L.filter((o) => o.age <= 7).length, c14 = L.filter((o) => o.age > 7 && o.age <= 14).length, c15 = L.filter((o) => o.age >= 15).length;
    const onTime = OPEN.filter((o) => !o.late && o.st !== 'returning').length;
    const waiting = OPEN.filter((o) => o.st === 'awaiting_pickup' && o.age >= 2).length;
    const back = OPEN.filter((o) => o.st === 'returning').length;
    figs($('late-figs'), [
      { label: 'Late, up to 7 days old', value: c7, alert: c7 > 0, sub: 'Chase with the courier today' },
      { label: 'Late, 8 to 14 days old', value: c14, alert: c14 > 0, sub: 'Likely stuck or on the way back' },
      { label: 'Late, 15 days or more', value: c15, sub: anyLive() ? 'Check the courier status' : 'Most of these are returns Shopify never recorded' },
      anyLive()
        ? { label: 'Booked, not picked up after 2 days', value: waiting, alert: waiting > 0, sub: back ? fInt(back) + ' more are on the way back to us' : 'Courier never collected them' }
        : { label: 'On the way, inside the promise', value: onTime, sub: 'Handed over recently, nothing to do yet' },
    ]);
    $('late-say').textContent = 'Promise: a parcel on the 9 AM pickup (QWQER, Lahore) is delivered the same day; a parcel on the 7 PM pickup (QWQER, PostEx, Leopards) within 24 hours, by 7 PM the next day. The clock starts at the courier’s pickup scan. As of ' + fD(A.as_of.slice(0, 10), true) + ', ' + A.as_of.slice(11) + '.';
    const rows = lateList();
    const shown = rows.slice(0, st.shown);
    if (!rows.length) {
      $('late-table').replaceChildren();
      const e = el('tbody'); const r = el('tr'); const c = el('td', null); c.colSpan = 8;
      const box = el('div', 'empty'); const w = el('div'); w.append(el('b', null, OPEN.some((o) => o.late) ? 'No late parcels match' : 'Nothing is late'), el('span', null, OPEN.some((o) => o.late) ? 'Clear the search or pick another filter.' : 'Every parcel is inside its promise.'));
      box.append(w); c.append(box); r.append(c); e.append(r); $('late-table').append(e);
    } else {
      table($('late-table'), [['Order'], ['Courier'], ['City'], ['Handed over'], ['Days out', 'n'], ['Due by', 'n'], ['Days late', 'n'], ['Status'], ['Tracking']],
        shown.map((o) => [
          td(o.o, 'mono'), td(who(o.c)), td(o.city || o.g), td(fD(o.d)), td(fInt(o.age), 'n'), td(o.due ? fD(o.due.slice(0, 10)) + ', ' + (o.b === 'am9' ? 'same day' : '7 PM') : o.sla + ' days', 'n dim'),
          td(fInt(o.over), 'n bad-t'), td(el('span', 'tag' + (o.over > 7 ? ' late' : ''), o.s || 'No update')), td(o.t || 'n/a', 'mono small'),
        ]), { animate: first });
    }
    $('late-more').hidden = rows.length <= st.shown;
    $('late-more').textContent = 'Show ' + Math.min(50, rows.length - st.shown) + ' more of ' + fInt(rows.length - st.shown);
    $('late-note').textContent = (rows.length ? 'Showing ' + fInt(shown.length) + ' of ' + fInt(rows.length) + ', most days late first. ' : '')
      + (anyLive() ? 'Statuses come from the courier where connected, otherwise from Shopify.' : 'Statuses come from Shopify until courier tracking is connected. Shopify never marks a return, so a parcel that came back stays here as out for delivery or fulfilled.')
      + ' This list is live and does not follow the date range.';
    const n = OPEN.filter((o) => lateIn(o, '14')).length;
    $('late-count').textContent = n ? fInt(n) : '';
  }
  $('late-more').addEventListener('click', () => { st.shown += 50; renderLate(false); });
  $('lf-q').addEventListener('input', () => { st.lq = $('lf-q').value; st.shown = 50; renderLate(false); });
  $('csv').addEventListener('click', () => {
    const rows = lateList();
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const lines = [['Order', 'Courier', 'Tracking', 'City', 'Handed over', 'Days out', 'Due by', 'Days late', 'Status'].join(',')]
      .concat(rows.map((o) => [o.o, o.c, o.t, o.city, o.d, o.age, o.due || '', o.over, o.s].map(esc).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'late-parcels-' + A.as_of.slice(0, 10) + '.csv';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ---------- render: speed ----------
  function renderSpeed(a, first) {
    $('speed-say').textContent = a.sf <= a.sl
      ? 'Parcels handed over ' + fD(a.sf) + ' to ' + fD(a.sl, true) + '. Big figure: share delivered on promise (7 PM pickup within 24 hours, 9 AM pickup the same day). Below it: average days to deliver and parcels counted. Faded cells have under 20 parcels.'
      : 'This range is too recent: parcels need 5 days before their speed is final. Pick a range that ends a week or more ago.';
    const G = A.city_groups;
    table($('city-table'), [['Courier'], ...G.map((g) => [g, 'n']), ['All cities', 'n']], CS.map((c) => {
      const cell = (o) => {
        const t = el('td', 'n' + (o.pn < 20 ? ' dim' : ''));
        if (!o.pn) { t.textContent = o.n ? 'Not settled' : 'n/a'; return t; }
        t.append(el('div', 'cell-big', fPct(o.op)), el('div', 'small dim', fDay(o.avg) + ' days, ' + fInt(o.pn)));
        return t;
      };
      return [td(who(c)), ...G.map((g) => cell(a.city[c][g])), cell(a.by[c])];
    }), { animate: first });
    ckeys($('k-dot')); ckeys($('k-dist'));
    dotPlot($('ch-dot'), G.map((g) => ({ g, dots: CS.map((c) => ({ c, v: a.city[c][g].avg, n: a.city[c][g].sd })) })), { aria: 'Average days to deliver by city and courier' });
    groupBars($('ch-dist'), KLAB.map((k, i) => { const o = { k: k.replace(' or more', '+') }; CS.forEach((c) => { const b = a.by[c]; o[c] = b.sd ? b.b[i] / b.sd : null; }); return o; }), CS.filter((c) => a.by[c].sd), { aria: 'Share of delivered parcels by days to deliver' });
  }

  // ---------- render: returns ----------
  function renderReturns(a, p) {
    const box = $('connect');
    box.replaceChildren(...CS.map((c) => {
      const d = el('div', 'conn'); d.append(el('b', null, c));
      if (live(c)) d.append(el('span', 'state-on', 'Connected'), el('span', 'small muted', fInt(a.by[c].ssrc) + ' parcels in the range have courier tracking.'));
      else d.append(el('span', 'state-off', 'Not connected yet'), el('span', 'small muted', 'Adds returns, delivery attempts and reasons once the API key is added.'));
      return d;
    }));
    $('ret-live').hidden = !anyLive();
    if (anyLive()) {
      const pl = p ? prevLabel(a) : '';
      figs($('ret-figs'), [
        ...CS.map((c) => ({ label: c + ', return rate', value: a.by[c].rr == null ? null : a.by[c].rr * 100, fmt: (v) => v.toFixed(1), unit: '%', sub: live(c) ? fInt(a.by[c].sret) + ' returned of ' + fInt(a.by[c].sret + a.by[c].scdl) : 'Not connected', delta: p && live(c) && delta(a.by[c].rr, p.by[c].rr, 'pts', false, pl) })),
        { label: 'Delivered on the first attempt', value: a.all.far == null ? null : a.all.far * 100, fmt: (v) => Math.round(v), unit: '%', sub: 'Connected couriers only' },
      ]);
      ckeys($('k-ret'), CS.filter(live));
      const rs = series(hi(a.f, A.track_start), lo(a.t, add(MAX, -5)), (k, rows) => {
        const o = { k };
        CS.filter(live).forEach((c) => { const r = rows.filter((x) => x.c === c && x.src), out = d3.sum(r, (x) => (x.cdl || 0) + x.ret + x.rtn), ret = d3.sum(r, (x) => x.ret + x.rtn); o[c] = out >= 20 ? ret / out : null; o['n_' + c] = out; });
        return o;
      });
      lineChart($('ch-ret'), rs.rows, CS.filter(live), { aria: 'Return rate by courier over time', label: rs.bk.label, domain: [0, 0.3], tipv: (q) => fPct1(q.v) + ' of ' + fInt(q.n) + ' parcels' });
      const why = d3.rollups((D.reasons || []).filter((r) => r.d >= a.sf && r.d <= a.sl), (v) => d3.sum(v, (r) => r.n), (r) => r.r).sort((x, y) => y[1] - x[1]).slice(0, 8);
      const tot = d3.sum(why, (w) => w[1]);
      hbars($('ch-why'), why.map(([r, n]) => ({ label: r, v: n, txt: fInt(n) + ', ' + fPct(n / tot) })), { aria: 'Return reasons', lw: 190, emptyTitle: 'No reasons yet', emptyText: 'Reasons appear once returned parcels in this range have courier data.' });
    }
    const inv = (D.returns_month || []).filter((r) => r.return_rate != null);
    hbars($('ch-inv'), inv.map((r) => ({ label: r.courier + ', ' + r.month.replace(' 2026', ''), v: r.return_rate, txt: fPct1(r.return_rate) + (r.estimated ? ' est.' : ''), color: COL[r.courier], tip: [r.courier + ', ' + r.month, fPct1(r.return_rate) + ' returned', fInt(r.returns) + ' returns' + (r.delivered ? ' of ' + fInt(r.delivered + r.returns) : ''), r.estimated ? 'Estimated from the invoice' : 'From the invoice'] })), { aria: 'Return rate by courier and month from invoices', max: 0.2 });
    const rr = D.return_reasons || [];
    hbars($('ch-reason'), rr.map((r) => ({ label: r.reason, v: r.share, txt: fInt(r.returns) + ', ' + fPct(r.share), color: 'var(--color-qwqer)', tip: [r.reason, fInt(r.returns) + ' returns', 'Owner: ' + r.owner] })), { aria: 'Why QWQER parcels came back in October', lw: 220, max: 1 });
  }

  // ---------- render: pickups ----------
  function num(id, d) { const v = parseFloat($(id).value); return isNaN(v) || v < 0 ? d : v; }
  const fmtT = (mins) => { if (mins < 0) return 'Not possible'; const t = Math.floor(mins + 1e-9); return d3.timeFormat('%-I:%M %p')(new Date(2000, 0, 1, Math.floor(t / 60), t % 60)); };
  function cuts() {
    const plan = D.plan[0], mpo = num('c-min', plan.minutes_per_order), ecom = num('c-ecom', plan.ecom_minutes);
    return [[540, num('c-o9', plan.plan_9am), Math.max(1, num('c-pk9', plan.packers))], [1140, num('c-o7', plan.plan_7pm), Math.max(1, num('c-pk7', plan.packers))]]
      .map(([pick, orders, packers]) => { const pack = orders * mpo / packers; return { cut: pick - pack - ecom, start: pick - pack, pack }; });
  }
  function renderPickups(a) {
    const plan = D.plan[0], c = cuts(), s = a.slots;
    const leg = (time, title, text, avg, busy, cut, extra) => {
      const d = el('div', 'leg');
      d.append(el('p', 'leg-time', time), el('p', 'leg-title', title), el('p', null, text));
      const dl = el('dl');
      [['Average day', avg, false], ['Busy day', busy, false], ['Order cut-off', cut, true]].forEach(([k, v, isCut]) => {
        const w = el('div'); w.append(el('dt', null, k)); const dd = el('dd', isCut ? 'cut' : null);
        if (isCut) dd.textContent = v; else { dd.append(el('span')); tween(dd.firstChild, v, (x) => Math.round(x)); }
        w.append(dd); dl.append(w);
      });
      d.append(dl);
      if (extra) d.append(el('p', null, extra));
      return d;
    };
    const old = $('board');
    const legs = [
      leg('9:00 AM', 'QWQER, Lahore same day', 'Lahore orders placed after the previous afternoon cut-off and before the morning one.', s.am9.avg, s.am9.p90, fmtT(c[0].cut), 'Planned for ' + plan.plan_9am + ' orders. Busy day: 9 days in 10 are at or below it.'),
      leg('7:00 PM', 'QWQER Lahore next day, PostEx other cities', 'Lahore orders from the morning cut-off to the afternoon one, plus 24 hours of other-city orders.', s.pm7.avg, s.pm7.p90, fmtT(c[1].cut),
        'Lahore ' + (s.pm7_lhr.avg == null ? 'n/a' : s.pm7_lhr.avg.toFixed(1)) + ' and other cities ' + (s.pm7_other.avg == null ? 'n/a' : s.pm7_other.avg.toFixed(1)) + ' on an average day. Planned for ' + plan.plan_7pm + '.'),
    ];
    // keep figures tweening: reuse old nodes' last values
    if (old.children.length === 2) {
      [0, 1].forEach((i) => { const oldDd = old.children[i].querySelectorAll('dd span'), newDd = legs[i].querySelectorAll('dd span'); newDd.forEach((n, j) => { if (oldDd[j]) { const v = n._v; n._v = oldDd[j]._v; tween(n, v, (x) => Math.round(x)); } }); });
    }
    old.replaceChildren(...legs);
    $('pick-say').textContent = 'Orders that went to each pickup, ' + fD(a.f) + ' to ' + fD(a.t, true) + ' (' + a.ndays + ' days). Cancelled orders are left out. Weeks and months show the average day.';
    keys($('k-pick'), [['9 AM, Lahore same day', 'var(--color-qwqer)'], ['7 PM, Lahore next day', 'color-mix(in oklab, var(--color-qwqer) 55%, var(--color-paper))'], ['7 PM, other cities', 'var(--color-postex)']]);
    const bk = bucketer(a.f, a.t), m = new Map();
    a.days.forEach((r) => { const k = bk.key(r.d); if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
    const data = [...m.entries()].map(([k, v]) => ({ k, n: v.length, am9: d3.mean(v, (r) => r.am9), pm7_lhr: d3.mean(v, (r) => r.pm7_lhr), pm7_other: d3.mean(v, (r) => r.pm7_other) }));
    pickChart($('ch-pick'), data, { aria: 'Orders per pickup by ' + bk.word, label: bk.label, plan9: plan.plan_9am, plan7: plan.plan_7pm,
      tip: (d) => [(bk.kind === 'day' ? '' : 'Average day, ' + (bk.kind === 'week' ? 'week of ' : '')) + bk.label(d.k), '9 AM: ' + Math.round(d.am9), '7 PM: ' + Math.round(d.pm7_lhr + d.pm7_other) + ' (Lahore ' + Math.round(d.pm7_lhr) + ', other ' + Math.round(d.pm7_other) + ')'] });
    renderFlow();
  }
  function renderFlow() {
    const c = cuts(), [x, y] = c.map((o) => fmtT(o.cut));
    $('flow').replaceChildren(...[
      'Lahore orders up to ' + x + ' go out at 9 AM and arrive the same day. Packing starts ' + fmtT(c[0].start) + ' and takes ' + Math.round(c[0].pack) + ' minutes.',
      'Lahore orders from ' + x + ' to ' + y + ' go out at 7 PM and arrive the next day. Packing starts ' + fmtT(c[1].start) + ' and takes ' + Math.round(c[1].pack) + ' minutes.',
      'Lahore orders after ' + y + ' wait for the next 9 AM pickup.',
      'Other cities: orders up to ' + y + ' go out with PostEx at 7 PM; later ones the next evening.',
    ].map((t) => el('li', null, t)));
    const legs = $('board').querySelectorAll('dd.cut'); if (legs.length === 2) { legs[0].textContent = x; legs[1].textContent = y; }
  }
  function resetCalc() {
    const p = D.plan[0];
    $('c-min').value = p.minutes_per_order; $('c-ecom').value = p.ecom_minutes; $('c-pk9').value = p.packers; $('c-pk7').value = p.packers; $('c-o9').value = p.plan_9am; $('c-o7').value = p.plan_7pm;
    renderFlow();
  }
  document.querySelectorAll('#calc .input').forEach((i) => i.addEventListener('input', renderFlow));
  $('calc').addEventListener('submit', (e) => e.preventDefault());
  $('c-reset').addEventListener('click', resetCalc);

  // ---------- render: costs ----------
  function renderCosts(a, first) {
    const plan = D.plan[0], sc = D.scorecard || [], acts = D.actions || [];
    const sameDay = a.slots.am9.avg == null ? null : a.slots.am9.avg * plan.sameday_extra_per_parcel * plan.days_per_month;
    const q = sc.find((r) => r.courier === 'QWQER') || {}, x = sc.find((r) => r.courier === 'PostEx') || {};
    figs($('cost-figs'), [
      { label: 'QWQER, per delivered parcel', value: q.cost_delivered, fmt: (v) => fInt(v), unit: ' Rs', sub: q.cost_period ? 'Invoice, ' + q.cost_period : '' },
      { label: 'PostEx, per delivered parcel', value: x.cost_delivered, fmt: (v) => fInt(v), unit: ' Rs', sub: x.cost_period ? 'Invoice, ' + x.cost_period : '' },
      { label: 'Same-day pickup, extra a month', value: sameDay, fmt: (v) => fInt(v), unit: ' Rs', sub: 'At ' + (a.slots.am9.avg == null ? 'n/a' : a.slots.am9.avg.toFixed(1)) + ' orders a morning in this range' },
      { label: 'Savings on the table, a month', value: d3.sum(acts, (r) => r.saving), fmt: (v) => fInt(v), unit: ' Rs', hot: true, sub: acts.length + ' actions, listed below' },
    ]);
    table($('cost-table'), [['Courier'], ['Used for'], ['Per parcel sent', 'n'], ['Per delivered parcel', 'n'], ['Return rate', 'n'], ['Based on'], ['Verdict']],
      sc.map((r) => [td(who(r.courier)), td(r.used_for), td(fRs(r.cost_sent), 'n'), td(fRs(r.cost_delivered), 'n cell-big'), td(fPct1(r.return_rate), 'n'), td(r.return_basis + ' returns, ' + r.cost_period + ' costs', 'small dim'), td(r.verdict)]), { animate: first });
    table($('act-table'), [['Action'], ['Saving a month', 'n'], ['Owner'], ['Note']],
      acts.map((r) => [td(r.action), td(fRs(r.saving), 'n cell-big'), td(r.owner), td(r.note, 'small dim')]).concat([[td(el('b', null, 'Total')), td(fRs(d3.sum(acts, (r) => r.saving)), 'n cell-big'), td(''), td('')]]), { animate: first });
  }

  // ---------- render: bills ----------
  // The bill check (weights and rates, Jun onwards) lives in its own encrypted file and opens on first visit.
  let BILL = null, billLoading = null;
  function loadBill() {
    if (BILL) return Promise.resolve(BILL);
    if (window.TLC_PREVIEW_BILL) { BILL = window.TLC_PREVIEW_BILL; return Promise.resolve(BILL); }
    if (!billLoading) billLoading = decrypt(PW, 'bill.enc.json').then((b) => { BILL = b; return b; }).catch((e) => { billLoading = null; throw e; });
    return billLoading;
  }
  const BCS = ['QWQER', 'PostEx', 'Leopards'];
  const fMonth = (m) => d3.timeFormat('%b\u00a0%Y')(new Date(m + '-01T00:00:00'));
  const BILL_PARTS = [['hb-rel', 'rel', 'Release', 'var(--color-accent-deep)'], ['hb-cl', 'cl', 'Weight claim', 'var(--color-error)'], ['hb-bk', 'bk', 'Bulky, to confirm', 'var(--color-warn)'], ['hb-rt', 'rt', 'Rate, to confirm', 'var(--color-ink-2)']];
  function billSum(rows) {
    const o = { n: 0, chk: 0, billed: 0, cl_n: 0, cl: 0, bk_n: 0, bk: 0, rt: 0, hold: 0, rel: 0, p24: 0, lh_n: 0, lh: 0, kg_n: 0, kg: 0, odd_n: 0, odd: 0, typo: 0 };
    rows.forEach((r) => { for (const k in o) o[k] += r[k] || 0; });
    return o;
  }
  function hbar(o) {
    const s = el('div', 'hbar'), tot = o.billed || 1;
    s.setAttribute('role', 'img');
    s.setAttribute('aria-label', BILL_PARTS.map(([, k, l]) => l + ' ' + fPct(o[k] / tot)).join(', '));
    BILL_PARTS.forEach(([c, k]) => { const i = el('i', c); i.dataset.g = o[k] / tot; s.append(i); });
    s.addEventListener('pointermove', (ev) => tip.show(['Of ' + fRs(o.billed) + ' billed', ...BILL_PARTS.map(([, k, l]) => l + ': ' + fRs(o[k]) + ' (' + fPct(o[k] / tot) + ')')], ev));
    s.addEventListener('pointerleave', tip.hide);
    return s;
  }
  function growBars(root) {
    const go = () => root.querySelectorAll('.hbar i').forEach((x) => { x.style.flexGrow = x.dataset.g; });
    if (RM.matches) go(); else requestAnimationFrame(() => requestAnimationFrame(go));
  }
  const billRow = (label, o, bar) => [td(label), td(fRs(o.billed), 'n'), td(fRs(o.rel), 'n'), td(fRs(o.hold), 'n cell-big'),
    td(o.cl ? fRs(o.cl) + ' (' + fInt(o.cl_n) + ')' : '-', 'n'), td(o.bk ? fRs(o.bk) + ' (' + fInt(o.bk_n) + ')' : '-', 'n'), td(o.rt ? fRs(o.rt) : '-', 'n')].concat(bar ? [td(hbar(o))] : []);
  const BILL_HEAD = [['Courier'], ['Billed', 'n'], ['Release now', 'n'], ['Hold', 'n'], ['Weight claim (parcels)', 'n'], ['Bulky, to confirm (parcels)', 'n'], ['Rate, to confirm', 'n'], ['Share of the bill']];
  const objs = (keys, rows) => rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
  let BL = null, FX = null;
  function billLines() {
    const q = st.bq.trim().toLowerCase();
    return BL.filter((r) => r.kind === st.bk && (st.blc === 'all' || r.c === st.blc)
      && (!q || [r.o, r.t, r.city, r.items].some((v) => String(v || '').toLowerCase().includes(q))))
      .sort((a, b) => (b.typo - a.typo) || (b.over - a.over));
  }
  function fixRows() { return FX.filter((r) => st.fs === 'all' || r.status === st.fs); }
  const FIXLAB = { missing: 'Missing', off: 'Looks wrong', ok: 'Looks right', few: 'Too few parcels' };
  const kg = (v) => (v == null ? '-' : v.toFixed(2) + ' kg');

  function renderBills(first) {
    if (!BILL) {
      $('bill-say').textContent = 'Opening the bill check.';
      loadBill().then(() => { if (st.tab === 'bills') renderBills(true); })
        .catch(() => { $('bill-say').textContent = 'The bill check could not be opened. It is written at the next refresh, 11 AM or 6 PM; reload the page after that.'; });
      return;
    }
    const B = BILL, M = B.months;
    if (!BL) { BL = objs(B.line_keys, B.lines); FX = objs(B.fix_keys, B.fix); }
    const all = billSum(M), months = [...new Set(M.map((r) => r.m))].sort();
    const span = fMonth(months[0]) + ' to ' + fMonth(months[months.length - 1]);
    $('bill-count').textContent = all.cl_n ? fInt(all.cl_n) : '';
    figs($('bill-figs'), [
      { label: 'Billed, ' + span, value: all.billed, fmt: fInt, unit: ' Rs', sub: fInt(all.n) + ' parcels, before GST' },
      { label: 'Release now', value: all.rel, fmt: fInt, unit: ' Rs', sub: fPct(all.rel / all.billed) + ' of the bill checks out' },
      { label: 'Hold', value: all.hold, fmt: fInt, unit: ' Rs', hot: true, sub: fRs(all.hold * 1.16) + ' with 16% GST' },
      { label: 'Weight claims to send', value: all.cl, fmt: fInt, unit: ' Rs', alert: all.cl > 0, sub: fInt(all.cl_n) + ' parcels billed in a dearer weight slab' },
    ]);
    $('bill-say').textContent = 'Every courier parcel from ' + span + ', checked against our product weights and the rate cards. '
      + fInt(all.chk) + ' of ' + fInt(all.n) + ' parcels could be weight-checked. Updated ' + fD(B.as_of.slice(0, 10), true) + ', ' + d3.timeFormat('%-I:%M %p')(new Date('2000-01-01T' + B.as_of.slice(11, 16) + ':00')) + '. This tab does not follow the date range.';
    const rows = BCS.filter((c) => M.some((r) => r.c === c)).map((c) => {
      const lab = el('span'); lab.append(whoLink(c)); if (c === 'Leopards') lab.append(document.createTextNode(' '), el('span', 'tag', 'Estimated'));
      return billRow(lab, billSum(M.filter((r) => r.c === c)), true);
    });
    rows.push(billRow(el('b', null, 'Total'), all, true));
    table($('bill-table'), BILL_HEAD, rows, { animate: first });
    keys($('k-bill'), BILL_PARTS.map(([, , l, col]) => [l, col]));
    const qi = B.qwqer_invoice;
    $('bill-note').textContent = (qi ? 'QWQER’s ' + fMonth(qi.month) + ' invoice matches its API to the rupee on ' + fInt(qi.matched) + ' of ' + fInt(qi.lines) + ' lines. ' : '')
      + 'Leopards gives no charge in its API, so its amounts are estimated from the tariff; match them to its invoices before paying. '
      + 'Parcels that could not be weight-checked (split orders, products with too few single-item parcels) are released when their rate matches the card.';
    // month by month
    const mm = M.filter((r) => st.bc === 'all' || r.c === st.bc);
    const mrows = months.filter((m) => mm.some((r) => r.m === m)).map((m) => billRow(fMonth(m), billSum(mm.filter((r) => r.m === m))));
    mrows.push(billRow(el('b', null, 'Total'), billSum(mm)));
    table($('bill-month'), [['Month']].concat(BILL_HEAD.slice(1, -1)), mrows, { animate: first });
    pressSeg($('bf-c'), 'v', st.bc);
    // PostEx rate questions
    const px = billSum(M.filter((r) => r.c === 'PostEx'));
    $('bill-px').closest('.sec').hidden = !px.n;
    table($('bill-px'), [['Question'], ['Parcels', 'n'], ['Above the proposal', 'n'], ['Ask PostEx']], [
      [td('24% added to every proposal rate'), td(fInt(px.n), 'n'), td(fRs(px.p24), 'n cell-big'), td('Is it in the signed contract? The proposal has 0% fuel.', 'small dim')],
      [td('Lahore billed at the intercity rate'), td(fInt(px.lh_n), 'n'), td(fRs(px.lh), 'n cell-big'), td('Which rate was agreed for within Lahore: Rs 130 or 200/220?', 'small dim')],
      [td('Billed per kilogram, not flat to 4 kg'), td(fInt(px.kg_n), 'n'), td(fRs(px.kg), 'n cell-big'), td('Why these parcels left the flat rate.', 'small dim')],
      [td('Fees that match no rate'), td(fInt(px.odd_n), 'n'), td(fRs(px.odd), 'n cell-big'), td('A breakdown of each fee. Held in full.', 'small dim')],
    ], { animate: first });
    renderBillLines(); renderFix();
    $('bill-how').replaceChildren(...[
      ['Our weight', 'Shopify weights are blank or a few grams for most products, so each product’s normal packed weight is the median weight the couriers recorded for parcels holding only that item (3 or more such parcels).'],
      ['Flagged', 'Only when a parcel was billed in a dearer weight slab than our weight plus ' + B.tol + ' kg.'],
      ['Weight claim', 'Flat, dense items where size cannot explain the extra weight. Send these lines to the courier for credit.'],
      ['Bulky, to confirm', 'Pillows, fillers, duvets, toppers, quilted items, mattress protectors, blankets. The contract may allow billing by size, so they are held, not claimed. “Check first” marks parcels billed at 5 times our weight or more, which look like typing errors.'],
      ['Rate, to confirm', 'PostEx charges above its proposal rates. Held until the contract is checked.'],
      ['Limit', 'Our weight comes from the couriers’ own scales, so an across-the-board over-weighing would not show. Real weights in Shopify close this.'],
    ].concat((B.notes || []).map((n, i) => [i === 0 ? 'Rate cards' : '', n])).map(([t, d]) => { const w = el('div'); w.append(el('dt', null, t), el('dd', null, d)); return w; }));
    growBars($('p-bills'));
    requestAnimationFrame(() => ['bf-c', 'bl-k', 'bl-c', 'fx-s'].forEach((id) => placeInd($(id), true)));
  }
  function renderBillLines() {
    const rows = billLines(), shown = rows.slice(0, st.bshown);
    const tot = d3.sum(rows, (r) => r.over);
    $('bl-say').textContent = fInt(rows.length) + (st.bk === 'claim' ? ' parcels to claim, ' : ' bulky parcels to confirm, ') + fRs(tot) + ' over the contract charge at our weight. Biggest first.';
    table($('bill-lines'), [['Order'], ['Courier'], ['Handed over'], ['City'], ['Items'], ['Our weight', 'n'], ['Courier weight', 'n'], ['Billed', 'n'], ['Should be', 'n'], ['Over', 'n']],
      shown.map((r) => {
        const o = el('span'); o.append(document.createTextNode(r.o)); if (r.typo) o.append(document.createTextNode(' '), el('span', 'tag warn', 'Check first'));
        return [td(o), td(who(r.c)), td(fD(r.d, true), 'small'), td(r.city, 'small'), td(r.items, 'small dim'), td(kg(r.ref), 'n'), td(kg(r.cw), 'n'),
          td(fRs(r.billed), 'n'), td(r.should == null ? '-' : fRs(r.should), 'n'), td(fRs(r.over), 'n cell-big')];
      }));
    $('bl-more').hidden = rows.length <= st.bshown;
    pressSeg($('bl-k'), 'v', st.bk); pressSeg($('bl-c'), 'v', st.blc);
  }
  function renderFix() {
    const rows = fixRows(), shown = rows.slice(0, st.fshown), fc = BILL.fix_counts || {};
    $('fx-say').textContent = fInt(fc.missing || 0) + ' of ' + fInt(BILL.fix_total || 0) + ' products sold have no real weight in Shopify, and ' + fInt(fc.off || 0)
      + ' differ from their parcels by more than 30%. Most-ordered first; weigh one packed unit and enter it in Shopify. The suggested weight comes from the couriers’ scales.';
    table($('bill-fix'), [['Product'], ['Size'], ['SKU'], ['Orders', 'n'], ['Suggested', 'n'], ['Shopify now', 'n'], ['Status']],
      shown.map((r) => [td(r.title), td(r.size, 'small'), td(r.sku, 'small dim mono'), td(fInt(r.orders), 'n'), td(kg(r.suggested_kg), 'n cell-big'),
        td(r.shopify_kg == null ? '-' : r.shopify_kg.toFixed(3) + ' kg', 'n'), td(el('span', 'tag' + (r.status === 'missing' ? ' late' : r.status === 'off' ? ' warn' : ''), FIXLAB[r.status] || r.status))]));
    $('fx-more').hidden = rows.length <= st.fshown;
    pressSeg($('fx-s'), 'v', st.fs);
  }
  const segOn = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && BILL) fn(b.dataset.v); });
  segOn('bf-c', (v) => { st.bc = v; renderBills(false); });
  segOn('bl-k', (v) => { st.bk = v; st.bshown = 50; renderBillLines(); });
  segOn('bl-c', (v) => { st.blc = v; st.bshown = 50; renderBillLines(); });
  segOn('fx-s', (v) => { st.fs = v; st.fshown = 50; renderFix(); });
  $('bl-q').addEventListener('input', () => { st.bq = $('bl-q').value; st.bshown = 50; if (BILL) renderBillLines(); });
  $('bl-more').addEventListener('click', () => { st.bshown += 50; renderBillLines(); });
  $('fx-more').addEventListener('click', () => { st.fshown += 50; renderFix(); });
  function csvDown(name, head, rows) {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const blob = new Blob(['﻿' + [head.join(',')].concat(rows.map((r) => r.map(esc).join(','))).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '-' + BILL.as_of.slice(0, 10) + '.csv';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  $('bl-csv').addEventListener('click', () => { if (!BILL) return; csvDown(st.bk === 'claim' ? 'weight-claims' : 'bulky-to-confirm',
    ['Order', 'Courier', 'Tracking', 'Handed over', 'City', 'Items', 'Our weight kg', 'Courier weight kg', 'Billed Rs', 'Should be Rs', 'Over Rs', 'Check first'],
    billLines().map((r) => [r.o, r.c, r.t, r.d, r.city, r.items, r.ref, r.cw, r.billed, r.should, r.over, r.typo ? 'yes' : ''])); });
  $('fx-csv').addEventListener('click', () => { if (!BILL) return; csvDown('product-weights',
    ['SKU', 'Product', 'Size', 'Orders', 'Suggested kg', 'Shopify kg', 'Status'],
    fixRows().map((r) => [r.sku, r.title, r.size, r.orders, r.suggested_kg, r.shopify_kg, FIXLAB[r.status] || r.status])); });

  // ---------- courier tabs ----------
  const CKEY = { QWQER: 'qwqer', PostEx: 'postex', Leopards: 'leopards' };
  COL.All = 'var(--color-muted)';
  // targets the grades are measured against (TLC's own bar; change here)
  const TARGETS = {
    op: { label: 'Delivered on promise', good: 0.8, watch: 0.6, up: true, note: '9 AM pickup same day, 7 PM pickup within 24 hours' },
    pk: { label: 'Collected at the scheduled pickup', good: 0.95, watch: 0.85, up: true, note: 'Picked up at the pickup on the day we hand it over' },
    rr: { label: 'Came back', good: 0.1, watch: 0.13, up: false, note: 'Returned or on the way back' },
    fa: { label: 'Delivered on the first attempt', good: 0.9, watch: 0.85, up: true, note: 'Of parcels that reached an outcome' },
  };
  const GRADE = { good: 'On target', watch: 'Watch', bad: 'Act now' };
  function grade(k, v) {
    if (v == null || isNaN(v)) return null;
    const t = TARGETS[k];
    if (t.up) return v >= t.good ? 'good' : v >= t.watch ? 'watch' : 'bad';
    return v <= t.good ? 'good' : v <= t.watch ? 'watch' : 'bad';
  }
  const tgtText = (k) => { const t = TARGETS[k]; return 'Target ' + (t.up ? '' : 'under ') + fPct(t.good); };

  function courierAgg(rows) {
    const o = { n: 0, pn: 0, po: 0, pk: 0, pko: 0, ph: [0, 0, 0, 0], hb: [0, 0, 0, 0, 0], at: [0, 0, 0], ret: 0, cdl: 0, src: 0, sd: 0, sum: 0, b: [0, 0, 0, 0, 0, 0], rtn_n: 0, rtn_d: 0 };
    for (const r of rows) {
      o.n += r.n; o.pn += r.pn || 0; o.po += r.po || 0; o.pk += r.pk || 0; o.pko += r.pko || 0; o.src += r.src || 0;
      (r.ph || []).forEach((v, i) => { o.ph[i] += v; }); (r.hb || []).forEach((v, i) => { o.hb[i] += v; }); (r.at || []).forEach((v, i) => { o.at[i] += v; });
      o.ret += (r.ret || 0) + (r.rtn || 0); o.cdl += r.cdl || 0; o.sd += r.sd; o.sum += r.sum; r.b.forEach((v, i) => { o.b[i] += v; });
      o.rtn_n += r.rtn_n || 0; o.rtn_d += r.rtn_d || 0;
    }
    o.op = o.pn ? o.po / o.pn : null;
    o.pkr = o.pk ? o.pko / o.pk : null;
    o.rr = (o.cdl + o.ret) ? o.ret / (o.cdl + o.ret) : null;
    o.fa = d3.sum(o.at) ? o.at[0] / d3.sum(o.at) : null;
    o.avg = o.sd ? o.sum / o.sd : null;
    o.d24 = d3.sum(o.hb) ? (o.hb[0] + o.hb[1]) / d3.sum(o.hb) : null;
    o.rtd = o.rtn_n ? o.rtn_d / o.rtn_n : null;
    return o;
  }
  const crow = (c, f, t) => D.hand.filter((r) => r.c === c && r.d >= f && r.d <= t);

  function buildCourierPanel(c) {
    const k = CKEY[c], id = (s) => k + '-' + s;
    const P = el('section', 'panel-tab'); P.id = 'p-' + k; P.setAttribute('role', 'tabpanel'); P.setAttribute('aria-labelledby', 't-' + k); P.hidden = true;
    P.innerHTML = `
      <header class="c-hero">
        <div class="c-name"><span class="swatch c-sw"></span><h2></h2><span class="tag" id="${id('state')}"></span></div>
        <p class="c-role" id="${id('role')}"></p>
      </header>
      <section class="sec">
        <div class="sec-head"><h2>Scorecard</h2><p>Graded against TLC targets for the chosen dates. On target, Watch or Act now. The table below shows the last four months.</p></div>
        <div class="grades" id="${id('grades')}"></div>
        <div class="table-wrap"><table id="${id('months')}"></table></div>
      </section>
      <div class="figs" id="${id('figs')}"></div>
      <section class="sec">
        <div class="sec-head"><h2>Promise and speed</h2><p id="${id('speed-say')}"></p></div>
        <div class="two">
          <div class="block"><h3>On promise over time</h3><div class="keys" id="${id('k-op')}"></div><div class="chart" id="${id('ch-op')}"></div></div>
          <div class="block"><h3>Hours from collection to delivery</h3><div class="chart short" id="${id('ch-hb')}"></div></div>
        </div>
        <div class="two">
          <div class="block"><h3>By city</h3><div class="table-wrap"><table id="${id('groups')}"></table></div></div>
          <div class="block"><h3>Days from handover to delivery</h3><div class="chart short" id="${id('ch-days')}"></div></div>
        </div>
      </section>
      <section class="sec">
        <div class="sec-head"><h2>Pickup discipline</h2><p>Does the courier collect at the scheduled pickup on the day we hand the parcel over? A late collection eats into its own 24 hours.</p></div>
        <div class="two">
          <div class="block"><h3>When they collect</h3><div class="chart short" id="${id('ch-ph')}"></div></div>
          <div class="block"><h3>Collected at the scheduled pickup, over time</h3><div class="chart" id="${id('ch-pk')}"></div></div>
        </div>
      </section>
      <section class="sec">
        <div class="sec-head"><h2>Returns and attempts</h2><p id="${id('ret-say')}"></p></div>
        <div class="two">
          <div class="block"><h3>Return rate over time</h3><div class="keys" id="${id('k-rr')}"></div><div class="chart" id="${id('ch-rr')}"></div></div>
          <div class="block"><h3>Why parcels came back</h3><div class="chart" id="${id('ch-why')}"></div></div>
        </div>
        <div class="two">
          <div class="block"><h3>Delivery attempts</h3><div class="chart short" id="${id('ch-at')}"></div></div>
          <div class="block"><h3>Getting returns back</h3><div class="figs mini" id="${id('ret-figs')}"></div></div>
        </div>
      </section>
      <section class="sec">
        <div class="sec-head"><h2>Live parcels and cities</h2><p id="${id('live-say')}"></p></div>
        <div class="figs" id="${id('live-figs')}"></div>
        <div><button class="btn btn-secondary" type="button" id="${id('go-late')}">Open ${c}'s late parcels</button></div>
        <div class="block"><h3>Busiest cities</h3><p class="note" id="${id('city-say')}"></p><div class="table-wrap"><table id="${id('cities')}"></table></div></div>
      </section>`;
    P.querySelector('h2').textContent = c;
    P.querySelector('.c-sw').style.background = COL[c];
    P.querySelector('#' + id('go-late')).addEventListener('click', () => { st.lc = c; st.la = 'all'; st.shown = 50; pressSeg($('lf-c'), 'v', st.lc); pressSeg($('lf-a'), 'v', st.la); showTab('late'); window.scrollTo({ top: 0 }); });
    return P;
  }

  function gradeChip(k, v, fmt) {
    const g = grade(k, v), s = el('span', 'gchip' + (g ? ' g-' + g : ''), v == null ? 'n/a' : (fmt || fPct)(v));
    if (g) s.title = GRADE[g] + ' (' + tgtText(k) + ')';
    return s;
  }

  function renderCourier(c, a, first) {
    const k = CKEY[c], $$ = (s) => $(k + '-' + s);
    const rows = crow(c, a.f, a.t), srows = crow(c, a.sf, a.sl), o = courierAgg(srows), all = courierAgg(D.hand.filter((r) => r.d >= a.sf && r.d <= a.sl));
    const n = d3.sum(rows, (r) => r.n), share = a.tot ? n / a.tot : null;
    // header
    const sc = (D.scorecard || []).find((r) => r.courier === c) || {};
    const lastDay = d3.max(D.hand.filter((r) => r.c === c && r.n > 0), (r) => r.d);
    const paused = lastDay && span(lastDay, MAX) > 4;
    $$('state').textContent = paused ? 'Paused, last parcel ' + fD(lastDay) : 'Active';
    $$('state').className = 'tag' + (paused ? ' late' : ' on');
    $$('role').textContent = (sc.used_for ? sc.used_for + '. ' : '') + fInt(n) + ' parcels handed over ' + fD(a.f) + ' to ' + fD(a.t, true) + (share != null ? ', ' + fPct(share) + ' of all parcels.' : '.');
    // scorecard
    const G = [['op', o.op], ['pk', o.pkr], ['rr', o.rr], ['fa', o.fa]];
    $$('grades').replaceChildren(...G.map(([key, v]) => {
      const t = TARGETS[key], g = grade(key, v), box = el('div', 'grade' + (g ? ' g-' + g : ''));
      const vv = el('p', 'grade-v'); vv.append(el('span')); tween(vv.firstChild, v == null ? null : v * 100, (x) => Math.round(x)); vv.append(el('small', null, v == null ? '' : '%'));
      box.append(el('p', 'grade-l', t.label), vv, el('p', 'grade-g', g ? GRADE[g] : 'Not enough parcels'), el('p', 'grade-t', tgtText(key) + '. ' + t.note));
      return box;
    }));
    const end = a.t.slice(0, 7), months = [];
    for (let i = 3; i >= 0; i--) { const dd = P(end + '-01'); dd.setUTCMonth(dd.getUTCMonth() - i); months.push(S(dd).slice(0, 7)); }
    table($$('months'), [['Month'], ['Parcels', 'n'], ['On promise', 'n'], ['Collected on time', 'n'], ['Came back', 'n'], ['First attempt', 'n'], ['Average days', 'n']],
      months.filter((m) => D.hand.some((x) => x.c === c && x.n > 0 && x.d.slice(0, 7) === m)).map((m) => {
        const r = D.hand.filter((x) => x.c === c && x.d.slice(0, 7) === m && x.d <= add(MAX, -5)), q = courierAgg(r), part = m === MAX.slice(0, 7);
        return [td(MON[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4) + (part ? ', so far' : '')), td(fInt(d3.sum(D.hand.filter((x) => x.c === c && x.d.slice(0, 7) === m), (x) => x.n)), 'n'),
          td(gradeChip('op', q.op), 'n'), td(gradeChip('pk', q.pkr), 'n'), td(gradeChip('rr', q.rr, fPct1), 'n'), td(gradeChip('fa', q.fa), 'n'), td(fDay(q.avg), 'n')];
      }), { animate: first });
    // figures
    const open = OPEN.filter((x) => x.c === c), late = open.filter((x) => lateIn(x, '14'));
    figs($$('figs'), [
      { label: 'Parcels handed over', value: n, sub: share == null ? '' : fPct(share) + ' of all parcels' },
      { label: 'Delivered within 24 h of collection', value: o.d24 == null ? null : o.d24 * 100, fmt: (v) => Math.round(v), unit: '%', sub: 'All couriers ' + fPct(all.d24) },
      { label: 'Average days to deliver', value: o.avg, fmt: (v) => v.toFixed(1), unit: ' days', sub: 'All couriers ' + fDay(all.avg) + ' days' },
      { label: 'Late now', value: late.length, alert: late.length > 0, sub: fInt(open.filter((x) => x.st !== 'returning').length) + ' still out' },
    ]);
    // promise and speed
    $$('speed-say').textContent = a.sf <= a.sl ? 'Parcels handed over ' + fD(a.sf) + ' to ' + fD(a.sl, true) + '. The grey line is all couriers together.' : 'This range is too recent; parcels need 5 days to settle.';
    keys($$('k-op'), [[c, COL[c]], ['All couriers', COL.All]]);
    const tr = series(hi(a.f, A.track_start), lo(a.t, add(MAX, -5)), (key, rs) => {
      const x = rs.filter((r) => r.c === c), pn = d3.sum(x, (r) => r.pn || 0), pnA = d3.sum(rs, (r) => r.pn || 0);
      const pk = d3.sum(x, (r) => r.pk || 0), out = d3.sum(x, (r) => (r.cdl || 0) + r.ret + r.rtn), outA = d3.sum(rs, (r) => (r.cdl || 0) + r.ret + r.rtn);
      return { k: key, [c]: pn >= 10 ? d3.sum(x, (r) => r.po || 0) / pn : null, ['n_' + c]: pn, All: pnA >= 10 ? d3.sum(rs, (r) => r.po || 0) / pnA : null, n_All: pnA,
        pk: pk >= 10 ? d3.sum(x, (r) => r.pko || 0) / pk : null, n_pk: pk,
        rr: out >= 10 ? d3.sum(x, (r) => r.ret + r.rtn) / out : null, n_rr: out, rrA: outA >= 10 ? d3.sum(rs, (r) => r.ret + r.rtn) / outA : null, n_rrA: outA };
    });
    const tooRecent = hi(a.f, A.track_start) > lo(a.t, add(MAX, -5));
    if (tooRecent) ['ch-op', 'ch-pk', 'ch-rr'].forEach((x) => empty($$(x), 'Too recent', 'Parcels need 5 days to settle. Pick a range that ends a week or more ago.'));
    else {
      lineChart($$('ch-op'), tr.rows, [c, 'All'], { aria: c + ' share delivered on promise over time', label: tr.bk.label, tipv: (q) => fPct(q.v) + ' on promise, of ' + fInt(q.n) });
      lineChart($$('ch-pk'), tr.rows.map((r) => ({ k: r.k, [c]: r.pk, ['n_' + c]: r.n_pk })), [c], { aria: c + ' collected at the scheduled pickup over time', label: tr.bk.label, tipv: (q) => fPct(q.v) + ' collected on time, of ' + fInt(q.n) });
      lineChart($$('ch-rr'), tr.rows.map((r) => ({ k: r.k, [c]: r.rr, ['n_' + c]: r.n_rr, All: r.rrA, n_All: r.n_rrA })), [c, 'All'], { aria: c + ' return rate over time', label: tr.bk.label, domain: [0, 0.3], tipv: (q) => fPct1(q.v) + ' came back, of ' + fInt(q.n) });
    }
    const HB = ['Within 12 hours', '12 to 24 hours', '1 to 2 days', '2 to 3 days', 'Over 3 days'], hbT = d3.sum(o.hb);
    hbars($$('ch-hb'), hbT ? o.hb.map((v, i) => ({ label: HB[i], v: v / hbT, txt: fPct(v / hbT) + ', ' + fInt(v), color: i < 2 ? 'var(--color-accent-deep)' : i === 4 ? 'var(--color-error)' : COL[c] })) : [], { aria: 'Hours from collection to delivery', max: 1, emptyTitle: 'No collection times', emptyText: 'Courier pickup scans are needed for this chart.' });
    const bT = d3.sum(o.b);
    hbars($$('ch-days'), bT ? o.b.map((v, i) => ({ label: KLAB[i], v: v / bT, txt: fPct(v / bT) + ', ' + fInt(v), color: i < 2 ? 'var(--color-accent-deep)' : i === 5 ? 'var(--color-error)' : COL[c] })) : [], { aria: 'Days from handover to delivery', max: 1, emptyTitle: 'No delivered parcels', emptyText: 'Nothing settled in this range.' });
    table($$('groups'), [['City'], ['Parcels', 'n'], ['On promise', 'n'], ['Average days', 'n'], ['Came back', 'n']],
      A.city_groups.map((g) => { const q = courierAgg(srows.filter((r) => r.g === g)); return [td(g), td(fInt(d3.sum(rows.filter((r) => r.g === g), (r) => r.n)), 'n'), td(q.pn >= 10 ? gradeChip('op', q.op) : el('span', 'dim', q.pn ? fPct(q.op) : 'n/a'), 'n'), td(fDay(q.avg), 'n'), td(q.cdl + q.ret >= 10 ? gradeChip('rr', q.rr, fPct1) : el('span', 'dim', 'n/a'), 'n')]; })
        .filter((r, i) => d3.sum(rows.filter((x) => x.g === A.city_groups[i]), (x) => x.n) > 0), { animate: first });
    // pickup
    const PH = ['Morning, 6 AM to 3 PM', 'Afternoon, 3 to 8 PM', 'Evening, 8 PM to midnight', 'After midnight'], phT = d3.sum(o.ph);
    hbars($$('ch-ph'), phT ? o.ph.map((v, i) => ({ label: PH[i], v: v / phT, txt: fPct(v / phT) + ', ' + fInt(v), color: COL[c] })) : [], { aria: 'When ' + c + ' collects parcels', max: 1, lw: 190, emptyTitle: 'No pickup scans', emptyText: 'The courier has not reported collection times in this range.' });
    // returns
    const rsn = d3.rollups((D.reasons || []).filter((r) => r.c === c && r.d >= a.sf && r.d <= a.sl), (v) => d3.sum(v, (r) => r.n), (r) => r.r).sort((x, y) => y[1] - x[1]);
    const rT = d3.sum(rsn, (x) => x[1]);
    hbars($$('ch-why'), rsn.slice(0, 8).map(([r, v]) => ({ label: r, v, txt: fInt(v) + ', ' + fPct(v / rT), color: COL[c] })), { aria: 'Why ' + c + ' parcels came back', lw: 200, emptyTitle: 'No reasons yet', emptyText: 'No returned parcels with a reason in this range.' });
    const atT = d3.sum(o.at);
    hbars($$('ch-at'), atT ? ['First attempt', 'Second attempt', 'Third or later'].map((l, i) => ({ label: l, v: o.at[i] / atT, txt: fPct(o.at[i] / atT) + ', ' + fInt(o.at[i]), color: i ? 'var(--color-warn)' : 'var(--color-accent-deep)' })) : [], { aria: c + ' delivery attempts', max: 1 });
    keys($$('k-rr'), [[c, COL[c]], ['All couriers', COL.All]]);
    $$('ret-say').textContent = o.rr == null ? 'No settled parcels in this range.' : fPct1(o.rr) + ' of ' + c + ' parcels came back (all couriers ' + fPct1(all.rr) + '). ' + (rsn.length ? 'Main reason: ' + rsn[0][0].toLowerCase() + ', ' + fPct(rsn[0][1] / rT) + '.' : '');
    const back = open.filter((x) => x.st === 'returning').length;
    figs($$('ret-figs'), [
      { label: 'Days from collection to back with us', value: o.rtd, fmt: (v) => v.toFixed(1), unit: ' days', sub: 'All couriers ' + fDay(all.rtd) + ' days' },
      { label: 'On the way back now', value: back, sub: 'Stock not yet back in the warehouse' },
    ]);
    // live parcels and cities
    const waiting = open.filter((x) => x.st === 'awaiting_pickup');
    $$('live-say').textContent = 'Live counts as of ' + fD(A.as_of.slice(0, 10)) + ', ' + A.as_of.slice(11) + '. These do not follow the date range.';
    figs($$('live-figs'), [
      { label: 'Still out', value: open.length - back, sub: 'Not delivered, not returning' },
      { label: 'Late now', value: late.length, alert: late.length > 0, sub: 'Past the promise, last 14 days' },
      { label: 'Booked, not collected', value: waiting.length, alert: waiting.some((x) => x.age >= 2), sub: waiting.length ? 'Oldest ' + fInt(d3.max(waiting, (x) => x.age)) + ' days' : 'Nothing waiting' },
      { label: 'On the way back', value: back, sub: 'Returning to the warehouse' },
    ]);
    const m0 = a.f.slice(0, 7), m1 = a.t.slice(0, 7);
    const cr = d3.rollups((D.cities || []).filter((r) => r.c === c && r.m >= m0 && r.m <= m1), (v) => ({ n: d3.sum(v, (r) => r.n), pn: d3.sum(v, (r) => r.pn), po: d3.sum(v, (r) => r.po), dl: d3.sum(v, (r) => r.dl), ret: d3.sum(v, (r) => r.ret) }), (r) => r.city)
      .sort((x, y) => y[1].n - x[1].n).slice(0, 12);
    $$('city-say').textContent = 'By calendar month, ' + MON[+m0.slice(5) - 1] + (m0 === m1 ? '' : ' to ' + MON[+m1.slice(5) - 1]) + ' ' + m1.slice(0, 4) + ', the 12 busiest cities for ' + c + '.';
    if (!cr.length) { $$('cities').replaceChildren(); return; }
    table($$('cities'), [['City'], ['Parcels', 'n'], ['On promise', 'n'], ['Came back', 'n']],
      cr.map(([city, v]) => [td(city), td(fInt(v.n), 'n'), td(v.pn >= 10 ? gradeChip('op', v.po / v.pn) : el('span', 'dim', v.pn ? fPct(v.po / v.pn) : 'n/a'), 'n'), td(v.dl + v.ret >= 10 ? gradeChip('rr', v.ret / (v.dl + v.ret), fPct1) : el('span', 'dim', 'n/a'), 'n')]), { animate: first });
  }

  // ---------- range bar, tabs ----------
  function placeInd(seg, instant) {
    const ind = seg.querySelector('.seg-ind, .tab-ind'), on = seg.querySelector('[aria-pressed="true"], [aria-selected="true"]');
    if (!ind || !on) return;
    if (instant) ind.style.transition = 'none';
    ind.style.transform = 'translateX(' + on.offsetLeft + 'px) scaleX(' + (on.offsetWidth / 100) + ')';
    if (instant) { void ind.offsetWidth; ind.style.transition = ''; }
  }
  function pressSeg(seg, attr, v) { seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === v))); placeInd(seg); }
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    st.p = b.dataset.p;
    if (st.p === 'c') { $('custom').hidden = false; }
    update();
  });
  ['from', 'to'].forEach((id) => $(id).addEventListener('change', () => {
    let f = $('from').value, t = $('to').value;
    if (!f || !t) return;
    if (f > t) { [f, t] = [t, f]; }
    st.p = 'c'; st.from = f; st.to = t; update();
  }));
  $('lf-c').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.lc = b.dataset.v; st.shown = 50; pressSeg($('lf-c'), 'v', st.lc); renderLate(false); });
  $('lf-a').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; st.la = b.dataset.v; st.shown = 50; pressSeg($('lf-a'), 'v', st.la); renderLate(false); });

  const done = new Set();
  function showTab(name, focus) {
    st.tab = name;
    TABS.forEach((t) => {
      const on = t === name, b = $('t-' + t), pnl = $('p-' + t);
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      if (on && pnl.hidden) { pnl.hidden = false; if (!RM.matches) { pnl.classList.remove('enter'); void pnl.offsetWidth; pnl.classList.add('enter'); } }
      else if (!on) pnl.hidden = true;
    });
    placeInd($('tabs'));
    if (focus) $('t-' + name).focus();
    renderTab(name);
    writeHash();
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('.tab'); if (b) showTab(b.dataset.tab); });
  $('tabs').addEventListener('keydown', (e) => {
    const i = TABS.indexOf(st.tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); showTab(TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length], true); }
    if (e.key === 'Home') { e.preventDefault(); showTab(TABS[0], true); }
    if (e.key === 'End') { e.preventDefault(); showTab(TABS[TABS.length - 1], true); }
  });

  function renderTab(name) {
    const a = agg(st.from, st.to), p = prevOf(st.from, st.to), first = !done.has(name);
    done.add(name);
    if (name === 'overview') renderOverview(a, p, first);
    else if (name === 'late') renderLate(first);
    else if (name === 'speed') renderSpeed(a, first);
    else if (name === 'returns') renderReturns(a, p);
    else if (name === 'pickups') renderPickups(a);
    else if (name === 'costs') renderCosts(a, first);
    else if (name === 'bills') renderBills(first);
    else { const c = CS.find((x) => CKEY[x] === name); if (c) renderCourier(c, a, first); }
  }
  function update() {
    resolveRange();
    pressSeg($('presets'), 'p', st.p);
    $('custom').hidden = st.p !== 'c';
    $('from').value = st.from; $('to').value = st.to;
    const n = span(st.from, st.to);
    $('range-say').replaceChildren(el('b', null, fD(st.from, st.from.slice(0, 4) !== st.to.slice(0, 4)) + ' to ' + fD(st.to, true)), document.createTextNode(', ' + n + (n === 1 ? ' day' : ' days')));
    writeHash();
    renderTab(st.tab);
  }

  function fresh() {
    const when = A.as_of ? fD(A.as_of.slice(0, 10)) + ', ' + d3.timeFormat('%-I:%M %p')(new Date('2000-01-01T' + A.as_of.slice(11) + ':00')) : (D.meta && D.meta[0] && D.meta[0].refreshed) || '';
    const h = +(A.as_of || '').slice(11, 13);
    const next = isNaN(h) ? '' : h < 18 ? ' Next update 6 PM.' : ' Next update 11 AM.';
    $('fresh').textContent = 'Updated ' + when + '.' + next;
    $('foot-fresh').textContent = 'Updated ' + when + ', refreshes daily at 11 AM and 6 PM PKT. Order data runs to the end of ' + fD(MAX, true) + '.';
  }

  function failOld() {
    TABS.forEach((t) => { $('p-' + t).hidden = true; });
    $('rangebar').hidden = true; $('tabs').hidden = true;
    const f = $('fail'); f.hidden = false;
    f.replaceChildren(el('h2', null, 'New data on its way'), el('p', null, 'This version of the dashboard needs the new data file. It is written at the next refresh, 11 AM or 6 PM. Reload the page after that.'));
  }

  function boot() {
    if (booted) { update(); return; }
    booted = true;
    if (!D || D.v !== 2 || !D.daily || !D.hand) { failOld(); return; }
    A = D.app[0]; MIN = D.daily.length ? D.daily[0].d : A.hist_start; MAX = A.data_to;
    if (!$('p-qwqer')) CS.forEach((c) => $('main').insertBefore(buildCourierPanel(c), $('p-late')));
    $('from').min = $('to').min = MIN; $('from').max = $('to').max = MAX;
    cache.clear(); done.clear(); prepOpen(); fresh(); resetCalc();
    readHash();
    pressSeg($('lf-c'), 'v', st.lc); pressSeg($('lf-a'), 'v', st.la);
    resolveRange();
    $('late-count').textContent = (() => { const n = OPEN.filter((o) => lateIn(o, '14')).length; return n ? fInt(n) : ''; })();
    showTab(st.tab);
    update();
    requestAnimationFrame(() => { placeInd($('presets'), true); placeInd($('tabs'), true); placeInd($('lf-c'), true); placeInd($('lf-a'), true); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { ['presets', 'tabs', 'lf-c', 'lf-a'].forEach((id) => placeInd($(id), true)); });
  }

  let rz;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      if (!D || !A) return;
      ['presets', 'tabs', 'lf-c', 'lf-a'].forEach((id) => placeInd($(id), true));
      document.querySelectorAll('.chart').forEach((c) => { c.__svg = null; });
      renderTab(st.tab);
    }, 160);
  });
  window.addEventListener('hashchange', () => { if (!A) return; const prev = st.tab; readHash(); if (st.tab !== prev) showTab(st.tab); else update(); });

  if (window.TLC_PREVIEW) { D = window.TLC_PREVIEW; $('lock').hidden = true; $('app').hidden = false; boot(); return; }
  const saved = store.get();
  if (saved) unlock(saved, true); else $('pw').focus();
})();

/* Preview hook: a page that defines window.TLC_PREVIEW (sample data, used only for design review) opens without a password. */
