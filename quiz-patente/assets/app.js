// Quiz patente B: simulazioni, ripasso a intervalli, capitoli, piano fino all'esame.
(function () {
  const { el, renderTF, enhanceLesson } = window.TF;
  const DAY = 864e5;
  const dayNum = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  const EXAM_DAY = dayNum(new Date(2026, 10, 6));
  const today = () => dayNum(new Date());
  // Giorni di attesa per scatola: 1 = sbagliata l'ultima volta, 5 = consolidata.
  const INTERVALS = [0, 1, 2, 4, 7, 14];
  const LESSONS = [
    { id: '0001', file: 'lessons/0001-parole-trappola.html', title: 'Parole assolute: indizio, non regola', mins: 6 },
  ];
  const REFS = [
    { file: 'reference/0001-aggiornamenti-2024.html', title: 'Cosa è cambiato con il nuovo codice (dic. 2024)' },
    { file: 'reference/0002-parole-assolute.html', title: 'Parole assolute in una pagina' },
  ];
  const LS = 'qp-state-v1';

  let CH = [], QS = {}, TOTAL = 0;
  let state = { v: 1, q: {}, sims: [], acts: {}, lessons: {} };
  let docRef = null, sync = 'local', saveTimer = null, writing = false, dirty = false;
  let timerId = null;
  const app = document.getElementById('app');

  // ---------- storage ----------
  function loadLocal() { try { return JSON.parse(localStorage.getItem(LS)); } catch { return null; } }
  function saveLocal() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch { /* storage off */ } }
  function merge(other) {
    if (!other || typeof other !== 'object') return;
    for (const [id, e] of Object.entries(other.q || {})) {
      const m = state.q[id];
      if (!m || e[2] > m[2] || (e[2] === m[2] && e[1] > m[1])) state.q[id] = e;
    }
    const seen = new Set(state.sims.map((s) => s.t));
    for (const s of other.sims || []) if (!seen.has(s.t)) state.sims.push(s);
    state.sims.sort((a, b) => a.t - b.t);
    for (const [d, a] of Object.entries(other.acts || {})) {
      const m = state.acts[d] || {};
      state.acts[d] = { sims: Math.max(m.sims || 0, a.sims || 0), rev: Math.max(m.rev || 0, a.rev || 0), prac: Math.max(m.prac || 0, a.prac || 0) };
    }
    Object.assign(state.lessons, other.lessons || {});
  }
  function save() {
    saveLocal();
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 2500);
  }
  async function flush() {
    if (!docRef || writing || !dirty) return;
    writing = true; dirty = false;
    try {
      await docRef.set({ ...state, summary: summary(), updatedAt: new Date().toISOString() });
      setSync('cloud');
    } catch (e) {
      if (e && (e.code === 'invalid_argument' || e.code === 'revoked' || e.code === 'not_granted')) { docRef = null; setSync('local'); }
      else dirty = true;
    } finally {
      writing = false;
      if (dirty && docRef) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, 5000); }
    }
  }
  async function initDb() {
    try {
      if (!window.claude || !window.claude.use) return;
      const db = await window.claude.use('db');
      if (!db) return;
      const ref = db.doc('progress/state');
      const snap = await ref.get();
      docRef = ref;
      if (snap.exists) { merge(snap.data()); saveLocal(); }
      setSync('cloud');
      if (current.view === 'home') go('home');
    } catch { setSync('local'); }
  }
  function setSync(s) {
    sync = s;
    const n = document.getElementById('sync');
    if (n) n.textContent = syncText();
  }
  const syncText = () => sync === 'cloud' ? 'Progressi salvati sul tuo account Claude.' : 'Progressi salvati solo su questo dispositivo.';
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  // ---------- data ----------
  async function loadData() {
    const res = await fetch('data/quiz.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const raw = await res.json();
    CH = raw.map((c) => {
      const ids = [];
      for (const s of c.subs) for (const [id, text, a, img] of s.qs) {
        QS[id] = { id, text, a, img, ch: c.id, sub: s.id };
        ids.push(id);
      }
      return { id: c.id, name: c.name, ids, subs: c.subs.map((s) => ({ id: s.id, ids: s.qs.map((q) => q[0]) })) };
    });
    TOTAL = Object.keys(QS).length;
  }
  const subIds = (q) => CH.find((c) => c.id === q.ch).subs.find((s) => s.id === q.sub).ids;

  // ---------- learning model ----------
  function record(id, ok) {
    const e = state.q[id] ? state.q[id].slice() : [0, 0, 0, 0]; // [scatola, ultimo giorno, viste, errori]
    const isNew = e[2] === 0;
    e[2]++;
    if (!ok) { e[3]++; e[0] = 1; }
    else e[0] = isNew ? 3 : Math.min(5, Math.max(1, e[0]) + 1);
    e[1] = today();
    state.q[id] = e;
  }
  function act(field, n) {
    const d = today();
    const a = state.acts[d] || { sims: 0, rev: 0, prac: 0 };
    a[field] += n || 1;
    state.acts[d] = a;
  }
  const todayActs = () => state.acts[today()] || { sims: 0, rev: 0, prac: 0 };
  // Only questions missed at least once come back for review.
  function dueIds() {
    const t = today();
    return Object.entries(state.q)
      .filter(([id, e]) => QS[id] && e[3] > 0 && e[0] < 5 && t >= e[1] + INTERVALS[e[0]])
      .sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1])
      .map(([id]) => id);
  }
  function chapterStats(c) {
    let seen = 0, wrongNow = 0;
    for (const id of c.ids) { const e = state.q[id]; if (e) { seen++; if (e[0] === 1) wrongNow++; } }
    return { seen, wrongNow, err: seen ? wrongNow / seen : null, share: (c.ids.length / TOTAL) * 30 };
  }
  function weakest() {
    const rows = CH.map((c) => ({ c, s: chapterStats(c) }));
    const tried = rows.filter((r) => r.s.seen >= 5 && r.s.wrongNow > 0);
    if (tried.length) return tried.sort((a, b) => b.s.err * b.s.share - a.s.err * a.s.share)[0].c;
    return rows.sort((a, b) => a.s.seen - b.s.seen)[0].c;
  }
  function passProb(avgErr) {
    const p = Math.min(0.999, avgErr / 30);
    let P = 0, C = 1;
    for (let k = 0; k <= 3; k++) { if (k > 0) C = (C * (30 - k + 1)) / k; P += C * p ** k * (1 - p) ** (30 - k); }
    return P;
  }
  function readiness() {
    const last = state.sims.slice(-5);
    if (last.length < 3) return null;
    const avg = last.reduce((s, x) => s + x.e, 0) / last.length;
    return { avg, p: passProb(avg), n: last.length };
  }
  function summary() {
    const chapters = {};
    for (const c of CH) { const s = chapterStats(c); if (s.seen) chapters[c.id] = { seen: s.seen, wrongNow: s.wrongNow }; }
    return { chapters, due: dueIds().length, lastSims: state.sims.slice(-10).map((s) => ({ d: s.d, e: s.e })) };
  }
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function buildExam() {
    // Proportional to chapter size, largest remainder. Approximates the real draw.
    const raw = CH.map((c) => ({ c, x: (c.ids.length / TOTAL) * 30 }));
    raw.forEach((r) => { r.n = Math.floor(r.x); r.rem = r.x - r.n; });
    let left = 30 - raw.reduce((s, r) => s + r.n, 0);
    raw.slice().sort((a, b) => b.rem - a.rem).slice(0, left).forEach((r) => r.n++);
    const out = [];
    for (const r of raw) out.push(...shuffle(r.c.ids.slice()).slice(0, r.n));
    return shuffle(out);
  }
  function buildPractice(c, n) {
    const t = today();
    const wrong = [], fresh = [], rest = [];
    for (const id of c.ids) {
      const e = state.q[id];
      if (!e) fresh.push(id);
      else if (e[0] === 1 || (e[3] > 0 && t >= e[1] + INTERVALS[e[0]])) wrong.push(id);
      else rest.push(id);
    }
    const pick = shuffle(wrong).slice(0, Math.ceil(n / 2));
    pick.push(...shuffle(fresh).slice(0, n - pick.length));
    pick.push(...shuffle(rest).slice(0, n - pick.length));
    return shuffle(pick);
  }

  // ---------- plan ----------
  function plan() {
    const L = EXAM_DAY - today();
    const a = todayActs();
    const due = dueIds().length;
    const w = weakest();
    const l1 = state.lessons['0001'];
    if (L < 0) return { phase: 'Esame passato', note: 'Se è andato male, dal Portale dell\'Automobilista puoi vedere gli errori commessi: portali qui e ripartiamo da quelli.', todo: [] };
    if (L === 0) return { phase: 'Giorno dell\'esame', note: 'Niente quiz nuovi oggi. Leggi ogni frase fino in fondo, cerca la parola che la rende falsa, e usa tutti i 20 minuti per ricontrollare.', todo: [] };
    const freshWrong = Object.values(state.q).filter((e) => e[0] === 1 && e[1] === today()).length;
    const rev = { t: due ? `Ripassa le ${due} domande sbagliate in scadenza` : freshWrong ? `Ripasso: le ${freshWrong} sbagliate oggi tornano domani` : 'Nessun ripasso in scadenza', done: due === 0 || a.rev >= 40, go: () => startReview() };
    if (L >= 16) return {
      phase: 'Fase 1 · Diagnosi', note: 'Prima di studiare bisogna sapere dove perdi i punti. Due simulazioni complete oggi danno 60 risposte distribuite su tutti i capitoli.',
      todo: [
        { t: 'Lezione 1: parole assolute (6 minuti)', done: !!l1, go: () => openLesson(LESSONS[0]) },
        { t: `Simulazioni d'esame: ${Math.min(a.sims, 2)} di 2`, done: a.sims >= 2, go: () => startExam() },
        rev,
      ],
    };
    if (L >= 4) return {
      phase: 'Fase 2 · Punti deboli', note: 'Ogni giorno: ripasso degli errori, un capitolo debole, una simulazione per misurare.',
      todo: [
        rev,
        { t: `Allenamento: ${w.name} (20 domande)`, done: a.prac >= 20, go: () => startPractice(w) },
        { t: `Simulazione d'esame: ${Math.min(a.sims, 1)} di 1`, done: a.sims >= 1, go: () => startExam() },
      ],
    };
    if (L >= 2) return {
      phase: 'Fase 3 · Rodaggio', note: 'Solo simulazioni e ripasso. Obiettivo: le ultime 5 simulazioni con al massimo 1 errore di media.',
      todo: [rev, { t: `Simulazioni d'esame: ${Math.min(a.sims, 3)} di 3`, done: a.sims >= 3, go: () => startExam() }],
    };
    return {
      phase: 'Vigilia', note: 'Ripasso leggero e una sola simulazione. Poi basta: il sonno conta più dell\'ultima ora di quiz.',
      todo: [rev, { t: 'Una simulazione d\'esame', done: a.sims >= 1, go: () => startExam() }],
    };
  }

  // ---------- views ----------
  let current = { view: 'home' };
  function go(view, arg) {
    clearInterval(timerId);
    current = { view, arg };
    app.replaceChildren();
    ({ home, chapters, lessons, results }[view] || home)(arg);
    window.scrollTo(0, 0);
  }
  function back(label, to) {
    return el('div', { class: 'topbar' }, [el('button', { class: 'btn', type: 'button', text: label || '← Home', onclick: () => go(to || 'home') })]);
  }

  function home() {
    const L = EXAM_DAY - today();
    const r = readiness();
    const p = plan();
    const due = dueIds().length;
    const sign = el('section', { class: 'sign stack', 'aria-label': 'Conto alla rovescia' }, [
      el('p', { class: 'label', text: 'Esame di teoria · giovedì 6 novembre' }),
      el('p', { class: 'big num', text: L > 1 ? `${L} giorni` : L === 1 ? 'Domani' : L === 0 ? 'Oggi' : 'Fatto' }),
      el('p', { text: '30 domande · 20 minuti · massimo 3 errori' }),
    ]);

    const ready = el('section', { class: 'card stack' }, [el('p', { class: 'label', text: 'Probabilità di passare oggi' })]);
    if (r) {
      const pct = Math.round(r.p * 100);
      ready.append(
        el('p', { class: 'num', style: 'font-family:var(--font-display);font-size:2.6rem;font-weight:700;line-height:1;color:' + (pct >= 90 ? 'var(--ok)' : pct >= 60 ? 'var(--fg)' : 'var(--warn)'), text: pct + '%' }),
        el('p', { class: 'muted', text: `Stima dalle ultime ${r.n} simulazioni: ${r.avg.toFixed(1).replace('.', ',')} errori di media. Obiettivo: 1 errore di media (98%).` }),
      );
    } else {
      ready.append(el('p', { text: 'Servono almeno 3 simulazioni per stimarla.' }), el('p', { class: 'muted small', text: 'Con 4-5 errori di media, la probabilità di restare entro 3 errori è circa 30-40%. Con 1 errore di media sale al 98%.' }));
    }
    if (state.sims.length) ready.append(simChart());

    const todo = el('section', { class: 'card stack' }, [
      el('div', {}, [el('p', { class: 'label', text: 'Oggi' }), el('h2', { text: p.phase })]),
      el('p', { class: 'muted', text: p.note }),
    ]);
    for (const t of p.todo) {
      todo.append(el('div', { class: 'todo' + (t.done ? ' done' : '') }, [
        el('span', { class: 'tick', 'aria-hidden': 'true', text: t.done ? '✓' : '' }),
        el('div', { class: 'stack', style: 'gap:6px;flex:1;min-width:0' }, [
          el('p', { class: 'todo-t', text: t.t }),
          t.done ? null : el('button', { class: 'btn', type: 'button', text: 'Inizia', onclick: t.go }),
        ]),
      ]));
    }

    const actions = el('section', { class: 'stack' }, [
      el('button', { class: 'btn primary block', type: 'button', text: 'Simulazione d\'esame (20 min)', onclick: () => startExam() }),
      el('div', { class: 'row', style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [
        el('button', { class: 'btn', type: 'button', text: `Ripasso errori (${due})`, onclick: () => startReview(), ...(due ? {} : { disabled: '' }) }),
        el('button', { class: 'btn', type: 'button', text: 'Capitoli', onclick: () => go('chapters') }),
      ]),
      el('button', { class: 'btn block', type: 'button', text: 'Lezioni e schede', onclick: () => go('lessons') }),
    ]);

    const weak = el('section', { class: 'card stack' }, [el('p', { class: 'label', text: 'Dove sbagli adesso' }), chapterBars(6)]);
    weak.append(el('button', { class: 'btn', type: 'button', text: 'Tutti i 25 capitoli', onclick: () => go('chapters') }));

    const foot = el('footer', { class: 'stack small muted' }, [
      el('p', { id: 'sync', text: syncText() }),
      el('p', {}, [
        document.createTextNode(`${TOTAL.toLocaleString('it-IT')} domande dal listato ministeriale (dataset `),
        el('a', { href: 'https://github.com/Ed0ardo/QuizPatenteB', target: '_blank', rel: 'noopener', text: 'Ed0ardo/QuizPatenteB' }),
        document.createTextNode(', licenza MIT, aggiornato al 2023). Leggi la scheda sugli aggiornamenti 2024.'),
      ]),
    ]);
    app.append(el('div', { class: 'stack', style: 'padding-top:16px' }, [sign, todo, ready, actions, weak, foot]));
  }

  function simChart() {
    const sims = state.sims.slice(-12);
    const max = Math.max(6, ...sims.map((s) => s.e));
    const W = 300, H = 90, bw = W / 12;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H + 16}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Errori nelle ultime simulazioni: ' + sims.map((s) => s.e).join(', '));
    svg.style.width = '100%';
    const y = (v) => H - (v / max) * H;
    const line = document.createElementNS(ns, 'line');
    Object.entries({ x1: 0, x2: W, y1: y(3.5), y2: y(3.5), stroke: 'var(--warn)', 'stroke-dasharray': '4 4', 'stroke-width': 1 }).forEach(([k, v]) => line.setAttribute(k, v));
    svg.append(line);
    sims.forEach((s, i) => {
      const r = document.createElementNS(ns, 'rect');
      const h = Math.max(2, (s.e / max) * H);
      Object.entries({ x: i * bw + 3, y: H - h, width: bw - 6, height: h, rx: 2, fill: s.e <= 3 ? 'var(--ok)' : 'var(--warn)' }).forEach(([k, v]) => r.setAttribute(k, v));
      const t = document.createElementNS(ns, 'text');
      Object.entries({ x: i * bw + bw / 2, y: H + 13, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)' }).forEach(([k, v]) => t.setAttribute(k, v));
      t.textContent = s.e;
      svg.append(r, t);
    });
    return el('div', { class: 'stack', style: 'gap:4px' }, [svg, el('p', { class: 'small muted', text: 'Errori per simulazione. Linea tratteggiata: oltre 3 si è bocciati.' })]);
  }

  function chapterBars(limit) {
    const rows = CH.map((c) => ({ c, s: chapterStats(c) }));
    const key = (s) => (s.seen >= 5 ? 2 + s.err : s.seen ? 1 : 0);
    rows.sort((a, b) => key(b.s) - key(a.s) || b.s.share - a.s.share);
    const box = el('div', { class: 'bars' });
    for (const { c, s } of rows.slice(0, limit || rows.length)) {
      const pct = s.err == null ? 0 : Math.round(s.err * 100);
      const color = s.seen < 5 ? 'var(--muted)' : pct > 15 ? 'var(--warn)' : pct > 5 ? 'var(--cantiere)' : 'var(--ok)';
      const right = s.seen < 5 ? (s.seen ? 'pochi dati' : 'mai provato') : pct + '% sbagliate';
      box.append(el('button', { class: 'bar', type: 'button', onclick: () => startPractice(c), 'aria-label': `${c.name}: ${right}. Allenati su questo capitolo` }, [
        el('span', { text: c.name }),
        el('span', { class: 'small muted num', text: right }),
        el('span', { class: 'track' }, [el('span', { class: 'fill', style: `display:block;width:${s.err == null ? 0 : Math.max(4, pct)}%;background:${color}` })]),
      ]));
    }
    return box;
  }

  function chapters() {
    app.append(back(), el('div', { class: 'stack' }, [
      el('h2', { text: 'Capitoli' }),
      el('p', { class: 'muted', text: 'Percentuale = domande che hai sbagliato l\'ultima volta che le hai viste. Tocca un capitolo per 20 domande di allenamento con correzione immediata.' }),
      el('div', { class: 'card' }, [chapterBars()]),
    ]));
  }

  function lessons() {
    const list = el('div', { class: 'stack' });
    for (const l of LESSONS) {
      const done = state.lessons[l.id];
      list.append(el('button', { class: 'card bar', type: 'button', onclick: () => openLesson(l) }, [
        el('span', {}, [el('span', { class: 'label', text: 'Lezione ' + Number(l.id) }), el('br'), el('strong', { text: l.title })]),
        el('span', { class: 'pill ' + (done ? 'ok' : 'wait'), text: done ? `${done.s}/${done.n}` : l.mins + ' min' }),
      ]));
    }
    for (const r of REFS) {
      list.append(el('button', { class: 'card bar', type: 'button', onclick: () => openLesson(r) }, [
        el('span', {}, [el('span', { class: 'label', text: 'Scheda' }), el('br'), el('strong', { text: r.title })]),
      ]));
    }
    app.append(back(), el('div', { class: 'stack' }, [
      el('h2', { text: 'Lezioni e schede' }),
      el('p', { class: 'muted', text: 'Le lezioni nuove arrivano in base ai tuoi errori: ogni volta che vuoi la successiva, chiedi a Claude "prossima lezione quiz patente".' }),
      list,
    ]));
  }

  async function openLesson(l) {
    clearInterval(timerId);
    current = { view: 'lesson', arg: l };
    app.replaceChildren(back('← Lezioni', 'lessons'));
    const host = el('div', { class: 'lesson', text: 'Carico la lezione…' });
    app.append(host);
    window.scrollTo(0, 0);
    try {
      const res = await fetch(l.file);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
      const main = doc.querySelector('main');
      host.replaceChildren(...Array.from(main.childNodes).map((n) => document.importNode(n, true)));
      host.querySelectorAll('script').forEach((s) => s.remove());
      host.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href');
        if (/^https?:/.test(href)) { a.target = '_blank'; a.rel = 'noopener'; return; }
        const file = href.replace(/^(\.\.\/)+/, '');
        const target = [...LESSONS, ...REFS].find((x) => x.file === file);
        if (target) a.addEventListener('click', (ev) => { ev.preventDefault(); openLesson(target); });
        else if (/index\.html$/.test(file)) a.addEventListener('click', (ev) => { ev.preventDefault(); go('home'); });
      });
      if (l.id) enhanceLesson(host, (s, n) => { state.lessons[l.id] = { d: today(), s, n }; save(); });
    } catch (e) {
      host.replaceChildren(el('p', { text: 'Non riesco ad aprire la lezione (' + e.message + '). Riprova tra poco.' }));
    }
  }

  // ---------- quiz runner ----------
  function startExam() { runExam(buildExam()); }
  function startReview() {
    const ids = shuffle(dueIds().slice(0, 40));
    if (!ids.length) return go('home');
    runPractice(ids, 'Ripasso errori', 'rev');
  }
  function startPractice(c) { runPractice(buildPractice(c, 20), c.name, 'prac'); }

  function siblings(q, n) {
    const ids = shuffle(subIds(q).filter((id) => id !== q.id)).slice(0, n || 6);
    if (!ids.length) return null;
    const d = el('details', { class: 'card' }, [el('summary', { text: `Altre ${ids.length} frasi sullo stesso argomento` })]);
    const list = el('div', { class: 'stack', style: 'margin-top:10px' });
    for (const id of ids) {
      const s = QS[id];
      list.append(el('div', { class: 'row', style: 'align-items:flex-start;flex-wrap:nowrap' }, [
        el('span', { class: 'pill ' + (s.a ? 'ok' : 'ko'), text: s.a ? 'V' : 'F' }),
        el('span', { text: s.text }),
      ]));
    }
    d.append(list);
    return d;
  }

  function runPractice(ids, title, kind) {
    clearInterval(timerId);
    current = { view: 'quiz' };
    const queue = ids.slice();
    const requeued = new Set();
    let i = 0, right = 0, firstTry = 0;
    const answeredFirst = new Set();
    app.replaceChildren();
    const head = el('div', { class: 'topbar' }, [
      el('button', { class: 'btn', type: 'button', text: '← Esci', onclick: () => go('home') }),
      el('span', { class: 'num muted' }),
    ]);
    const body = el('div', { class: 'stack' });
    app.append(head, el('h2', { text: title, style: 'margin-bottom:12px' }), body);
    function show() {
      if (i >= queue.length) return end();
      head.lastChild.textContent = `${i + 1} / ${queue.length}`;
      const q = QS[queue[i]];
      const card = el('div', { class: 'card' });
      body.replaceChildren(card);
      renderTF(card, q, {
        onAnswer: (_c, ok, out) => {
          const first = !answeredFirst.has(q.id);
          if (first) { answeredFirst.add(q.id); record(q.id, ok); act(kind); if (ok) firstTry++; }
          if (ok) right++;
          else if (!requeued.has(q.id)) { requeued.add(q.id); queue.push(q.id); }
          save();
          const sib = siblings(q);
          if (sib) out.append(sib);
          const next = el('button', { class: 'btn primary block', type: 'button', text: i + 1 < queue.length ? 'Avanti' : 'Fine', onclick: () => { i++; show(); } });
          out.append(next);
          next.focus({ preventScroll: true });
        },
      });
      window.scrollTo(0, 0);
    }
    function end() {
      const n = answeredFirst.size;
      body.replaceChildren(el('div', { class: 'card stack' }, [
        el('h2', { text: `${firstTry} su ${n} giuste al primo colpo` }),
        el('p', { class: 'muted', text: requeued.size ? `Le ${requeued.size} sbagliate tornano nel ripasso domani: è lo spazio tra un tentativo e l'altro che le fissa.` : 'Nessun errore in questa serie.' }),
        el('button', { class: 'btn primary block', type: 'button', text: 'Torna alla home', onclick: () => go('home') }),
      ]));
    }
    show();
  }

  function runExam(ids) {
    clearInterval(timerId);
    current = { view: 'quiz' };
    const answers = {};
    let i = 0;
    const end = Date.now() + 20 * 60 * 1000;
    const startT = Date.now();
    app.replaceChildren();
    const timer = el('span', { class: 'timer num', role: 'timer', 'aria-label': 'Tempo rimasto' });
    const submitBtn = el('button', { class: 'btn primary', type: 'button', text: 'Consegna', onclick: () => confirmSubmit() });
    const head = el('div', { class: 'topbar' }, [el('button', { class: 'btn', type: 'button', text: '← Abbandona', onclick: () => go('home') }), timer, submitBtn]);
    const grid = el('div', { class: 'grid30', role: 'navigation', 'aria-label': 'Domande' });
    const card = el('div', { class: 'card' });
    const nav = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [
      el('button', { class: 'btn', type: 'button', text: '← Precedente', onclick: () => { if (i > 0) { i--; show(); } } }),
      el('button', { class: 'btn', type: 'button', text: 'Successiva →', onclick: () => { if (i < 29) { i++; show(); } } }),
    ]);
    const confirmBox = el('div');
    app.append(head, el('div', { class: 'stack' }, [grid, card, nav, confirmBox]));
    function tick() {
      const left = Math.max(0, end - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
      timer.classList.toggle('low', left < 120000);
      if (left <= 0) submit();
    }
    function drawGrid() {
      grid.replaceChildren(...ids.map((_, k) => el('button', {
        type: 'button', text: String(k + 1), class: (answers[k] != null ? 'done ' : '') + (k === i ? 'cur' : ''),
        'aria-label': `Domanda ${k + 1}` + (answers[k] != null ? ', risposta data' : ''), onclick: () => { i = k; show(); },
      })));
    }
    function show() {
      confirmBox.replaceChildren();
      drawGrid();
      renderTF(card, QS[ids[i]], {
        mode: 'exam', chosen: answers[i],
        onAnswer: (c) => { answers[i] = c; drawGrid(); if (i < 29) setTimeout(() => { i++; show(); }, 180); },
      });
    }
    function confirmSubmit() {
      const missing = 30 - Object.keys(answers).length;
      if (!missing) return submit();
      confirmBox.replaceChildren(el('div', { class: 'card stack' }, [
        el('p', { text: `${missing} domande senza risposta: all'esame contano come errori.` }),
        el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [
          el('button', { class: 'btn', type: 'button', text: 'Continua', onclick: () => confirmBox.replaceChildren() }),
          el('button', { class: 'btn primary', type: 'button', text: 'Consegna comunque', onclick: () => submit() }),
        ]),
      ]));
    }
    let done = false;
    function submit() {
      if (done) return;
      done = true;
      clearInterval(timerId);
      const wrong = [];
      ids.forEach((id, k) => {
        const ok = answers[k] === QS[id].a;
        record(id, ok);
        if (!ok) wrong.push(id);
      });
      state.sims.push({ t: Date.now(), d: today(), e: wrong.length, wrong, secs: Math.round((Date.now() - startT) / 1000) });
      act('sims');
      save();
      go('results', { ids, answers, wrong });
    }
    timerId = setInterval(tick, 1000);
    tick();
    show();
  }

  function results({ ids, answers, wrong }) {
    const e = wrong.length;
    const pass = e <= 3;
    const r = readiness();
    const verdict = el('section', { class: 'sign stack', style: pass ? 'background:var(--ok);box-shadow:0 0 0 2px var(--ok)' : 'background:var(--warn);box-shadow:0 0 0 2px var(--warn)' }, [
      el('p', { class: 'label', text: 'Simulazione d\'esame' }),
      el('p', { class: 'big', text: pass ? 'Idoneo' : 'Non idoneo' }),
      el('p', { class: 'num', text: `${e} ${e === 1 ? 'errore' : 'errori'} su 30` + (r ? ` · probabilità stimata di passare: ${Math.round(r.p * 100)}%` : '') }),
    ]);
    const grid = el('div', { class: 'grid30' }, ids.map((id, k) => el('span', {
      class: answers[k] === QS[id].a ? 'ok' : 'ko', text: String(k + 1),
      style: 'display:grid;place-items:center;min-height:30px;border-radius:6px;font-size:.8rem;border:1px solid;' + (answers[k] === QS[id].a ? 'border-color:var(--ok);background:var(--ok-soft)' : 'border-color:var(--warn);background:var(--warn-soft)'),
    })));
    const list = el('div', { class: 'stack' });
    ids.forEach((id, k) => {
      if (answers[k] === QS[id].a) return;
      const q = QS[id];
      const card = el('div', { class: 'card' });
      list.append(el('p', { class: 'label', text: `Domanda ${k + 1} · ${CH.find((c) => c.id === q.ch).name}` + (answers[k] == null ? ' · senza risposta' : '') }), card);
      const { out } = renderTF(card, q, { mode: 'review', chosen: answers[k] == null ? (q.a ? 0 : 1) : answers[k] });
      const sib = siblings(q);
      if (sib) out.append(sib);
    });
    app.append(el('div', { class: 'stack', style: 'padding-top:16px' }, [
      verdict, grid,
      e ? el('h2', { text: 'I tuoi errori' }) : el('p', { text: 'Zero errori. Ripeti domani: conta la media, non il colpo singolo.' }),
      e ? el('p', { class: 'muted', text: 'Apri "Altre frasi sullo stesso argomento": all\'esame la stessa figura torna con frasi diverse.' }) : null,
      list,
      el('button', { class: 'btn primary block', type: 'button', text: 'Torna alla home', onclick: () => go('home') }),
    ]));
  }

  // ---------- boot ----------
  async function boot() {
    const local = loadLocal();
    if (local) merge(local);
    app.replaceChildren(el('p', { class: 'muted', style: 'padding-top:24px', text: 'Carico le domande del listato…' }));
    try { await loadData(); }
    catch (e) { app.replaceChildren(el('p', { style: 'padding-top:24px', text: 'Non riesco a caricare le domande (' + e.message + '). Ricarica la pagina.' })); return; }
    go('home');
    initDb();
  }
  boot();
})();
