/* Test des Editors im Browser: öffnet test/page/index.html per file:// in Chromium (wie NoNotes das Gebaute) und bedient den Baustein
   wie ein Mensch: Toolleiste, Darstellungen, Tasten, Vorschau, Aufgaben, @kürzel, [[Verweise]], Datumsauswahl, Tabellen, Platzhalter,
   Bilder, Schreibschutz, Erweiterungen, Speichern und Konflikt, Texte auf Englisch mit Ersetzung.
   Ausführen: node test/editor.cjs   (Chromium: NONOTES_EDITOR_CHROMIUM=/pfad/zu/chrome, siehe test/lib.cjs) */
'use strict';

const path = require('node:path');
const assert = require('node:assert/strict');
const { suite } = require('./lib.cjs');

const PAGE = 'file://' + path.join(__dirname, 'page', 'index.html');
const READY = 'body[data-ready="true"]';

async function open(browser, query) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e));
  page.on('console', m => { if (m.type() === 'error') errors.push(new Error(m.text())); });
  await page.goto(PAGE + (query || ''));
  await page.waitForSelector(READY);
  page.errors = errors;
  return page;
}

const text = page => page.$eval('#body', ta => ta.value);
const setText = (page, value, caret) => page.evaluate(([v, c]) => {
  window.ed.set(v);
  const ta = document.getElementById('body');
  ta.focus();
  const p = c == null ? v.length : c;
  ta.setSelectionRange(p, p);
}, [value, caret == null ? null : caret]);
const previewHas = (page, sel) => page.waitForSelector('#preview ' + sel);

async function runBasics(browser, part) {
  const page = await open(browser);
  assert.equal(await page.$eval('.nn-editor', r => r.className), 'nn-editor mode-split');
  assert.equal(await page.$$eval('#mdToolbar button[data-cmd]', b => b.length), 17, 'Knöpfe der Toolleiste');
  assert.ok(await page.$('#attachBtn:not([hidden])'), 'Bild einfügen mit Bildern des Gastgebers');
  await previewHas(page, 'h1');
  assert.equal(await page.$eval('#preview h1', h => h.textContent), 'Start');
  await page.waitForSelector('#preview img.md-att[src^="blob:"]');
  assert.equal(await page.$eval('.nn-counts', c => c.textContent), '2 offene Aufgaben · 1 offene Frage');
  part('Aufbau: feste Kennungen, Toolleiste, geteilte Ansicht, Vorschau mit Bild aus den Anhängen, Zähler');

  await page.click('#modeSwitch [data-mode="edit"]');
  assert.ok(await page.$eval('#preview', p => getComputedStyle(p).display === 'none'));
  await page.focus('#body');
  await page.keyboard.press('Control+e');
  assert.equal(await page.evaluate(() => window.ed.mode()), 'split');
  await page.keyboard.press('Control+e');
  assert.equal(await page.evaluate(() => window.ed.mode()), 'preview');
  assert.ok(await page.$eval('#body', b => getComputedStyle(b).display === 'none'));
  await page.keyboard.press('Control+e');
  assert.deepEqual(await page.evaluate(() => window.log.modes), ['split', 'edit', 'split', 'preview', 'edit'], 'onMode für den Gastgeber');
  assert.deepEqual(await page.evaluate(() => window.log.remember), [false, true, true, true, true], 'onMode: remember nur, wenn die Person wählt');
  await page.keyboard.press('F1');
  assert.equal(await page.evaluate(() => window.log.help), 1, 'F1 ruft die Hilfe des Gastgebers');
  part('Darstellungen: Knöpfe und Ctrl+E (Bearbeiten → Geteilt → Vorschau), F1');

  await setText(page, 'eins zwei', 0);
  await page.evaluate(() => document.getElementById('body').setSelectionRange(5, 9));
  await page.keyboard.press('Control+b');
  assert.equal(await text(page), 'eins **zwei**');
  await page.click('#mdToolbar [data-cmd="task"]');
  assert.equal(await text(page), '- [ ] eins **zwei**');
  await page.evaluate(() => { const ta = document.getElementById('body'); ta.setSelectionRange(ta.value.length, ta.value.length); });
  await page.keyboard.press('Enter');
  await page.keyboard.type('drei');
  assert.equal(await text(page), '- [ ] eins **zwei**\n- [ ] drei');
  await page.selectOption('#mdToolbar select', '2');
  assert.ok((await text(page)).split('\n')[1].startsWith('## '), 'Überschrift 2 auf der Zeile des Cursors');
  part('Toolleiste und Tasten: Ctrl+B, Aufgabe, Enter führt die Liste weiter, Überschrift');

  await setText(page, '- [ ] Haupt\n  - [ ] Unter\n');
  await page.click('#modeSwitch [data-mode="split"]');
  await previewHas(page, 'li.task[data-line="0"] input');
  await page.click('#preview li.task[data-line="0"] > .task-text > input');
  assert.equal(await text(page), '- [ ] Haupt\n  - [ ] Unter\n', 'Hauptaufgabe erst, wenn die Unteraufgaben erledigt sind');
  await page.click('#preview li.task[data-line="1"] input');
  assert.equal(await text(page), '- [ ] Haupt\n  - [x] Unter\n');
  await page.waitForFunction(() => window.log.saves.length > 0);
  const save = await page.evaluate(() => window.log.saves[window.log.saves.length - 1]);
  assert.equal(save.base, '2026-10-31T08:00:00.000Z', 'onChange bekommt den Stand, auf dem die Änderung beruht');
  assert.equal(await page.evaluate(() => window.ed.flush()), true);
  assert.equal(await page.$eval('.nn-editor', r => r.dataset.state), 'saved');
  part('Aufgaben in der Vorschau abhaken (Unteraufgaben zuerst), verzögertes Speichern über onChange, flush()');
  assert.deepEqual(page.errors, []);
  await page.close();
}

async function runPopups(browser, part) {
  const page = await open(browser);
  await setText(page, 'Frage an ');
  await page.keyboard.type('@an');
  await page.waitForSelector('.mention-popup:not([hidden]):not(.wiki-popup) button');
  await page.keyboard.press('Enter');
  assert.equal(await text(page), 'Frage an @anna ');
  part('@kürzel: Vorschläge der Lieferanten (NoNotesMentions), Enter übernimmt');

  await setText(page, 'Siehe ');
  await page.keyboard.type('[[Pro');
  await page.waitForSelector('.wiki-popup:not([hidden]) .wiki-list button');
  assert.equal(await page.$eval('.wiki-count', c => c.textContent), '2 passende Notizen');
  assert.deepEqual(await page.$$eval('.wiki-list .wiki-title', b => b.map(x => x.textContent)), ['Protokoll', 'Projekt Alpha'], 'zuletzt geändert zuerst');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Shift+Enter');
  assert.equal(await text(page), 'Siehe [[Projekt Alpha*]]', 'Umschalt+Enter: Querverweis');
  await page.waitForSelector('#preview a.md-wiki');
  await page.click('#preview a.md-wiki');
  assert.deepEqual(await page.evaluate(() => window.log.opened), [{ id: '8', title: 'Projekt Alpha' }]);
  part('[[Verweise]]: Ziele des Gastgebers, Anzahl, Reihenfolge, Querverweis, Klick in der Vorschau an refs.open');

  await setText(page, '- [ ] Offerte');
  await page.keyboard.type(' >');
  await page.waitForSelector('.dp:not([hidden])');
  await page.keyboard.press('Enter');
  const today = await page.evaluate(() => NoNotesDates.toText(NoNotesDates.todayIso()));
  assert.equal(await text(page), `- [ ] Offerte >${today}`);
  assert.ok(await page.$eval('.dp', d => d.hidden));
  part('Datumsauswahl: « >» öffnet sie, Enter setzt das volle Datum');

  await setText(page, '');
  await page.click('#mdToolbar [data-cmd="table"]');
  await page.waitForSelector('.table-picker:not([hidden])');
  await page.uncheck('.tp-grid-kind');
  await page.focus('.tp-grid');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const table = await text(page);
  assert.ok(/^\| Spalte 1 \| Spalte 2 \|\n\| -+ \| -+ \|\n\|\s+\|\s+\|\n?/.test(table), table);
  await page.waitForSelector('#preview table.md-table td');
  await page.click('#preview table.md-table td', { button: 'right' });
  const menu = await page.evaluate(() => window.log.menus[window.log.menus.length - 1]);
  assert.ok(menu.includes('Titelzeile') && menu.includes('Zeile darunter einfügen') && menu.includes('In Tabelle mit Rahmen umwandeln'), menu.join(', '));
  await page.evaluate(() => window.lastMenu.find(i => i.label === 'Zeile darunter einfügen').action());
  assert.equal((await text(page)).trim().split('\n').length, table.trim().split('\n').length + 1, 'eine Zeile mehr');
  part('Tabellen: Raster einfügen, Rechtsklick in der Vorschau an showMenu, Eintrag ändert den Text');

  await setText(page, '');
  await page.evaluate(() => window.ed.insert('Liebe {{?Name}}, danke {{?Name}}. {{?Gruss}}'));
  await page.keyboard.type('Anna');
  await page.keyboard.press('Tab');
  assert.equal(await text(page), 'Liebe Anna, danke Anna. {{?Gruss}}');
  assert.deepEqual(await page.evaluate(() => window.log.filled), [['Name', 'Anna']], 'gleicher Name ausserhalb: placeholders.onFill');
  assert.equal(await page.evaluate(() => window.ed.selection().text), '{{?Gruss}}', 'Tab springt zum nächsten');
  await page.keyboard.press('Escape');
  part('Platzhalter: insert() beginnt das Ausfüllen, gleiche Namen überall, Tab springt, onFill für den Gastgeber');
  assert.deepEqual(page.errors, []);
  await page.close();
}

async function runHostHooks(browser, part) {
  const page = await open(browser);
  await page.waitForSelector('#attachments figure.attachment');
  await setText(page, 'Bild:');
  await page.setInputFiles('#attachInput', { name: 'neu.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  await page.waitForFunction(() => document.getElementById('body').value.includes('(att:2)'));
  assert.equal(await text(page), 'Bild:\n![neu](att:2)');
  await page.waitForSelector('#attachments figure[data-id="2"]');
  await page.click('#attachments figure[data-id="2"] .att-delete');
  await page.waitForFunction(() => window.log.removed.includes(2));
  part('Bilder: Datei wählen → attachments.add, Verweis an der Cursorstelle, Leiste, Löschen mit confirm');

  await page.evaluate(() => NoNotesEditor.extend({ toolbar: () => [{ plugin: 'probe', label: 'P', title: 'Probe einfügen', run: e => e.replaceSelection('[Probe]') }] }));
  await page.waitForSelector('#mdToolbar .tb-plugin[data-plugin="probe"]');
  await setText(page, 'x');
  await page.click('#mdToolbar .tb-plugin');
  assert.equal(await text(page), 'x[Probe]');
  await page.evaluate(() => NoNotesEditor.extend({ tableFormat: () => () => [{ table: { class: 'probe-table' } }], toolbar: null }));
  await setText(page, '| a |\n|---|\n| 1 |');
  await page.waitForSelector('#preview table.md-table.probe-table');
  assert.equal(await page.$('#mdToolbar .tb-plugin'), null, 'toolbar: null nimmt die Knöpfe weg');
  assert.equal(await page.evaluate(() => NoNotesEditor.of(document.getElementById('body')) === window.ed && NoNotesEditor.all().length === 1), true);
  part('Erweiterungen: extend() mit Knopf in der Toolleiste, Tabellenformat in der Vorschau, of(), all()');

  await page.evaluate(() => window.ed.setReadOnly(true));
  assert.equal(await page.$eval('#body', b => b.readOnly), true);
  assert.equal(await page.$$eval('#mdToolbar button', b => b.every(x => x.disabled)), true);
  await setText(page, '- [ ] Aufgabe');
  await previewHas(page, 'li.task input:disabled');
  await page.evaluate(() => window.ed.setReadOnly(false));
  await previewHas(page, 'li.task input:not(:disabled)');
  part('Schreibschutz: Textfeld, Toolleiste und Kästchen gesperrt, wieder frei');

  await page.evaluate(() => { window.failNextSave('CONFLICT'); });
  await page.focus('#body');
  await page.keyboard.type(' neu');
  assert.equal(await page.evaluate(() => window.ed.flush()), true);
  const last = await page.evaluate(() => window.log.saves[window.log.saves.length - 1]);
  assert.equal(last.base, '2026-10-31T09:00:00.000Z', 'nach resolveConflict «mine» auf dem neuen Stand geschrieben');
  assert.equal(last.text, '- [ ] Aufgabe neu');
  part('Konflikt: onChange mit CONFLICT → reload, resolveConflict, «Meine Fassung» schreibt auf dem neuen Stand');
  assert.deepEqual(page.errors, []);
  await page.close();
}

/* Was NoNotes v4.0.0 braucht: ein Feld vor dem Text (der Titel) beim Ausfüllen von Platzhaltern, weitere feste Kennungen,
   refresh() nach einem Text von aussen, selectLine(), forgetAttachment() ohne Kennung, hint(text, kind). */
async function runHostField(browser, part) {
  const page = await open(browser);
  const r = await page.evaluate(async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const title = document.createElement('input');
    title.id = 't2';
    box.appendChild(title);
    const host = document.createElement('div');
    box.appendChild(host);
    window.log2 = { filled: [], hints: [] };
    window.ed2 = NoNotesEditor.create(host, {
      remember: false, mode: 'edit', ids: { body: 'b2', editorBody: 'eb2', mirror: 'm2', tablePicker: 'tp2' },
      placeholders: { field: title, onFill: (n, v, k, info) => window.log2.filled.push([n, v, k, info.field, info.data]) },
      attachments: { list: () => [], add: async () => ({ id: 1 }) },
      hint: (t, k) => window.log2.hints.push([t, k]),
    });
    title.value = 'Protokoll {{?Kunde}}';
    window.ed2.set('Kunde: {{?Kunde}}, Ort {{?Ort}}\n\n```template-description Kunde\nFirma, wie im Handelsregister\n```');
    const started = await window.ed2.startPlaceholders({ start: 0, end: 29, keep: false, data: { tag: 1 } });
    return { started, active: document.activeElement === title, sel: [title.selectionStart, title.selectionEnd], hint: !document.querySelector('#eb2 .ph-hint').hidden };
  });
  assert.deepEqual(r, { started: true, active: true, sel: [10, 20], hint: true }, 'der Platzhalter im Feld kommt zuerst, mit Beschreibung');
  await page.keyboard.type('Muster AG');
  await page.keyboard.press('Tab');
  assert.equal(await page.inputValue('#t2'), 'Protokoll Muster AG');
  assert.equal(await page.inputValue('#b2'), 'Kunde: Muster AG, Ort {{?Ort}}', 'gleicher Name im Text ausgefüllt, Beschreibung ohne Platzhalter weg');
  assert.equal(await page.evaluate(() => window.ed2.selection().text), '{{?Ort}}', 'Tab springt aus dem Feld in den Text');
  assert.deepEqual(await page.evaluate(() => window.log2.filled), [['Kunde', 'Muster AG', false, true, { tag: 1 }]], 'onFill mit field und data');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'b2', 'ohne offenen Platzhalter im Feld bleibt der Cursor im Text');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.getElementById('t2').value = 'Für {{?Wer}}'; window.ed2.set('{{?Wer}} und {{?Was}}'); window.ed2.startPlaceholders({ start: 0, end: 18, keep: true }); });
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => window.ed2.selection().text), '{{?Was}}', 'übersprungen: der Name gilt als erledigt (wie in NoNotes)');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => window.ed2.selection().text), '{{?Wer}}', 'zurück zum vorigen im Text');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 't2', 'Umschalt+Tab aus dem ersten Platzhalter des Texts zurück ins Feld');
  await page.keyboard.press('Escape');
  part('Platzhalter mit einem Feld davor (NoNotes: der Titel): zuerst das Feld, Tab in den Text, gleiche Namen, zurück mit Umschalt+Tab');

  const ids = await page.evaluate(() => { window.ed2.runCommand('table'); return ['eb2', 'm2', 'tp2'].map(id => !!document.getElementById(id)); });
  assert.deepEqual(ids, [true, true, true], 'feste Kennungen editorBody, mirror, tablePicker');
  await page.keyboard.press('Escape');
  const grid = await page.evaluate(() => {
    document.getElementById('b2').value = '+---+\n| a |\n+---+';
    window.ed2.refresh();
    return document.getElementById('eb2').classList.contains('grid-font');
  });
  assert.equal(grid, true, 'refresh() nach einem Text von aussen: Festbreitenschrift für Tabellen mit Rahmen');
  assert.equal(await page.evaluate(() => { window.ed2.set('eins\nzwei\ndrei'); window.ed2.selectLine(1); return window.ed2.selection().text; }), 'zwei', 'selectLine()');
  await page.evaluate(() => window.ed2.forgetAttachment());
  await page.evaluate(() => window.ed2.addAttachments([new File(['x'], 'a.txt', { type: 'text/plain' })]));
  assert.deepEqual(await page.evaluate(() => window.log2.hints.slice(-1)), [['Nur Bilder können angehängt werden.', 'error']], 'hint(text, kind)');
  part('Kennungen editorBody, mirror, tablePicker; refresh(), selectLine(), forgetAttachment(), hint mit Art');
  assert.deepEqual(page.errors, []);
  await page.close();
}

/* v1.1.0, Wünsche von SteeringBoard: afterRender und Verweisziele mit Adresse (E1), onMode mit remember (E2), storagePrefix (E3),
   übersetzte Platzhalterwörter der Toolleiste (E4), readOnlyTools: 'hide' (E5). */
async function runV11(browser, part) {
  const page = await open(browser);
  const r = await page.evaluate(async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.log3 = { after: [], opened: [] };
    window.ed3 = NoNotesEditor.create(host, {
      remember: false, mode: 'preview', value: '[[V-001]] und [[X-9]]',
      refs: {
        resolver: async () => target => (target === 'V-001'
          ? { id: 'V-001', label: 'V-001 Budget', href: '#item/3', title: 'V-001 Budget', className: 'sb-ref', data: { code: 'V-001' } }
          : { id: null, label: target, title: `Kein Eintrag «${target}»` }),
        open: x => window.log3.opened.push(x.id),
      },
      afterRender: (preview, ed) => window.log3.after.push([preview === ed.preview, preview.querySelectorAll('a.md-wiki').length]),
    });
    await window.ed3.renderPreview();
    const a = window.ed3.preview.querySelector('a.md-wiki');
    const b = window.ed3.preview.querySelector('a.md-wiki.missing');
    return { href: a.getAttribute('href'), cls: a.className, code: a.dataset.code, title: a.title, missing: b.title, after: window.log3.after.slice(-1)[0] };
  });
  assert.deepEqual(r, { href: '#item/3', cls: 'md-wiki sb-ref', code: 'V-001', title: 'V-001 Budget', missing: 'Kein Eintrag «X-9»', after: [true, 2] });
  const before = await page.evaluate(() => location.href);
  await page.click('.nn-editor:last-of-type a.sb-ref');
  assert.equal(await page.evaluate(() => location.href), before, 'ein einfacher Klick folgt der Adresse nicht');
  assert.deepEqual(await page.evaluate(() => window.log3.opened), ['V-001'], 'sondern ruft refs.open');
  const n = await page.evaluate(async () => { window.ed3.set('[[V-001]]'); await window.ed3.renderPreview(); return window.log3.after.length; });
  assert.ok(n >= 2, 'afterRender nach jedem Zeichnen');
  part('E1: afterRender(preview, ed), Verweisziele mit href, title, className, data');

  await page.evaluate(() => window.ed.mode('preview'));
  await page.evaluate(() => window.ed.insert('Liebe {{?Name}}'));
  assert.equal(await page.evaluate(() => window.ed.mode()), 'split', 'Platzhalter: der Editor schaltet selbst um');
  assert.deepEqual(await page.evaluate(() => window.log.remember.slice(-2)), [true, false], 'ed.mode(name) zählt als Wahl, das Umschalten des Editors nicht');
  await page.keyboard.press('Escape');
  part('E2: onMode(mode, ed, { remember })');

  const keys = await page.evaluate(() => {
    const out = { before: [NoNotesEditor.MODE_KEY, NoNotesEditor.storageKey('tableGrid')] };
    NoNotesEditor.configure({ storagePrefix: 'testapp' });
    out.after = [NoNotesEditor.MODE_KEY, NoNotesEditor.GRID_KEY];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const ed4 = NoNotesEditor.create(host, { kind: 'probe', mode: 'edit' });
    ed4.el.querySelector('.nn-modes [data-mode="preview"]').click();
    ed4.runCommand('table');
    const box = ed4.el.querySelector('.tp-grid-kind');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
    out.stored = [JSON.parse(localStorage.getItem('testapp.mode')), localStorage.getItem('testapp.tableGrid'), localStorage.getItem('nonotes-editor.mode')];
    ed4.destroy();
    NoNotesEditor.configure({ storagePrefix: null });
    out.reset = NoNotesEditor.MODE_KEY;
    localStorage.removeItem('testapp.mode');
    localStorage.removeItem('testapp.tableGrid');
    return out;
  });
  assert.deepEqual(keys, {
    before: ['nonotes-editor.mode', 'nonotes-editor.tableGrid'], after: ['testapp.mode', 'testapp.tableGrid'],
    stored: [{ probe: 'preview' }, '0', null], reset: 'nonotes-editor.mode',
  });
  part('E3: configure({ storagePrefix }) für Darstellung und «Mit Rahmen», storageKey(), MODE_KEY folgt');

  const words = [];
  for (const cmd of ['bold', 'italic', 'strike', 'code']) {
    await setText(page, 'ab', 1);
    await page.click(`#mdToolbar [data-cmd="${cmd}"]`);
    words.push(await text(page));
  }
  assert.deepEqual(words, ['a**fett**b', 'a*kursiv*b', 'a~~durchgestrichen~~b', 'a`code`b'], 'Deutsch wie bis v1.0.0');
  part('E4: Platzhalterwörter auf Deutsch unverändert');

  const ro = await page.evaluate(async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const PNG = new Uint8Array([137, 80, 78, 71]);
    const ed5 = NoNotesEditor.create(host, {
      remember: false, mode: 'edit', readOnly: true, readOnlyTools: 'hide',
      attachments: { list: async () => [{ id: 1, name: 'a.png', mime: 'image/png', size: 4 }], get: async () => ({ mime: 'image/png', bytes: PNG }) },
    });
    await ed5.renderAttachments();
    const shown = () => [getComputedStyle(ed5.toolbar).display !== 'none', getComputedStyle(ed5.el.querySelector('.attachments')).display !== 'none'];
    const out = { locked: shown(), cls: ed5.el.classList.contains('nn-tools-hidden') };
    ed5.setReadOnly(false);
    out.open = shown();
    ed5.setReadOnly(true);
    await ed5.renderAttachments();
    out.again = shown();
    window.ed.setReadOnly(true);
    out.plain = [getComputedStyle(window.ed.toolbar).display !== 'none', window.ed.toolbar.querySelector('button[data-cmd="bold"]').disabled];
    window.ed.setReadOnly(false);
    return out;
  });
  assert.deepEqual(ro, { locked: [false, false], cls: true, open: [true, true], again: [false, false], plain: [true, true] });
  part('E5: readOnlyTools: \'hide\' verbirgt Toolleiste und Bilderleiste; ohne die Option nur gesperrt (wie bis v1.0.0)');
  assert.deepEqual(page.errors, []);
  await page.close();
}

async function runLabels(browser, part) {
  const page = await open(browser, '?lang=en');
  assert.equal(await page.$eval('#mdToolbar [data-cmd="bold"]', b => b.getAttribute('aria-label')), 'Strong', 'Ersetzung des Gastgebers');
  assert.equal(await page.$eval('#mdToolbar [data-cmd="bold"]', b => b.title), 'Bold (Ctrl+B)', 'sonst der Katalog des Pakets');
  assert.deepEqual(await page.$$eval('#modeSwitch button', b => b.map(x => x.textContent)), ['Edit', 'Split', 'Preview']);
  assert.equal(await page.$eval('.nn-counts', c => c.textContent), '2 open tasks · 1 open question');
  await setText(page, '- [ ] Offerte');
  await page.keyboard.type(' >');
  await page.waitForSelector('.dp:not([hidden])');
  assert.equal(await page.$eval('.dp-quick button', b => b.textContent), 'Today');
  part('Englisch: Katalog des Pakets, Ersetzung einzelner Texte gewinnt, Mehrzahl, Datumsauswahl');
  await page.keyboard.press('Escape');
  const words = [];
  for (const cmd of ['bold', 'italic', 'strike', 'code']) {
    await setText(page, 'ab', 1);
    await page.click(`#mdToolbar [data-cmd="${cmd}"]`);
    words.push(await text(page));
  }
  assert.deepEqual(words, ['a**strong**b', 'a*italic*b', 'a~~strikethrough~~b', 'a`code`b'], 'Platzhalterwörter aus den Beschriftungen, auch mit Ersetzung');
  part('Englisch: Platzhalterwörter der Toolleiste (E4, v1.1.0)');
  assert.deepEqual(page.errors, []);
  await page.close();
}

suite('Editor-Test', [
  { name: 'Grundlagen: Aufbau, Darstellungen, Toolleiste, Tasten, Aufgaben in der Vorschau, Speichern', run: runBasics },
  { name: 'Listen unter dem Cursor: @kürzel, [[Verweise]], Datumsauswahl, Tabellen, Platzhalter', run: runPopups },
  { name: 'Rückrufe des Gastgebers: Bilder, Erweiterungen, Schreibschutz, Konflikt', run: runHostHooks },
  { name: 'Für NoNotes v4.0.0: Feld vor dem Text bei Platzhaltern, Kennungen, refresh, selectLine, Hinweise mit Art', run: runHostField },
  { name: 'v1.1.0: afterRender, Verweisziele, onMode mit remember, storagePrefix, Platzhalterwörter, readOnlyTools', run: runV11 },
  { name: 'Texte: Englisch mit Ersetzung durch den Gastgeber', run: runLabels },
], { browser: true });
