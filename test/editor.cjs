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

/* v1.2.0, Wünsche von SteeringBoard: Enter im Platzhalter, Enter im Feld des Gastgebers, Fortsetzen, Datumsauswahl bei Fristen. */
async function hostEditor(page, { title, value, keep }) {
  await page.evaluate(async ([ti, v, k]) => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const field = document.createElement('input');
    field.id = 'tt';
    box.appendChild(field);
    const host = document.createElement('div');
    box.appendChild(host);
    window.fills = [];
    window.ed5 = NoNotesEditor.create(host, {
      remember: false, mode: 'edit', ids: { body: 'b5', editorBody: 'eb5', mirror: 'm5', tablePicker: 'tp5' },
      placeholders: { field, keep: async () => k, onFill: (n, val, kept, info) => window.fills.push([n, val, kept, info.field]) },
      attachments: { list: () => [], add: async () => ({ id: 1 }) },
    });
    field.value = ti || '';
    window.ed5.set(v);
    await window.ed5.startPlaceholders({ start: 0, keep: k });
  }, [title || '', value, !!keep]);
}
const sel5 = page => page.evaluate(() => window.ed5.selection().text);
const text5 = page => page.inputValue('#b5');
const fills = page => page.evaluate(() => window.fills);
/** Klick in den Text an die Stelle pos (der Cursor kommt dorthin, dann das click-Ereignis wie bei der Maus). */
const clickAt = (page, pos) => page.evaluate(p => {
  const ta = document.getElementById('b5');
  ta.focus();
  ta.setSelectionRange(p, p);
  ta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}, pos);
const dpVisible = page => page.$eval('#eb5 .dp', d => !d.hidden);
const dpDay = page => page.$eval('#eb5 .dp button.sel', b => b.dataset.iso);

async function runV12(browser, part) {
  // 1. Enter im Platzhalter im Text: neue Zeile, kein Sprung; ohne «behalten»
  let page = await open(browser);
  await hostEditor(page, { value: 'Kunde {{?Name}} und {{?Ort}}', keep: false });
  await page.keyboard.type('Anna');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Muster');
  assert.equal(await text5(page), 'Kunde Anna\nMuster und {{?Ort}}', 'Enter ist eine neue Zeile im Wert, kein Sprung');
  await page.keyboard.press('Tab');
  assert.equal(await sel5(page), '{{?Ort}}', 'Tab springt weiter');
  assert.deepEqual((await fills(page)).pop(), ['Name', 'Anna\nMuster', false, false], 'onFill: nicht behalten');
  await page.keyboard.press('Escape');
  part('Enter im Platzhalter: neue Zeile, kein Sprung (ohne behalten)');

  // 2. mit «behalten»: der Wert mit Zeilenumbruch wird Text, einzeilige bleiben {{?Name: Wert}}
  await page.close();
  page = await open(browser);
  await hostEditor(page, { value: 'Kunde {{?Name}} und {{?Ort}}', keep: true });
  await page.keyboard.type('Anna');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Muster');
  assert.equal(await text5(page), 'Kunde Anna\nMuster und {{?Ort}}', 'auch mit behalten springt Enter nicht');
  await page.keyboard.press('Tab');
  assert.equal(await text5(page), 'Kunde Anna\nMuster und {{?Ort}}', 'mit Zeilenumbruch: Text statt {{?Name: …}}');
  assert.deepEqual((await fills(page)).pop(), ['Name', 'Anna\nMuster', false, false], 'onFill meldet: nicht behalten');
  await page.keyboard.type('Ulm');
  await page.keyboard.press('Tab');
  assert.equal(await text5(page), 'Kunde Anna\nMuster und {{?Ort: Ulm}}', 'einzeilig bleibt behalten');
  assert.deepEqual((await fills(page)).pop(), ['Ort', 'Ulm', true, false]);
  part('Enter im Platzhalter mit behalten: Wert mit Zeilenumbruch als Text, onFill mit keep false; einzeilige bleiben');

  // 3. einen behaltenen Wert über mehrere Zeilen erweitern: ganzer Platzhalter wird Text, gleiche Namen ebenso, das Feld bekommt eine Zeile
  await page.close();
  page = await open(browser);
  await hostEditor(page, { title: 'T {{?A}}', value: '{{?B}} {{?A: x}} und {{?A}}', keep: true });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tt', 'das Feld zuerst');
  await page.keyboard.press('Tab'); // A im Feld übersprungen
  assert.equal(await sel5(page), '{{?B}}');
  await clickAt(page, (await text5(page)).indexOf('x') + 1); // Klick hinter «x» im ausgefüllten A
  assert.equal(await page.evaluate(() => window.ed5.selection().text), '', 'ein ausgefüllter Platzhalter: der Cursor steht im Wert');
  await page.keyboard.press('Enter');
  await page.keyboard.type('z');
  await page.keyboard.press('Tab');
  assert.equal(await text5(page), '{{?B}} x\nz und x\nz', 'ganzer Platzhalter wird Text, gleiche Namen ebenso');
  assert.equal(await page.inputValue('#tt'), 'T x z', 'im Feld auf einer Zeile');
  assert.deepEqual((await fills(page)).pop(), ['A', 'x\nz', false, false]);
  part('Mehrzeiliger Wert in einem ausgefüllten Platzhalter (behalten): Text, gleiche Namen, Feld einzeilig');
  await page.close();

  // 4. Gastgeberfeld: Enter bestätigt und beendet; Tab geht weiter
  page = await open(browser);
  await hostEditor(page, { title: 'P {{?Kunde}}', value: 'Ort {{?Ort}} Plz {{?Plz}}', keep: false });
  await page.keyboard.type('Muster');
  await page.keyboard.press('Enter');
  assert.equal(await page.inputValue('#tt'), 'P Muster', 'Enter bestätigt den Wert');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'tt', 'der Fokus bleibt im Feld');
  assert.equal(await text5(page), 'Ort {{?Ort}} Plz {{?Plz}}', 'kein Sprung in den Text');
  assert.equal(await page.$eval('#eb5 .ph-hint', d => d.hidden), true);
  assert.deepEqual((await fills(page)).pop(), ['Kunde', 'Muster', false, true]);
  // 5. Fortsetzen nach Enter im Feld: Klick in den Platzhalter, Tab geht zum nächsten
  await clickAt(page, 6);
  assert.equal(await sel5(page), '{{?Ort}}', 'Klick beginnt das Ausfüllen wieder');
  await page.keyboard.type('Ulm');
  await page.keyboard.press('Tab');
  assert.equal(await text5(page), 'Ort Ulm Plz {{?Plz}}');
  assert.equal(await sel5(page), '{{?Plz}}', 'Tab geht von dort weiter');
  // 6. Fortsetzen nach Esc
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab'); // beendet: Tab verlässt das Textfeld
  assert.notEqual(await page.evaluate(() => document.activeElement.id), 'b5', 'nach Esc springt Tab nicht mehr');
  await clickAt(page, (await text5(page)).indexOf('{{?Plz}}') + 3);
  assert.equal(await sel5(page), '{{?Plz}}', 'Klick nach Esc beginnt wieder');
  await page.keyboard.type('8000');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await text5(page), 'Ort Ulm Plz 8000', 'Umschalt+Tab füllt den Wert ein und bleibt im Text');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'b5');
  part('Fortsetzen: Klick in einen Platzhalter nach Enter im Feld und nach Esc, Tab und Umschalt+Tab gehen weiter');
  await page.close();

  // 7. Datumsauswahl: nach «>» oder mit Datum als Vorgabe
  page = await open(browser);
  const today = await page.evaluate(() => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n, i) => String(n).padStart(i ? 2 : 4, '0')).join('-'); });
  await hostEditor(page, { value: 'Offerte >{{?Frist}} Mail {{?Datum: 15.12.2026}} Name {{?Name}} Ende >{{?Spaet: 1.2.2027 14:30}}', keep: true });
  assert.equal(await dpVisible(page), true, 'nach «>» öffnet die Auswahl');
  assert.equal(await dpDay(page), today, 'ohne Vorgabe: heute');
  await page.keyboard.press('Enter'); // Enter in der Auswahl: das Datum füllt den Platzhalter
  assert.equal(await dpVisible(page), false);
  const [d, m, y] = today.split('-').reverse();
  assert.ok((await text5(page)).startsWith(`Offerte >${d}.${m}.${y} Mail`), await text5(page));
  await page.keyboard.press('Tab');
  assert.ok((await text5(page)).includes(`>{{?Frist: ${d}.${m}.${y}}}`), 'ausgefüllt und behalten: ' + (await text5(page)));
  assert.equal(await dpVisible(page), true, 'ein Datum als Vorgabe öffnet sie ebenfalls');
  assert.equal(await dpDay(page), '2026-12-15', 'die Vorgabe ist vorgewählt');
  await page.click('#eb5 .dp button[data-iso="2026-12-20"]'); // Klick: füllt, das Ausfüllen geht weiter
  assert.equal(await dpVisible(page), false);
  assert.ok((await text5(page)).includes('Mail {{?Datum: 20.12.2026}} Name'), await text5(page));
  await page.keyboard.press('Tab');
  assert.ok((await text5(page)).includes('Mail {{?Datum: 20.12.2026}} Name'));
  assert.equal(await sel5(page), '{{?Name}}', 'danach springt Tab weiter, ohne Auswahl für einen Namen');
  assert.equal(await dpVisible(page), false);
  part('Datumsauswahl: nach «>» und mit Datum als Vorgabe; Enter und Klick füllen, Tab geht weiter');

  await page.keyboard.press('Tab'); // Name offen gelassen, weiter zu «Spaet»
  assert.equal(await dpVisible(page), true);
  assert.equal(await dpDay(page), '2027-02-01', 'Vorgabe mit Uhrzeit');
  assert.equal(await page.$eval('#eb5 .dp-time input', i => i.value), '14:30');
  await page.keyboard.press('Escape'); // erstes Esc: nur die Auswahl
  assert.equal(await dpVisible(page), false);
  await page.keyboard.press('Shift+Tab'); // das Ausfüllen läuft noch: zurück zu Name
  assert.equal(await sel5(page), '{{?Name}}', 'nach dem ersten Esc läuft das Ausfüllen weiter');
  await page.keyboard.press('Shift+Tab'); // zurück zu Datum: die Auswahl öffnet wieder
  assert.equal(await dpVisible(page), true);
  await page.keyboard.press('Tab'); // bei offener Auswahl springt Tab weiter, statt durch ihre Bereiche zu gehen
  assert.equal(await sel5(page), '{{?Name}}');
  assert.equal(await dpVisible(page), false);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape'); // zweites Esc beendet das Ausfüllen
  await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate(() => document.activeElement.id), 'b5', 'das zweite Esc beendet das Ausfüllen');
  // Klick in einen Platzhalter nach «>»: die Auswahl öffnet
  const at = (await text5(page)).indexOf('{{?Spaet');
  await clickAt(page, at + 4);
  assert.equal(await dpVisible(page), true, 'ein Klick in den Platzhalter öffnet die Auswahl');
  part('Datumsauswahl: erstes Esc schliesst nur sie, zweites beendet das Ausfüllen, Klick und Umschalt+Tab öffnen sie');

  // Tippen ersetzt den Wert wie bisher, der Kalender folgt
  await page.close();
  page = await open(browser);
  await hostEditor(page, { value: 'Bis >{{?Frist}}', keep: false });
  await page.keyboard.type('5.1.2027');
  assert.equal(await text5(page), 'Bis >5.1.2027');
  assert.equal(await dpDay(page), '2027-01-05', 'der Kalender folgt dem Getippten');
  await page.keyboard.type('x');
  assert.equal(await dpVisible(page), false, 'ein anderes Zeichen schliesst die Auswahl');
  await page.keyboard.press('Tab');
  assert.deepEqual((await fills(page)).pop(), ['Frist', '5.1.2027x', false, false]);
  part('Datumsauswahl: Tippen ersetzt den Wert, der Kalender folgt, andere Zeichen schliessen sie');
  assert.deepEqual(page.errors, []);
  await page.close();
}

/* v1.3.0: Fragen und Entscheide einzeln abschaltbar (questionKinds): Toolleiste, Tasten, Vorschau, «Beantworten», Zähler, Umschalten
   später (setQuestionKinds), Text unverändert, Vorgabe unverändert. */
async function runV13(browser, part) {
  const TEXT = '? Frage >15.10.2026\n\n?! Entscheid\n\n- ?! Liste\n\nfrei';
  const make = (page, opts, value) => page.evaluate(([o, v]) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.k = NoNotesEditor.create(host, Object.assign({ remember: false, mode: 'split', counts: true, answers: true,
      ids: { body: 'kb', preview: 'kp', questionBtn: 'kq', answerBtn: 'ka', decisionBtn: 'kd', toolbar: 'kt' } }, o));
    window.k.set(v);
    return window.k.renderPreview();
  }, [opts, value == null ? TEXT : value]);
  const shown = (page, sel) => page.$eval(sel, b => !b.hidden && getComputedStyle(b).display !== 'none');
  const bar = page => Promise.all(['#kq', '#ka', '#kd'].map(sel => shown(page, sel)));
  const val = page => page.inputValue('#kb');
  const cards = page => page.$$eval('#kp .md-q', n => n.map(c => (c.classList.contains('md-decision') ? 'd' : 'q') + (c.classList.contains('open') ? '+' : '-')).join(' '));
  const counts = page => page.evaluate(() => window.k.el.dataset.counts);
  const footer = page => page.evaluate(() => window.k.el.querySelector('.nn-counts').textContent);
  const key = async (page, combo) => {
    await page.focus('#kb');
    await page.evaluate(() => { const t = document.getElementById('kb'); t.setSelectionRange(t.value.length, t.value.length); });
    await page.keyboard.press(combo);
  };
  const waitCards = (page, n) => page.waitForFunction(c => document.querySelectorAll('#kp .md-q').length === c, n);

  // 1. Vorgabe: alles da, alles wie bis v1.2.0 (auch im Editor der Testseite)
  let page = await open(browser);
  assert.deepEqual(await page.evaluate(() => window.ed.questionKinds()), { questions: true, decisions: true });
  for (const cmd of ['question', 'answer', 'decision']) assert.ok(await shown(page, `#mdToolbar [data-cmd="${cmd}"]`), cmd);
  await make(page, {});
  assert.deepEqual(await bar(page), [true, true, true]);
  assert.equal(await cards(page), 'q+ d+ d+');
  assert.equal(await counts(page), '0/1/2');
  assert.equal(await footer(page), '1 offene Frage · 2 offene Entscheide');
  part('Vorgabe: Knöpfe, Vorschau, Zähler');

  // 2. Entscheide aus
  await page.close();
  page = await open(browser);
  await make(page, { questionKinds: { questions: true, decisions: false } });
  assert.deepEqual(await bar(page), [true, true, false], 'Entscheid-Knopf weg, Antwort bleibt');
  assert.deepEqual(await page.evaluate(() => window.k.questionKinds()), { questions: true, decisions: false });
  assert.equal(await cards(page), 'q+', 'nur die Frage ist ein Kasten');
  assert.equal(await counts(page), '0/1/0', 'Zähler zählt keine Entscheide');
  assert.equal(await footer(page), '1 offene Frage');
  const shownText = await page.$eval('#kp', p => p.textContent);
  assert.ok(shownText.includes('?! Entscheid') && shownText.includes('?! Liste'), 'als Text sichtbar');
  assert.equal(await page.$$eval('#kp .md-decision', n => n.length), 0);
  assert.equal(await page.$$eval('#kp .md-mark', n => n.length), 1, 'nur das Abzeichen der Frage');
  assert.equal(await page.$$eval('#kp .md-q-answer', n => n.map(b => b.textContent).join()), 'Beantworten', 'kein «Entscheiden»');
  assert.equal(await page.$$eval('#kp .md-due', n => n.length), 1, 'Frist der Frage');
  part('Entscheide aus: Knopf, Vorschau, Beantworten, Zähler');

  // 3. Tasten
  await page.evaluate(() => window.k.set('Zeile'));
  await key(page, 'Control+Shift+D');
  assert.equal(await val(page), 'Zeile', 'Ctrl+Shift+D tut nichts');
  await page.evaluate(() => window.k.runCommand('decision'));
  assert.equal(await val(page), 'Zeile', 'runCommand tut nichts');
  await key(page, 'Control+Shift+F');
  assert.equal(await val(page), '? Zeile', 'Ctrl+Shift+F wirkt');
  await key(page, 'Control+Shift+A');
  assert.equal(await val(page), '! Zeile', 'Antwort wirkt, solange eine Art gilt');
  part('Entscheide aus: Tasten');

  // 4. Fragen aus
  await page.close();
  page = await open(browser);
  await make(page, { questionKinds: { questions: false } });
  assert.deepEqual(await bar(page), [false, true, true]);
  assert.equal(await cards(page), 'd+ d+');
  assert.equal(await counts(page), '0/0/2');
  assert.equal(await page.$$eval('#kp .md-q-answer', n => n.map(b => b.textContent).join()), 'Entscheiden,Entscheiden');
  await page.evaluate(() => window.k.set('Zeile'));
  await key(page, 'Control+Shift+F');
  assert.equal(await val(page), 'Zeile', 'Ctrl+Shift+F tut nichts');
  await key(page, 'Control+Shift+D');
  assert.equal(await val(page), '?! Zeile');
  part('Fragen aus');

  // 5. beide aus
  await page.close();
  page = await open(browser);
  await make(page, { questionKinds: false }, TEXT + '\n\n! lose');
  assert.deepEqual(await bar(page), [false, false, false]);
  assert.equal(await page.evaluate(() => [...window.k.el.querySelectorAll('.tb-sep')].filter(s => getComputedStyle(s).display !== 'none').length), 3, 'Trennstrich vor den drei Knöpfen weg');
  assert.equal(await cards(page), '');
  assert.equal(await page.$$eval('#kp .md-a, #kp .md-q, #kp .md-due', n => n.length), 0);
  assert.equal(await counts(page), '0/0/0');
  assert.equal(await footer(page), '');
  await page.evaluate(() => window.k.set('Zeile'));
  for (const c of ['F', 'A', 'D']) { await key(page, 'Control+Shift+' + c); assert.equal(await val(page), 'Zeile', `Ctrl+Shift+${c} tut nichts`); }
  part('beide aus');

  // 6. Später umschalten: gleiche Instanz, der Text bleibt, Vorschau, Zähler und Knöpfe folgen
  await page.evaluate(() => window.k.set('? Frage\n\n?! Entscheid\n\n?!```\nBlock\n```\n!! ok'));
  const before = await val(page);
  assert.deepEqual(await page.evaluate(() => window.k.setQuestionKinds({ decisions: true })), { questions: false, decisions: true });
  assert.deepEqual(await bar(page), [false, true, true]);
  await waitCards(page, 2);
  assert.equal(await cards(page), 'd+ d-', 'Entscheid und Block');
  assert.equal(await counts(page), '0/0/1');
  assert.deepEqual(await page.evaluate(() => window.k.setQuestionKinds({ questions: true })), { questions: true, decisions: true }, 'nur die genannte Art ändert sich');
  await waitCards(page, 3);
  assert.equal(await counts(page), '0/1/1');
  assert.deepEqual(await page.evaluate(() => window.k.counts()), { tasks: 0, questions: 1, decisions: 1 });
  assert.equal(await val(page), before, 'der Text blieb in allen Stellungen gleich');
  await page.evaluate(() => window.k.setQuestionKinds(false));
  assert.deepEqual(await page.evaluate(() => window.k.questionKinds()), { questions: false, decisions: false });
  await waitCards(page, 0);
  assert.equal(await val(page), before);
  await page.evaluate(() => window.k.setQuestionKinds(true));
  await waitCards(page, 3);
  part('später umschalten: setQuestionKinds, Text unverändert');

  // 7. Block: ohne Entscheide ist «?!```» kein Block
  await page.evaluate(() => { window.k.set('?!``` Titel\nTeil\n```\n!! ok\n\nNach'); window.k.setQuestionKinds({ decisions: false }); });
  await waitCards(page, 0);
  assert.equal(await page.$$eval('#kp .md-q-block', n => n.length), 0);
  assert.equal(await counts(page), '0/0/0');
  await page.evaluate(() => window.k.setQuestionKinds({ decisions: true }));
  await waitCards(page, 1);
  assert.equal(await page.$$eval('#kp .md-q-block', n => n.length), 1);
  part('Block');

  // 8. «Beantworten» bei abgeschaltetem Entscheid: die Antwort steht unter der Frage, der Rest bleibt
  await page.evaluate(() => { window.k.set('? Frage\n\n?! Entscheid'); window.k.setQuestionKinds({ decisions: false }); });
  await waitCards(page, 1);
  await page.click('#kp .md-q-answer');
  await page.fill('#kp textarea', 'Ja');
  await page.keyboard.press('Control+Enter');
  assert.equal(await val(page), '? Frage\n! Ja\n\n?! Entscheid');
  part('Beantworten bei abgeschaltetem Entscheid');

  // 9. Tabellenfeld: die abgeschaltete Art ist Text, der Text bleibt
  await page.evaluate(() => { window.k.set('| a | b |\n|---|---|\n| ? Frage<br>! ja | ?! Entscheid |'); });
  await page.waitForFunction(() => document.querySelectorAll('#kp .md-cell-q').length === 1);
  assert.equal(await page.$$eval('#kp .md-cell-q.md-decision', n => n.length), 0);
  assert.equal(await val(page), '| a | b |\n|---|---|\n| ? Frage<br>! ja | ?! Entscheid |');
  part('Tabellenfeld');
  assert.deepEqual(page.errors, []);
  await page.close();
}

suite('Editor-Test', [
  { name: 'Grundlagen: Aufbau, Darstellungen, Toolleiste, Tasten, Aufgaben in der Vorschau, Speichern', run: runBasics },
  { name: 'Listen unter dem Cursor: @kürzel, [[Verweise]], Datumsauswahl, Tabellen, Platzhalter', run: runPopups },
  { name: 'Rückrufe des Gastgebers: Bilder, Erweiterungen, Schreibschutz, Konflikt', run: runHostHooks },
  { name: 'Für NoNotes v4.0.0: Feld vor dem Text bei Platzhaltern, Kennungen, refresh, selectLine, Hinweise mit Art', run: runHostField },
  { name: 'v1.1.0: afterRender, Verweisziele, onMode mit remember, storagePrefix, Platzhalterwörter, readOnlyTools', run: runV11 },
  { name: 'v1.2.0: Enter im Platzhalter, Enter im Feld des Gastgebers, Fortsetzen, Datumsauswahl bei Fristen', run: runV12 },
  { name: 'v1.3.0: Fragen und Entscheide einzeln abschaltbar (Toolleiste, Tasten, Vorschau, Zähler, später umschalten)', run: runV13 },
  { name: 'Texte: Englisch mit Ersetzung durch den Gastgeber', run: runLabels },
], { browser: true });
