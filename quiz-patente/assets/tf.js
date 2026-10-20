// Componente Vero/Falso condiviso da app e lezioni.
// Una domanda: { text, a (1 vero / 0 falso), img }. Le lezioni usano <div class="tf" data-a="1" data-why="...">testo</div>.
(function () {
  function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    for (const c of kids || []) if (c) n.append(c);
    return n;
  }

  // mode "feedback": shows right/wrong at once. mode "exam": only marks the choice.
  function renderTF(host, q, opts) {
    opts = opts || {};
    host.replaceChildren();
    const box = el('div', { class: 'stack' });
    if (q.img) box.append(el('img', { class: 'tf-img', src: (opts.imgBase || 'img/') + q.img, alt: 'Figura della domanda' }));
    box.append(el('p', { class: 'tf-q', text: q.text }));
    const bV = el('button', { class: 'tf-btn', type: 'button', 'aria-pressed': 'false', text: 'VERO' });
    const bF = el('button', { class: 'tf-btn', type: 'button', 'aria-pressed': 'false', text: 'FALSO' });
    const out = el('div', { class: 'stack', 'aria-live': 'polite' });
    box.append(el('div', { class: 'tf-btns' }, [bV, bF]), out);
    host.append(box);

    let locked = false;
    function show(choice) {
      const right = choice === q.a;
      const correctBtn = q.a === 1 ? bV : bF;
      const chosenBtn = choice === 1 ? bV : bF;
      correctBtn.classList.add('is-right');
      if (!right) chosenBtn.classList.add('is-wrong');
      out.replaceChildren(el('p', { class: 'verdict ' + (right ? 'ok' : 'ko'), text: right ? 'Giusto.' : 'Sbagliato: la risposta è ' + (q.a ? 'VERO' : 'FALSO') + '.' }));
      if (q.why) out.append(el('p', { class: 'why', text: q.why }));
    }
    function pick(choice) {
      if (locked) return;
      if (opts.mode === 'exam') {
        bV.setAttribute('aria-pressed', String(choice === 1));
        bF.setAttribute('aria-pressed', String(choice === 0));
      } else {
        locked = true;
        show(choice);
      }
      if (opts.onAnswer) opts.onAnswer(choice, choice === q.a, out);
    }
    bV.addEventListener('click', () => pick(1));
    bF.addEventListener('click', () => pick(0));
    if (opts.mode === 'exam' && opts.chosen != null) {
      bV.setAttribute('aria-pressed', String(opts.chosen === 1));
      bF.setAttribute('aria-pressed', String(opts.chosen === 0));
    }
    if (opts.mode === 'review' && opts.chosen != null) { locked = true; show(opts.chosen); }
    return { out };
  }

  // Turns every .tf in a lesson into a drill card. Calls onDone(score, total) when all are answered.
  function enhanceLesson(root, onDone) {
    const items = Array.from(root.querySelectorAll('.tf'));
    let answered = 0, score = 0;
    const result = root.querySelector('.tf-result');
    items.forEach((it) => {
      const q = { text: it.textContent.trim(), a: Number(it.dataset.a), why: it.dataset.why || '', img: it.dataset.img || '' };
      const card = el('div', { class: 'card' });
      it.replaceWith(card);
      renderTF(card, q, {
        imgBase: it.dataset.imgBase || '',
        onAnswer: (_c, ok) => {
          answered++; if (ok) score++;
          if (answered === items.length) {
            if (result) result.textContent = 'Risultato: ' + score + ' su ' + items.length + '.';
            if (onDone) onDone(score, items.length);
          }
        },
      });
    });
  }

  window.TF = { el, renderTF, enhanceLesson };
})();
