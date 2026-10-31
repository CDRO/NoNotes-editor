/* Test der Markdown-Engine ohne Browser: die Module aus src/ laufen in einem eigenen vm-Kontext wie in NoNotes (Node, ohne DOM).
   Die Abschnitte sind aus NoNotes v3.3.0 test/core.cjs übernommen (die Teile, die nur Engine-Funktionen prüfen; was die Datenbank, den
   Export oder die Agenten braucht, bleibt in NoNotes). Dazu die Texte (labels.js): Katalog, Übersetzer und Ersetzungen des Gastgebers.
   Ausführen: node test/engine.cjs */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { suite } = require('./lib.cjs');

const ROOT = path.resolve(__dirname, '..');
// Reihenfolge wie in einer Seite: Texte zuerst, dann die Module (siehe README)
const FILES = ['src/labels.js', 'lang/editor.de.js', 'lang/editor.en.js', 'src/placeholders.js', 'src/dates.js', 'src/questions.js', 'src/mentions.js',
  'src/tasks.js', 'src/embeds.js', 'src/tables.js', 'src/markdown.js', 'src/editing.js'];

/** Lädt alle Module des Pakets. Ohne extra im eigenen Kontext (wie require in NoNotes: Vergleiche mit deepEqual über dieselben Arrays),
 *  mit extra in einem neuen vm-Kontext mit diesen Namen (z. B. einer festen Uhr als Date). */
function load(extra) {
  if (!extra) {
    globalThis.window = globalThis;
    for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
    return globalThis;
  }
  const sandbox = Object.assign({ console, URL, URLSearchParams, TextEncoder, TextDecoder }, extra || {});
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), context, { filename: f });
  return sandbox;
}

// ============================================================
/* Texte: ohne Gastgeber Deutsch, Katalog des Pakets je Sprache, Übersetzer des Gastgebers, Ersetzungen einzelner Texte (sie gewinnen
   immer), Mehrzahl, Gebietsschema, Laufen ohne DOM. */
async function runLabels(browser, part) {
  const s = load();
  const L = s.NoNotesEditorLabels;
  assert.equal(L.language(), 'de');
  assert.equal(L.t('Fett'), 'Fett');
  assert.equal(L.t('Spalte {n}', { n: 3 }), 'Spalte 3');
  assert.equal(L.locale(), 'de-CH');
  assert.ok(L.keys().length > 150 && L.keys().includes('Tabelle einfügen'), 'Katalog aus lang/editor.de.js');
  part('Ohne Gastgeber: Deutsch, Platzhalter gesetzt, Katalog mit allen Schlüsseln');

  L.configure({ language: 'en' });
  assert.equal(L.t('Fett'), 'Bold');
  assert.equal(L.tn('{n} offene Aufgabe', '{n} offene Aufgaben', 1), '1 open task');
  assert.equal(L.tn('{n} offene Aufgabe', '{n} offene Aufgaben', 4), '4 open tasks');
  assert.equal(L.locale(), 'en-GB');
  assert.equal(s.NoNotesTasks.openMessage(2), '2 subtasks are still open', 'die Module übersetzen über labels.js');
  L.configure({ language: 'en-US' });
  assert.equal(L.t('Fett'), 'Bold', 'en-US fällt auf en zurück');
  part('Katalog des Pakets: Englisch, Mehrzahl, Gebietsschema, Region fällt auf die Sprache zurück');

  // Übersetzer des Gastgebers (wie NoNotesI18n.t): er gewinnt, wenn er übersetzt; was er nicht kennt, kommt aus dem Paket
  const host = { Fett: 'Gras', 'Übernehmen': 'Add' };
  L.configure({ language: 'en', t: (k, p) => (host[k] ? host[k] : L.format(k, p)), tn: (one, other, n, p) => L.format(n === 1 ? one : other, Object.assign({ n }, p)) });
  assert.equal(L.t('Fett'), 'Gras', 'Übersetzer des Gastgebers');
  assert.equal(L.t('Kursiv'), 'Italic', 'unbekannt beim Gastgeber: Katalog des Pakets');
  assert.equal(L.tn('{n} offene Aufgabe', '{n} offene Aufgaben', 2), '2 open tasks');
  // Ersetzungen gewinnen immer (das Problem von NoNotesI18n.extend, das Texte des Grundpakets nie ersetzt: «Übernehmen» → "Add")
  L.configure({ messages: { en: { 'Fett': 'Strong', 'Übernehmen': 'Apply', '{n} offene Aufgabe': { one: 'one to do', other: '{n} to do' } }, de: { 'Notiz': 'Eintrag' } } });
  assert.equal(L.t('Fett'), 'Strong');
  assert.equal(L.t('Übernehmen'), 'Apply');
  assert.equal(L.tn('{n} offene Aufgabe', '{n} offene Aufgaben', 1), 'one to do');
  assert.equal(L.tn('{n} offene Aufgabe', '{n} offene Aufgaben', 3), '3 to do');
  L.configure({ language: 'de' });
  assert.equal(L.t('Notiz'), 'Eintrag', 'auch deutsche Texte lassen sich ersetzen');
  assert.equal(L.t('Fett'), 'Gras', 'im Deutschen gilt der Übersetzer des Gastgebers, wenn er etwas anderes liefert');
  L.configure({ messages: { de: { 'Notiz': null } }, t: null, tn: null });
  assert.equal(L.t('Notiz'), 'Notiz', 'null entfernt eine Ersetzung');
  assert.equal(L.t('Fett'), 'Fett', 't: null entfernt den Übersetzer (ohne NoNotesI18n im Kontext)');
  part('Gastgeber: sein Übersetzer gewinnt, wo er übersetzt; Ersetzungen gewinnen immer, auch auf Deutsch; null nimmt sie zurück');

  // Vorgabe: NoNotesI18n, wenn es im Kontext ist (NoNotes, Server von NoNotes-SaaS, MCP-Programm), auch wenn es erst später geladen wird
  const withI18n = load({});
  const fake = { de: {}, en: { 'Fett': 'Bold (NoNotes)' } };
  let lang = 'en';
  withI18n.NoNotesI18n = { t: (k, p) => withI18n.NoNotesEditorLabels.format(fake[lang][k] || k, p), tn: (one, other, n, p) => withI18n.NoNotesEditorLabels.format(n === 1 ? one : other, Object.assign({ n }, p)),
    language: () => lang, locale: () => (lang === 'en' ? 'en-GB' : 'de-CH') };
  const WL = withI18n.NoNotesEditorLabels;
  assert.equal(WL.t('Fett'), 'Bold (NoNotes)', 'NoNotesI18n übersetzt');
  assert.equal(WL.t('Kursiv'), 'Italic', 'Sprache von NoNotesI18n, Katalog des Pakets für das, was es nicht kennt');
  assert.equal(WL.locale(), 'en-GB');
  lang = 'de';
  assert.equal(WL.t('Fett'), 'Fett');
  lang = 'en';
  WL.configure({ t: false });
  assert.equal(WL.t('Fett'), 'Fett', 't: false: ohne Übersetzer (Sprache aus <html lang> oder Deutsch)');
  WL.configure({ t: null, language: 'en' });
  assert.equal(WL.t('Fett'), 'Bold (NoNotes)', 't: null: wieder die Vorgabe');
  part('Vorgabe NoNotesI18n: übersetzt, Sprache und Gebietsschema von dort, abschaltbar mit t: false');

  const pseudo = load();
  pseudo.NoNotesEditorLabels.configure({ t: k => `⟦${k}⟧` });
  assert.equal(pseudo.NoNotesEditorLabels.t('Fett'), '⟦Fett⟧', 'Pseudo-Sprache des Gastgebers kommt durch');
  part('Pseudo-Sprache des Gastgebers (NoNotes qps) kommt durch');
}

/* Test der Videos (v1.6.0), Teil 1, ohne Browser: Erkennung der Adressen (auch Fälschungen), Adressen zum Einbetten, Karte im Markdown,
   Link statt Bild ohne Einbetten. */
async function runEmbeds(browser, part, step) {
  const sandbox = load();
  const window = sandbox;
  const E = sandbox.NoNotesEmbeds;
  const M = sandbox.NoNotesMarkdown;

  const ID = 'dQw4w9WgXcQ';

  // ---------- Erkennung ----------
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`, `https://youtube.com/watch?v=${ID}&list=PL1`, `https://m.youtube.com/watch?v=${ID}`, `http://youtu.be/${ID}`,
    `https://www.youtube.com/embed/${ID}`, `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/live/${ID}`, `www.youtube.com/watch?v=${ID}`, `youtu.be/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
  ]) {
    const v = E.parse(url);
    assert.ok(v, url);
    assert.equal(v.provider, 'youtube');
    assert.equal(v.id, ID);
    assert.equal(v.embedUrl, `https://www.youtube-nocookie.com/embed/${ID}?rel=0`);
    assert.equal(v.watchUrl, `https://www.youtube.com/watch?v=${ID}`);
  }
  assert.equal(E.parse(`https://youtu.be/${ID}?t=90`).embedUrl, `https://www.youtube-nocookie.com/embed/${ID}?rel=0&start=90`);
  assert.equal(E.parse(`https://www.youtube.com/watch?v=${ID}&t=1h2m3s`).embedUrl, `https://www.youtube-nocookie.com/embed/${ID}?rel=0&start=3723`);
  assert.equal(E.parse(`https://youtu.be/${ID}?t=99999999`).embedUrl, `https://www.youtube-nocookie.com/embed/${ID}?rel=0`, 'unsinnige Zeit wird ignoriert');
  assert.deepEqual(['0', 'abc', '-5', '1x', ''].map(E.seconds), [0, 0, 0, 0, 0]);
  assert.equal(E.seconds('1m30s'), 90);
  part('YouTube: alle üblichen Schreibweisen, Startzeit, Adresse ohne Cookies');

  const vim = E.parse('https://vimeo.com/76979871');
  assert.deepEqual([vim.provider, vim.id, vim.embedUrl], ['vimeo', '76979871', 'https://player.vimeo.com/video/76979871?dnt=1']);
  assert.equal(E.parse('https://vimeo.com/76979871/abcdef1234').embedUrl, 'https://player.vimeo.com/video/76979871?dnt=1&h=abcdef1234', 'Vimeo, nicht gelistet');
  assert.equal(E.parse('https://player.vimeo.com/video/76979871?h=abcdef1234').watchUrl, 'https://vimeo.com/76979871/abcdef1234');
  const dm = E.parse('https://www.dailymotion.com/video/x8abc12');
  assert.deepEqual([dm.provider, dm.id, dm.embedUrl], ['dailymotion', 'x8abc12', 'https://www.dailymotion.com/embed/video/x8abc12']);
  assert.equal(E.parse('https://www.dailymotion.com/video/x8abc12_titel-des-videos').id, 'x8abc12', 'ältere Adressen mit Titel');
  assert.equal(E.parse('https://dai.ly/x8abc12').provider, 'dailymotion');
  part('Vimeo (auch nicht gelistet) und Dailymotion (auch kurze und ältere Adressen)');

  // Fälschungen und Unsinn: nichts davon wird eingebettet
  for (const bad of [
    `https://youtube.com.boese.example/watch?v=${ID}`, `https://boese-youtube.com/watch?v=${ID}`, `https://youtube.com@boese.example/watch?v=${ID}`,
    `https://user:pw@www.youtube.com/watch?v=${ID}`, `https://www.youtube.com:8443/watch?v=${ID}`, `javascript:alert(1)`, `data:text/html,<p>`, `ftp://youtu.be/${ID}`,
    'https://youtu.be/kurz', 'https://youtu.be/' + 'x'.repeat(40), `https://www.youtube.com/watch?v=${ID}"onload="x`, `https://www.youtube.com/watch?v=${ID} x`,
    'https://www.youtube.com/', 'https://www.youtube.com/watch', 'https://vimeo.com/abc', 'https://vimeo.com/12/', 'https://www.dailymotion.com/', 'https://example.com/video/x8abc12',
    '', null, undefined, 'x'.repeat(400),
  ]) assert.equal(E.parse(bad), null, String(bad).slice(0, 60));
  part('Fälschungen und Unsinn werden nicht eingebettet (ähnliche Hosts, Zugangsdaten, andere Schemata, falsche Kennung, Sonderzeichen)');

  assert.deepEqual(E.frameHosts(), ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.dailymotion.com', 'https://geo.dailymotion.com']);
  part('Hosts für den Schutzkopf');

  // ---------- Markdown ----------
  const src = `Vorher\nhttps://youtu.be/${ID}\n\n![Mein Clip](https://vimeo.com/76979871)\n![](https://www.dailymotion.com/video/x8abc12 "Titel")\nText mit ![x](https://youtu.be/${ID}) mittendrin\n[Link](https://youtu.be/${ID})`;
  const withCards = M.render(src, { embeds: true, lineMap: true });
  const cards = [...withCards.matchAll(/<div class="md-embed"[^>]*>/g)].map(m => m[0]);
  assert.equal(cards.length, 3, 'drei Karten: eine Adresse allein, zwei Bilder allein auf der Zeile');
  assert.match(cards[0], /data-provider="youtube"/);
  assert.match(cards[1], /data-provider="vimeo"/);
  assert.match(cards[1], /data-title="Mein Clip"/);
  assert.match(cards[2], /data-provider="dailymotion"/);
  assert.match(cards[0], /data-line="1"/, 'Zeilennummer für das gemeinsame Scrollen');
  assert.ok(!/<iframe/i.test(withCards), 'die Karte enthält keinen Rahmen');
  assert.ok(!/<img/i.test(withCards), 'kein Bild-Element, das die Seite des Anbieters abruft');
  assert.ok(!/src=/i.test(withCards), 'keine Quelle, die der Browser von selbst lädt');
  assert.match(withCards, /<button type="button" class="md-embed-load">Video laden<\/button>/);
  assert.match(withCards, /<a class="md-embed-open" href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"/);
  assert.match(withCards, /<p data-line="5">Text mit <a href="https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"[^>]*class="md-video-link">▶ x<\/a> mittendrin<br><a /, 'mitten im Satz: Link statt Karte; [Text](Adresse) bleibt ein Link');
  part('Markdown: Karte nur für eine Adresse oder ein Bild allein auf der Zeile; kein Rahmen, kein Bild, keine Quelle');

  const plain = M.render(src, {});
  assert.ok(!/md-embed/.test(plain), 'ohne die Option (Druck, Listen) keine Karte');
  assert.ok(!/<img/i.test(plain), 'auch kein Bild: eine Videoadresse ist kein Bild');
  assert.match(plain, /<a href="https:\/\/vimeo\.com\/76979871"[^>]*class="md-video-link">▶ Mein Clip<\/a>/);
  assert.match(plain, /<a href="https:\/\/youtu\.be\/dQw4w9WgXcQ"[^>]*>https:\/\/youtu\.be\/dQw4w9WgXcQ<\/a>/, 'eine nackte Adresse bleibt ein normaler Link');
  // echte Bilder bleiben Bilder
  assert.match(M.render('![x](https://beispiel.ch/bild.png)', { embeds: true }), /<img src="https:\/\/beispiel\.ch\/bild\.png"/);
  assert.ok(!/md-embed/.test(M.render('![x](https://beispiel.ch/bild.png)\nhttps://beispiel.ch/seite', { embeds: true })));
  part('Ohne Einbetten: Link statt Bild; gewöhnliche Bilder und Links bleiben unverändert');

  // YouTube kann nicht überall geladen werden: nur der Link
  const noLoad = M.render(`https://youtu.be/${ID}`, { embeds: true, embedLoad: p => p !== 'youtube' });
  assert.ok(!/md-embed-load/.test(noLoad));
  assert.match(noLoad, /lässt YouTube das Einbetten nicht zu|does not allow embedding/);
  assert.match(noLoad, /md-embed-open/);
  part('Ohne Ladeknopf (zum Beispiel YouTube in einer geöffneten Datei): nur der Link zum Anbieter, mit Erklärung');

  // Einschleusen über den Titel
  const evil = M.render('![<img src=x onerror=alert(1)>](https://vimeo.com/76979871)', { embeds: true });
  assert.ok(!/<img/i.test(evil) && !/onerror=alert/.test(evil.replace(/&lt;img src=x onerror=alert\(1\)&gt;/g, '')), 'der Titel wird maskiert');
  part('Titel mit HTML wird maskiert');

}

/* Mehrzeilige Entscheide und Fragen (v2.4.0) ohne Browser: Parser ("?!```" … "```", Einträge in Listen, Unter-Einträge, Code zählt
   nicht), Index mit Beschreibung und Block (Schema 15), Antworten schreiben, Angleichen aus Schema 14, Vorschau, Export, Editor,
   Querverweise im Block und Werkzeuge für Agenten. */
async function runEntries(browser, part, step) {
  let now = Date.parse('2026-10-20T08:00:00Z');
  const RealDate = Date;
  const sandbox = load({Date: class extends RealDate { constructor(...a) { if (a.length === 0) super(now); else super(...a); } static now() { return now; } }});

  const { NoNotesQuestions: Q, NoNotesMarkdown: M, NoNotesEditing: E } = sandbox;
  const json = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  const BODY = [
    'Intro',                                                         // 0
    '?!``` Ablage auf SharePoint umstellen @anna >15.11.2026',       // 1
    'Ab 1.11. liegen alle Projektordner auf SharePoint.',            // 2
    '- Altdaten bleiben bis Ende Jahr lesbar',                       // 3
    '?! Wer migriert die Altdaten? @ben',                            // 4
    '!! 21.10.2026: Externe Firma',                                  // 5
    '- ?! Brauchen wir Schulungen?',                                 // 6
    '? Wer schult? @cem',                                            // 7
    '~~~',                                                           // 8
    '?! im Code zählt nicht',                                        // 9
    '```',                                                           // 10 (im Code: schliesst den Block nicht)
    '~~~',                                                           // 11
    'Siehe [[Ziel*]]',                                               // 12
    '```',                                                           // 13
    '!! 22.10.2026: Ja, so umsetzen',                                // 14
    '',                                                              // 15
    '- Budget 2027',                                                 // 16
    '- ?! Neues Tool kaufen? @anna',                                 // 17
    '  !! 20.10.2026: Ja, Variante B',                               // 18
    '- [ ] Offerte einholen',                                        // 19
    'Danach [[Nach*]]',                                              // 20
    '```',                                                           // 21
    '? im Code zählt nicht',                                         // 22
    '```',                                                           // 23
    '?```',                                                          // 24
    '',                                                              // 25
    '# Wie gehen wir vor?',                                          // 26
    'Mit Details',                                                   // 27
    '```',                                                           // 28
  ].join('\n');

  // ---------- Parser ----------
  const parsed = json(Q.parse(BODY));
  assert.deepEqual(parsed.map(p => [p.kind, p.text, p.lineIndex, p.parent, p.answer, p.decided]), [
    ['decision', 'Ablage auf SharePoint umstellen @anna', 1, null, 'Ja, so umsetzen', '2026-10-22'],
    ['decision', 'Wer migriert die Altdaten? @ben', 4, 0, 'Externe Firma', '2026-10-21'],
    ['decision', 'Brauchen wir Schulungen?', 6, 0, null, null],
    ['question', 'Wer schult? @cem', 7, 0, null, null],
    ['decision', 'Neues Tool kaufen? @anna', 17, null, 'Ja, Variante B', '2026-10-20'],
    ['question', 'Wie gehen wir vor?', 24, null, null, null],
  ]);
  assert.equal(parsed[0].due, '2026-11-15', 'Termin in der Titelzeile');
  assert.deepEqual(parsed[0].people, [{ handle: 'anna', optional: false }], 'Personen nur aus dem Titel');
  assert.equal(parsed[0].details, 'Ab 1.11. liegen alle Projektordner auf SharePoint.\n- Altdaten bleiben bis Ende Jahr lesbar\n\n~~~\n?! im Code zählt nicht\n```\n~~~\nSiehe [[Ziel*]]',
    'Beschreibung ohne Unter-Einträge, Code im Block bleibt Text');
  assert.equal(parsed[0].block, true);
  assert.equal(parsed[2].list, true);
  assert.equal(parsed[4].indent, '  ', 'Antwort eines Listenpunkts eingerückt');
  assert.equal(parsed[5].details, 'Mit Details', 'ohne Titel gilt die erste Zeile (ohne «#»)');
  assert.equal(json(Q.parse('?!```\n```')).length, 0, 'leerer Block: kein Eintrag');
  assert.deepEqual(json(Q.parse('?!```\n```\n? Danach')).map(p => p.text), ['Danach'], 'und er verschluckt nichts');
  assert.deepEqual(json(Q.parse('?!``` Offen\n? Unter\n!! nicht die Antwort des Blocks')).map(p => [p.text, p.parent, p.answer]),
    [['Offen', null, null], ['Unter', 0, 'nicht die Antwort des Blocks']], 'ohne "```" reicht der Block bis zum Ende');
  assert.deepEqual(json(Q.parse('? Wie?\n! So\n?! Und? @x')).map(p => [p.kind, p.text, p.answer, p.block, p.list]),
    [['question', 'Wie?', 'So', false, false], ['decision', 'Und? @x', null, false, false]], 'einzeilig wie bisher');
  part('Parser: Block mit Titel, Termin und Personen, Beschreibung ohne Unter-Einträge, Einträge in Listen, ohne Titel die erste Zeile, Code zählt nicht');
}

async function runTables(browser, part, step) {
  const sandbox = load();
  const window = sandbox;
  const Tb = sandbox.NoNotesTables;
  const M = sandbox.NoNotesMarkdown;
  const sel = r => r.text.slice(r.selStart, r.selEnd);
  const caretLine = r => r.text.slice(0, r.selStart).split('\n').length - 1;
  const json = v => JSON.parse(JSON.stringify(v));

  // ---------- Lesen ----------
  assert.deepEqual(Tb.splitRow('| a | b \\| c |'), ['a', 'b \\| c'], '«\\|» trennt nicht');
  assert.deepEqual(Tb.splitRow('|a|b'), ['a', 'b'], 'ohne Strich am Ende');
  assert.deepEqual(Tb.splitRow('| a |  |'), ['a', ''], 'leeres letztes Feld');
  assert.ok(Tb.isDelimiter('|:---|---:| :-: |') && Tb.isDelimiter('|---|') && !Tb.isDelimiter('| a |') && !Tb.isDelimiter('---'));
  assert.deepEqual(Tb.readMeta('<!-- tabelle: {"kopfspalte":true} -->'), { kopfspalte: true });
  assert.deepEqual(Tb.readMeta('  <!-- Table: {"x":1} -->'), { x: 1 }, 'englisch und gross geschrieben');
  assert.equal(Tb.readMeta('<!-- tabelle: {kaputt} -->'), null);
  assert.equal(Tb.readMeta('<!-- tabelle: [1] -->'), null);
  let lines = ['Text', '<!-- tabelle: {"hervorheben":true} -->', '| A | B | C |', '|:--|:-:|--:|', '| 1 | 2 | 3 | 4 |', '| x |', 'danach'];
  let t = Tb.parseAt(lines, 2);
  assert.deepEqual({ start: t.start, head: t.head, end: t.end, metaLine: t.metaLine, meta: t.meta, align: t.align, rows: t.rows, cols: t.cols, header: t.header },
    { start: 1, head: 2, end: 6, metaLine: 1, meta: { hervorheben: true }, align: ['left', 'center', 'right'], rows: [['1', '2', '3'], ['x', '', '']], cols: 3, header: ['A', 'B', 'C'] },
    'Format darüber, Ausrichtung, Zeilen auf die Spaltenzahl gebracht, Ende vor der ersten Zeile ohne «|»');
  assert.equal(Tb.parseAt(['|   |   |', '|---|---|', '| 1 | 2 |'], 0).header, null, 'leere Kopfzeile: keine Titelzeile');
  assert.equal(Tb.parseAt(['| a | b |', '|---|'], 0), null, 'Trennzeile mit anderer Spaltenzahl');
  assert.equal(Tb.parseAt(['| a | b |', 'kein Strich'], 0), null);
  part('Lesen: Felder mit «\\|», Trennzeile mit Ausrichtung, Format-Zeile (deutsch und englisch), leere Kopfzeile, Zeilen auf die Spaltenzahl');

  // ---------- Einfügen und Tab/Enter ----------
  let r = Tb.insert('Text', 4, 4, 3, 3, { header: true });
  assert.equal(r.text, 'Text\n\n| Spalte 1 | Spalte 2 | Spalte 3 |\n| -------- | -------- | -------- |\n|          |          |          |\n|          |          |          |\n');
  assert.equal(sel(r), 'Spalte 1', 'erster Titel markiert');
  r = Tb.insert('vorher\n\nnachher', 7, 7, 2, 2, { header: false, headerColumn: true, label: n => 'Col ' + n });
  assert.equal(r.text, 'vorher\n\n<!-- tabelle: {"kopfspalte":true} -->\n|     |     |\n| --- | --- |\n|     |     |\n|     |     |\n\nnachher', 'ohne Titelzeile: leerer Kopf, Titelspalte im Format');
  assert.equal(r.selStart, r.selEnd);
  assert.equal(caretLine(r), 5, 'Cursor im ersten Feld');
  r = Tb.insert('', 0, 0, 1, 1, { header: true, label: n => 'Col ' + n });
  assert.equal(r.text, '| Col 1 |\n| ----- |\n', 'eine Zeile mit Titel: nur der Kopf');
  assert.equal(Tb.insert('', 0, 0, 99, 99, {}).text.split('\n')[0].split('|').length - 2, 20, 'höchstens 20 Spalten');

  let text = 'Liste:\n\n| Name | Wert |\n|---|---|\n| a | 1 |\n';
  let pos = text.indexOf('Name') + 2;
  r = Tb.move(text, pos, 1);
  assert.equal(r.text, 'Liste:\n\n| Name | Wert |\n| ---- | ---- |\n| a    | 1    |\n', 'Tab richtet die Striche aus');
  assert.equal(sel(r), 'Wert');
  r = Tb.move(r.text, r.selStart, 1);
  assert.equal(sel(r), 'a', 'über die Trennzeile in die erste Zeile');
  r = Tb.move(r.text, r.selStart, -1);
  assert.equal(sel(r), 'Wert', 'Umschalt+Tab zurück');
  r = Tb.move(r.text, r.text.indexOf('1    |'), 1);
  assert.equal(r.text, 'Liste:\n\n| Name | Wert |\n| ---- | ---- |\n| a    | 1    |\n|      |      |\n', 'hinter dem letzten Feld eine neue Zeile');
  assert.equal(caretLine(r), 5);
  r = Tb.move(r.text, r.text.indexOf('| Name') + 2, -1);
  assert.equal(sel(r), 'Name', 'vor dem ersten Feld bleibt der Cursor im ersten');
  // Breite nach dem Tippen: längerer Inhalt verbreitert die Spalte
  text = '| Name | Wert |\n| ---- | ---- |\n| Bodensee | 1 |';
  r = Tb.move(text, text.indexOf('Bodensee') + 8, 1);
  assert.equal(r.text, '| Name     | Wert |\n| -------- | ---- |\n| Bodensee | 1    |');
  assert.equal(sel(r), '1');
  // ohne Titelzeile wird der leere Kopf übersprungen
  text = '|     |     |\n| --- | --- |\n| a   | b   |';
  r = Tb.move(text, text.indexOf('b') + 1, -1);
  assert.equal(sel(r), 'a');
  r = Tb.move(r.text, r.selStart, -1);
  assert.equal(sel(r), 'a', 'nicht in den leeren Kopf');
  assert.equal(Tb.move('kein | Tisch', 3, 1), null, 'ausserhalb einer Tabelle nichts');

  text = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\nText';
  r = Tb.enter(text, text.indexOf('2'));
  assert.equal(r.text, '| A   | B   |\n| --- | --- |\n| 1   | 2   |\n|     |     |\n| 3   | 4   |\nText', 'Enter: neue Zeile darunter');
  assert.equal(caretLine(r), 3);
  r = Tb.enter(text, 2);
  assert.equal(r.text.split('\n')[2], '|     |     |', 'Enter im Kopf: neue erste Zeile');
  text = '| A | B |\n|---|---|\n| 1 | 2 |\n|   |   |\nText';
  r = Tb.enter(text, text.indexOf('|   |   |') + 2);
  assert.equal(r.text, '| A   | B   |\n| --- | --- |\n| 1   | 2   |\n\n\n\nText', 'Enter in der leeren letzten Zeile: Tabelle endet, Leerzeilen um die Zeile des Cursors');
  assert.equal(caretLine(r), 4);
  text = '| A | B |\n|---|---|\n| 1 | 2 |\n|   |   |\n\n\n\n\nText';
  r = Tb.enter(text, text.indexOf('|   |   |') + 2);
  assert.equal(r.text, '| A   | B   |\n| --- | --- |\n| 1   | 2   |\n\n\n\n\nText', 'vorhandene Leerzeilen genügen');
  assert.equal(caretLine(r), 4);
  for (const end of ['', '\n', '\n\n']) {
    text = '| A | B |\n|---|---|\n| 1 | 2 |\n|   |   |' + end;
    r = Tb.enter(text, text.indexOf('|   |   |') + 2);
    assert.equal(r.text, '| A   | B   |\n| --- | --- |\n| 1   | 2   |\n\n', `am Ende des Texts (${JSON.stringify(end)}): eine Leerzeile, dann der Cursor`);
    assert.equal(r.selStart, r.text.length);
  }
  part('Einfügen (mit und ohne Titelzeile, Titelspalte, Grenzen) und Editor: Tab und Umschalt+Tab mit Ausrichten, neue Zeile am Ende, Enter fügt an oder beendet');

  // ---------- Codeblöcke, Entscheidblöcke, mehrere Tabellen ----------
  text = '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```';
  assert.equal(Tb.at(text, text.indexOf('1')), null, 'im Codeblock nur Text');
  assert.equal(Tb.move(text, text.indexOf('1'), 1), null);
  text = '~~~~md\n```\n| a | b |\n~~~~\n| a | b |\n|---|---|\n| 1 | 2 |';
  assert.ok(Tb.at(text, text.lastIndexOf('1')), 'nach dem Codeblock wieder eine Tabelle (Zaun mit ~~~~, darin ```)');
  text = '?!``` Varianten\n| a | b |\n|---|---|\n| 1 | 2 |\n```';
  assert.equal(Tb.at(text, text.indexOf('1')).row, 0, 'im Entscheidblock gilt die Tabelle');
  text = '| a |\n|---|\n| 1 |\n| b |\n|---|\n| 2 |';
  const a2 = Tb.at(text, text.lastIndexOf('2'));
  assert.equal(a2, null, 'eine zweite Trennzeile beendet die erste Tabelle; ohne Kopf darüber keine zweite');
  text = '| a |\n|---|\n| 1 |\n\n| b |\n|---|\n| 2 |';
  assert.equal(Tb.at(text, text.lastIndexOf('2')).t.head, 4, 'zwei Tabellen mit Leerzeile');
  part('Codeblöcke (``` und ~~~) sind keine Tabellen, Entscheidblöcke schon; mehrere Tabellen hintereinander');

  // ---------- Schritte am Kopf ----------
  text = 'Intro\n| A | B |\n|---|--:|\n| 1 | 2 |\nEnde';
  r = Tb.setMeta(text, 1, m => { m.kopfspalte = true; }, text.length);
  assert.equal(r.text, 'Intro\n<!-- tabelle: {"kopfspalte":true} -->\n| A   | B   |\n| --- | --: |\n| 1   | 2   |\nEnde', 'Format-Zeile entsteht, Ausrichtung bleibt');
  assert.equal(r.selStart, r.text.length, 'Cursor hinter der Tabelle wandert mit');
  r = Tb.setMeta(r.text, 2, m => { m.hervorheben = true; m.plugin = { breite: { 0: 'schmal' } }; });
  assert.deepEqual(Tb.readMeta(r.text.split('\n')[1]), { kopfspalte: true, hervorheben: true, plugin: { breite: { 0: 'schmal' } } });
  r = Tb.setMeta(r.text, 2, m => ({ kopfspalte: false, hervorheben: null }));
  assert.equal(r.text, 'Intro\n| A   | B   |\n| --- | --: |\n| 1   | 2   |\nEnde', 'leeres Format: die Zeile verschwindet');
  assert.equal(Tb.setMeta(r.text, 0, m => { m.x = 1; }), null, 'keine Tabelle in dieser Zeile');
  r = Tb.toggleHeader(r.text, 1, null);
  assert.equal(r.text, 'Intro\n|     |     |\n| --- | --: |\n| A   | B   |\n| 1   | 2   |\nEnde', 'Titelzeile aus: der Kopf wird zur ersten Zeile');
  r = Tb.toggleHeader(r.text, 1, null);
  assert.equal(r.text.split('\n')[1], '| A   | B   |', 'und wieder ein');
  r = Tb.toggleHeader('|   |   |\n|---|---|', 0, n => 'Col ' + n);
  assert.equal(r.text, '| Col 1 | Col 2 |\n| ----- | ----- |', 'ohne Zeilen: Spaltentitel');
  text = '| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
  r = Tb.insertRow(text, 0, 0, 'above');
  assert.deepEqual(r.text.split('\n').slice(2).map(l => Tb.splitRow(l)), [['', ''], ['1', '2'], ['3', '4']]);
  assert.equal(caretLine(r), 2);
  r = Tb.insertRow(text, 0, 1, 'below');
  assert.deepEqual(r.text.split('\n').slice(2).map(l => Tb.splitRow(l)), [['1', '2'], ['3', '4'], ['', '']]);
  r = Tb.insertRow(text, 0, -1, 'below');
  assert.deepEqual(Tb.splitRow(r.text.split('\n')[2]), ['', ''], 'unter dem Kopf: erste Zeile');
  r = Tb.deleteRow(text, 0, 0);
  assert.deepEqual(r.text.split('\n').slice(2).map(l => Tb.splitRow(l)), [['3', '4']]);
  r = Tb.insertColumn(text, 0, 0, 'right', n => 'Spalte ' + n);
  assert.deepEqual(Tb.splitRow(r.text.split('\n')[0]), ['A', 'Spalte 2', 'B']);
  assert.equal(sel(r), '', 'Cursor am Anfang des neuen Titels');
  assert.equal(r.text.slice(r.selStart, r.selStart + 8), 'Spalte 2');
  r = Tb.insertColumn('|   |   |\n|---|---|\n| 1 | 2 |', 0, 0, 'left', n => 'X');
  assert.deepEqual(Tb.splitRow(r.text.split('\n')[2]), ['', '1', '2'], 'ohne Titelzeile bleibt der Kopf leer');
  assert.equal(r.text.split('\n')[0].replace(/[|\s]/g, ''), '');
  r = Tb.deleteColumn(text, 0, 1);
  assert.equal(r.text, '| A   |\n| --- |\n| 1   |\n| 3   |');
  assert.equal(Tb.deleteColumn(r.text, 0, 0).text, r.text, 'die letzte Spalte bleibt');
  r = Tb.setMeta('x\n<!-- tabelle: {"a":1} -->\n| A |\n|---|', 1, m => { m.b = 2; });
  assert.equal(r.text, 'x\n<!-- tabelle: {"a":1,"b":2} -->\n| A   |\n| --- |', 'über die Format-Zeile angesprochen');
  assert.ok(Tb.tableAtLine(r.text, 1) && Tb.tableAtLine(r.text, 2), 'Format-Zeile oder Kopf');

  // Angaben der Erweiterungen je Zeile, Spalte und Feld wandern mit
  const fm = { kopfspalte: true, 'tab-x': { rows: { h: 'H', 0: 'A', 1: 'B', 2: 'C' }, cols: { 0: 'x', 1: 'y' }, cells: { 'h,1': 'hc', '0,0': 'a0', '1,1': 'b1', '2,0': 'c0', frei: 1 }, other: 5 }, 'tab-y': 'kein Objekt' };
  text = `<!-- tabelle: ${JSON.stringify(fm)} -->\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |`;
  const metaOf = res => Tb.readMeta(res.text.split('\n')[0]);
  const mine = res => { const m = metaOf(res); assert.equal(m.kopfspalte, true); assert.equal(m['tab-y'], 'kein Objekt'); assert.equal(m['tab-x'].other, 5); return m['tab-x']; };
  let x = mine(Tb.insertRow(text, 0, 0, 'below'));
  assert.deepEqual([x.rows, x.cells], [{ h: 'H', 0: 'A', 2: 'B', 3: 'C' }, { 'h,1': 'hc', '0,0': 'a0', '2,1': 'b1', '3,0': 'c0', frei: 1 }], 'Zeile eingefügt');
  x = mine(Tb.deleteRow(text, 0, 1));
  assert.deepEqual([x.rows, x.cells], [{ h: 'H', 0: 'A', 1: 'C' }, { 'h,1': 'hc', '0,0': 'a0', '1,0': 'c0', frei: 1 }], 'Zeile gelöscht: ihre Angaben fallen weg');
  x = mine(Tb.insertColumn(text, 0, 0, 'left', null));
  assert.deepEqual([x.cols, x.cells, x.rows.h], [{ 1: 'x', 2: 'y' }, { 'h,2': 'hc', '0,1': 'a0', '1,2': 'b1', '2,1': 'c0', frei: 1 }, 'H'], 'Spalte eingefügt');
  x = mine(Tb.deleteColumn(text, 0, 0));
  assert.deepEqual([x.cols, x.cells], [{ 0: 'y' }, { 'h,0': 'hc', '1,0': 'b1', frei: 1 }], 'Spalte gelöscht');
  r = Tb.toggleHeader(text, 0, null);
  x = mine(r);
  assert.deepEqual([x.rows, x.cells], [{ 0: 'H', 1: 'A', 2: 'B', 3: 'C' }, { '0,1': 'hc', '1,0': 'a0', '2,1': 'b1', '3,0': 'c0', frei: 1 }], 'Titelzeile aus: «h» wird Zeile 0');
  x = mine(Tb.toggleHeader(r.text, 0, null));
  assert.deepEqual([x.rows, x.cells], [fm['tab-x'].rows, fm['tab-x'].cells], 'und wieder an: wie vorher');
  x = mine(Tb.enter(text, text.indexOf('| 1 |') + 2));
  assert.deepEqual(x.rows, { h: 'H', 0: 'A', 2: 'B', 3: 'C' }, 'Enter fügt eine Zeile ein');
  r = Tb.enter(text + '\n|   |   |', text.length + 3);
  assert.deepEqual(mine(r).rows, fm['tab-x'].rows, 'Enter in der leeren letzten Zeile: die übrigen bleiben');
  part('Rechtsklick-Schritte: Format setzen und entfernen (Cursor wandert mit), Titelzeile aus und ein, Zeilen und Spalten einfügen und löschen; Angaben der Erweiterungen wandern mit');

  // ---------- Vorschau ----------
  text = 'Vorher\n\n<!-- tabelle: {"kopfspalte":true,"hervorheben":true} -->\n| Name | Wert \\| Einheit | Mitte |\n|---|--:|:-:|\n| **a** | 1 | x |\n| b | [[Ziel]] | y |\n\nNachher';
  let html = M.render(text, { lineMap: true });
  assert.ok(html.includes('<table class="md-table md-table-col md-table-mark" data-line="2" data-src="2">'), 'data-src: erste Zeile der Tabelle (die Format-Zeile)');
  assert.ok(html.includes('<thead><tr><th scope="col" data-col="0">Name</th><th scope="col" data-col="1" style="text-align: right">Wert | Einheit</th>'), 'Kopf mit Ausrichtung, «\\|» als Strich');
  assert.ok(html.includes('<tr data-row="0"><th scope="row" data-col="0"><strong>a</strong></th><td data-col="1" style="text-align: right">1</td><td data-col="2" style="text-align: center">x</td></tr>'), 'Titelspalte als th, Markdown in Feldern');
  assert.ok(!html.includes('tabelle:'), 'Format-Zeile unsichtbar');
  assert.match(html, /<p data-line="0">Vorher<\/p>\n<table/);
  assert.match(html, /<\/table>\n<p data-line="8">Nachher<\/p>/);
  html = M.render('|   |   |\n|---|---|\n| 1 | 2 |', {});
  assert.ok(html.includes('class="md-table md-table-nohead"') && !html.includes('<thead>'), 'ohne Titelzeile kein thead');
  assert.ok(html.includes('data-src="0"'));
  assert.ok(!M.render('```\n| a |\n|---|\n```', {}).includes('<table'), 'im Code keine Tabelle');
  assert.ok(!M.render('> | a |\n> |---|\n> | 1 |', {}).includes('data-src'), 'im Zitat ohne Quellzeile (kein Rechtsklick)');
  assert.ok(M.render('> | a |\n> |---|\n> | 1 |', {}).includes('<table class="md-table"'), 'aber als Tabelle');
  assert.ok(!M.render('?!``` T\n| a |\n|---|\n| 1 |\n```', {}).includes('data-src'), 'im Block ohne Quellzeile');
  assert.ok(!M.render('| a |\n|---|', { tableSrc: false }).includes('data-src'), 'tableSrc: false (Druck)');
  assert.ok(M.render('<!-- tabelle: {"x":1} -->\nkein Tisch', {}).includes('&lt;!-- tabelle'), 'Format-Zeile ohne Tabelle bleibt Text');
  assert.ok(M.render('Text\n| a |\n|---|\n| 1 |', {}).includes('<p>Text</p>\n<table'), 'Tabelle direkt nach einem Absatz');
  part('Vorschau: Titelzeile als thead, Titelspalte als th, Hervorheben, Ausrichtung, Markdown und «\\|» in Feldern, Quellzeile nur oben, Code, Zitat, Block');

  // ---------- Angaben von Erweiterungen ----------
  const seen = [];
  html = M.render('<!-- tabelle: {"tf":{"b":{"0":"20%"}}} -->\n| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |', {
    tableFormat: info => {
      seen.push(info);
      return [
        { table: { class: 'tf-x', width: '100%' }, header: { class: 'tf-h', background: '#eef' }, columns: { 0: { width: info.meta.tf.b[0], class: 'tf-c0' } },
          rows: { 1: { height: '40px', class: 'tf-r1', background: '#ffe' } }, cells: { '1,1': { background: '#fdd', fontWeight: 'bold' }, 'h,1': { color: 'red' } } },
        { columns: { 1: { background: 'url(javascript:alert(1))', color: 'expression(alert(1))', onclick: 'x', 'text-align': 'center' } }, cells: { '0,0': { class: 'ok bad"class <x>' } } },
        null, 'Unsinn',
      ];
    },
  });
  assert.deepEqual(json(seen), [{ line: 0, meta: { tf: { b: { 0: '20%' } } }, header: true, headerColumn: false, cols: 2, rows: 2, cells: { header: ['A', 'B'], rows: [['1', '2'], ['3', '4']] } }]);
  assert.ok(html.includes('<table class="md-table tf-x" style="width: 100%" data-src="0">'), html);
  assert.ok(html.includes('<thead><tr class="tf-h"><th scope="col" data-col="0" class="tf-c0" style="width: 20%; background: #eef">A</th><th scope="col" data-col="1" style="text-align: center; background: #eef; color: red">B</th></tr></thead>'), 'Kopf: Klasse am tr, Werte an jedem Feld');
  assert.ok(html.includes('<tr data-row="1" class="tf-r1"><td data-col="0" class="tf-c0" style="width: 20%; height: 40px; background: #ffe">3</td><td data-col="1" style="text-align: center; height: 40px; background: #ffe; background: #fdd; font-weight: bold">4</td></tr>'), 'Spalte, Zeile, Feld in dieser Reihenfolge');
  assert.ok(html.includes('<td data-col="0" class="tf-c0 ok" style="width: 20%">1</td>'), 'nur gültige Klassennamen');
  assert.ok(!/javascript|expression|onclick|url\(/.test(html), 'gefährliche Werte und Eigenschaften fallen weg');
  html = M.render('| A |\n|---|\n| 1 |', { tableFormat: () => { throw new Error('kaputt'); } });
  assert.ok(html.includes('<table class="md-table" data-src="0">'), 'Fehler der Erweiterung: Tabelle ohne Angaben');
  part('Angaben von Erweiterungen: Tabelle, Kopf, Spalten, Zeilen, Felder (Reihenfolge), Format aus der Datei, Klassen und Werte geprüft, Fehler schaden nicht');
}

async function runGridTables(browser, part, step) {
  const sandbox = load();
  const window = sandbox;
  const Tb = sandbox.NoNotesTables;
  const M = sandbox.NoNotesMarkdown;
  const Tk = sandbox.NoNotesTasks;
  const Q = sandbox.NoNotesQuestions;
  const sel = r => r.text.slice(r.selStart, r.selEnd);
  const caretLine = r => r.text.slice(0, r.selStart).split('\n').length - 1;
  const json = v => JSON.parse(JSON.stringify(v));
  const posOf = (text, line, col) => text.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0) + col;

  // ---------- Lesen ----------
  const user = [
    '+ -------- + -------- + -------- + -------- +',
    '| Spalte 1 | Spalte 2 | Spalte 3 | Spalte 4 |',
    '| -------- | -------- | -------- | -------- |',
    '| Zeile 1  (4 Spalten breit)                |',
    '+ ----------------------------------------- +',
    '| Zeile 2,      |          |          |          |',
    '| über 2 Zeilen |          |          |          |',
    '+ ----------------------------------------- +',
    'danach',
  ];
  let t = Tb.parseAt(user, 0);
  assert.deepEqual(json({ kind: t.kind, cols: t.cols, end: t.end, header: t.header, rows: t.rows, spans: t.spans }), {
    kind: 'grid', cols: 4, end: 8, header: ['Spalte 1', 'Spalte 2', 'Spalte 3', 'Spalte 4'],
    rows: [['Zeile 1  (4 Spalten breit)', '', '', ''], ['Zeile 2,<br>über 2 Zeilen', '', '', '']],
    spans: { h: [1, 1, 1, 1], rows: [[4, 0, 0, 0], [1, 1, 1, 1]] },
  }, 'Schreibweise aus der Anfrage: Leerzeichen im Rahmen, «| --- |» als Trennlinie der Titelzeile, Feld über vier Spalten, verrutschte «|»');
  assert.equal(Tb.hasGrid(user.join('\n')), true, 'hasGrid: die Schreibweise aus der Anfrage');
  assert.equal(Tb.hasGrid('| a | b |\n| --- | --- |\n| 1 | 2 |'), false, 'hasGrid: einfache Tabelle');
  assert.equal(Tb.hasGrid('Text\n+---+\nmehr Text\n\n---'), false, 'hasGrid: Linie ohne Zeile mit «|» daneben');
  assert.equal(Tb.hasGrid(''), false);
  const pandoc = [
    '<!-- tabelle: {"kopfspalte":true} -->',
    '+---------------+---------------+--------------------+',
    '| Frucht        | Preis         | Vorteile           |',
    '+:==============+==============:+:==================:+',
    '| Bananen       | 1.34          | - gelb             |',
    '|               |               | - mit Schale       |',
    '+---------------+---------------+--------------------+',
    '| Orangen, über zwei Spalten    | Vitamin C \\| D     |',
    '+-------------------------------+--------------------+',
  ];
  t = Tb.parseAt(pandoc, 1);
  assert.deepEqual(json({ start: t.start, head: t.head, end: t.end, meta: t.meta, align: t.align, rows: t.rows, spans: t.spans.rows }), {
    start: 0, head: 1, end: 9, meta: { kopfspalte: true }, align: ['left', 'right', 'center'],
    rows: [['Bananen', '1.34', '- gelb<br>- mit Schale'], ['Orangen, über zwei Spalten', '', 'Vitamin C \\| D']],
    spans: [[1, 1, 1], [2, 0, 1]],
  }, 'wie bei Pandoc: Format-Zeile darüber, Ausrichtung in der Trennlinie der Titelzeile, mehrzeilige Felder, Feld über zwei Spalten, «\\|»');
  t = Tb.parseAt(['+:--+--:+', '| a | b |', '+---+---+', '| über beide |'], 0);
  assert.deepEqual(json({ header: t.header, align: t.align, rows: t.rows, spans: t.spans.rows, end: t.end }),
    { header: null, align: ['left', 'right'], rows: [['a', 'b'], ['über beide', '']], spans: [[1, 1], [2, 0]], end: 4 },
    'ohne Titelzeile (Ausrichtung in der obersten Linie), letzte Zeile ohne Rahmen darunter');
  t = Tb.parseAt(['+---+---+---+---+', '| a | b | c | d |', '+---+---+---+---+', '| drei Spalten | d |', '+---+---+---+---+', '| x | über drei     |', '| y | noch eine Zeile |', '| z |', '+---+---+---+---+'], 0);
  assert.deepEqual(json(t.spans.rows.slice(1)), [[3, 0, 0, 1], [1, 3, 0, 0]], 'welche Spalten ein Feld umfasst, bestimmt die Lage der «|» zu den «+», auch wenn sie nicht genau untereinander stehen');
  assert.deepEqual(t.rows[2], ['x<br>y<br>z', 'über drei<br>noch eine Zeile', '', ''], 'die häufigste Zahl der Felder einer Zeile gilt, fehlende Felder sind leer');
  assert.equal(Tb.parseAt(['+---+---+', 'Text'], 0), null, 'ein Rahmen allein ist keine Tabelle');
  assert.ok(!Tb.isBorder('+ Punkt einer Liste') && Tb.isBorder('+---+') && Tb.isBorder('  +===+===+') && Tb.isBorder('+ --- + --- +'));
  assert.equal(Tb.at('```\n+---+\n| a |\n+---+\n```', 10), null, 'in einem Codeblock keine Tabelle');
  part('Lesen: Schreibweise aus der Anfrage, Pandoc mit Ausrichtung und Format, ohne Titelzeile, Felder über Spalten aus der Lage der «|», keine Tabelle ohne Zeile und im Code');

  // ---------- Schreiben ----------
  let f = Tb.format(Tb.parseAt(user, 0));
  assert.equal(f.lines.join('\n'), [
    '+---------------+----------+----------+----------+',
    '| Spalte 1      | Spalte 2 | Spalte 3 | Spalte 4 |',
    '+===============+==========+==========+==========+',
    '| Zeile 1  (4 Spalten breit)                     |',
    '+---------------+----------+----------+----------+',
    '| Zeile 2,      |          |          |          |',
    '| über 2 Zeilen |          |          |          |',
    '+---------------+----------+----------+----------+',
  ].join('\n'), 'ausgerichtet wie bei Pandoc');
  f = Tb.format(Tb.parseAt(pandoc, 1));
  assert.deepEqual(f.lines, [
    '<!-- tabelle: {"kopfspalte":true} -->',
    '+---------+------------------+----------------+',
    '| Frucht  | Preis            | Vorteile       |',
    '+:========+=================:+:==============:+',
    '| Bananen | 1.34             | - gelb         |',
    '|         |                  | - mit Schale   |',
    '+---------+------------------+----------------+',
    '| Orangen, über zwei Spalten | Vitamin C \\| D |',
    '+----------------------------+----------------+',
  ], 'Format-Zeile bleibt, Ausrichtung in der Trennlinie, das Feld über zwei Spalten macht die zweite breiter, «+» nur an Feldgrenzen');
  const again = Tb.parseAt(f.lines, 1);
  assert.deepEqual(json([again.rows, again.spans, again.align]), json([Tb.parseAt(pandoc, 1).rows, Tb.parseAt(pandoc, 1).spans, Tb.parseAt(pandoc, 1).align]), 'lesen, schreiben, lesen ergibt dasselbe');
  let r = Tb.insert('Text', 4, 4, 3, 3, { header: true, grid: true });
  assert.equal(r.text, 'Text\n\n+----------+----------+----------+\n| Spalte 1 | Spalte 2 | Spalte 3 |\n+==========+==========+==========+\n|          |          |          |\n+----------+----------+----------+\n|          |          |          |\n+----------+----------+----------+\n');
  assert.equal(sel(r), 'Spalte 1', 'erster Titel markiert');
  r = Tb.insert('', 0, 0, 2, 1, { header: false, grid: true });
  assert.equal(r.text, '+-----+-----+\n|     |     |\n+-----+-----+\n', 'ohne Titelzeile: keine «=»-Linie');
  part('Schreiben: ausgerichtet wie Pandoc, Format-Zeile, Ausrichtung, «+» nur an Feldgrenzen, lesen-schreiben-lesen, Einfügen mit und ohne Titelzeile');

  // ---------- Tasten im Editor ----------
  let text = 'Vorher\n\n' + Tb.format(Tb.parseAt(['+---+---+', '| A | B |', '+===+===+', '| a | b |', '+---+---+', '| beide |', '+---+---+'], 0)).lines.join('\n') + '\n\nNachher';
  const L0 = 2;
  r = Tb.move(text, posOf(text, L0 + 1, 2), 1);
  assert.equal(sel(r), 'B', 'Tab: nächstes Feld');
  r = Tb.move(r.text, posOf(r.text, L0 + 3, 8), 1);
  assert.equal(sel(r), 'beide', 'Tab: das Feld über zwei Spalten ist ein Feld');
  r = Tb.move(r.text, r.selStart, 1);
  assert.equal(caretLine(r), L0 + 7, 'Tab hinter dem letzten Feld: neue Zeile');
  assert.deepEqual(r.text.split('\n').slice(L0 + 6, L0 + 9), ['+-----+-----+', '|     |     |', '+-----+-----+'], 'mit Rahmen darunter');
  r = Tb.enter(text, posOf(text, L0 + 3, 3));
  assert.deepEqual(r.text.split('\n').slice(L0 + 3, L0 + 6), ['| a   | b   |', '|     |     |', '+-----+-----+'], 'Enter am Ende eines Felds: neue Textzeile im Feld');
  assert.equal(caretLine(r), L0 + 4);
  r = Tb.enter(text, posOf(text, L0 + 5, 4));
  assert.deepEqual(r.text.split('\n').slice(L0 + 5, L0 + 7), ['| be        |', '| ide       |'], 'Enter mitten im Text teilt die Textzeile');
  assert.equal(Tb.joinLine(r.text, r.selStart, -1).text, text, 'Rücktaste am Anfang der Textzeile verbindet sie wieder');
  assert.deepEqual(Tb.joinLine(text, posOf(text, L0 + 5, 2), -1), { text, selStart: posOf(text, L0 + 5, 2), selEnd: posOf(text, L0 + 5, 2) }, 'Rücktaste am Anfang der ersten Zeile: nichts, der Rahmen bleibt');
  assert.equal(Tb.joinLine(text, posOf(text, L0 + 5, 4), -1), null, 'mitten im Text: normale Rücktaste');
  assert.equal(Tb.joinLine(Tb.enter(text, posOf(text, L0 + 5, 4)).text, posOf(text, L0 + 5, 4), 1).text, text, 'Entf am Ende der Textzeile verbindet mit der nächsten');
  r = Tb.newRow(text, posOf(text, L0 + 3, 2));
  assert.equal(caretLine(r), L0 + 5, 'Strg+Enter: neue Zeile darunter');
  const withLast = Tb.newRow(text, posOf(text, L0 + 5, 2));
  r = Tb.newRow(withLast.text, withLast.selStart);
  assert.equal(r.text, text.replace('\n\nNachher', '\n\n\n\nNachher'), 'Strg+Enter in der leeren letzten Zeile: die Tabelle endet');
  assert.equal(caretLine(r), L0 + 8, 'Cursor unter der Tabelle');
  assert.equal(Tb.enter(text, posOf(text, L0 + 6, 13)), null, 'Enter am Ende der untersten Linie: normale neue Zeile');
  r = Tb.lineBreak(text, posOf(text, L0 + 1, 3));
  assert.deepEqual(r.text.split('\n').slice(L0 + 1, L0 + 3), ['| A   | B   |', '|     |     |'], 'Umschalt+Enter wie Enter (auch im Kopf)');
  part('Tasten: Tab über Felder und verbundene Felder, neue Zeile am Ende, Enter teilt die Textzeile, Rücktaste verbindet, Rahmen bleibt heil, Strg+Enter, Ende der Tabelle');

  // ---------- Tippen: die Striche bleiben untereinander ----------
  const base = Tb.insert('', 0, 0, 2, 3, { header: true, grid: true, label: n => ['Name', 'Wer'][n - 1] }).text
    .replace('|      |     |\n+------+-----+\n|      |     |', '| längerer Text | x |\n+------+-----+\n| über beide |');
  const baseT = Tb.format(Tb.parseAt(base.split('\n'), 0)).lines.join('\n');
  assert.deepEqual(Tb.parseAt(baseT.split('\n'), 0).spans.rows, [[1, 1], [2, 0]]);
  const typeAt = (src, pos, ch) => { const n = src.slice(0, pos) + ch + src.slice(pos); return Tb.typed(src, n, pos + ch.length) || { text: n, selStart: pos + ch.length, selEnd: pos + ch.length }; };
  const sameWidth = src => new Set(src.split('\n').filter(Boolean).map(l => Array.from(l).length)).size === 1;
  let cur = typeAt(baseT, posOf(baseT, 1, 6), 'x');
  assert.equal(cur.text.split('\n')[1], '| Namex         | Wer |', 'Platz im Feld: der Zwischenraum nimmt das Zeichen auf');
  assert.ok(sameWidth(cur.text));
  for (const ch of ' mit Text') cur = typeAt(cur.text, cur.selStart, ch);
  assert.equal(cur.text.split('\n')[1], '| Namex mit Text | Wer |', 'kein Platz mehr: neu ausgerichtet, Leerzeichen im Text bleiben');
  assert.ok(sameWidth(cur.text), 'alle Linien gleich breit');
  assert.deepEqual(Tb.parseAt(cur.text.split('\n'), 0).spans.rows, [[1, 1], [2, 0]], 'das verbundene Feld bleibt verbunden');
  assert.equal(cur.text.slice(cur.selStart - 4, cur.selStart), 'Text', 'Cursor hinter dem Getippten');
  cur = typeAt(cur.text, cur.selStart, '|');
  assert.ok(cur.text.split('\n')[1].startsWith('| Namex mit Text\\| '), 'ein getipptes «|» wird zu «\\|»');
  const del = baseT.slice(0, posOf(baseT, 1, 5)) + baseT.slice(posOf(baseT, 1, 6));
  assert.equal(Tb.typed(baseT, del, posOf(baseT, 1, 5)).text.split('\n')[1], '| Nam           | Wer |', 'Löschen: der Zwischenraum wächst');
  assert.equal(Tb.snap(baseT, posOf(baseT, 1, 10)), posOf(baseT, 1, 6), 'Klick in den Zwischenraum: hinter den Text');
  assert.equal(Tb.snap(baseT, posOf(baseT, 1, 4)), null);
  part('Tippen: Zwischenraum nimmt Zeichen auf, sonst neu ausrichten mit den Spannen von vorher, Leerzeichen bleiben, «|» maskiert, Löschen, Klick in den Zwischenraum');

  // ---------- Rechtsklick: verbinden, teilen, Spalten, umwandeln ----------
  const four = Tb.insert('', 0, 0, 4, 2, { header: true, grid: true, label: n => 'S' + n }).text;
  r = Tb.mergeRight(four, 0, 0, 1);
  assert.deepEqual(Tb.parseAt(r.text.split('\n'), 0).spans.rows[0], [1, 2, 0, 1], 'Feld mit dem rechts daneben verbinden');
  r = Tb.mergeRight(r.text, 0, 0, 1);
  assert.deepEqual(Tb.parseAt(r.text.split('\n'), 0).spans.rows[0], [1, 3, 0, 0]);
  let g = Tb.insertColumn(r.text, 0, 2, 'right', n => 'S' + n);
  assert.deepEqual(json(Tb.parseAt(g.text.split('\n'), 0).spans), { h: [1, 1, 1, 1, 1], rows: [[1, 4, 0, 0, 0]] }, 'neue Spalte mitten im verbundenen Feld: es wird breiter');
  g = Tb.deleteColumn(g.text, 0, 1);
  assert.deepEqual(json(Tb.parseAt(g.text.split('\n'), 0).spans), { h: [1, 1, 1, 1], rows: [[1, 3, 0, 0]] }, 'Spalte löschen, wo das Feld beginnt: es wird schmaler');
  g = Tb.splitCell(g.text, 0, 0, 2);
  assert.deepEqual(Tb.parseAt(g.text.split('\n'), 0).spans.rows[0], [1, 1, 1, 1], 'teilen');
  g = Tb.toggleHeader(Tb.mergeRight(four, 0, -1, 0).text, 0);
  t = Tb.parseAt(g.text.split('\n'), 0);
  assert.deepEqual(json([t.header, t.spans.rows[0], t.rows[0]]), [null, [2, 0, 1, 1], ['S1<br>S2', '', 'S3', 'S4']], 'Titelzeile aus: der verbundene Kopf wird zur ersten Zeile');
  const pipe = 'x\n\n| a | b |\n|---|---|\n| [ ] eins<br>zwei | z |\n\ny';
  g = Tb.convert(pipe, 2, 'grid');
  assert.equal(g.text, 'x\n\n+----------+-----+\n| a        | b   |\n+==========+=====+\n| [ ] eins | z   |\n| zwei     |     |\n+----------+-----+\n\ny', 'einfache Tabelle → mit Rahmen: «<br>» wird zur Textzeile');
  assert.equal(Tb.convert(g.text, 2, 'pipe').text, 'x\n\n| a                | b   |\n| ---------------- | --- |\n| [ ] eins<br>zwei | z   |\n\ny', 'und zurück');
  g = Tb.mergeRight(pipe, 2, 0, 0);
  assert.equal(Tb.parseAt(g.text.split('\n'), 2).kind, 'grid', 'Verbinden in einer einfachen Tabelle macht eine mit Rahmen');
  g = Tb.setMeta(Tb.convert(pipe, 2, 'grid').text, 2, m => { m.hervorheben = true; });
  assert.ok(g.text.includes('<!-- tabelle: {"hervorheben":true} -->\n+---'), 'Format-Zeile auch über einer Tabelle mit Rahmen');
  part('Rechtsklick: verbinden, Spalte in und an einem verbundenen Feld, teilen, Titelzeile, umwandeln in beide Richtungen, verbinden in einer einfachen Tabelle, Format');

  // ---------- Aufgaben, Fragen, Vorschau ----------
  const body = [
    '+---------+----------------------+',
    '| Wer     | Was                  |',
    '+=========+======================+',
    '| Anna    | [ ] Offerte @anna    |',
    '|         | [x] Termin >13.11.2026 |',
    '+---------+----------------------+',
    '| ? Budget reicht? | [ ] Plan  |',
    '| ! Ja, knapp      |           |',
    '+---------+----------------------+',
    '| über beide Spalten             |',
    '+--------------------------------+',
  ].join('\n');
  assert.deepEqual(Tk.parse(body).map(x => [x.text, x.lineIndex, x.slot, x.done, x.due]), [['Offerte @anna', 3, 0, false, null], ['Termin', 4, 0, true, '2026-11-13'], ['Plan', 6, 0, false, null]], 'Aufgaben je Textzeile eines Felds');
  assert.equal(Tk.parse(body)[0].people[0].handle, 'anna');
  assert.equal(Tk.setDone(body, 4, false, 0).split('\n')[4], '|         | [ ] Termin >13.11.2026 |', 'Kästchen in der zweiten Textzeile');
  const qs = Q.parse(body);
  assert.deepEqual(qs.map(x => [x.kind, x.text, x.answer, x.lineIndex]), [['question', 'Budget reicht?', 'Ja, knapp', 6]], 'die Antwort in der nächsten Textzeile des Felds gehört zur Frage');
  const answered = Q.writeAnswer(body, qs[0], 'Nein\nzu knapp');
  assert.deepEqual(answered.split('\n').slice(6, 10), ['| ? Budget reicht? | [ ] Plan               |', '| ! Nein           |                        |', '| ! zu knapp       |                        |', '+------------------+------------------------+'], 'Antwort schreiben: je Zeile eine Textzeile im Feld, neu ausgerichtet');
  const html = M.render(body, { tableSrc: true, lineMap: true, interactiveTasks: true });
  assert.ok(html.includes('<td data-col="0" colspan="2">über beide Spalten</td>'), 'Feld über zwei Spalten');
  assert.ok(html.includes('data-line="3" data-slot="0"') && html.includes('data-line="4" data-slot="0"'), 'Kästchen kennen ihre Textzeile');
  assert.ok(/Anna<\/td><td data-col="1"><span class="md-cell-task task"[^]*<br><span class="md-cell-task task done"/.test(html), 'Textzeilen im Feld untereinander');
  let info = null;
  M.render(body, { tableFormat: x => { info = x; return null; } });
  assert.deepEqual(json([info.grid, info.spans.rows]), [true, [[1, 1], [1, 1], [2, 0]]], 'Erweiterungen erfahren die Spannen');
  part('Aufgaben, Fragen und Vorschau: je Textzeile, Kästchen setzen, Antwort in der nächsten Textzeile, Antwort schreiben, colspan, Angaben für Erweiterungen');
}

/* v2.11.0: Personen an Aufgaben (auch geerbt), Aufgaben, Fragen und Entscheide in Tabellenfeldern, Zeilenumbruch im Feld,
   Index (Schema 16, Regeln 3), Abhaken nach slot, Antwort ins Feld, Vorschau, Agenten, Abschnitte unter der Mindmap im Export. */
async function runCellsPeople(browser, part, step) {
  const sandbox = load({});

  const { NoNotesQuestions: Q, NoNotesTasks: T, NoNotesTables: Tb, NoNotesMarkdown: M } = sandbox;
  const json = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  // ---------- Personen an Aufgaben ----------
  const LIST = [
    '- [ ] Offerte einholen @anna (@ben) >15.11.2026', // 0
    '  - [ ] Preise vergleichen',                      // 1: erbt anna und ben
    '    - [ ] Tabelle machen',                        // 2: erbt (über 1) von 0
    '  - [x] Lieferant fragen @cem',                   // 3: eigene Person
    '- [ ] Ohne Person',                               // 4
    '- [ ] Mail an anna@example.ch schicken',          // 5: keine Mailadresse als Person
  ].join('\n');
  const tp = json(T.parse(LIST));
  assert.deepEqual(tp.map(x => [x.text, x.parent, x.people.map(p => (p.inherited ? '~' : '') + (p.optional ? '(' + p.handle + ')' : p.handle)).join(' ')]), [
    ['Offerte einholen @anna (@ben)', -1, 'anna (ben)'],
    ['Preise vergleichen', 0, '~anna ~(ben)'],
    ['Tabelle machen', 1, '~anna ~(ben)'],
    ['Lieferant fragen @cem', 0, 'cem'],
    ['Ohne Person', -1, ''],
    ['Mail an anna@example.ch schicken', -1, ''],
  ]);
  assert.equal(tp[0].due, '2026-11-15', 'Termin bleibt Termin, @anna ist eine Person');
  part('Personen an Aufgaben: @ verantwortlich, (@) beteiligt, Unteraufgaben erben (über mehrere Ebenen), eigene Person geht vor, keine Mailadressen');

  // ---------- Tabellenfelder ----------
  const TABLE = [
    'Plan',                                                                                  // 0
    '',                                                                                      // 1
    '| Thema | Aufgaben | Klärung |',                                                        // 2
    '|---|---|---|',                                                                         // 3
    '| Lieferant | [ ] Offerten @anna >20.11.2026<br>[x] Liste erstellt | ?! Wer liefert? @ben<br>!! 14.10.2026: Müller |', // 4
    '| Budget | [ ] Antrag schreiben (@cem) | ? Reicht 5000?<br>? Wer zahlt? |',            // 5
    '| Text | nur Text<br>zweite Zeile | |',                                                // 6
    '',                                                                                      // 7
    '```',                                                                                   // 8
    '| [ ] im Code | ? im Code |',                                                           // 9
    '|---|---|',                                                                             // 10
    '| [ ] auch nicht | x |',                                                                // 11
    '```',                                                                                   // 12
    '- [ ] Danach @dora',                                                                    // 13
  ].join('\n');
  const ct = json(T.parse(TABLE));
  assert.deepEqual(ct.map(x => [x.text, x.lineIndex, x.slot == null ? null : x.slot, x.done, x.due, x.people.map(p => p.handle).join(' ')]), [
    ['Offerten @anna', 4, 0, false, '2026-11-20', 'anna'],
    ['Liste erstellt', 4, 1, true, null, ''],
    ['Antrag schreiben (@cem)', 5, 0, false, null, 'cem'],
    ['Danach @dora', 13, null, false, null, 'dora'],
  ], 'Aufgaben in Feldern mit slot, nicht in Code, danach geht es weiter');
  const cq = json(Q.parse(TABLE));
  assert.deepEqual(cq.map(x => [x.kind, x.text, x.lineIndex, x.answer, x.decided, x.people.map(p => p.handle).join(' '), x.cell && x.cell.index]), [
    ['decision', 'Wer liefert? @ben', 4, 'Müller', '2026-10-14', 'ben', 2],
    ['question', 'Reicht 5000?', 5, null, null, '', 2],
    ['question', 'Wer zahlt?', 5, null, null, '', 2],
  ], 'Fragen und Entscheide in Feldern, Antwort im selben Feld');
  // abhaken nach slot, nur das richtige Kästchen
  let b = T.setDone(TABLE, 4, true, 0);
  assert.equal(b.split('\n')[4], '| Lieferant | [x] Offerten @anna >20.11.2026<br>[x] Liste erstellt | ?! Wer liefert? @ben<br>!! 14.10.2026: Müller |');
  b = T.reopen(b, 4, 1);
  assert.equal(b.split('\n')[4], '| Lieferant | [x] Offerten @anna >20.11.2026<br>[ ] Liste erstellt | ?! Wer liefert? @ben<br>!! 14.10.2026: Müller |');
  assert.equal(T.openSubtasks(TABLE, 4, 0), 0, 'keine Unteraufgaben in Feldern');
  assert.equal(T.doubleClick(TABLE, 5, 0).body.split('\n')[5], '| Budget | [x] Antrag schreiben (@cem) | ? Reicht 5000?<br>? Wer zahlt? |');
  // Antwort ins Feld, Tabelle neu ausgerichtet
  b = Q.writeAnswer(TABLE, cq[2], 'Die Firma | nicht wir');
  assert.ok(b.split('\n')[5].includes('? Reicht 5000?<br>? Wer zahlt?<br>! Die Firma \\| nicht wir'), b.split('\n')[5]);
  assert.equal(new Set(b.split('\n').slice(2, 7).map(l => l.length)).size, 1, 'alle Zeilen der Tabelle gleich lang (ausgerichtet)');
  assert.equal(json(Q.parse(b)).find(x => x.text === 'Wer zahlt?').answer, 'Die Firma | nicht wir', '«\\|» als «|» im Index');
  b = Q.writeAnswer(b, json(Q.parse(b)).find(x => x.text === 'Wer liefert? @ben'), 'Meier', { decided: '15.10.2026' });
  assert.ok(b.includes('?! Wer liefert? @ben<br>!! 15.10.2026: Meier'), 'Entscheid ersetzt, mit Datum');
  b = Q.writeAnswer(b, json(Q.parse(b)).find(x => x.text === 'Wer zahlt?'), '');
  assert.ok(b.includes('? Reicht 5000?<br>? Wer zahlt? '), 'leere Antwort entfernt die Antwort-Teile');
  part('Tabellenfelder: Aufgaben mit slot (nicht in Code), Fragen und Entscheide mit Antwort im Feld; abhaken trifft das richtige Kästchen; Antwort ins Feld mit «\\|», ausgerichtet');

  // ---------- Editor ----------
  let text = '| A | B |\n|---|---|\n| eins | zwei |';
  let r = Tb.lineBreak(text, text.indexOf('eins') + 2);
  assert.equal(r.text.split('\n')[2], '| ei<br>ns | zwei |', r.text);
  assert.equal(r.text.slice(r.selStart, r.selStart + 2), 'ns', 'Cursor hinter «<br>»');
  r = Tb.togglePrefix(text, text.indexOf('zwei') + 1, 'task');
  assert.ok(r.text.includes('| [ ] zwei |'));
  r = Tb.togglePrefix(r.text, r.selStart, 'question');
  assert.ok(r.text.includes('| ? zwei |'), 'ein anderes Zeichen wird ersetzt');
  r = Tb.togglePrefix(r.text, r.selStart, 'answer');
  assert.ok(r.text.includes('| ? zwei<br>!  |'), 'Antwort hängt einen Teil an (der Cursor steht nach «! »)');
  assert.equal(r.text.slice(r.selStart - 2, r.selStart), '! ');
  r = Tb.togglePrefix(r.text, r.text.indexOf('? zwei') + 3, 'question');
  assert.ok(/\| zwei<br>! +\|/.test(r.text), 'zweimal Frage: wieder Text');
  assert.equal(Tb.togglePrefix(text, 3, 'task'), null, 'in der Titelzeile nicht');
  assert.equal(Tb.togglePrefix('Text', 2, 'task'), null);
  part('Editor: Umschalt+Enter setzt «<br>», Aufgabe, Frage, Entscheid und Antwort wirken auf den Teil des Felds');

  // ---------- Vorschau ----------
  let html = M.render(TABLE, { interactiveTasks: true, lineMap: true });
  assert.ok(html.includes('<span class="md-cell-task task" data-line="4" data-slot="0"><input type="checkbox" aria-label="offen"><span class="task-text">Offerten <span class="md-person" data-handle="anna">@anna</span></span><span class="md-due due '), html);
  assert.ok(html.includes('<span class="md-cell-task task done" data-line="4" data-slot="1"><input type="checkbox" checked aria-label="erledigt">'));
  assert.ok(html.includes('<span class="md-cell-q md-decision answered"><span class="md-mark" aria-hidden="true">✓</span> Wer liefert? <span class="md-person" data-handle="ben">@ben</span></span><br><span class="md-cell-a">14.10.2026: Müller</span>'));
  assert.ok(html.includes('<td data-col="1">nur Text<br>zweite Zeile</td>'), '<br> als Zeilenumbruch');
  assert.ok(!html.includes('data-slot="0"><input type="checkbox" aria-label="offen"><span class="task-text">im Code'), 'Code bleibt Code');
  html = M.render(TABLE, { interactiveTasks: true, tableSrc: false });
  assert.ok(html.includes('<span class="md-cell-task task"><input type="checkbox" disabled aria-label="offen">'), 'ohne Quellzeile (Druck): Kästchen gesperrt, ohne data-line');
  html = M.render(LIST, { interactiveTasks: true });
  assert.ok(html.includes('Offerte einholen <span class="md-person" data-handle="anna">@anna</span> <span class="md-person optional" data-handle="ben" title="optional">@ben</span>'), 'Personen in Aufgaben als Marke');
  assert.ok(M.render('| <b>x</b> |\n|---|\n| <br/>a<BR>b |', {}).includes('<td data-col="0"><br>a<br>b</td>'), 'nur <br> wird zum Umbruch, anderes HTML bleibt Text');
  part('Vorschau: Kästchen mit Zeile und slot, Personen und Termine in Feldern, Entscheid mit Antwort, <br> als Umbruch, Druck ohne Quellzeile, Personen in Listen');
}

/* Pfade auf Dateien und Ordner (v2.12.0) als reine Funktionen: Erkennen, Adresse, Schreibweise zum Kopieren, Ordner, Einfügen, Grenzen. */
async function runPathsCore(browser, part, step) {
  const sandbox = load();
  const window = sandbox;
  const M = window.NoNotesMarkdown;
  M.configure({ localFiles: true });
  const P = M.pathInfo;
  assert.deepEqual(P('\\\\srv01\\Projekte\\Angebot 2026.docx'), { href: 'file://srv01/Projekte/Angebot%202026.docx', path: '\\\\srv01\\Projekte\\Angebot 2026.docx', folder: false });
  assert.deepEqual(P('\\\\srv01\\Daten$\\Ablage\\'), { href: 'file://srv01/Daten$/Ablage/', path: '\\\\srv01\\Daten$\\Ablage\\', folder: true }, 'versteckte Freigabe mit $');
  assert.deepEqual(P('z:\\Team'), { href: 'file:///Z:/Team', path: 'z:\\Team', folder: true }, 'ohne Endung: Ordner');
  assert.equal(P('C:\\Ä#ö%.txt').href, 'file:///C:/%C3%84%23%C3%B6%25.txt', 'Umlaute, # und % kodiert');
  assert.deepEqual(P('file:///C:/Daten/Bericht%202026.pdf'), { href: 'file:///C:/Daten/Bericht%202026.pdf', path: 'C:\\Daten\\Bericht 2026.pdf', folder: false });
  assert.equal(P('file://srv01/Projekte/x.pdf').path, '\\\\srv01\\Projekte\\x.pdf');
  assert.equal(P('file://localhost/C:/x/y.txt').path, 'C:\\x\\y.txt');
  assert.equal(P('file:///home/anna/a b/').path, '/home/anna/a b/');
  for (const bad of ['\\\\srv01', '\\\\srv01\\', 'C:Daten', 'https://x.ch', 'C:\\a<b', '\\\\srv\\a"b', 'javascript:alert(1)']) assert.equal(P(bad), null, bad);
  part('Pfad → Adresse: Netz, Laufwerk, file://, Kodierung, Schreibweise zum Kopieren, Ordner, keine falschen Treffer');

  const html = M.inline('A \\\\srv\\x\\a.pdf, B (Z:\\T\\) C <\\\\srv\\a b\\c.docx> D [Text](<C:\\a b\\>) E `C:\\code` F a:b G x\\\\y H 12:30');
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(hrefs, ['file://srv/x/a.pdf', 'file:///Z:/T/', 'file://srv/a%20b/c.docx', 'file:///C:/a%20b/'], html);
  assert.ok(html.includes('<code>C:\\code</code>') && html.includes('x\\\\y') && html.includes('a:b'), 'Code und gewöhnlicher Text bleiben');
  assert.ok(html.includes('a.pdf</a>, B') && html.includes('T\\</a>) C'), 'Komma und Klammer nach dem Pfad bleiben Text');
  const safe = M.inline('<\\\\srv\\x" onclick="alert(1)> und \\\\srv\\y"onmouseover=1');
  assert.ok(!/<a [^>]*on\w+=/.test(safe), 'keine Attribute aus dem Pfad: ' + safe);
  M.configure({ localFiles: false });
  assert.match(M.inline('![Plan](<\\\\srv\\b\\Plan 1.png>)'), /^<a href="file:\/\/srv\/b\/Plan%201\.png" class="md-path md-path-file"[^>]*><span class="md-path-icon"[^>]*><\/span>Plan<\/a>$/, 'im Dienst: Bild als Link');
  M.configure({ localFiles: true });
  assert.match(M.inline('![Plan](<\\\\srv\\b\\Plan 1.png>)'), /^<img src="file:\/\/srv\/b\/Plan%201\.png" alt="Plan" class="md-path-img"/, 'lokal: das Bild');
  part('In der Zeile: Pfade mit und ohne Klammern, Link mit Text, Satzzeichen, Code, keine eingeschleusten Attribute, Bilder lokal und im Dienst');

  assert.equal(M.pastePaths('"C:\\Projekte\\Angebot 2026.docx"'), '<C:\\Projekte\\Angebot 2026.docx>');
  assert.equal(M.pastePaths('"\\\\srv\\a\\x.pdf"\r\n"\\\\srv\\a\\y z.pdf"'), '\\\\srv\\a\\x.pdf\n<\\\\srv\\a\\y z.pdf>', 'mehrere Dateien, je eine Zeile');
  assert.equal(M.pastePaths('C:\\a\\b.txt'), null, 'nichts zu ändern');
  assert.equal(M.pastePaths('Siehe C:\\a b'), null, 'kein reiner Pfad');
  part('Einfügen: «Als Pfad kopieren» aus dem Explorer, mehrere Dateien, sonst unverändert');
}

/* Ausfüllbare Platzhalter (v2.12.0) als reine Funktionen und im Kern: Erkennen (nicht in Code), Werte für Aufgaben, Fragen, Personen und
   Termine, Vorschau, Druck und Export, Beschreibungen (sammeln, anhängen, wegräumen), Vorlagen anlegen und einfügen, Agenten. */
async function runPlaceholdersCore(browser, part, step) {
  // Feste Uhr (im Paket neu): am 31.10.2026 schriebe die Vorschau «heute · 31.10.2026», und der Vergleich unten träfe nicht mehr
  const RealDate = Date;
  const now = RealDate.parse('2026-10-20T08:00:00Z');
  const sandbox = load({ Date: class extends RealDate { constructor(...a) { if (a.length === 0) super(now); else super(...a); } static now() { return now; } } });
  const P = sandbox.NoNotesPlaceholders, M = sandbox.NoNotesMarkdown;
  const json = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

  // Erkennen und Werte
  const text = 'A {{?Kunde}} B {{?Kunde: Muster AG}} `{{?Code}}`\n```\n{{?Block}}\n```\n{{? }} {{?Leer: }}';
  assert.deepEqual(json(P.scan(text).map(p => [p.name, p.value])), [['Kunde', null], ['Kunde', 'Muster AG'], ['Leer', '']], 'nicht in Code, ohne Namen kein Platzhalter');
  assert.equal(P.flatten('x {{?A}} y {{?B: b}}'), 'x [A] y b');
  assert.equal(P.forPreview('@{{?Wer: anna}} {{?Ziel: frei}} [[{{?Notiz: Plan}}]] {{?Offen}}'), '@anna {{?Ziel: frei}} [[Plan]] {{?Offen}}', 'nur hängende Werte aufgelöst, offene bleiben');
  assert.equal(P.fill('{{?Kunde}} und {{?kunde: alt}} und {{?Ort}}', { KUNDE: 'Neu' }), 'Neu und Neu und {{?Ort}}', 'Gross-/Kleinschreibung egal');
  assert.equal(P.fill('{{?Kunde}}', { Kunde: 'Neu' }, { keep: true }), '{{?Kunde: Neu}}');
  assert.equal(P.resolve('{{?A: a}} {{?B}} {{?A}}', 'a'), 'a {{?B}} A');
  assert.equal(P.resolve('{{?A: a}} {{?B}}'), 'a B');
  assert.deepEqual(json(P.at('xx {{?A: aa}} yy', 6)), { name: 'A', value: 'aa', start: 3, end: 13, valueStart: 9, valueEnd: 11 });
  part('Erkennen: offen und ausgefüllt, nicht in Code; flatten, Vorschau (hängende Werte), fill, resolve, at');

  // Beschreibungen
  const withDesc = 'Text {{?A}} {{?B}}\n\n```template-description A\nfür **A**\n```\n```js\n```template-description X\n```\n```template-description B\nB eins\nB zwei\n```\n';
  const ds = P.descriptions(withDesc);
  assert.deepEqual([...ds.keys()], ['a', 'b'], 'Beschreibungen in einem anderen Codeblock zählen nicht');
  assert.equal(P.describe(ds, 'b'), 'B eins\nB zwei');
  assert.equal(P.stripDescriptions(withDesc), 'Text {{?A}} {{?B}}\n\n```js\n```template-description X\n```\n');
  const appended = P.appendDescriptions('Nur {{?B}}', ds);
  assert.equal(appended, 'Nur {{?B}}\n\n```template-description B\nB eins\nB zwei\n```\n', 'nur für vorkommende Namen');
  assert.equal(P.appendDescriptions(appended, ds), appended, 'nicht doppelt');
  assert.equal(P.pruneDescriptions(appended.replace('{{?B}}', 'fertig')), 'Nur fertig', 'ohne Platzhalter weg, samt Zeilenumbruch');
  assert.equal(P.pruneDescriptions(appended, '{{?B}}'), appended, 'der Titel zählt mit');
  assert.equal(P.plain('X {{?A: a}} {{?B}}\n\n```template-description A\nd\n```'), 'X a [B]');
  part('Beschreibungen: sammeln (nicht aus anderem Code), anhängen nur für vorkommende Namen, wegräumen ohne Platzhalter, Druck und Export');

  // Vorschau und Druck
  const html = M.render('- [ ] {{?Was: Offerte}} @{{?Wer: anna}} >{{?Bis: 31.10.2026}}\n\nZiel: {{?Ziel}}\n\n```template-description Ziel\ngeheim\n```');
  assert.ok(html.includes('<span class="md-ph" data-ph="Was"'), 'frei stehend: Platzhalter');
  assert.ok(html.includes('class="md-person" data-handle="anna"') && /md-due[^>]*>31\.10\.2026/.test(html), 'Person und Termin wirken');
  assert.ok(html.includes('<span class="md-ph open" data-ph="Ziel"') && !html.includes('geheim'), 'offen gelb, Beschreibung unsichtbar');
  const printed = M.render('Ziel: {{?Ziel}}, Wert {{?A: **fett**}}', { placeholders: 'plain' });
  assert.equal(printed, '<p>Ziel: [Ziel], Wert <strong>fett</strong></p>');
  part('Vorschau: frei stehend markiert, offen gelb, Personen und Termine wirken, Beschreibung unsichtbar; Druck nur Werte');

  // Index: Aufgaben, Fragen, Abhaken, Antworten
}

/* Termine mit «>» (v3.0.0): Schreibweise, Frist und Erinnerungen, Umstellung alter Texte (gleiche Länge, nicht in Code), Schema 17
   mit Sicherungsangaben, Umschreiben beim Speichern, Index, Kalender (VALARM), Agenten, Programm mit Sicherung, Seiten der Hauptäste. */
async function runDatesV3(browser, part, step) {
  const sandbox = load({});
  const D = sandbox.NoNotesDates, M = sandbox.NoNotesMarkdown;
  const json = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));


  // ---------- Schreibweise ----------
  const sd = t => json(D.splitDue(t));
  assert.deepEqual(sd('Offerte einholen @anna >30.10.2026 >6.11.2026'), { text: 'Offerte einholen @anna', due: '2026-11-06', reminders: ['2026-10-30'], legacy: false });
  assert.deepEqual(sd('Offerte >6.11.2026 >30.10.2026 14:00'), { text: 'Offerte', due: '2026-11-06', reminders: ['2026-10-30T14:00'], legacy: false }, 'der späteste ist die Frist, gleich wo er steht');
  assert.deepEqual(sd('Termin >2026-11-06 14:30'), { text: 'Termin', due: '2026-11-06T14:30', reminders: [], legacy: false });
  assert.deepEqual(sd('Doppelt >6.11.2026 >06.11.2026'), { text: 'Doppelt', due: '2026-11-06', reminders: [], legacy: false }, 'gleiche Termine einmal');
  assert.deepEqual(sd('Alt @anna @6.11.2026'), { text: 'Alt @anna', due: '2026-11-06', reminders: [], legacy: true }, '@Datum gilt weiter');
  for (const t of ['a > b', 'Pfeil ->6.11.2026', 'Doppelpfeil =>6.11.2026', 'mitten >6.11.2026 im Satz', 'kein Datum >morgen']) {
    assert.equal(sd(t).due, null, `kein Termin: ${t}`);
  }
  assert.equal(D.toText('2026-11-06'), '06.11.2026');
  assert.equal(D.toText('2026-11-06T09:05'), '06.11.2026 09:05');
  assert.equal(D.nextReminder(['2026-10-20', '2026-10-30'], '2026-10-27T08:00'), '2026-10-30');
  assert.equal(D.nextReminder(['2026-10-20'], '2026-10-27T08:00'), null);
  part('Schreibweise: >Datum am Zeilenende, mehrere, der späteste ist die Frist, Uhrzeit, @Datum gilt weiter, kein Termin bei a > b, -> und mitten im Satz');

  // ---------- Umschreiben ----------
  const before = [
    '- [ ] Offerte @anna @30.10.2026 @6.11.2026 14:00',
    '? Budget? @2026-11-01',
    'Mail an anna@6.11.2026 bleibt',
    'Text @6.11.2026 mitten',
    '`- [ ] im Code @6.11.2026`',
    '```',
    '- [ ] im Block @6.11.2026',
    '```',
    '| Wer | Was |',
    '|---|---|',
    '| anna | [ ] Plan @6.11.2026<br>[ ] Liste @7.11.2026 |',
    '- [ ] Vorlage @{{datum+7}} und @{{?Bis wann: {{datum+7}}}}',
    '- [ ] Person bleibt @{{?Wer: anna}}',
    'Satz endet @6.11.2026',
  ].join('\n');
  const after = D.rewriteLegacy(before);
  assert.equal(after.length, before.length, 'gleiche Länge (die Fassungen im Verlauf passen weiter)');
  assert.deepEqual(after.split('\n'), [
    '- [ ] Offerte @anna >30.10.2026 >6.11.2026 14:00',
    '? Budget? >2026-11-01',
    'Mail an anna@6.11.2026 bleibt',
    'Text @6.11.2026 mitten',
    '`- [ ] im Code @6.11.2026`',
    '```',
    '- [ ] im Block @6.11.2026',
    '```',
    '| Wer | Was |',
    '|---|---|',
    '| anna | [ ] Plan >6.11.2026<br>[ ] Liste >7.11.2026 |',
    '- [ ] Vorlage @{{datum+7}} und >{{?Bis wann: {{datum+7}}}}',
    '- [ ] Person bleibt @{{?Wer: anna}}',
    'Satz endet >6.11.2026',
  ]);
  assert.equal(D.rewriteLegacy('- [ ] Vorlage @{{datum+7}}'), '- [ ] Vorlage >{{datum+7}}', 'automatischer Platzhalter am Ende');
  assert.equal(D.rewriteLegacy(after), after, 'ein zweites Mal ändert nichts');
  assert.ok(D.hasLegacy(before) && !D.hasLegacy(after));
  part('Umschreiben: @Datum am Zeilenende zu >Datum, auch mehrere, in Tabellenfeldern und Vorlagen; gleiche Länge; nicht in Code, nicht mitten im Text, nicht an Wörtern');
}

// ============================================================
/* Toolleiste und Tasten als reine Textfunktionen (editing.js) und die Vorschläge für @kürzel (mentions.js); neu im Paket, die Abläufe
   im Browser prüft test/editor.cjs. */
async function runEditing(browser, part) {
  const s = load();
  const E = s.NoNotesEditing;
  const r = x => [x.text, x.selStart, x.selEnd];
  assert.deepEqual(r(E.wrap('a b c', 2, 3, '**')), ['a **b** c', 4, 5]);
  assert.deepEqual(r(E.wrap('a **b** c', 4, 5, '**')), ['a b c', 2, 3], 'zweimal hebt auf');
  assert.deepEqual(r(E.wrap('ab', 1, 1, '**', '**', 'fett')), ['a**fett**b', 3, 7], 'ohne Markierung: Platzhalter markiert');
  assert.deepEqual(r(E.setHeading('Titel', 0, 0, 2)), ['## Titel', 0, 8]);
  assert.deepEqual(r(E.wikiLink('x', 1, 1)), ['x[[]]', 3, 3], 'Cursor zwischen den Klammern');
  part('Umschliessen, Überschrift, Verweis');
  assert.deepEqual(r(E.toggleList('eins\nzwei', 0, 9, 'task')), ['- [ ] eins\n- [ ] zwei', 0, 21]);
  assert.deepEqual(r(E.continueLine('- [ ] eins', 10, 10)), ['- [ ] eins\n- [ ] ', 17, 17], 'Enter führt die Aufgabe weiter');
  assert.deepEqual(r(E.continueLine('- [ ] ', 6, 6)), ['', 0, 0], 'Enter auf leerem Punkt beendet die Liste');
  assert.deepEqual(r(E.indentLines('- a\n- b', 4, 7, 1)), ['- a\n  - b', 4, 9]);
  assert.equal(E.renumberAll('1. a\n1. b\n1. c'), '1. a\n2. b\n3. c');
  assert.deepEqual(r(E.togglePrefix('Frage', 0, 0, 'question')), ['? Frage', 0, 7]);
  part('Listen, Aufgaben, Einrücken, Nummerieren, Frage');
  const M = s.NoNotesMentions;
  const off = M.provide(async () => [{ handle: 'anna', name: 'Anna Muster' }, 'ben']);
  const off2 = M.provide(async () => ['anna', 'andrea']);
  assert.deepEqual(JSON.parse(JSON.stringify(await M.suggest('an'))), [{ handle: 'andrea', name: '' }, { handle: 'anna', name: 'Anna Muster' }], 'zusammengeführt, jedes Kürzel einmal (mit Namen), sortiert');
  off(); off2();
  assert.equal(M.count(), 0);
  assert.throws(() => M.provide('x'));
  part('Vorschläge für @kürzel: mehrere Lieferanten, zusammengeführt, abmelden');
}

suite('Engine-Test', [
  { name: 'Texte: Katalog de/en, Übersetzer des Gastgebers, Ersetzungen gewinnen, Mehrzahl, ohne DOM', run: runLabels },
  { name: 'Toolleiste und Tasten (editing.js), Vorschläge für @kürzel (mentions.js)', run: runEditing },
  { name: 'Videoadressen: YouTube, Vimeo, Dailymotion, Fälschungen, Karte im Markdown, maskierte Titel', run: runEmbeds },
  { name: 'Mehrzeilige Entscheide und Fragen: Parser', run: runEntries },
  { name: 'Tabellen: Lesen, Einfügen, Tab und Enter, Rechtsklick-Schritte, Vorschau, Angaben von Erweiterungen', run: runTables },
  { name: 'Tabellen mit Rahmen (v3.3.0): Lesen wie Pandoc und nachsichtig, Schreiben, Tasten, Tippen, verbinden und teilen, umwandeln, Aufgaben, Fragen, Vorschau', run: runGridTables },
  { name: 'Personen an Aufgaben und Tabellenfelder: Parser, Editor, Vorschau', run: runCellsPeople },
  { name: 'Pfade auf Dateien und Ordner: Netz, Laufwerk, file://, Kodierung, Kopieren, in der Zeile, Bilder, Einfügen aus dem Explorer', run: runPathsCore },
  { name: 'Ausfüllbare Platzhalter: Erkennen, Werte, Vorschau, Druck, Beschreibungen', run: runPlaceholdersCore },
  { name: 'Termine mit «>» (v3.0.0): Schreibweise, Frist und Erinnerungen, Umschreiben alter Texte', run: runDatesV3 },
]);
