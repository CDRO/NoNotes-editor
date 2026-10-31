/* NoNotes – Datumsauswahl (v3.0.0, Beschluss 2026-10-27).
   Ein kleiner Monatskalender unter der Zeile, wenn im Editor nach einem Leerzeichen ">" getippt wird (oder über den Knopf «Termin»,
   Strg+Leertaste auf einem Termin, ein Klick auf sein Abzeichen in der Vorschau). Oben drei Knöpfe Heute, Morgen, Nächste Woche
   (Montag), darunter der Kalender und ein Feld Uhrzeit (leer = ohne).
   Tasten (der Fokus bleibt im Text, ausser im Feld Uhrzeit): ←/→ ein Tag, ↑/↓ eine Woche, Bild↑/Bild↓ ein Monat, Tab und Umschalt+Tab
   gehen durch Heute, Morgen, Nächste Woche, Kalender, Uhrzeit; Enter setzt das gewählte Datum ein, Esc schliesst. Eingesetzt wird immer
   das volle Datum (TT.MM.JJJJ, mit Uhrzeit «TT.MM.JJJJ HH:MM»), damit es in einem Jahr noch eindeutig ist.

   NoNotesDatePicker.create(root, { onPick(iso), onClose(), refocus() }) → { open(iso, time), close(), isOpen(), key(e), follow(text), el }
     key(e)      eine Taste aus dem Textfeld: true, wenn die Auswahl sie verarbeitet hat (dann preventDefault)
     follow(t)   der Kalender folgt dem getippten Text nach dem ">" (Ziffern, "." und "-") */
(function (global) {
  'use strict';

  // Texte über das Label-Modul des Pakets (labels.js, wird zuerst geladen); der Gastgeber kann jeden Text ersetzen.
  const I18n = global.NoNotesEditorLabels;
  const { t } = I18n;
  const D = () => global.NoNotesDates;

  const ZONES = ['today', 'tomorrow', 'nextweek', 'calendar', 'time'];
  const TIME_RE = /^\s*(\d{1,2})[:.]?(\d{2})\s*$/; // 14:30, 14.30 oder 1430

  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const addMonths = (s, n) => {
    const d = parse(s);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return iso(d);
  };
  const today = () => iso(new Date());
  /** Nächster Montag (nie heute). */
  const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); return iso(d); };

  /** Getippter Teil nach ">" → Tag (ISO) oder null: «31.10.2026», «31.10.», «31.10», «31», «2026-10-31». */
  function guess(text, base) {
    const s = String(text || '').trim();
    const b = parse(base) || new Date();
    let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s);
    if (m) return valid(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 1);
    m = /^(\d{1,2})(?:\.(\d{1,2})?)?(?:\.(\d{0,4}))?$/.exec(s);
    if (!m || !m[1]) return null;
    const y = m[3] && m[3].length === 4 ? Number(m[3]) : b.getFullYear();
    return valid(y, m[2] ? Number(m[2]) : b.getMonth() + 1, Number(m[1]));
  }
  function valid(y, mo, d) {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(y, mo - 1, d);
    return dt.getMonth() === mo - 1 ? iso(dt) : null;
  }

  function create(root, opts) {
    const o = opts || {};
    const locale = I18n.locale();
    const monthFmt = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
    const dayFmt = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const wdFmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    const s = { open: false, sel: today(), zone: 3 };

    const el = document.createElement('div');
    el.className = 'dp';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', t('Datum wählen'));
    el.addEventListener('mousedown', e => { if (e.target !== timeInput) e.preventDefault(); }); // der Fokus bleibt im Text
    root.appendChild(el);

    const quick = document.createElement('div');
    quick.className = 'dp-quick';
    const quickBtns = [[t('Heute'), today], [t('Morgen'), () => addDays(today(), 1)], [t('Nächste Woche'), nextMonday]].map(([label, fn], i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.zone = ZONES[i];
      b.addEventListener('click', () => pick(fn()));
      quick.appendChild(b);
      return b;
    });

    const head = document.createElement('div');
    head.className = 'dp-head';
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'dp-nav';
    prev.textContent = '‹';
    prev.setAttribute('aria-label', t('Voriger Monat'));
    prev.addEventListener('click', () => { s.sel = addMonths(s.sel, -1); render(); });
    const title = document.createElement('span');
    title.className = 'dp-month';
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'dp-nav';
    next.textContent = '›';
    next.setAttribute('aria-label', t('Nächster Monat'));
    next.addEventListener('click', () => { s.sel = addMonths(s.sel, 1); render(); });
    head.append(prev, title, next);

    const grid = document.createElement('table');
    grid.className = 'dp-grid';
    grid.setAttribute('role', 'grid');
    grid.addEventListener('click', e => { const b = e.target.closest('button[data-iso]'); if (b) pick(b.dataset.iso); });

    const timeRow = document.createElement('label');
    timeRow.className = 'dp-time';
    const timeLabel = document.createElement('span');
    timeLabel.textContent = t('Uhrzeit');
    const timeInput = document.createElement('input');
    timeInput.type = 'text';
    timeInput.inputMode = 'numeric';
    timeInput.placeholder = '14:30';
    timeInput.maxLength = 5;
    timeInput.setAttribute('aria-label', t('Uhrzeit (leer = ohne)'));
    timeInput.addEventListener('focus', () => { s.zone = 4; mark(); });
    timeInput.addEventListener('keydown', e => {
      if (e.key === 'Tab' || e.key === 'Enter' || e.key === 'Escape') { if (key(e)) { e.preventDefault(); e.stopPropagation(); } }
    });
    timeRow.append(timeLabel, timeInput);

    const keys = document.createElement('div');
    keys.className = 'dp-keys';
    keys.textContent = t('←/→ Tag · ↑/↓ Woche · Bild↑/↓ Monat · Tab weiter · Enter einsetzen · Esc schliessen');

    el.append(quick, head, grid, timeRow, keys);

    function render() {
      const sel = parse(s.sel);
      title.textContent = monthFmt.format(sel);
      const first = new Date(sel.getFullYear(), sel.getMonth(), 1);
      const start = new Date(first);
      start.setDate(1 - ((first.getDay() + 6) % 7)); // Montag davor
      const now = today();
      const thead = document.createElement('thead');
      const hr = document.createElement('tr');
      for (let i = 0; i < 7; i++) {
        const th = document.createElement('th');
        const d = new Date(start); d.setDate(start.getDate() + i);
        th.textContent = wdFmt.format(d).replace(/\.$/, '');
        th.setAttribute('scope', 'col');
        hr.appendChild(th);
      }
      thead.appendChild(hr);
      const tbody = document.createElement('tbody');
      const d = new Date(start);
      for (let w = 0; w < 6; w++) {
        const tr = document.createElement('tr');
        for (let i = 0; i < 7; i++) {
          const td = document.createElement('td');
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.iso = iso(d);
          b.textContent = String(d.getDate());
          b.setAttribute('aria-label', dayFmt.format(d));
          if (d.getMonth() !== sel.getMonth()) b.classList.add('other');
          if (b.dataset.iso === now) b.classList.add('today');
          if (b.dataset.iso === s.sel) { b.classList.add('sel'); b.setAttribute('aria-selected', 'true'); }
          td.appendChild(b);
          tr.appendChild(td);
          d.setDate(d.getDate() + 1);
        }
        tbody.appendChild(tr);
        if (d.getMonth() !== sel.getMonth() && w >= 4) break;
      }
      grid.replaceChildren(thead, tbody);
      mark();
    }

    /** Welcher Bereich gerade dran ist (Tab). */
    function mark() {
      el.dataset.zone = ZONES[s.zone];
      quickBtns.forEach((b, i) => b.classList.toggle('active', s.zone === i));
      grid.classList.toggle('active', s.zone === 3);
      timeRow.classList.toggle('active', s.zone === 4);
    }

    function setZone(z) {
      s.zone = (z + ZONES.length) % ZONES.length;
      mark();
      if (s.zone === 4) timeInput.focus();
      else if (document.activeElement === timeInput && o.refocus) o.refocus();
    }

    /** Das Datum des Bereichs, der dran ist (Heute, Morgen, Nächste Woche oder der Kalender). */
    function zoneDate() {
      if (s.zone === 0) return today();
      if (s.zone === 1) return addDays(today(), 1);
      if (s.zone === 2) return nextMonday();
      return s.sel;
    }

    function pick(day) {
      const m = TIME_RE.exec(timeInput.value);
      const h = m ? Number(m[1]) : -1, mi = m ? Number(m[2]) : -1;
      const value = day + (h >= 0 && h <= 23 && mi >= 0 && mi <= 59 ? `T${pad(h)}:${pad(mi)}` : '');
      close();
      if (o.onPick) o.onPick(value);
    }

    function move(fn) {
      s.sel = fn(s.sel);
      if (s.zone !== 3) s.zone = 3;
      render();
    }

    /** Eine Taste (aus dem Text oder dem Feld Uhrzeit). true = verarbeitet. */
    function key(e) {
      if (!s.open || e.altKey || e.metaKey) return false;
      const inTime = e.target === timeInput;
      switch (e.key) {
        case 'Escape': close(); if (o.onClose) o.onClose(); return true;
        case 'Enter': pick(zoneDate()); return true;
        case 'Tab': setZone(s.zone + (e.shiftKey ? -1 : 1)); return true;
        default: break;
      }
      if (inTime || e.ctrlKey || e.shiftKey) return false;
      switch (e.key) {
        case 'ArrowLeft': move(x => addDays(x, -1)); return true;
        case 'ArrowRight': move(x => addDays(x, 1)); return true;
        case 'ArrowUp': move(x => addDays(x, -7)); return true;
        case 'ArrowDown': move(x => addDays(x, 7)); return true;
        case 'PageUp': move(x => addMonths(x, -1)); return true;
        case 'PageDown': move(x => addMonths(x, 1)); return true;
        default: return false;
      }
    }

    /** Öffnen mit einem Tag (ISO, sonst heute) und wahlweise einer Uhrzeit ("14:30"). */
    function open(day, time) {
      s.sel = parse(day) ? D().datePart(day) : today();
      s.zone = 3;
      timeInput.value = time || '';
      s.open = true;
      el.hidden = false;
      render();
    }

    function close() {
      if (!s.open) return;
      s.open = false;
      el.hidden = true;
      if (document.activeElement === timeInput && o.refocus) o.refocus();
    }

    /** Der Kalender folgt dem getippten Text nach dem ">". */
    function follow(text) {
      const g = guess(text, s.sel);
      if (g && g !== s.sel) { s.sel = g; s.zone = 3; render(); }
    }

    return { open, close, isOpen: () => s.open, key, follow, el, selected: () => s.sel };
  }

  global.NoNotesDatePicker = { create, guess };
})(window);
