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
  assert.deepEqual(page.errors, []);
  await page.close();
}

suite('Editor-Test', [
  { name: 'Grundlagen: Aufbau, Darstellungen, Toolleiste, Tasten, Aufgaben in der Vorschau, Speichern', run: runBasics },
  { name: 'Listen unter dem Cursor: @kürzel, [[Verweise]], Datumsauswahl, Tabellen, Platzhalter', run: runPopups },
  { name: 'Rückrufe des Gastgebers: Bilder, Erweiterungen, Schreibschutz, Konflikt', run: runHostHooks },
  { name: 'Texte: Englisch mit Ersetzung durch den Gastgeber', run: runLabels },
], { browser: true });
