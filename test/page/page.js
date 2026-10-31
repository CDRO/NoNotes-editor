/* Testseite des Editors: ein Gastgeber mit nachgebauten Rückrufen (Bilder, Verweise, Personen, Speichern, Menüs). test/editor.cjs
   öffnet sie per file:// und liest window.log. Adresse: index.html?lang=en stellt Englisch ein und ersetzt einen Text. */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const log = { modes: [], inputs: 0, saves: [], opened: [], menus: [], help: 0, filled: [], removed: [] };
  window.log = log;
  if (params.get('lang') === 'en') {
    document.documentElement.lang = 'en';
    NoNotesEditor.configure({ language: 'en', messages: { en: { 'Fett': 'Strong' } } });
  }

  const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  const atts = new Map([[1, { id: 1, name: 'punkt.png', mime: 'image/png', bytes: PNG, size: PNG.length }]]);
  let nextAtt = 2;
  const NOTES = [
    { id: 7, title: 'Protokoll', updated: '2026-10-01', path: ['Projekte'] },
    { id: 8, title: 'Projekt Alpha', updated: '2026-09-01', path: ['Projekte'] },
    { id: 9, title: 'Ferien', archived: true },
  ];
  NoNotesMentions.provide(async () => [{ handle: 'anna', name: 'Anna Muster' }, { handle: 'ben', name: 'Ben Beispiel' }]);

  let failNext = null;
  window.failNextSave = code => { failNext = code; };

  const ed = NoNotesEditor.create(document.getElementById('host'), {
    value: params.get('value') || '# Start\n\n- [ ] Erste Aufgabe\n- [ ] Zweite Aufgabe\n\n? Offene Frage @anna\n\n![Punkt](att:1)\n',
    updatedAt: '2026-10-31T08:00:00.000Z',
    kind: 'test', remember: false, mode: 'split',
    ids: { body: 'body', preview: 'preview', toolbar: 'mdToolbar', modeSwitch: 'modeSwitch', help: 'helpBtn', attach: 'attachBtn', attachInput: 'attachInput', attachments: 'attachments' },
    onInput: () => { log.inputs++; },
    onMode: mode => { log.modes.push(mode); },
    onChange: async (text, info) => {
      if (failNext) { const code = failNext; failNext = null; throw Object.assign(new Error('Konflikt'), { code }); }
      log.saves.push({ text, base: info.baseUpdatedAt });
      return { updatedAt: new Date().toISOString() };
    },
    reload: async () => ({ text: 'Fassung von anderswo', updatedAt: '2026-10-31T09:00:00.000Z' }),
    resolveConflict: async () => 'mine',
    attachments: {
      list: async () => [...atts.values()],
      get: async id => atts.get(id) || null,
      add: async a => { const id = nextAtt++; atts.set(id, Object.assign({ id, size: a.bytes.length }, a)); return { id, name: a.name }; },
      remove: async id => { log.removed.push(id); atts.delete(id); },
    },
    refs: {
      list: async () => NOTES,
      resolver: async () => target => {
        const n = NOTES.find(x => x.title.toLowerCase() === String(target).replace(/\*$/, '').trim().toLowerCase());
        return n ? { id: n.id, label: n.title } : { id: null, label: target };
      },
      open: x => log.opened.push({ id: x.id, title: x.title }),
      cross: true,
    },
    showMenu: (items, x, y) => { window.lastMenu = items; log.menus.push(items.map(i => (i === 'sep' ? '-' : i.label))); },
    confirm: async () => true,
    help: () => { log.help++; },
    counts: true,
    answers: true,
    placeholders: { keep: async () => false, onFill: (name, value) => log.filled.push([name, value]) },
  });
  window.ed = ed;
  document.body.dataset.ready = 'true';
})();
