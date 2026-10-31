/* NoNotes-editor – der Editor als Baustein (NoNotesEditor).
   Aus dem Editor von NoNotes v3.3.0 (packages/ui/app.js) herausgelöst: Toolleiste, drei Darstellungen (Bearbeiten, Geteilt, Vorschau),
   Tasten beim Schreiben (Listen, Tabellen, Fragen), Datumsauswahl hinter «>», Vorschläge für @kürzel und [[Verweise]], Tabellen
   (Raster zum Einfügen, Kontextmenü in der Vorschau, Tippen in Tabellen mit Rahmen), Aufgaben in der Vorschau abhaken, Bilder
   (einfügen, ablegen, verkleinern), Videos nach einem Klick, Pfade, ausfüllbare Platzhalter, synchrones Scrollen. Was der
   Gastgeber besitzt (Daten, Verweisziele, Speichern, Menüs, Dialoge, Verlauf, Vorlagen), kommt über Rückrufe herein.

   Benutzung:
     const ed = NoNotesEditor.create(host, {
       value, updatedAt, readOnly, mode: 'edit' | 'split' | 'preview', kind: 'note',   kind: unter diesem Namen merkt sich der Browser die Darstellung
       remember: false, onMode(mode, ed),                                             nicht merken / der Gastgeber merkt sie selbst
       ids: { root, body, preview, toolbar, heading, modeSwitch, help, attach, attachInput, attachments, mentionPopup, wikiPopup, wikiCount,
              wikiList, phHint },                                                     feste Kennungen für die Elemente (Tests, CSS des Gastgebers)
       placeholder, label,                                                            Platzhalter und Beschriftung des Textfelds
       onInput(text, ed),                                                             nach jeder Änderung, sofort (der Gastgeber speichert selbst)
       onChange(text, { baseUpdatedAt }) → Promise<{ updatedAt, text? }>              oder: das Paket speichert verzögert (saveDelay, Vorgabe 600 ms),
       reload() → Promise<{ text, updatedAt }>, resolveConflict({ mine, theirs }) → 'reload' | 'mine' | null      bei Fehler CONFLICT
       attachments: { list(), get(id) → { mime, bytes|data }, add({ name, mime, bytes }) → { id, name }, remove(id) },   Bilder (att:ID)
       refs: { list() → [{ title, insert?, parent?, path?, archived?, updated?, dup? }], resolver(text) → fn(target) → { id, label },
               open({ id, title, el, event }), cross: true },                         [[Verweise]]: Vorschläge, Auflösung, Klick
       render(text) → Promise<object>,                                                weitere Angaben für NoNotesMarkdown.render (highlight, noteLink …)
       onLinkClick(a, event) → true,                                                  eigene Links (z. B. a.md-note) selbst behandeln
       people: true,                                                                  @kürzel-Vorschläge (NoNotesMentions)
       placeholders: { keep() → boolean, onFill(name, value, keep) },                 ausfüllbare Platzhalter ({{?Name}})
       history: { label, title, open(ed) }, help(ed), templates: { insert(ed), save(ed) },   Knöpfe des Gastgebers
       actions: [{ id, label, title, run(ed) }],                                      weitere Knöpfe neben der Toolleiste
       showMenu(items, x, y), confirm(text, { danger, yes }) → Promise<boolean>, hint(text), onError(e),
       counts: true, answers: true, modernizeDates: true, entity,                     Zähler, «Beantworten» in der Vorschau, alte «@Datum», Angaben für Erweiterungen
     })
     → { el, textarea, preview, get(), set(text, updatedAt), focus(), setReadOnly(b), isReadOnly(), mode(name?), insert(text, { keep }),
         insertAtCursor(text), selection(), replaceSelection(text), applyEdit({ text, selStart, selEnd }), runCommand(cmd), counts(),
         isDirty(), flush(), renderPreview(), renderAttachments(), addAttachments(files), fillPlaceholders({ keep }), updateTableMeta(line, fn),
         refreshExtensions(), isWritable(), destroy() }
   NoNotesEditor.configure({ localFiles, embeds: 'ask' | 'off', t, tn, messages, language, locale }): Einstellungen der Seite; die Texte
   gehen an NoNotesEditorLabels.configure (siehe labels.js).
   NoNotesEditor.extend({ toolbar(ed) → [{ plugin, label, title, run(ed) }], tableFormat(ed) → fn, tableMenu(target) → Einträge }):
   Rückrufe einer Erweiterungs-Schnittstelle (NoNotes ctx.ui.addToolbarButton, ctx.tables.format, ctx.ui.addTableMenuItem).
   NoNotesEditor.of(node), all(), focused(): der Editor um ein Element, alle auf der Seite, der zuletzt benutzte.

   Die reinen Textfunktionen kommen aus den Modulen des Pakets: NoNotesEditing, NoNotesTables, NoNotesTasks, NoNotesQuestions,
   NoNotesDates, NoNotesMarkdown, NoNotesMentions, NoNotesPlaceholders, NoNotesDatePicker, NoNotesScrollSync, NoNotesEditorLabels. */
(function (global) {
  'use strict';

  const L = global.NoNotesEditorLabels;
  const { t, tn, N_ } = L;
  const E = global.NoNotesEditing;
  const Tables = global.NoNotesTables;
  const Tasks = global.NoNotesTasks;
  const Q = global.NoNotesQuestions;
  const Dates = global.NoNotesDates;
  const M = global.NoNotesMarkdown;
  const PH = global.NoNotesPlaceholders;

  const VERSION = '1.0.0';
  const MODE_KEY = 'nonotes-editor.mode';  // { [kind]: 'edit' | 'split' | 'preview' }
  const GRID_KEY = 'nonotes-editor.tableGrid'; // «Mit Rahmen (mehrzeilige Felder)» im Raster: '1' | '0'
  const MODES = [['edit', N_('Bearbeiten')], ['split', N_('Geteilt')], ['preview', N_('Vorschau')]];
  const SAVE_MS = 600;
  const PREVIEW_MS = 120;
  const PICK_COLS = 8;
  const PICK_ROWS = 10;
  const WIKI_PAGE = 50; // so viele Einträge auf einmal in die Liste, weitere beim Blättern
  const MAX_ATTACHMENT_BYTES = 400 * 1024;
  const MAX_ATTACHMENT_EDGE = 1600;
  let seq = 0;
  const editors = new WeakMap(); // Wurzel → Editor
  const live = new Set();
  let lastFocused = null;
  const ext = { toolbar: null, tableFormat: null, tableMenu: null };

  // Einstellungen der Seite: Pfade lassen sich öffnen (Seite aus einer Datei), Videos als Karte, die erst nach einem Klick lädt
  const conf = { localFiles: typeof location !== 'undefined' && location.protocol === 'file:', embeds: 'ask' };
  function configure(o) {
    if (!o) return;
    if (typeof o.localFiles === 'boolean') conf.localFiles = o.localFiles;
    if (o.embeds === 'ask' || o.embeds === 'off') conf.embeds = o.embeds;
    if (M && M.configure) M.configure({ localFiles: conf.localFiles });
    const labels = {};
    for (const k of ['t', 'tn', 'messages', 'language', 'locale']) if (o[k] !== undefined) labels[k] = o[k];
    if (Object.keys(labels).length) L.configure(labels);
  }
  const embedsOn = () => conf.embeds !== 'off';
  /** YouTube lässt das Einbetten in Seiten ohne Herkunft (geöffnete Datei, file://) nicht zu: dort nur der Link zum Anbieter. */
  const embedCanLoad = provider => !(provider === 'youtube' && global.location.protocol === 'file:');

  // ---------- Kleine Hilfen ----------

  /** Element bauen: h('button', { className, dataset, on: { click }, title, hidden … }, Kinder …). Text bleibt Text (kein HTML). */
  function h(tag, props, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'className') n.className = v;
      else if (k === 'dataset') { for (const [dk, dv] of Object.entries(v)) if (dv != null) n.dataset[dk] = dv; }
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
      else if (k === 'htmlFor') n.htmlFor = v;
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    const add = c => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    };
    children.forEach(add);
    return n;
  }

  function readModes() {
    try { const v = JSON.parse(global.localStorage.getItem(MODE_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
  }
  function rememberMode(kind, mode) {
    try { const all = readModes(); all[kind] = mode; global.localStorage.setItem(MODE_KEY, JSON.stringify(all)); } catch (e) { /* ohne Speicher: nicht gemerkt */ }
  }

  // ---------- Toolleiste (wie die feste Toolleiste in NoNotes index.html) ----------

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(parts) {
    const s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of parts) {
      const n = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      s.appendChild(n);
    }
    return s;
  }
  const stroke = w => ({ fill: 'none', stroke: 'currentColor', 'stroke-width': w });
  const glyph = (text, cls) => h('span', { className: 'tb-glyph' + (cls ? ' ' + cls : '') }, text);
  const ICONS = {
    bold: () => svg([['path', { d: 'M4 2h5a3.5 3.5 0 0 1 2.4 6A3.5 3.5 0 0 1 9.5 14H4V2zm2 2v3h3a1.5 1.5 0 0 0 0-3H6zm0 5v3h3.5a1.5 1.5 0 0 0 0-3H6z' }]]),
    italic: () => svg([['path', { d: 'M6 2h7v2h-2.5l-2 8H11v2H4v-2h2.5l2-8H6z' }]]),
    strike: () => glyph('S', 'tb-strike'),
    code: () => glyph('</>', 'tb-mono'),
    bullet: () => svg([['circle', { cx: 3, cy: 4, r: 1.3 }], ['rect', { x: 6, y: 3.2, width: 8, height: 1.6 }], ['circle', { cx: 3, cy: 8, r: 1.3 }],
      ['rect', { x: 6, y: 7.2, width: 8, height: 1.6 }], ['circle', { cx: 3, cy: 12, r: 1.3 }], ['rect', { x: 6, y: 11.2, width: 8, height: 1.6 }]]),
    ordered: () => glyph('1.'),
    task: () => svg([['rect', Object.assign({ x: 2, y: 2, width: 12, height: 12, rx: 2 }, stroke(1.6))], ['path', Object.assign({ d: 'M4.5 8.2l2.3 2.3 4.7-4.9' }, stroke(1.8))]]),
    date: () => svg([['rect', Object.assign({ x: 2, y: 3, width: 12, height: 11, rx: 2 }, stroke(1.5))], ['path', Object.assign({ d: 'M2 6.5h12 M5.2 1.6v2.8 M10.8 1.6v2.8' }, stroke(1.5))],
      ['rect', { x: 9, y: 8.6, width: 3, height: 3, rx: 0.6 }]]),
    quote: () => glyph('“', 'tb-quote'),
    codeblock: () => glyph('{ }', 'tb-mono'),
    hr: () => svg([['rect', { x: 2, y: 7.2, width: 12, height: 1.6 }]]),
    table: () => svg([['rect', Object.assign({ x: 2, y: 2.5, width: 12, height: 11, rx: 1.5 }, stroke(1.5))], ['path', Object.assign({ d: 'M2 6.2h12 M2 9.8h12 M6.2 2.5v11 M10 2.5v11' }, stroke(1.2))]]),
    link: () => svg([['path', Object.assign({ d: 'M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-1 1' }, stroke(1.6))], ['path', Object.assign({ d: 'M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l1-1' }, stroke(1.6))]]),
    wiki: () => glyph('[[ ]]', 'tb-mono'),
    image: () => svg([['rect', Object.assign({ x: 2, y: 3, width: 12, height: 10, rx: 1.5 }, stroke(1.5))], ['circle', { cx: 5.5, cy: 6.5, r: 1.3 }],
      ['path', Object.assign({ d: 'M3 12l3.5-3.5 2.5 2.5 2-2 3 3' }, stroke(1.5))]]),
    question: () => glyph('?', 'tb-q'),
    answer: () => glyph('!', 'tb-a'),
    decision: () => glyph('?!', 'tb-d'),
    template: () => svg([['path', Object.assign({ d: 'M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3 M5.5 7.5h5 M5.5 10h5 M5.5 12.5h3' }, stroke(1.4))]]),
  };
  /** [Befehl, Titel, Beschriftung, Kennung in NoNotes]; 'sep' trennt Gruppen. */
  const TOOLS = [
    'sep',
    ['bold', N_('Fett (Ctrl+B)'), N_('Fett')],
    ['italic', N_('Kursiv (Ctrl+I)'), N_('Kursiv')],
    ['strike', N_('Durchgestrichen'), N_('Durchgestrichen')],
    ['code', N_('Code'), N_('Code')],
    'sep',
    ['bullet', N_('Liste'), N_('Liste')],
    ['ordered', N_('Nummerierte Liste'), N_('Nummerierte Liste')],
    ['task', N_('Aufgabe (Kästchen zum Abhaken)'), N_('Aufgabe')],
    ['date', N_('Termin am Zeilenende: Datum wählen (auch «>» tippen, Strg+Leertaste auf einem Termin ändert ihn)'), N_('Termin')],
    ['quote', N_('Zitat'), N_('Zitat')],
    ['codeblock', N_('Codeblock'), N_('Codeblock')],
    ['hr', N_('Trennlinie'), N_('Trennlinie')],
    ['table', N_('Tabelle einfügen: Grösse im Raster wählen (bis 8 × 10)'), N_('Tabelle einfügen')],
    'sep',
    ['link', N_('Link (Ctrl+K)'), N_('Link')],
    ['wiki', N_('Verweis auf eine Notiz [[Titel]]'), N_('Verweis auf Notiz')],
    ['image', N_('Bild einfügen (auch per Einfügen aus der Zwischenablage oder Ablegen auf dem Text)'), N_('Bild einfügen'), 'attach'],
    'sep',
    ['question', N_('Zeile als Frage markieren, mehrere Zeilen als Block (Ctrl+Shift+F)'), N_('Frage'), 'questionBtn'],
    ['answer', N_('Zeile als Antwort markieren (Ctrl+Shift+A)'), N_('Antwort'), 'answerBtn'],
    ['decision', N_('Zeile als Entscheid markieren, mehrere Zeilen als Block (Ctrl+Shift+D)'), N_('Entscheid'), 'decisionBtn'],
  ];
  const HEADINGS = [['', N_('Überschrift…')], ['1', N_('Überschrift 1')], ['2', N_('Überschrift 2')], ['3', N_('Überschrift 3')],
    ['4', N_('Überschrift 4')], ['0', N_('Normaler Text')]];

  // ---------- Textfunktionen ----------

  /** Zeile um die Stelle pos: { start, end, text }. */
  function lineAround(v, pos) {
    const start = v.lastIndexOf('\n', pos - 1) + 1;
    let end = v.indexOf('\n', pos);
    if (end < 0) end = v.length;
    return { start, end, text: v.slice(start, end) };
  }

  /** Alle Termine einer Zeile, auch in Tabellenfeldern: [{ iso, start (das «>»), end }], Stellen in der Zeile. */
  const DATE_TOKEN_RE = new RegExp(String.raw`(^|[\s|>])([>@])(` + Dates.DATE_SRC.replace(/\((?!\?)/g, '(?:') + String.raw`)(?=\s|$|\||<)`, 'g');
  function lineDates(line) {
    const out = [];
    DATE_TOKEN_RE.lastIndex = 0;
    for (let m; (m = DATE_TOKEN_RE.exec(line));) {
      const start = m.index + m[1].length;
      const iso = Dates.splitDue('x >' + m[3]).due;
      out.push({ iso, start, end: start + 1 + m[3].length });
      DATE_TOKEN_RE.lastIndex = start + 1;
    }
    return out;
  }

  /** Die Termine am Zeilenende nach Datum ordnen (der letzte ist die Frist); null, wenn sich nichts ändert. */
  function sortLineDates(line) {
    const tl = Dates.tail(line);
    if (tl.dates.length < 2) return null;
    const keyed = tl.dates.map(d => ({ key: d.iso || '9999', text: line.slice(d.start, d.end) }));
    if (keyed.every((x, i) => !i || keyed[i - 1].key <= x.key)) return null;
    keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return line.slice(0, tl.dates[0].start) + keyed.map(x => x.text).join(' ') + line.slice(tl.dates[tl.dates.length - 1].end);
  }

  // Ein begonnenes Kürzel direkt vor dem Cursor: «@» am Wortanfang (auch nach «(»), dann nichts oder ein Buchstabe und mehr.
  const MENTION_PREFIX_RE = /(?:^|[\s(])\(?@(\p{L}[\p{L}\p{N}_.-]*|)$/u;

  const fold = s => String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const atWordStart = (text, q) => {
    for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + 1)) if (i === 0 || !/[\p{L}\p{N}]/u.test(text[i - 1])) return true;
    return false;
  };

  /** Passende Ziele: der Text kommt im Titel vor (ohne Gross-/Kleinschreibung, «ue» findet «ü»). Aktive vor archivierten, dann
   *  Titelanfang, Wortanfang, irgendwo; darin die zuletzt geänderten zuerst (NoNotes wikiMatches). */
  function refMatches(items, query) {
    const q = fold(query);
    const out = [];
    for (const n of items) {
      let rank = 0;
      if (q) {
        const at = n.fold.indexOf(q);
        if (at < 0) continue;
        rank = at === 0 ? 0 : atWordStart(n.fold, q) ? 1 : 2;
      }
      out.push({ n, rank });
    }
    out.sort((a, b) => (a.n.archived - b.n.archived) || (a.rank - b.rank)
      || (a.n.updated < b.n.updated ? 1 : a.n.updated > b.n.updated ? -1 : 0) || (a.n.order - b.n.order));
    return out.map(x => x.n);
  }

  const errorText = e => String(e && e.message ? e.message : e);

  // ============================================================

  function create(host, options) {
    const o = options || {};
    const uid = ++seq;
    const kind = o.kind || 'default';
    const ids = o.ids || {};
    const st = {
      mode: null, readOnly: !!o.readOnly, destroyed: false,
      base: o.updatedAt || null, sent: o.value || '', stored: o.value || '',
      saveTimer: null, chain: Promise.resolve(true),
      previewTimer: null, previewSeq: 0,
      mention: null, mentionSeq: 0, wiki: null, wikiSeq: 0, wikiData: null, dp: null,
      gridPrev: null, gridApplying: false, ph: null, modernizing: false,
      attUrls: new Map(), loadedEmbeds: new Set(), previewed: null,
    };

    // ---------- Aufbau (wie der Editor in NoNotes index.html) ----------

    const bodyId = ids.body || `nn-editor-${uid}-body`;
    const ta = h('textarea', { className: 'body', id: bodyId, spellcheck: 'true',
      placeholder: o.placeholder != null ? o.placeholder : t('Notiz… (Markdown; Zeile mit ? = Frage, ?! = Entscheid, darunter Zeilen mit ! = Antwort; [[Titel]] verweist auf eine Notiz)'),
      'aria-label': o.label || t('Inhalt') });
    ta.value = o.value || '';
    const heading = h('select', { className: 'tb-select', id: ids.heading || null, 'aria-label': t('Überschrift'), title: t('Überschrift setzen') },
      HEADINGS.map(([v, label]) => h('option', { value: v }, t(label)))); // i18n-dynamic: HEADINGS
    const toolbar = h('div', { className: 'toolbar', id: ids.toolbar || null, role: 'toolbar', 'aria-label': t('Formatierung') }, heading,
      TOOLS.map(x => (x === 'sep' ? h('span', { className: 'tb-sep', 'aria-hidden': 'true' })
        : h('button', { type: 'button', id: (x[3] && ids[x[3]]) || null, dataset: x[0] === 'image' ? null : { cmd: x[0] }, className: x[0] === 'image' ? 'tb-image' : null,
          title: t(x[1]), 'aria-label': t(x[2]), // i18n-dynamic: TOOLS
          'aria-haspopup': x[0] === 'table' ? 'dialog' : null, hidden: x[0] === 'image' && !o.attachments }, ICONS[x[0]]()))));
    const attachBtn = toolbar.querySelector('.tb-image');
    const tplBtn = o.templates && typeof o.templates.insert === 'function'
      ? h('button', { type: 'button', className: 'nn-tpl-btn', title: t('Vorlage einfügen oder diesen Text als Vorlage speichern'), 'aria-label': t('Vorlagen'), 'aria-haspopup': 'menu' }, ICONS.template())
      : null;
    if (tplBtn) toolbar.append(h('span', { className: 'tb-sep', 'aria-hidden': 'true' }), tplBtn);
    const pluginTools = h('span', { className: 'nn-plugin-tools' }); // Knöpfe von Erweiterungen (extend.toolbar)
    toolbar.append(pluginTools);
    const modeSwitch = h('div', { className: 'segmented small nn-modes', id: ids.modeSwitch || null, role: 'tablist', 'aria-label': t('Darstellung') },
      MODES.map(([m, label]) => h('button', { type: 'button', role: 'tab', dataset: { mode: m }, 'aria-selected': 'false', 'aria-controls': bodyId,
        title: `${t(label)} (Ctrl+E)` }, t(label)))); // i18n-dynamic: MODES
    const helpBtn = o.help ? h('button', { type: 'button', className: 'help-btn', id: ids.help || null, title: t('Hilfe: alles, was der Editor kann (F1)'), 'aria-label': t('Hilfe') }, '?') : null;
    const historyBtn = o.history && typeof o.history.open === 'function'
      ? h('button', { type: 'button', className: 'ghost small nn-history-btn', title: o.history.title || t('Frühere Fassungen dieses Texts') }, o.history.label || t('Verlauf…'))
      : null;
    const actionBar = o.actions && o.actions.length ? h('div', { className: 'nn-actions', role: 'group', 'aria-label': o.actionsLabel || t('Aktionen') },
      o.actions.map(a => h('button', { type: 'button', className: 'small nn-action', id: a.id || null, title: a.title || null, 'data-write': true,
        on: { click: () => { if (!st.readOnly) a.run(api); } } }, a.label))) : null;
    const preview = h('div', { className: 'preview md', id: ids.preview || null, tabindex: 0, 'aria-label': t('Vorschau') });
    const mirror = h('div', { className: 'body body-mirror', 'aria-hidden': 'true' });
    const mentionPopup = h('div', { className: 'mention-popup', id: ids.mentionPopup || null, role: 'listbox', 'aria-label': t('Personen'), hidden: true });
    const wikiCount = h('div', { className: 'wiki-count', id: ids.wikiCount || null, 'aria-live': 'polite' });
    const wikiList = h('div', { className: 'wiki-list', id: ids.wikiList || null, role: 'listbox', 'aria-label': t('Notizen') });
    const wikiPopup = h('div', { className: 'mention-popup wiki-popup', id: ids.wikiPopup || null, hidden: true }, wikiCount, wikiList);
    const phHint = h('div', { className: 'ph-hint', id: ids.phHint || null, role: 'note', 'aria-live': 'polite', hidden: true });
    const body = h('div', { className: 'editor-body' }, ta, preview, mirror, mentionPopup, phHint, wikiPopup);
    const strip = h('div', { className: 'attachments', id: ids.attachments || null, 'aria-label': t('Anhänge'), hidden: true });
    const fileInput = h('input', { type: 'file', id: ids.attachInput || null, accept: 'image/*', multiple: true, hidden: true, className: 'nn-file' });
    const countsEl = o.counts ? h('span', { className: 'nn-counts' }) : null;
    const hintEl = h('span', { className: 'nn-hint', role: 'status' });
    const foot = h('div', { className: 'nn-foot', hidden: !o.counts && !!o.hint }, countsEl, hintEl);
    const tools = h('div', { className: 'editor-tools' }, toolbar, actionBar, modeSwitch, historyBtn, helpBtn);
    const root = h('div', { className: 'nn-editor', id: ids.root || null, dataset: { kind, state: 'saved' } }, tools, strip, body, foot, fileInput);
    host.append(root);

    const setState = s => { root.dataset.state = s; };
    /** Hinweis: an den Gastgeber (Statuszeile), sonst in die Fusszeile des Editors. */
    function hint(text) {
      if (o.hint) { o.hint(text || ''); return; }
      hintEl.textContent = text || '';
    }

    // ---------- Darstellungen und Vorschau ----------

    let sync = null;
    function setMode(mode, remember) {
      if (!MODES.some(([m]) => m === mode)) return;
      st.mode = mode;
      root.classList.remove('mode-edit', 'mode-split', 'mode-preview');
      root.classList.add('mode-' + mode);
      for (const b of modeSwitch.querySelectorAll('button[data-mode]')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
      if (remember && o.remember !== false) rememberMode(kind, mode);
      if (o.onMode) o.onMode(mode, api);
      // der Fokus bleibt im Editor: ein verborgenes Textfeld gibt ihn an die Vorschau ab und bekommt ihn zurück
      if (mode === 'preview' && document.activeElement === ta) preview.focus();
      else if (mode !== 'preview' && document.activeElement === preview) ta.focus();
      if (mode !== 'edit') renderPreview();
      else closeDatePicker();
    }
    function cycleMode() {
      const order = MODES.map(([m]) => m);
      setMode(order[(order.indexOf(st.mode) + 1) % order.length], true);
    }

    function schedulePreview() {
      if (st.mode === 'edit') return;
      clearTimeout(st.previewTimer);
      st.previewTimer = setTimeout(renderPreview, PREVIEW_MS);
    }

    /** Zeichnet die Vorschau. Was ein synchroner Renderer braucht (Verweise, Bilder, Angaben des Gastgebers), wird vorher geholt;
     *  eine veraltete Antwort wird verworfen. */
    async function renderPreview() {
      clearTimeout(st.previewTimer);
      if (st.mode === 'edit' || st.destroyed) return;
      const mine = ++st.previewSeq;
      const text = ta.value;
      let resolveRef = null;
      let extra = null;
      try { if (o.refs && o.refs.resolver) resolveRef = await o.refs.resolver(text); } catch (e) { resolveRef = null; }
      try { if (o.render) extra = await o.render(text, api); } catch (e) { extra = null; }
      await prefetchAttachments(text);
      if (mine !== st.previewSeq || st.destroyed) return;
      const tableFormat = ext.tableFormat ? ext.tableFormat(api) : undefined;
      const opts = Object.assign({
        lineMap: true,
        tableFormat,
        interactiveTasks: !st.readOnly,
        resolveAttachment: id => st.attUrls.get(id) || null,
        embeds: embedsOn(),
        embedLoad: embedCanLoad,
      }, resolveRef ? { resolveRef } : {}, extra || {});
      preview.innerHTML = M.render(text, opts); // nur die Ausgabe von NoNotesMarkdown
      for (const box of preview.querySelectorAll('.md-embed')) if (st.loadedEmbeds.has(box.dataset.embed)) loadEmbed(box, false);
      if (o.answers) addAnswerButtons();
      if (st.mode === 'split' && sync) sync.afterRender();
      root.dataset.previewSeq = String(mine);
      st.previewed = text;
    }

    // ---------- Zähler ----------

    function counts() {
      const text = ta.value;
      const qs = Q.parse(text);
      return {
        tasks: Tasks.parse(text).filter(x => !x.done).length,
        questions: qs.filter(q => q.kind !== 'decision' && !q.answer).length,
        decisions: qs.filter(q => q.kind === 'decision' && !q.answer).length,
      };
    }
    function renderCounts() {
      if (!countsEl) return;
      const c = counts();
      countsEl.textContent = [
        c.tasks ? tn('{n} offene Aufgabe', '{n} offene Aufgaben', c.tasks) : '',
        c.questions ? tn('{n} offene Frage', '{n} offene Fragen', c.questions) : '',
        c.decisions ? tn('{n} offener Entscheid', '{n} offene Entscheide', c.decisions) : '',
      ].filter(Boolean).join(' · ');
      root.dataset.counts = `${c.tasks}/${c.questions}/${c.decisions}`;
    }

    // ---------- Änderungen, Speichern, Konflikte ----------

    const isDirty = () => ta.value !== st.sent;

    function onEdit() {
      if (!o.hint) hint('');
      renderCounts();
      updateEditorFont();
      schedulePreview();
      if (o.onInput) o.onInput(ta.value, api);
      if (!o.onChange || st.readOnly) return;
      if (isDirty()) setState('dirty');
      clearTimeout(st.saveTimer);
      st.saveTimer = setTimeout(() => { st.saveTimer = null; saveNow(); }, o.saveDelay || SAVE_MS);
    }

    /** Gibt den Text jetzt an den Gastgeber; true, wenn er geschrieben ist (oder nichts zu tun war). Aufträge laufen nacheinander. */
    function saveNow() {
      clearTimeout(st.saveTimer);
      st.saveTimer = null;
      if (!o.onChange || st.readOnly) return Promise.resolve(true);
      st.chain = st.chain.catch(() => false).then(() => writeText(false));
      return st.chain;
    }

    async function writeText(retried) {
      const text = ta.value;
      if (text === st.sent || st.destroyed) return true;
      setState('saving');
      try {
        const r = await o.onChange(text, { baseUpdatedAt: st.base });
        st.sent = text;
        st.stored = r && typeof r.text === 'string' ? r.text : text;
        if (r && r.updatedAt) st.base = r.updatedAt;
        setState(isDirty() ? 'dirty' : 'saved');
        return true;
      } catch (e) {
        if (e && (e.code === 'CONFLICT' || e.code === 'NOTE_CONFLICT') && o.reload) return onConflict(retried);
        setState('error');
        if (o.onError) o.onError(e); else console.error(e);
        return false;
      }
    }

    async function onConflict(retried) {
      const fresh = await o.reload();
      // Der gespeicherte Text ist noch der, den dieser Editor zuletzt geschrieben hat (geändert hat sich etwas anderes): still nochmals
      if (!retried && fresh.text === st.stored) { st.base = fresh.updatedAt; return writeText(true); }
      setState('conflict');
      const choice = o.resolveConflict ? await o.resolveConflict({ mine: ta.value, theirs: fresh.text }) : null;
      if (choice === 'reload') { set(fresh.text, fresh.updatedAt); return true; }
      if (choice === 'mine') { st.base = fresh.updatedAt; st.stored = fresh.text; return writeText(true); }
      setState('dirty'); // später entschieden: die nächste Änderung versucht es wieder
      return false;
    }

    function set(text, updatedAt) {
      clearTimeout(st.saveTimer);
      st.saveTimer = null;
      ta.value = text || '';
      st.sent = ta.value;
      st.stored = ta.value;
      if (updatedAt !== undefined) st.base = updatedAt;
      setState('saved');
      endPlaceholders();
      closeMentionPopup();
      closeWikiPopup();
      closeDatePicker();
      renderCounts();
      updateEditorFont();
      if (st.mode !== 'edit') renderPreview();
    }

    // ---------- Änderungen anwenden ----------

    function applyEdit(result) {
      ta.value = result.text;
      ta.focus();
      ta.setSelectionRange(result.selStart, result.selEnd);
      onEdit();
    }

    /** Ersetzt den Text nach einer Aktion in der Vorschau (Kästchen, Doppelklick, Antwort, Tabellenmenü) und zeichnet die Vorschau
     *  gleich neu, damit eine schnelle zweite Aktion die neuen Zeilen trifft. Der Cursor bleibt, wo er war. */
    function replaceText(next, sel) {
      if (next === ta.value) return;
      const c = Math.min(ta.selectionStart || 0, next.length);
      ta.value = next;
      if (sel) ta.setSelectionRange(sel.selStart, sel.selEnd); else ta.setSelectionRange(c, c);
      onEdit();
      if (st.mode !== 'edit') renderPreview();
    }

    function runCommand(cmd, anchor) {
      if (st.readOnly) return;
      if (cmd === 'table') { openTablePicker(anchor || toolbar.querySelector('[data-cmd="table"]')); return; }
      if (cmd === 'date') { insertDateAtLineEnd(); return; }
      if (cmd === 'image') { if (o.attachments) { fileInput.value = ''; fileInput.click(); } return; }
      const text = ta.value;
      const s = ta.selectionStart || 0;
      const e = ta.selectionEnd || s;
      // In einem Tabellenfeld (v2.11.0): Aufgabe, Frage, Entscheid und Antwort wirken auf den Teil des Felds, nicht auf die Zeile
      if (Tables && ['task', 'question', 'decision', 'answer'].includes(cmd) && !text.slice(s, e).includes('\n')) {
        const cellEdit = Tables.togglePrefix(text, s, cmd);
        if (cellEdit) { applyEdit(cellEdit); return; }
      }
      let r = null;
      switch (cmd) {
        case 'bold': r = E.wrap(text, s, e, '**', '**', 'fett'); break;
        case 'italic': r = E.wrap(text, s, e, '*', '*', 'kursiv'); break;
        case 'strike': r = E.wrap(text, s, e, '~~', '~~', 'durchgestrichen'); break;
        case 'code': r = E.wrap(text, s, e, '`', '`', 'code'); break;
        case 'bullet': r = E.toggleList(text, s, e, 'bullet'); break;
        case 'ordered': r = E.toggleList(text, s, e, 'ordered'); break;
        case 'task': r = E.toggleList(text, s, e, 'task'); break;
        case 'quote': r = E.togglePrefix(text, s, e, 'quote'); break;
        case 'question': r = E.togglePrefix(text, s, e, 'question'); break;
        case 'answer': r = E.togglePrefix(text, s, e, 'answer'); break;
        case 'decision': r = E.togglePrefix(text, s, e, 'decision'); break;
        case 'codeblock': r = E.codeBlock(text, s, e); break;
        case 'hr': r = E.horizontalRule(text, s, e); break;
        case 'link': r = E.link(text, s, e); break;
        case 'wiki': r = E.wikiLink(text, s, e); break;
        default: return;
      }
      applyEdit(r);
      if (cmd === 'wiki') updateWikiPopup();
    }

    function setHeadingFromSelect() {
      const v = heading.value;
      heading.value = '';
      if (v === '' || st.readOnly) return;
      applyEdit(E.setHeading(ta.value, ta.selectionStart || 0, ta.selectionEnd || 0, Number(v)));
    }

    // ---------- Listen unter dem Cursor ----------

    /** Lage der Textstelle start im Textfeld, ohne zu scrollen: { top, left, lineH } (NoNotes bodyCaretBox). */
    function caretBox(start) {
      const cs = getComputedStyle(ta);
      const m = document.createElement('div');
      for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'boxSizing', 'tabSize', 'textIndent']) m.style[p] = cs[p];
      Object.assign(m.style, { position: 'absolute', top: '0', left: '0', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', border: '0', width: ta.clientWidth + 'px' });
      m.textContent = ta.value.slice(0, start);
      const marker = document.createElement('span');
      marker.textContent = ta.value.slice(start, start + 1) || '.';
      m.appendChild(marker);
      body.appendChild(m);
      const box = { top: marker.offsetTop, left: marker.offsetLeft, lineH: parseFloat(cs.lineHeight) || 20 };
      m.remove();
      return box;
    }

    /** Setzt eine Liste unter die Textstelle start (mit end: unter die Zeile, in der end steht); reicht der Platz nicht, darüber. */
    function placePopupAt(popup, start, end) {
      const c = caretBox(start);
      const e = end != null && end > start ? caretBox(end) : c;
      const lineTop = ta.offsetTop + e.top - ta.scrollTop;
      const left = ta.offsetLeft + Math.min(c.left, e.left) - ta.scrollLeft;
      const ph = popup.offsetHeight;
      let top = lineTop + c.lineH + 2;
      if (top + ph > body.clientHeight - 4 && lineTop - ph - 2 >= 0) top = lineTop - ph - 2;
      popup.style.left = Math.max(0, Math.min(left, body.clientWidth - popup.offsetWidth - 4)) + 'px';
      popup.style.top = Math.max(0, top) + 'px';
    }

    /** Scrollt das Textfeld so, dass die Stelle pos zu sehen ist. */
    function scrollTextTo(pos) {
      const c = caretBox(pos);
      if (c.top < ta.scrollTop || c.top + c.lineH > ta.scrollTop + ta.clientHeight) ta.scrollTop = Math.max(0, c.top - Math.round(ta.clientHeight / 3));
    }

    // ---------- Datumsauswahl (v3.0.0) ----------
    // «>» nach einem Leerzeichen (nicht am Zeilenanfang, nicht in Code) öffnet die Auswahl (datepicker.js); Ziffern, «.» und «-»
    // schreiben weiter, und der Kalender folgt, jedes andere Zeichen schliesst sie. Strg+Leertaste auf einem Termin, ein Klick auf
    // sein Abzeichen in der Vorschau oder der Knopf «Termin» öffnen sie ebenfalls. st.dp: { start (das «>»), end, edit }

    let datePick = null;
    function datePicker() {
      if (!datePick && global.NoNotesDatePicker) {
        datePick = global.NoNotesDatePicker.create(body, {
          onPick: value => insertPickedDate(value),
          onClose: () => { st.dp = null; },
          refocus: () => ta.focus(),
        });
      }
      return datePick;
    }
    function closeDatePicker() {
      st.dp = null;
      if (datePick) datePick.close();
    }
    function placeDatePicker() {
      if (st.dp && datePick && datePick.isOpen()) placePopupAt(datePick.el, st.dp.start);
    }

    /** Öffnet die Auswahl für dp; vorgewählt: der Termin selbst (Ändern), sonst die Frist der Zeile, sonst heute. */
    function openDatePicker(dp) {
      const p = datePicker();
      if (!p || st.readOnly) return;
      closeMentionPopup();
      st.dp = dp;
      const l = lineAround(ta.value, dp.start);
      const dates = lineDates(l.text);
      let day = null;
      let time = '';
      const own = dp.edit ? dates.find(d => l.start + d.start === dp.start) : null;
      if (own && own.iso) { day = own.iso; time = Dates.timePart(own.iso) || ''; }
      else { const all = dates.map(d => d.iso).filter(Boolean).sort(); day = all.length ? all[all.length - 1] : null; }
      p.open(day, time);
      placeDatePicker();
    }

    /** Setzt das gewählte Datum ein (immer «TT.MM.JJJJ», mit Uhrzeit «TT.MM.JJJJ HH:MM») und ordnet die Termine der Zeile. */
    function insertPickedDate(value) {
      const dp = st.dp;
      st.dp = null;
      if (!dp) return;
      const text = Dates.toText(value);
      if (!text) return;
      let v = ta.value.slice(0, dp.start) + '>' + text + ta.value.slice(dp.end);
      let caret = dp.start + 1 + text.length;
      const l = lineAround(v, dp.start);
      const sorted = sortLineDates(l.text);
      if (sorted != null) {
        v = v.slice(0, l.start) + sorted + v.slice(l.end);
        const dates = Dates.tail(sorted).dates;
        caret = l.start + (dates.length ? dates[dates.length - 1].end : sorted.length);
      }
      applyEdit({ text: v, selStart: caret, selEnd: caret });
    }

    function onDateInput(e) {
      if (!global.NoNotesDatePicker || st.readOnly || o.dates === false) return;
      const v = ta.value;
      const caret = ta.selectionStart || 0;
      if (st.dp) {
        const typed = v.slice(st.dp.start + 1, caret);
        if (v[st.dp.start] !== '>' || caret <= st.dp.start || !/^[\d.\-]*$/.test(typed)) { closeDatePicker(); return; }
        st.dp.end = Math.max(caret, st.dp.start + 1);
        datePicker().follow(typed);
        placeDatePicker();
        return;
      }
      if (!e || e.inputType !== 'insertText' || e.data !== '>' || caret !== (ta.selectionEnd || 0)) return;
      const at = caret - 1;
      if (v[at] !== '>') return;
      const l = lineAround(v, at);
      const before = v.slice(l.start, at);
      if (!/\S/.test(before) || !/\s$/.test(before)) return; // nach einem Leerzeichen, nicht am Zeilenanfang
      if (Tables && Tables.inCode && Tables.inCode(v.split('\n'), v.slice(0, at).split('\n').length - 1)) return;
      if (/`[^`]*$/.test(before) && (before.match(/`/g) || []).length % 2) return; // in `Code`
      openDatePicker({ start: at, end: caret });
    }

    /** Strg+Leertaste: auf einem Termin diesen mit der Auswahl ändern. */
    function openDateAtCaret() {
      const v = ta.value;
      const c = ta.selectionStart || 0;
      const l = lineAround(v, c);
      const tok = lineDates(l.text).find(d => c >= l.start + d.start && c <= l.start + d.end);
      if (!tok) return false;
      openDatePicker({ start: l.start + tok.start, end: l.start + tok.end, edit: true });
      return true;
    }

    /** Klick auf das Abzeichen eines Termins in der Vorschau: zum Termin im Text und die Auswahl öffnen. */
    function openDateFromBadge(badge) {
      const holder = badge.closest('[data-line]');
      if (!holder || st.readOnly) return;
      const line = Number(holder.dataset.line);
      const lines = ta.value.split('\n');
      if (!Number.isInteger(line) || lines[line] == null) return;
      const ls = lines.slice(0, line).reduce((n, x) => n + x.length + 1, 0);
      const tok = lineDates(lines[line]).find(d => d.iso === badge.dataset.date);
      if (!tok) return;
      if (st.mode === 'preview') setMode('split', false);
      ta.focus();
      ta.setSelectionRange(ls + tok.end, ls + tok.end);
      scrollTextTo(ls + tok.start);
      openDatePicker({ start: ls + tok.start, end: ls + tok.end, edit: true });
    }

    /** Knopf «Termin»: « >» ans Zeilenende (in einer Tabelle ans Ende des Felds) und die Auswahl öffnen. */
    function insertDateAtLineEnd() {
      const v = ta.value;
      const s0 = ta.selectionStart || 0;
      const l = lineAround(v, s0);
      let end = l.end;
      if (/^\s*\|/.test(l.text)) {
        const rest = l.text.slice(s0 - l.start);
        const m = /(?:^|[^\\])(?:\||<br\s*\/?>)/i.exec(rest);
        if (m) end = s0 + m.index + (m[0][0] === '|' || m[0][0] === '<' ? 0 : 1);
      }
      const head = v.slice(l.start, end).replace(/\s+$/, '');
      if (!/\S/.test(head) || /^\s*\|$/.test(head)) {
        hint(t('Termine stehen am Ende einer Zeile mit Text, etwa einer Aufgabe: «- [ ] Offerte einholen >30.10.2026».'));
        ta.focus();
        return;
      }
      const at = l.start + head.length + 1;
      applyEdit({ text: v.slice(0, l.start) + head + ' >' + v.slice(end).replace(/^[ \t]+(?=\||<br)/i, ' '), selStart: at + 1, selEnd: at + 1 });
      openDatePicker({ start: at, end: at + 1 });
    }

    /** Alte Termine «@Datum» (bis v2.x) in der Zeile, die der Cursor verlassen hat, als «>Datum» schreiben (rückgängig machbar). */
    function modernizeDates() {
      const v = ta.value;
      if (!o.modernizeDates || st.modernizing || !v.includes('@') || st.readOnly || !Dates.rewriteLegacy) return false;
      const s0 = ta.selectionStart || 0, e0 = ta.selectionEnd || 0;
      const next = Dates.rewriteLegacy(v, v.slice(0, s0).split('\n').length - 1);
      if (next === v) return false;
      const focused = document.activeElement === ta;
      st.modernizing = true;
      try {
        for (let i = 0; i < v.length; i++) {
          if (v[i] === next[i]) continue;
          ta.setSelectionRange(i, i + 1);
          if (!(focused && document.execCommand && document.execCommand('insertText', false, next[i]))) { ta.value = next; break; }
        }
        ta.setSelectionRange(s0, e0);
      } finally {
        st.modernizing = false;
      }
      return true;
    }

    // ---------- Vervollständigung @kürzel ----------

    async function updateMentionPopup() {
      const Mentions = global.NoNotesMentions;
      if (!Mentions || o.people === false || st.readOnly || document.activeElement !== ta) { closeMentionPopup(); return; }
      const caret = ta.selectionStart || 0;
      if (caret !== (ta.selectionEnd || 0)) { closeMentionPopup(); return; }
      const m = MENTION_PREFIX_RE.exec(ta.value.slice(Math.max(0, caret - 120), caret));
      if (!m) { closeMentionPopup(); return; }
      const prefix = m[1];
      const token = ++st.mentionSeq;
      // das Kürzel, das gerade getippt wird, schlägt sich nicht selbst vor (es steht nach dem Speichern vielleicht schon im Index)
      const items = (await Mentions.suggest(prefix, 9)).filter(it => !(it.handle.toLowerCase() === prefix.toLowerCase() && !it.name)).slice(0, 8);
      if (token !== st.mentionSeq || document.activeElement !== ta) return;
      if (!items.length) { closeMentionPopup(); return; }
      st.mention = { start: caret - prefix.length, items, index: 0 };
      mentionPopup.replaceChildren(...items.map((it, i) => h('button', { type: 'button', role: 'option', dataset: { index: String(i) }, 'aria-selected': String(i === 0), tabindex: -1 },
        h('span', { className: 'mention-handle' }, '@' + it.handle), it.name ? h('span', { className: 'mention-name' }, it.name) : null)));
      mentionPopup.hidden = false;
      placePopupAt(mentionPopup, st.mention.start);
    }

    function closeMentionPopup() {
      st.mention = null;
      st.mentionSeq++;
      mentionPopup.hidden = true;
      mentionPopup.replaceChildren();
    }

    function handleMentionKey(e) {
      const m = st.mention;
      if (!m) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        m.index = (m.index + (e.key === 'ArrowDown' ? 1 : m.items.length - 1)) % m.items.length;
        for (const b of mentionPopup.children) b.setAttribute('aria-selected', String(Number(b.dataset.index) === m.index));
        e.preventDefault();
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptMention(m.index); return true; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMentionPopup(); return true; }
      return false;
    }

    function acceptMention(index) {
      const m = st.mention;
      if (!m || !m.items[index]) return;
      const text = ta.value;
      const after = text.slice(ta.selectionStart || 0);
      const ins = m.items[index].handle + (/^[\s)]/.test(after) ? '' : ' ');
      closeMentionPopup();
      applyEdit({ text: text.slice(0, m.start) + ins + after, selStart: m.start + ins.length, selEnd: m.start + ins.length });
    }

    // ---------- Vorschläge für Verweise [[…]] (v2.9.0) ----------
    // «[[» tippen oder der Knopf öffnet die Liste der Ziele des Gastgebers (refs.list); Tippen schränkt sie ein. Enter oder Tab übernehmen,
    // Umschalt+Enter als Querverweis (refs.cross). Gibt es einen Titel mehrfach (dup), steht das Übergeordnete dabei; Strg zeigt die Pfade.

    /** Steht der Cursor in einem begonnenen Verweis «[[…» (auch zwischen «[[» und «]]»)? { start, end, close, query, star } oder null. */
    function wikiContext() {
      const caret = ta.selectionStart || 0;
      if (caret !== (ta.selectionEnd || 0)) return null;
      const text = ta.value;
      const before = /\[\[([^[\]\n]*)$/.exec(text.slice(Math.max(0, caret - 200), caret));
      if (!before) return null;
      const after = /^([^[\]\n]*)\]\]/.exec(text.slice(caret, caret + 200));
      const start = caret - before[1].length;
      const end = caret + (after ? after[1].length : 0);
      return { start, end, close: !!after, query: before[1].replace(/\*\s*$/, '').trim(), star: /\*\s*$/.test(text.slice(start, end)) };
    }

    /** Ziele für die Liste, einmal je Öffnen. */
    function wikiItems() {
      if (!st.wikiData) {
        st.wikiData = (async () => {
          const rows = (o.refs && o.refs.list ? await o.refs.list(api) : []) || [];
          return rows.filter(r => r && String(r.title || '').trim()).map((r, i) => Object.assign({}, r, {
            title: String(r.title).trim(), insert: r.insert != null ? String(r.insert) : String(r.title).trim(), fold: fold(String(r.title).trim()),
            archived: !!r.archived, updated: r.updated || '', path: Array.isArray(r.path) ? r.path : [], order: i,
          }));
        })();
      }
      return st.wikiData;
    }

    async function updateWikiPopup() {
      if (!o.refs || !o.refs.list || st.readOnly || document.activeElement !== ta) { closeWikiPopup(); return; }
      const c = wikiContext();
      if (!c) { closeWikiPopup(); return; }
      const token = ++st.wikiSeq;
      let items;
      try { items = await wikiItems(); } catch (e) { closeWikiPopup(); return; }
      if (token !== st.wikiSeq || document.activeElement !== ta) return;
      closeMentionPopup();
      const before = st.wiki;
      const found = refMatches(items, c.query);
      // Bei gleichem Suchtext bleibt die Wahl (etwa nach einem Klick in den Text), sonst steht der erste Vorschlag oben
      const index = before && before.query === c.query && before.items.length === found.length ? before.index : 0;
      st.wiki = Object.assign(c, { items: found, index, shown: 0 });
      wikiCount.textContent = found.length ? tn('{n} passende Notiz', '{n} passende Notizen', found.length) : t('Keine passende Notiz');
      wikiList.replaceChildren();
      showMoreWiki(Math.max(WIKI_PAGE, index + 1));
      wikiPopup.hidden = false;
      placePopupAt(wikiPopup, Math.max(0, c.start - 2));
      markWikiSelected();
    }

    /** Hängt Einträge bis upto an (die Liste wächst beim Blättern, damit auch tausend Ziele schnell bleiben). */
    function showMoreWiki(upto) {
      const w = st.wiki;
      const end = Math.min(w.items.length, upto);
      for (let i = w.shown; i < end; i++) {
        const n = w.items[i];
        const parent = n.parent != null ? String(n.parent) : n.path.length ? n.path[n.path.length - 1] : '';
        let path = n.path.join(' › ') || parent;
        if (path.length > 48) { // vorne kürzen: der Teil nahe am Ziel unterscheidet
          const parts = [];
          for (let k = n.path.length - 1, len = 0; k >= 0 && (len + n.path[k].length < 44 || !parts.length); k--) { parts.unshift(n.path[k]); len += n.path[k].length + 3; }
          path = '… › ' + parts.join(' › ');
        }
        wikiList.appendChild(h('button', { type: 'button', role: 'option', tabindex: -1, className: n.archived ? 'archived' : null,
          dataset: { index: String(i), id: n.id != null ? String(n.id) : null }, 'aria-selected': 'false', title: [...n.path, n.title].join(' › ') },
        h('span', { className: 'wiki-title' }, n.title),
        n.dup && parent ? h('span', { className: 'wiki-parent' }, parent) : null,
        path ? h('span', { className: 'wiki-path' }, path) : null,
        n.archived ? h('span', { className: 'wiki-tag' }, t('archiviert')) : null));
      }
      w.shown = Math.max(w.shown, end);
    }

    function markWikiSelected() {
      const w = st.wiki;
      if (!w) return;
      const prev = wikiList.querySelector('[aria-selected="true"]');
      if (prev) prev.setAttribute('aria-selected', 'false');
      const cur = wikiList.children[w.index];
      if (cur) { cur.setAttribute('aria-selected', 'true'); cur.scrollIntoView({ block: 'nearest' }); }
    }

    function closeWikiPopup() {
      st.wiki = null;
      st.wikiData = null;
      st.wikiSeq++;
      wikiPopup.hidden = true;
      wikiPopup.classList.remove('with-path');
      wikiList.replaceChildren();
    }

    function handleWikiKey(e) {
      const w = st.wiki;
      if (!w) return false;
      if (e.key === 'Control') { wikiPopup.classList.add('with-path'); return false; }
      const n = w.items.length;
      const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[e.key];
      if (n && step && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        w.index = Math.max(0, Math.min(n - 1, w.index + step));
        if (w.index >= w.shown) showMoreWiki(w.index + WIKI_PAGE);
        markWikiSelected();
        return true;
      }
      if (n && (e.key === 'Enter' || e.key === 'Tab') && !e.altKey) { e.preventDefault(); acceptWiki(w.index, e.key === 'Enter' && e.shiftKey); return true; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeWikiPopup(); return true; }
      return false;
    }

    /** Übernimmt den Vorschlag: der Inhalt zwischen «[[» und «]]» wird insert des Ziels; cross (oder ein schon getippter Stern) macht
     *  einen Querverweis, wenn der Gastgeber sie kennt. Der Cursor steht danach hinter «]]». */
    function acceptWiki(index, cross) {
      const w = st.wiki;
      const n = w && w.items[index];
      const c = wikiContext();
      if (!n || !c) { closeWikiPopup(); return; }
      const star = o.refs && o.refs.cross && (cross || c.star) ? '*' : '';
      const ins = `${n.insert}${star}]]`;
      const text = ta.value;
      const caret = c.start + ins.length;
      closeWikiPopup();
      applyEdit({ text: text.slice(0, c.start) + ins + text.slice(c.end + (c.close ? 2 : 0)), selStart: caret, selEnd: caret });
    }

    // ---------- Tabellen (v2.10.0): Raster zum Einfügen ----------

    let picker = null;
    const outsidePicker = e => {
      if (picker && !picker.box.hidden && !picker.box.contains(e.target) && !(picker.anchor && picker.anchor.contains(e.target))) closeTablePicker(false);
    };

    function tablePicker() {
      if (picker) return picker;
      const cells = [];
      const grid = h('div', { className: 'tp-grid', tabindex: 0, role: 'grid', 'aria-label': t('Grösse der Tabelle: Pfeiltasten, Enter fügt ein') });
      for (let r = 0; r < PICK_ROWS; r++) {
        for (let c = 0; c < PICK_COLS; c++) {
          const d = h('div', { className: 'tp-cell', dataset: { c: String(c + 1), r: String(r + 1) } });
          cells.push(d);
          grid.appendChild(d);
        }
      }
      const size = h('div', { className: 'tp-size' });
      const opts = h('div', { className: 'tp-opts' });
      const check = (text, on, cls) => {
        const i = h('input', { type: 'checkbox', className: cls, checked: on });
        opts.appendChild(h('label', {}, i, text));
        return i;
      };
      const head = check(t('Titelzeile'), true, 'tp-head');
      const headCol = check(t('Titelspalte'), false, 'tp-headcol');
      let gridOn = true;
      try { gridOn = global.localStorage.getItem(GRID_KEY) !== '0'; } catch (e) { /* ohne Speicher: Vorgabe */ }
      const gridBox = check(t('Mit Rahmen (mehrzeilige Felder)'), gridOn, 'tp-grid-kind');
      gridBox.parentElement.title = t('Tabelle mit Rahmen aus «+---+»: Felder dürfen mehrere Zeilen haben und sich über mehrere Spalten ziehen. Ohne: einfache Tabelle wie bei GitHub');
      gridBox.addEventListener('change', () => { try { global.localStorage.setItem(GRID_KEY, gridBox.checked ? '1' : '0'); } catch (e) { /* nicht gemerkt */ } });
      const box = h('div', { className: 'table-picker', hidden: true, role: 'dialog', 'aria-label': t('Tabelle einfügen') }, grid, size, opts);
      root.appendChild(box);
      const p = { box, grid, cols: 0, rows: 0, drag: false, sel: null, anchor: null };
      const paint = () => {
        for (const d of cells) {
          const c = Number(d.dataset.c);
          const r = Number(d.dataset.r);
          const on = c <= p.cols && r <= p.rows;
          d.classList.toggle('on', on);
          d.classList.toggle('head', on && r === 1 && head.checked);
        }
        size.textContent = p.cols ? t('{spalten} × {zeilen}', { spalten: p.cols, zeilen: p.rows }) : t('Grösse wählen');
      };
      p.set = (c, r) => { p.cols = Math.max(1, Math.min(PICK_COLS, c)); p.rows = Math.max(1, Math.min(PICK_ROWS, r)); paint(); };
      p.paint = paint;
      const cellAt = (x, y) => { const d = document.elementFromPoint(x, y); return d && d.classList && d.classList.contains('tp-cell') && grid.contains(d) ? d : null; };
      const insertNow = () => {
        if (!p.cols) return;
        const r = Tables.insert(ta.value, p.sel.s, p.sel.e, p.cols, p.rows,
          { header: head.checked, headerColumn: headCol.checked, label: n => t('Spalte {n}', { n }), grid: gridBox.checked });
        closeTablePicker(false);
        applyEdit(r);
      };
      grid.addEventListener('pointermove', e => { const d = cellAt(e.clientX, e.clientY); if (d) p.set(Number(d.dataset.c), Number(d.dataset.r)); });
      grid.addEventListener('pointerdown', e => {
        const d = cellAt(e.clientX, e.clientY);
        if (!d) return;
        e.preventDefault();
        p.drag = true;
        p.set(Number(d.dataset.c), Number(d.dataset.r));
        try { grid.setPointerCapture(e.pointerId); } catch (err) { /* nicht nötig */ }
      });
      grid.addEventListener('pointerup', e => {
        if (!p.drag) return;
        p.drag = false;
        const d = cellAt(e.clientX, e.clientY);
        if (d) p.set(Number(d.dataset.c), Number(d.dataset.r));
        insertNow();
      });
      grid.addEventListener('keydown', e => {
        const step = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
        if (step) { e.preventDefault(); p.set((p.cols || 1) + step[0], (p.rows || 1) + step[1]); }
        else if (e.key === 'Enter') { e.preventDefault(); insertNow(); }
      });
      box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeTablePicker(true); } });
      head.addEventListener('change', paint);
      picker = p;
      return p;
    }

    function openTablePicker(anchor) {
      if (!Tables || st.readOnly) return;
      const p = tablePicker();
      if (!p.box.hidden) { closeTablePicker(true); return; }
      p.sel = { s: ta.selectionStart || 0, e: ta.selectionEnd || 0 };
      p.anchor = anchor || null;
      p.cols = 0;
      p.rows = 0;
      p.drag = false;
      p.paint();
      p.box.hidden = false;
      const a = (anchor || ta).getBoundingClientRect();
      const w = p.box.offsetWidth;
      const bh = p.box.offsetHeight;
      p.box.style.left = `${Math.max(8, Math.min(a.left, global.innerWidth - w - 8))}px`;
      p.box.style.top = `${a.bottom + 6 + bh <= global.innerHeight - 8 ? a.bottom + 6 : Math.max(8, a.top - bh - 6)}px`;
      if (anchor) anchor.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', outsidePicker, true);
      p.grid.focus();
    }

    function closeTablePicker(backToText) {
      document.removeEventListener('pointerdown', outsidePicker, true);
      if (!picker || picker.box.hidden) return;
      picker.box.hidden = true;
      if (picker.anchor) picker.anchor.setAttribute('aria-expanded', 'false');
      if (backToText) ta.focus();
    }

    // ---------- Aufgaben in der Vorschau ----------

    /** Kästchen in der Vorschau: genau diese Zeile (oder den Teil eines Tabellenfelds) umschalten. Abhaken geht erst, wenn alle
     *  Unteraufgaben erledigt sind; Öffnen einer Unteraufgabe öffnet erledigte Hauptaufgaben mit. */
    function onPreviewChange(e) {
      const input = e.target.closest('li.task[data-line] input[type="checkbox"], .md-cell-task[data-line] input[type="checkbox"]');
      if (!input || st.readOnly) return;
      const holder = input.closest('[data-line]');
      const line = Number(holder.dataset.line);
      const slot = holder.dataset.slot != null ? Number(holder.dataset.slot) : null;
      if (input.checked) {
        const open = Tasks.openSubtasks(ta.value, line, slot);
        if (open > 0) { input.checked = false; hint(Tasks.openMessage(open)); return; }
        replaceText(Tasks.setDone(ta.value, line, true, slot));
      } else {
        replaceText(Tasks.reopen(ta.value, line, slot));
      }
    }

    /** Doppelklick auf den Text einer Aufgabe in der Vorschau: Aufgabe samt Unteraufgaben abschliessen oder wieder öffnen. */
    function onPreviewDblClick(e) {
      if (st.readOnly || e.target.closest('a, input, button, textarea')) return;
      const li = e.target.closest('li.task[data-line]');
      if (!li || !preview.contains(li)) return;
      const r = Tasks.doubleClick(ta.value, Number(li.dataset.line));
      if (!r.action) return;
      global.getSelection().removeAllRanges();
      replaceText(r.body);
      hint(r.action === 'completed' ? t('Aufgabe mit allen Unteraufgaben erledigt') : t('Aufgabe wieder geöffnet'));
    }

    // ---------- Antworten und Entscheide aus der Vorschau (options.answers) ----------

    function addAnswerButtons() {
      if (st.readOnly) return;
      for (const card of preview.querySelectorAll('.md-q.open')) {
        const li = card.parentElement && card.parentElement.matches('li.q-li[data-line]') ? card.parentElement : null;
        const line = card.dataset.line != null ? card.dataset.line : li ? li.dataset.line : null;
        const qBody = card.querySelector(':scope > .md-q-body');
        if (line == null || !qBody) continue;
        const decision = card.classList.contains('md-decision');
        qBody.appendChild(h('div', { className: 'md-q-actions' },
          h('button', { type: 'button', className: 'small md-q-answer', 'data-write': true, dataset: { line } }, decision ? t('Entscheiden') : t('Beantworten'))));
      }
    }

    const questionAt = line => Q.parse(ta.value).find(q => q.lineIndex === line && !q.cell) || null;

    /** Kleines Formular in der Karte: Ctrl+Enter oder «Speichern» schreibt die Antwort (den Entscheid) unter den Eintrag. */
    function openAnswerForm(button) {
      const card = button.closest('.md-q');
      const line = Number(button.dataset.line);
      const q = questionAt(line);
      const actions = card.querySelector('.md-q-actions');
      if (!q || !actions || st.readOnly) return;
      const decision = q.kind === 'decision';
      const area = h('textarea', { className: 'md-answer-text', rows: 2, placeholder: decision ? t('Entscheid…') : t('Antwort…'), 'aria-label': decision ? t('Entscheid') : t('Antwort') });
      const save = h('button', { type: 'button', className: 'primary small md-answer-save' }, t('Speichern'));
      const cancel = h('button', { type: 'button', className: 'ghost small md-answer-cancel' }, t('Abbrechen'));
      actions.replaceWith(h('div', { className: 'q-form md-answer-form' }, area, h('div', { className: 'row' }, save, cancel)));
      const finish = ok => {
        const now = questionAt(line);
        if (!ok || !now || !area.value.trim()) { renderPreview(); return; }
        const opts = decision && !now.decided ? { decided: Dates.toText(Dates.todayIso()) } : {};
        replaceText(Q.writeAnswer(ta.value, now, area.value, opts));
        hint(decision ? t('Entscheid gespeichert') : t('Antwort gespeichert'));
      };
      save.addEventListener('click', () => finish(true));
      cancel.addEventListener('click', () => finish(false));
      area.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finish(true); }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      });
      area.focus();
    }

    // ---------- Tabellen: Tippen, Kontextmenü ----------

    const tableLabel = n => t('Spalte {n}', { n });

    /** Ersetzt nur den Teil, der sich unterscheidet, über execCommand, damit Rückgängig weiter geht (Ausrichten beim Tippen in
     *  Tabellen mit Rahmen); danach die Auswahl. */
    function replaceKeepingUndo(next, selStart, selEnd) {
      const cur = ta.value;
      let p = 0;
      while (p < cur.length && p < next.length && cur[p] === next[p]) p++;
      let q = 0;
      while (q < cur.length - p && q < next.length - p && cur[cur.length - 1 - q] === next[next.length - 1 - q]) q++;
      const ins = next.slice(p, next.length - q);
      if (p < cur.length - q || ins) {
        ta.setSelectionRange(p, cur.length - q);
        st.gridApplying = true;
        let ok = false;
        try { ok = !!(document.execCommand && document.execCommand(ins ? 'insertText' : 'delete', false, ins)); } catch (e) { ok = false; }
        finally { st.gridApplying = false; }
        if (!ok || ta.value !== next) ta.value = next;
      }
      ta.setSelectionRange(selStart, selEnd);
    }

    /** Tabellen mit Rahmen brauchen gleich breite Zeichen: solange der Text eine enthält, schreibt der Editor in Festbreitenschrift. */
    function updateEditorFont() {
      body.classList.toggle('grid-font', !!(Tables && Tables.hasGrid && Tables.hasGrid(ta.value)));
    }

    /** Was ein Feld der Vorschau meint: { line, row (-1 Titelzeile), col, cols, rows, header, headerColumn, meta, grid, span } oder null. */
    function tableTarget(cellEl) {
      const table = cellEl.closest('table.md-table[data-src]');
      if (!table || !Tables) return null;
      const line = Number(table.dataset.src);
      const found = Tables.tableAtLine(ta.value, line);
      if (!found) return null;
      const tb = found.t;
      const tr = cellEl.parentElement;
      const row = tr.closest('thead') ? -1 : Number(tr.dataset.row);
      const col = Number(cellEl.dataset.col);
      const spans = tb.kind === 'grid' ? (row < 0 ? tb.spans.h : tb.spans.rows[row]) : null;
      return { line, row, col, cols: tb.cols, rows: tb.rows.length, header: !!tb.header, headerColumn: tb.meta.kopfspalte === true,
        meta: tb.meta, grid: tb.kind === 'grid', span: spans && spans[col] > 0 ? spans[col] : 1 };
    }

    /** Rechtsklick auf eine Tabelle der Vorschau: Titelzeile und -spalte, Hervorheben, Zeilen, Spalten, Verbinden, Teilen, Umwandeln;
     *  dazu die Einträge der Erweiterungen (extend.tableMenu). */
    function tableMenu(e, cellEl) {
      const tg = tableTarget(cellEl);
      if (!tg) return false;
      e.preventDefault();
      const caret = () => ta.selectionStart || 0;
      const run = fn => () => {
        const r = fn(ta.value);
        if (r && r.text !== ta.value) replaceText(r.text, r);
      };
      const items = [
        { write: true, label: t('Titelzeile'), checked: tg.header, title: t('Erste Zeile als Titel, bleibt beim Scrollen oben und steht im Druck auf jeder Seite'), action: run(text => Tables.toggleHeader(text, tg.line, tableLabel, caret())) },
        { write: true, label: t('Titelspalte'), checked: tg.headerColumn, title: t('Erste Spalte als Titel'), action: run(text => Tables.setMeta(text, tg.line, m => { m.kopfspalte = !tg.headerColumn; }, caret())) },
        { write: true, label: t('Titel hervorheben'), checked: tg.meta.hervorheben === true, title: t('Titelzeile und Titelspalte im Ton der Hauptfarbe'), action: run(text => Tables.setMeta(text, tg.line, m => { m.hervorheben = tg.meta.hervorheben !== true; }, caret())) },
        'sep',
      ];
      if (tg.row >= 0) items.push({ write: true, label: t('Zeile darüber einfügen'), action: run(text => Tables.insertRow(text, tg.line, tg.row, 'above')) });
      items.push({ write: true, label: t('Zeile darunter einfügen'), action: run(text => Tables.insertRow(text, tg.line, tg.row, 'below')) });
      if (tg.row >= 0) items.push({ write: true, label: t('Zeile löschen'), action: run(text => Tables.deleteRow(text, tg.line, tg.row, caret())) });
      items.push('sep',
        { write: true, label: t('Spalte links einfügen'), action: run(text => Tables.insertColumn(text, tg.line, tg.col, 'left', tg.header ? tableLabel : null)) },
        { write: true, label: t('Spalte rechts einfügen'), action: run(text => Tables.insertColumn(text, tg.line, tg.col, 'right', tg.header ? tableLabel : null)) });
      if (tg.cols > 1) items.push({ write: true, label: t('Spalte löschen'), action: run(text => Tables.deleteColumn(text, tg.line, tg.col, caret())) });
      items.push('sep');
      if (tg.col + tg.span < tg.cols) items.push({ write: true, label: t('Mit dem Feld rechts verbinden'), title: tg.grid ? t('Das Feld zieht sich über beide Spalten, der Text kommt untereinander') : t('Das Feld zieht sich über beide Spalten; die Tabelle bekommt dafür einen Rahmen'), action: run(text => Tables.mergeRight(text, tg.line, tg.row, tg.col)) });
      if (tg.span > 1) items.push({ write: true, label: t('Feld teilen'), title: t('Der Text bleibt im ersten Feld'), action: run(text => Tables.splitCell(text, tg.line, tg.row, tg.col)) });
      items.push(tg.grid
        ? { write: true, label: t('In einfache Tabelle umwandeln'), title: t('Ohne Rahmen, wie bei GitHub: verbundene Felder werden geteilt, Zeilen im Feld mit <br> verbunden'), action: run(text => Tables.convert(text, tg.line, 'pipe', caret())) }
        : { write: true, label: t('In Tabelle mit Rahmen umwandeln'), title: t('Mit mehrzeiligen Feldern: aus <br> wird eine neue Zeile im Feld'), action: run(text => Tables.convert(text, tg.line, 'grid', caret())) });
      const extra = ext.tableMenu ? ext.tableMenu(Object.assign({ editor: api, entity: o.entity }, tg)) || [] : [];
      if (extra.length) items.push('sep', ...extra);
      o.showMenu(items, e.clientX, e.clientY);
      return true;
    }

    /** Format einer Tabelle ändern (NoNotes ctx.tables.update): fn(meta) ändert das Objekt oder liefert ein neues; true bei Änderung. */
    function updateTableMeta(line, fn) {
      if (st.readOnly || !Tables) return false;
      const r = Tables.setMeta(ta.value, Number(line), fn, ta.selectionStart || 0);
      if (!r || r.text === ta.value) return false;
      replaceText(r.text, r);
      return true;
    }

    // ---------- Bilder (att:ID) ----------

    /** Objekt-URL für ein Bild des Gastgebers, gemerkt, damit sie nicht mehrfach angelegt wird (beim Zerstören freigegeben). */
    async function attachmentUrl(id) {
      if (st.attUrls.has(id)) return st.attUrls.get(id);
      if (!o.attachments || !o.attachments.get) return null;
      let row = null;
      try { row = await o.attachments.get(id); } catch (e) { row = null; }
      if (!row || st.destroyed) return null;
      if (st.attUrls.has(id)) return st.attUrls.get(id);
      const url = URL.createObjectURL(new Blob([row.bytes || row.data], { type: row.mime }));
      st.attUrls.set(id, url);
      return url;
    }

    /** Holt vorab die Bilder, auf die ein Text verweist, damit das Rendern danach ohne Warten auskommt. */
    async function prefetchAttachments(text) {
      if (!o.attachments) return;
      const found = [...new Set([...String(text || '').matchAll(/\(att:(\d+)\)/g)].map(m => Number(m[1])))];
      await Promise.all(found.map(id => attachmentUrl(id)));
    }

    function forgetAttachmentUrl(id) {
      const url = st.attUrls.get(id);
      if (url) { URL.revokeObjectURL(url); st.attUrls.delete(id); }
    }

    /** Die Leiste über dem Text: jedes Bild mit «Einfügen» und «Löschen» (verborgen ohne Bilder). */
    async function renderAttachments() {
      if (!o.attachments || !o.attachments.list || st.destroyed) return;
      let rows = [];
      try { rows = (await o.attachments.list()) || []; } catch (e) { rows = []; }
      const urls = await Promise.all(rows.map(a => attachmentUrl(a.id)));
      if (st.destroyed) return;
      if (st.mode !== 'edit' && urls.some(Boolean) && preview.querySelector('.md-missing')) renderPreview();
      strip.dataset.count = String(rows.length);
      strip.hidden = rows.length === 0;
      strip.replaceChildren(...rows.map((a, i) => h('figure', { className: 'attachment', dataset: { id: String(a.id) } },
        h('img', { src: urls[i] || '', alt: a.name, title: t('In den Text einfügen'), on: { click: () => insertAttachmentRef(a) } }),
        h('div', { className: 'name', title: `${a.name} · ${Math.round((a.size || 0) / 1024)} KB` }, a.name),
        h('div', { className: 'row' },
          h('button', { type: 'button', className: 'att-insert', disabled: st.readOnly, on: { click: () => insertAttachmentRef(a) } }, t('Einfügen')),
          h('button', { type: 'button', className: 'danger att-delete', disabled: st.readOnly, on: { click: () => removeAttachment(a) } }, t('Löschen'))))));
    }

    /** Fügt Text auf einer eigenen Zeile an der Cursorstelle ein. */
    function insertAtCursor(text) {
      const start = ta.selectionStart || 0;
      const end = ta.selectionEnd || start;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const insert = (before.length && !before.endsWith('\n') ? '\n' : '') + text + (after.startsWith('\n') || !after.length ? '' : '\n');
      const pos = before.length + insert.length;
      applyEdit({ text: before + insert + after, selStart: pos, selEnd: pos });
    }

    function insertAttachmentRef(a) {
      if (st.readOnly) return;
      const alt = String(a.name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[[\]]/g, '');
      insertAtCursor(`![${alt}](att:${a.id})`);
    }

    const ask = (text, opts) => (o.confirm ? o.confirm(text, opts) : Promise.resolve(global.confirm(text)));

    async function removeAttachment(a) {
      if (st.readOnly || !o.attachments.remove) return;
      if (!(await ask(t('Bild „{name}“ aus dieser Notiz entfernen? Verweise im Text zeigen danach ins Leere.', { name: a.name }), { danger: true, yes: t('Löschen') }))) return;
      try { await o.attachments.remove(a.id); } catch (e) { hint(errorText(e)); return; }
      forgetAttachmentUrl(a.id);
      await renderAttachments();
      if (st.mode !== 'edit') renderPreview();
    }

    function imageSize(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('no image')); }; // i18n-ignore: interner Fehler
        img.src = url;
      });
    }

    /** Verkleinert grosse Bilder (lange Kante 1600 px, JPEG; PNG bleibt, wenn klein genug), damit die Datenbank handlich bleibt. */
    async function prepareImage(file) {
      const mime = file.type || 'application/octet-stream';
      const bytes = new Uint8Array(await file.arrayBuffer());
      const maxBytes = o.attachments.maxBytes || MAX_ATTACHMENT_BYTES;
      const maxEdge = o.attachments.maxEdge || MAX_ATTACHMENT_EDGE;
      if (!mime.startsWith('image/') || mime === 'image/svg+xml' || mime === 'image/gif') return { name: file.name, mime, bytes };
      if (bytes.length <= maxBytes) {
        const dims = await imageSize(file).catch(() => null);
        if (!dims || Math.max(dims.w, dims.h) <= maxEdge) return { name: file.name, mime, bytes };
      }
      try {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        if (bitmap.close) bitmap.close();
        const keepPng = mime === 'image/png' && bytes.length <= 2 * maxBytes;
        const outMime = keepPng ? 'image/png' : 'image/jpeg';
        const blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob'))), outMime, 0.85));
        const out = new Uint8Array(await blob.arrayBuffer());
        if (out.length >= bytes.length && scale === 1) return { name: file.name, mime, bytes };
        const name = outMime === 'image/jpeg' ? String(file.name || 'bild').replace(/\.[a-z0-9]{2,5}$/i, '') + '.jpg' : file.name;
        return { name, mime: outMime, bytes: out };
      } catch (e) {
        return { name: file.name, mime, bytes };
      }
    }

    /** Eingefügte, abgelegte oder gewählte Bilder: beim Gastgeber gespeichert, ein Verweis ![Name](att:ID) an der Cursorstelle. */
    async function addAttachments(files) {
      if (!o.attachments || !o.attachments.add || st.readOnly) return;
      const images = [...files].filter(f => f && f.type && f.type.startsWith('image/'));
      if (!images.length) { hint(t('Nur Bilder können angehängt werden.')); return; }
      hint(tn('Bild wird eingefügt…', '{n} Bilder werden eingefügt…', images.length));
      try {
        for (const file of images) {
          const prepared = await prepareImage(file);
          const name = prepared.name || `bild-${Date.now()}.png`;
          const added = await o.attachments.add({ name, mime: prepared.mime, bytes: prepared.bytes });
          insertAttachmentRef({ id: added.id, name: added.name || name });
        }
        hint('');
      } catch (e) {
        hint(t('Bild konnte nicht eingefügt werden: {fehler}', { fehler: errorText(e) }));
      }
      await renderAttachments();
    }

    // ---------- Videos (YouTube, Vimeo, Dailymotion) ----------

    /** Baut den Rahmen erst jetzt (nach dem Klick) und ersetzt die Karte. Der Rahmen ist abgeschottet (sandbox), sendet die Herkunft der
     *  Seite (YouTube verlangt sie), aber keinen Pfad, und darf selbst abspielen, weil die Person eben geklickt hat. */
    function loadEmbed(box, autoplay) {
      const url = box.dataset.embed;
      if (!url || box.querySelector('iframe')) return;
      const frame = h('iframe', { src: autoplay ? url + (url.includes('?') ? '&' : '?') + 'autoplay=1' : url, title: box.dataset.title || '',
        loading: 'lazy', referrerPolicy: 'strict-origin-when-cross-origin', allowFullscreen: true, className: 'md-embed-frame' });
      frame.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture; encrypted-media'); // i18n-ignore: Berechtigungen des Rahmens
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox allow-forms');
      box.replaceChildren(frame);
      st.loadedEmbeds.add(url);
    }

    // ---------- Pfade auf Dateien und Ordner (v2.12.0) ----------

    /** Pfad in die Zwischenablage (Windows-Schreibweise, zum Einfügen im Explorer); ohne Zwischenablage zum Kopieren gezeigt. */
    async function copyPath(path) {
      try {
        await global.navigator.clipboard.writeText(path);
        hint(conf.localFiles ? t('Pfad kopiert: {pfad}', { pfad: path }) : t('Pfad kopiert – im Explorer einfügen: {pfad}', { pfad: path }));
      } catch (e) {
        global.prompt(t('Pfad (mit Ctrl+C kopieren):'), path);
      }
    }

    /** Rechtsklick auf einen Pfad (Link oder Bild): «Öffnen» (nur lokal) und «Pfad kopieren». */
    function pathMenu(e, target) {
      e.preventDefault();
      const path = target.dataset.path;
      const href = target.tagName === 'IMG' ? target.getAttribute('src') : target.getAttribute('href');
      const items = [];
      if (conf.localFiles) items.push({ label: target.classList.contains('md-path-folder') ? t('Ordner öffnen') : t('Öffnen'), action: () => { global.open(href, '_blank', 'noopener'); } });
      items.push({ label: t('Pfad kopieren'), title: path, action: () => copyPath(path) });
      o.showMenu(items, e.clientX, e.clientY);
    }

    /** Einfügen von Pfaden (wie «Als Pfad kopieren» im Explorer): ohne Anführungszeichen, mit Leerzeichen in spitzen Klammern. */
    function pastePathText(e) {
      const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
      const conv = text ? M.pastePaths(text) : null;
      if (!conv) return false;
      e.preventDefault();
      ta.focus();
      if (!document.execCommand || !document.execCommand('insertText', false, conv)) { // execCommand: Rückgängig bleibt
        ta.setRangeText(conv, ta.selectionStart, ta.selectionEnd, 'end');
        onEdit();
      }
      return true;
    }

    // ---------- Ausfüllbare Platzhalter (v2.12.0) ----------

    async function keepPlaceholders() {
      try { return o.placeholders && o.placeholders.keep ? !!(await o.placeholders.keep()) : false; } catch (e) { return false; }
    }

    /** Verschiebt eine Stelle um die Änderungen davor: edits [{ start, end, len }]. */
    function shiftPos(pos, edits) {
      let p = pos;
      for (const x of edits) if (x.end <= pos) p += x.len - (x.end - x.start);
      return p;
    }

    /** Ein Wert für alle Platzhalter eines Namens: keep → {{?Name: Wert}}, sonst der Wert. */
    function fillName(text, name, value, keep) {
      const edits = [];
      let out = text;
      for (const p of PH.scan(text).filter(x => PH.same(x.name, name)).reverse()) {
        const r = keep ? PH.token(p.name, value) : value;
        out = out.slice(0, p.start) + r + out.slice(p.end);
        edits.push({ start: p.start, end: p.end, len: r.length });
      }
      return { text: out, edits };
    }

    /** Beginnt das Ausfüllen, nachdem ein Text mit Platzhaltern eingefügt wurde (start/end: der eingefügte Bereich). */
    async function startPlaceholders(opts) {
      if (!PH || st.readOnly) return false;
      const toks = PH.scan(ta.value);
      if (!toks.length) return false;
      if (st.mode === 'preview') setMode('split', false);
      st.ph = { keep: typeof opts.keep === 'boolean' ? opts.keep : await keepPlaceholders(), insTail: opts.end == null ? null : ta.value.length - opts.end, field: null };
      selectField(toks.find(p => p.start >= (opts.start || 0)) || toks[0], true);
      hint(t('Platzhalter ausfüllen: Tab springt zum nächsten, Umschalt+Tab zurück, Esc beendet.'));
      return true;
    }

    /** Wählt einen Platzhalter: einen offenen ganz (Tippen ersetzt ihn), einen ausgefüllten seinen Wert. */
    function selectField(tok, select) {
      const ph = st.ph;
      if (!ph || !tok) return;
      const v = ta.value;
      const open = tok.value == null;
      const a = open ? tok.start : tok.valueStart;
      const b = open ? tok.end : tok.valueEnd;
      if (document.activeElement !== ta) ta.focus();
      if (select || open) { ta.setSelectionRange(a, b); scrollTextTo(a); }
      ph.field = { name: tok.name, start: a, tail: v.length - b, open, token: v.slice(tok.start, tok.end), original: tok.value };
      showPhHint(tok.name, a, b);
    }

    /** Kasten mit der Beschreibung unter der Zeile des Platzhalters; ohne Beschreibung keiner. */
    function showPhHint(name, pos, end) {
      const desc = PH.describe(PH.descriptions(ta.value), name);
      if (!desc) { hidePhHint(); return; }
      const descBox = h('div', { className: 'md' });
      descBox.innerHTML = M.render(desc, { embeds: false, placeholders: 'plain' }); // nur die Ausgabe von NoNotesMarkdown
      phHint.replaceChildren(h('div', { className: 'ph-hint-name' }, name), descBox,
        h('div', { className: 'ph-hint-keys' }, t('Tab: nächster Platzhalter · Umschalt+Tab: voriger · Esc: fertig')));
      phHint.hidden = false;
      placePopupAt(phHint, pos, end);
    }

    function hidePhHint() {
      phHint.hidden = true;
      phHint.replaceChildren();
    }

    /** Verlässt den aktuellen Platzhalter: setzt den Wert (keep: {{?Name: Wert}}), füllt gleiche Namen überall, lässt Beschreibungen
     *  weg, die kein Platzhalter mehr braucht. Liefert { start, end, name } des Felds danach oder null. */
    function leaveField() {
      const ph = st.ph;
      const f = ph && ph.field;
      if (!f) return null;
      ph.field = null;
      hidePhHint();
      const v = ta.value;
      const end = v.length - f.tail;
      if (end < f.start) return null;
      const typed = v.slice(f.start, end);
      let text = v;
      let cut = null;
      if (f.open) {
        if (typed === f.token) return { start: f.start, end, name: f.name }; // übersprungen: bleibt offen
        if (ph.keep) cut = { start: f.start, end, len: PH.token(f.name, typed).length, repl: PH.token(f.name, typed) };
      } else if (!ph.keep) {
        if (typed === f.original) return { start: f.start, end, name: f.name };
        const tok = PH.at(v, f.start);
        if (tok) cut = { start: tok.start, end: tok.end, len: typed.length, repl: typed };
      }
      if (cut) text = v.slice(0, cut.start) + cut.repl + v.slice(cut.end);
      const map1 = pos => (cut && pos >= cut.end ? pos + cut.len - (cut.end - cut.start) : pos);
      let fStart = cut ? cut.start : f.start;
      let fEnd = cut ? cut.start + cut.len : end;
      let r = { text, edits: [] };
      if (!/\n/.test(typed)) r = fillName(text, f.name, typed, ph.keep);
      const map2 = pos => shiftPos(pos, r.edits);
      fStart = map2(fStart);
      fEnd = map2(fEnd);
      const caret = map2(map1(ta.selectionStart));
      const next = PH.pruneDescriptions(r.text, o.placeholders && o.placeholders.extraText ? o.placeholders.extraText() : '');
      if (ph.insTail != null) {
        const insEnd = v.length - ph.insTail;
        let tail = ph.insTail;
        if (cut && cut.start >= insEnd) tail += cut.len - (cut.end - cut.start);
        const insEnd1 = map1(insEnd);
        for (const x of r.edits) if (x.start >= insEnd1) tail += x.len - (x.end - x.start);
        ph.insTail = Math.max(0, tail - (r.text.length - next.length));
      }
      if (next !== v) {
        ta.value = next;
        const c = Math.min(caret, next.length);
        ta.setSelectionRange(c, c);
        onEdit();
      }
      // Gleiche Namen ausserhalb des Editors (in NoNotes: der Titel) füllt der Gastgeber
      if (o.placeholders && o.placeholders.onFill && !/\n/.test(typed) && typed !== f.token) o.placeholders.onFill(f.name, typed, ph.keep);
      return { start: Math.min(fStart, ta.value.length), end: Math.min(fEnd, ta.value.length), name: f.name };
    }

    /** Tab (dir 1) oder Umschalt+Tab (dir -1): zum nächsten oder vorigen Platzhalter; nach dem letzten ans Ende des eingefügten Texts. */
    function phJump(dir) {
      const ph = st.ph;
      if (!ph) return;
      const left = leaveField();
      if (!st.ph) return;
      const toks = PH.scan(ta.value).filter(p => !left || !PH.same(p.name, left.name)); // gleiche Namen sind schon ausgefüllt
      const at = left || { start: ta.selectionStart, end: ta.selectionEnd };
      const tok = dir > 0 ? toks.find(p => p.start >= at.end && (!left || p.start !== left.start)) : toks.filter(p => p.end <= at.start).pop() || null;
      if (!tok && dir < 0) { if (left) ta.setSelectionRange(left.start, left.start); return; }
      if (!tok) {
        const endAt = ph.insTail != null ? Math.max(0, ta.value.length - ph.insTail) : (left ? left.end : ta.selectionEnd);
        endPlaceholders();
        ta.focus();
        ta.setSelectionRange(endAt, endAt);
        return;
      }
      selectField(tok, true);
    }

    function endPlaceholders() {
      st.ph = null;
      hidePhHint();
    }

    /** Tasten beim Ausfüllen: Tab, Umschalt+Tab, Esc (und Enter mit «behalten»: der Wert bleibt auf einer Zeile). */
    function handlePhKey(e) {
      const ph = st.ph;
      if (!ph || e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && ph.keep && ph.field)) {
        e.preventDefault();
        e.stopPropagation();
        phJump(e.key === 'Tab' && e.shiftKey ? -1 : 1);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        leaveField();
        endPlaceholders();
        return true;
      }
      return false;
    }

    /** Der Cursor hat sich bewegt (Klick, Pfeile): in einen Platzhalter hinein beginnt das Ausfüllen, hinaus beendet es. */
    async function phCaretMoved() {
      if (!PH || st.readOnly) return;
      const c = ta.selectionStart;
      if (c !== ta.selectionEnd) return;
      const ph = st.ph;
      if (ph && ph.field) {
        const end = ta.value.length - ph.field.tail;
        if (c >= ph.field.start && c <= end) return; // noch im Feld
        leaveField();
      }
      const tok = PH.at(ta.value, ta.selectionStart);
      if (!tok) { if (st.ph) endPlaceholders(); return; }
      if (!st.ph) st.ph = { keep: await keepPlaceholders(), insTail: null, field: null };
      selectField(tok, tok.value == null);
    }

    /** «Platzhalter auflösen»: der Name (oder alle) wird Text; Beschreibungen ohne Platzhalter fallen weg. */
    function resolvePlaceholders(name) {
      if (st.readOnly) return;
      endPlaceholders();
      const v = ta.value;
      const next = PH.pruneDescriptions(PH.resolve(v, name || null), '');
      if (next === v) return;
      replaceText(next);
      hint(name ? t('Platzhalter «{name}» aufgelöst.', { name }) : t('Alle Platzhalter dieser Notiz aufgelöst.'));
    }

    /** Rechtsklick auf einen Platzhalter in der Vorschau oder im Text: einen oder alle auflösen. */
    function onPhContextMenu(e) {
      if (!PH || st.readOnly || !o.showMenu) return false;
      const span = e.target.closest && e.target.closest('.md-ph[data-ph]');
      let name = span && preview.contains(span) ? span.dataset.ph : null;
      if (!name && e.target === ta && ta.selectionStart === ta.selectionEnd) {
        const tok = PH.at(ta.value, ta.selectionStart);
        if (tok) name = tok.name;
      }
      if (!name) return false;
      e.preventDefault();
      e.stopPropagation();
      o.showMenu([
        { write: true, label: t('Platzhalter «{name}» auflösen', { name }), title: t('Der Text bleibt, die Markierung als Platzhalter fällt weg'), action: () => resolvePlaceholders(name) },
        { write: true, label: t('Alle Platzhalter der Notiz auflösen'), action: () => resolvePlaceholders(null) },
      ], e.clientX, e.clientY);
      return true;
    }

    /** Klick auf einen Platzhalter in der Vorschau: im Text auswählen (aus der Vorschau allein wird die geteilte Ansicht). */
    async function onPreviewPlaceholderClick(span) {
      if (st.readOnly) return;
      const toks = PH.scan(ta.value).filter(p => PH.same(p.name, span.dataset.ph));
      if (!toks.length) return;
      if (st.mode === 'preview') setMode('split', false);
      if (!st.ph) st.ph = { keep: await keepPlaceholders(), insTail: null, field: null };
      selectField(toks[0], true);
    }

    /** insert(text, { keep }): ein Text mit Platzhaltern beginnt das Ausfüllen (wie eine Vorlage in NoNotes). */
    function insertText(text, opts) {
      if (st.readOnly) return;
      const s0 = ta.selectionStart || 0;
      const r = E.insert(ta.value, s0, ta.selectionEnd || s0, String(text));
      applyEdit(r);
      if (PH && PH.scan(String(text)).length) startPlaceholders({ start: s0, end: r.selEnd, keep: opts && opts.keep });
    }

    // ---------- Tasten ----------

    function onTextKeydown(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (e.isComposing || ta.readOnly) return;
      if (st.dp && datePick && datePick.isOpen() && datePick.key(e)) { e.preventDefault(); e.stopPropagation(); return; }
      if (mod && e.key === ' ' && !e.shiftKey && !e.altKey && openDateAtCaret()) { e.preventDefault(); return; }
      if (st.wiki && handleWikiKey(e)) return;
      if (st.ph && st.ph.field && st.mention && e.key === 'Tab' && !mod && !e.altKey) {
        // Kürzel in einem Platzhalter: Tab übernimmt den Vorschlag (falls einer passt) und springt weiter
        e.preventDefault();
        e.stopPropagation();
        const m = st.mention;
        if (!e.shiftKey && m.items[m.index]) acceptMention(m.index); else closeMentionPopup();
        phJump(e.shiftKey ? -1 : 1);
        return;
      }
      if (st.mention && handleMentionKey(e)) return;
      if (st.ph && handlePhKey(e)) return;
      // Tabellen: Tab/Umschalt+Tab von Feld zu Feld, Enter eine neue Zeile (mit Rahmen: eine neue Zeile im Feld), Umschalt+Enter «<br>»,
      // Strg+Enter eine neue Zeile einer Tabelle mit Rahmen, Rücktaste/Entf an den Enden einer Zeile im Feld verbinden die Zeilen
      if (Tables && !e.altKey) {
        const value = ta.value;
        const s = ta.selectionStart || 0;
        const end = ta.selectionEnd || s;
        let r = null;
        if (!mod && (e.key === 'Tab' || e.key === 'Enter') && !value.slice(s, end).includes('\n')) {
          r = e.key === 'Tab' ? Tables.move(value, s, e.shiftKey ? -1 : 1) : e.shiftKey ? Tables.lineBreak(value, s) : Tables.enter(value, s);
        } else if (mod && !e.shiftKey && e.key === 'Enter' && s === end) {
          r = Tables.newRow(value, s);
        } else if (!mod && !e.shiftKey && (e.key === 'Backspace' || e.key === 'Delete') && s === end) {
          r = Tables.joinLine(value, s, e.key === 'Backspace' ? -1 : 1);
        }
        if (r) { e.preventDefault(); if (r.text !== value || r.selStart !== s || r.selEnd !== end) applyEdit(r); return; }
      }
      // Listen, Aufgaben, Zitate und Antworten weiterführen; Umschalt+Enter bleibt die normale neue Zeile
      if (e.key === 'Enter' && !mod && !e.shiftKey && !e.altKey) {
        const r = E.continueLine(ta.value, ta.selectionStart || 0, ta.selectionEnd || 0);
        if (r) { e.preventDefault(); applyEdit(r); }
        return;
      }
      if (e.key === 'Tab' && !mod && !e.altKey) {
        const r = E.indentLines(ta.value, ta.selectionStart || 0, ta.selectionEnd || 0, e.shiftKey ? -1 : 1);
        if (r) { e.preventDefault(); applyEdit(r); }
        return;
      }
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey) {
        const cmd = { f: 'question', a: 'answer', d: 'decision' }[k];
        if (cmd) { e.preventDefault(); runCommand(cmd); }
        return;
      }
      const cmd = { b: 'bold', i: 'italic', k: 'link' }[k];
      if (cmd) { e.preventDefault(); runCommand(cmd); }
    }

    /** Tasten im ganzen Editor: Ctrl+E wechselt die Darstellung, F1 öffnet die Hilfe des Gastgebers, Ctrl+S speichert sofort. */
    function onRootKeydown(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (e.target.closest && e.target.closest('.table-picker')) return;
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e' && o.modeKeys !== false) { e.preventDefault(); e.stopPropagation(); cycleMode(); }
      else if (e.key === 'F1' && o.help) { e.preventDefault(); e.stopPropagation(); o.help(api); }
      else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's' && o.onChange) saveNow();
    }

    // ---------- Schreibschutz, Erweiterungen ----------

    function renderPluginTools() {
      const list = ext.toolbar ? ext.toolbar(api) || [] : [];
      pluginTools.replaceChildren(...list.map(x => h('button', { type: 'button', className: 'tb-plugin', dataset: { plugin: x.plugin || '' }, title: x.title || x.label,
        'aria-label': x.title || x.label, disabled: st.readOnly, on: { click: () => { if (!st.readOnly) x.run(api); } } }, x.label)));
    }

    function setReadOnly(b) {
      st.readOnly = !!b;
      ta.readOnly = st.readOnly;
      for (const x of toolbar.querySelectorAll('button')) x.disabled = st.readOnly;
      heading.disabled = st.readOnly;
      if (actionBar) actionBar.hidden = st.readOnly;
      root.classList.toggle('readonly', st.readOnly);
      if (st.readOnly) { closeMentionPopup(); closeWikiPopup(); closeDatePicker(); closeTablePicker(false); endPlaceholders(); }
      for (const x of strip.querySelectorAll('button')) x.disabled = st.readOnly;
      if (st.mode && st.mode !== 'edit') renderPreview(); // Kästchen und Antwortknöpfe folgen
    }

    // ---------- Ereignisse ----------

    toolbar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); }); // Fokus und Markierung bleiben
    toolbar.addEventListener('click', e => {
      const b = e.target.closest('button[data-cmd]');
      if (b) { e.preventDefault(); runCommand(b.dataset.cmd, b); }
    });
    if (attachBtn) attachBtn.addEventListener('click', () => runCommand('image'));
    heading.addEventListener('change', setHeadingFromSelect);
    modeSwitch.addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]');
      if (b) setMode(b.dataset.mode, true);
    });
    modeSwitch.addEventListener('keydown', e => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const order = MODES.map(([m]) => m);
      setMode(order[(order.indexOf(st.mode) + step + order.length) % order.length], true);
      modeSwitch.querySelector(`[data-mode="${st.mode}"]`).focus();
    });
    if (helpBtn) helpBtn.addEventListener('click', () => o.help(api));
    if (historyBtn) historyBtn.addEventListener('click', () => o.history.open(api));
    if (tplBtn) {
      tplBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation(); // die Seite schliesst offene Menüs bei einem Klick
        if (st.readOnly) return;
        const items = [{ write: true, label: t('Vorlage einfügen…'), action: () => o.templates.insert(api) }];
        if (o.templates.save) items.push({ label: t('Als Vorlage speichern…'), action: () => o.templates.save(api) });
        if (!o.showMenu) { items[0].action(); return; }
        const r = tplBtn.getBoundingClientRect();
        o.showMenu(items, r.left, r.bottom + 4);
      });
    }
    root.addEventListener('keydown', onRootKeydown);
    root.addEventListener('focusin', () => { lastFocused = api; });
    ta.addEventListener('keydown', onTextKeydown);
    // Tabellen mit Rahmen (v3.3.0): beim Tippen bleiben die Striche untereinander (Tables.typed); der Text davor kommt aus beforeinput.
    // Rückgängig und Wiederholen bleiben, wie sie sind (sonst entstünde dabei ein neuer Schritt)
    ta.addEventListener('beforeinput', e => {
      if (st.gridApplying) return;
      st.gridPrev = e.inputType && e.inputType.startsWith('history') ? null : ta.value;
    });
    ta.addEventListener('input', e => {
      const prev = st.gridPrev;
      st.gridPrev = null;
      if (Tables && Tables.typed && !st.gridApplying && prev != null) {
        const c = ta.selectionStart || 0;
        if (c === (ta.selectionEnd || c)) {
          const r = Tables.typed(prev, ta.value, c);
          if (r) replaceKeepingUndo(r.text, r.selStart, r.selEnd);
        }
      }
      if (st.gridApplying || st.modernizing) return;
      onEdit(); updateMentionPopup(); updateWikiPopup(); onDateInput(e);
    });
    ta.addEventListener('click', () => {
      // Klick in den Zwischenraum eines Felds einer Tabelle mit Rahmen: der Cursor kommt hinter den Text
      if (Tables && Tables.snap && ta.selectionStart === ta.selectionEnd) {
        const p = Tables.snap(ta.value, ta.selectionStart || 0);
        if (p != null) ta.setSelectionRange(p, p);
      }
      if (st.mention) updateMentionPopup();
      if (st.wiki) updateWikiPopup();
      if (st.dp) closeDatePicker();
      phCaretMoved();
      if (modernizeDates()) onEdit(); // alte «@Datum» in der Zeile, die der Cursor verlassen hat (v3.0.0)
    });
    ta.addEventListener('keyup', e => {
      if (/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(e.key) && !st.mention && !st.wiki && !st.dp) {
        phCaretMoved();
        if (/^(ArrowUp|ArrowDown|PageUp|PageDown)$/.test(e.key) && modernizeDates()) onEdit();
      }
      if (e.key === 'Enter' && !st.dp && modernizeDates()) onEdit(); // die Zeile davor ist verlassen
      if (e.key === 'Control') wikiPopup.classList.remove('with-path');
      else if (st.wiki && /^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) updateWikiPopup(); // Cursor aus dem Verweis: Liste zu
    });
    ta.addEventListener('scroll', () => {
      if (st.mention) placePopupAt(mentionPopup, st.mention.start);
      if (st.wiki) placePopupAt(wikiPopup, Math.max(0, st.wiki.start - 2));
      if (st.dp) placeDatePicker();
      const f = st.ph && st.ph.field;
      if (f && !phHint.hidden) placePopupAt(phHint, f.start, ta.value.length - f.tail);
    });
    ta.addEventListener('contextmenu', onPhContextMenu);
    ta.addEventListener('paste', e => {
      if (st.readOnly) return;
      const items = e.clipboardData && e.clipboardData.items ? [...e.clipboardData.items] : [];
      const files = items.filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
      if (files.length && o.attachments) { e.preventDefault(); addAttachments(files); return; }
      pastePathText(e);
    });
    ta.addEventListener('dragover', e => {
      if (!st.readOnly && o.attachments && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); ta.classList.add('drop-target'); }
    });
    ta.addEventListener('dragleave', () => ta.classList.remove('drop-target'));
    ta.addEventListener('drop', e => {
      ta.classList.remove('drop-target');
      if (!st.readOnly && o.attachments && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); addAttachments(e.dataTransfer.files); }
    });
    fileInput.addEventListener('change', () => { const files = [...fileInput.files]; fileInput.value = ''; addAttachments(files); });
    ta.addEventListener('blur', () => setTimeout(() => {
      if (st.destroyed || document.activeElement === ta) return;
      closeMentionPopup();
      closeWikiPopup();
      if (st.dp && !(datePick && datePick.el.contains(document.activeElement))) closeDatePicker();
      if (o.onChange && !root.contains(document.activeElement) && isDirty()) saveNow(); // wer den Editor verlässt, speichert sofort
    }, 0));
    const offCtrl = e => { if (e.type === 'blur' || e.key === 'Control') wikiPopup.classList.remove('with-path'); };
    global.addEventListener('keyup', offCtrl);
    global.addEventListener('blur', offCtrl);
    mentionPopup.addEventListener('mousedown', e => e.preventDefault()); // der Fokus bleibt im Textfeld
    mentionPopup.addEventListener('click', e => { const b = e.target.closest('button[data-index]'); if (b) acceptMention(Number(b.dataset.index)); });
    wikiPopup.addEventListener('mousedown', e => e.preventDefault());
    wikiPopup.addEventListener('click', e => { const b = e.target.closest('button[data-index]'); if (b) acceptWiki(Number(b.dataset.index), e.shiftKey); });
    wikiList.addEventListener('scroll', () => {
      const w = st.wiki;
      if (w && w.shown < w.items.length && wikiList.scrollTop + wikiList.clientHeight > wikiList.scrollHeight - 60) showMoreWiki(w.shown + WIKI_PAGE);
    });
    preview.addEventListener('click', e => {
      if (e.target.closest('.md-answer-form')) return;
      const badge = e.target.closest('[data-date]');
      if (badge && preview.contains(badge) && !e.target.closest('a')) { openDateFromBadge(badge); return; }
      const phSpan = PH && e.target.closest('.md-ph[data-ph]');
      if (phSpan && !e.target.closest('a')) { onPreviewPlaceholderClick(phSpan); return; }
      const load = e.target.closest('.md-embed-load');
      if (load) { e.preventDefault(); loadEmbed(load.closest('.md-embed'), true); return; }
      const answer = e.target.closest('.md-q-answer');
      if (answer) { e.preventDefault(); openAnswerForm(answer); return; }
      const a = e.target.closest('a');
      if (!a) return;
      if (o.onLinkClick && o.onLinkClick(a, e, api)) return;
      if (a.classList.contains('md-path')) {
        // lokal öffnet der Link die Datei in einem neuen Tab (Vorgabe des Browsers); aus einer Webseite kopiert er den Pfad
        if (e.button !== 0 || conf.localFiles) return;
        e.preventDefault();
        copyPath(a.dataset.path);
        return;
      }
      if (a.classList.contains('md-wiki')) {
        e.preventDefault();
        if (o.refs && o.refs.open) o.refs.open({ id: a.dataset.noteId != null ? a.dataset.noteId : null, title: a.dataset.title || '', el: a, event: e });
      } else if (a.getAttribute('href') === '#') e.preventDefault();
    });
    preview.addEventListener('change', onPreviewChange);
    preview.addEventListener('dblclick', onPreviewDblClick);
    preview.addEventListener('contextmenu', e => {
      if (onPhContextMenu(e)) return;
      if (!o.showMenu) return;
      const path = e.target.closest('a.md-path, img.md-path-img');
      if (path) { pathMenu(e, path); return; }
      const cellEl = e.target.closest('table.md-table[data-src] th, table.md-table[data-src] td');
      if (cellEl && !st.readOnly) tableMenu(e, cellEl);
    });
    if (global.NoNotesScrollSync) {
      sync = global.NoNotesScrollSync.create({ textarea: ta, preview, mirror, isActive: () => st.mode === 'split' && root.isConnected });
    }

    const api = {
      el: root,
      textarea: ta,
      preview,
      toolbar,
      entity: o.entity,
      isWritable: () => !st.readOnly && !st.destroyed,
      isReadOnly: () => st.readOnly,
      updateTableMeta,
      refreshExtensions: () => { renderPluginTools(); if (st.mode !== 'edit') renderPreview(); },
      get: () => ta.value,
      set,
      focus: () => ta.focus(),
      setReadOnly,
      mode: (name, remember) => { if (name) setMode(name, remember !== false); return st.mode; },
      insert: insertText,
      insertAtCursor: text => { if (!st.readOnly) insertAtCursor(String(text)); },
      fillPlaceholders: opts => startPlaceholders({ start: 0, end: PH ? PH.stripDescriptions(ta.value).replace(/\s+$/, '').length : ta.value.length, keep: opts && opts.keep }),
      startPlaceholders,
      selection: () => ({ start: ta.selectionStart || 0, end: ta.selectionEnd || 0, text: ta.value.slice(ta.selectionStart || 0, ta.selectionEnd || 0) }),
      replaceSelection: text => {
        if (st.readOnly) return false;
        applyEdit(E.insert(ta.value, ta.selectionStart || 0, ta.selectionEnd || 0, String(text)));
        return true;
      },
      applyEdit: r => { if (!st.readOnly) applyEdit(r); },
      runCommand,
      counts,
      isDirty,
      flush: () => saveNow(),
      renderPreview,
      renderAttachments,
      addAttachments,
      forgetAttachment: forgetAttachmentUrl,
      closePopups: () => { closeMentionPopup(); closeWikiPopup(); closeDatePicker(); closeTablePicker(false); endPlaceholders(); },
      get previewed() { return st.previewed == null ? null : st.previewed; },
      destroy() {
        st.destroyed = true;
        clearTimeout(st.saveTimer);
        clearTimeout(st.previewTimer);
        closeTablePicker(false);
        closeDatePicker();
        global.removeEventListener('keyup', offCtrl);
        global.removeEventListener('blur', offCtrl);
        for (const url of st.attUrls.values()) URL.revokeObjectURL(url);
        st.attUrls.clear();
        live.delete(api);
        if (lastFocused === api) lastFocused = null;
        root.remove();
      },
    };
    editors.set(root, api);
    live.add(api);

    const remembered = o.remember === false ? null : readModes()[kind];
    setMode(o.mode || (MODES.some(([m]) => m === remembered) ? remembered : 'split'), false);
    setReadOnly(st.readOnly);
    renderCounts();
    updateEditorFont();
    renderAttachments();
    renderPluginTools();
    return api;
  }

  /** Der Editor um ein Element (seine Wurzel oder etwas darin) oder null. */
  function of(node) {
    const r = node && node.closest ? node.closest('.nn-editor') : null;
    return r ? editors.get(r) || null : null;
  }

  /** Die Editoren auf der Seite (entfernte fallen weg). */
  function all() {
    for (const x of [...live]) if (!x.el.isConnected) live.delete(x);
    return [...live];
  }

  /** Der Editor, der zuletzt den Fokus hatte, solange er auf der Seite ist. */
  const focused = () => (lastFocused && lastFocused.el.isConnected ? lastFocused : null);

  /** Rückrufe einer Erweiterungs-Schnittstelle; ein Aufruf ersetzt die genannten. Danach refreshExtensions() an den Editoren. */
  function extend(hooks) {
    for (const k of Object.keys(ext)) if (hooks && (typeof hooks[k] === 'function' || hooks[k] === null)) ext[k] = hooks[k];
    for (const x of all()) x.refreshExtensions();
  }

  global.NoNotesEditor = { VERSION, MODE_KEY, MODES: MODES.map(([m]) => m), create, configure, of, all, focused, extend, h };
})(typeof window !== 'undefined' ? window : globalThis);
