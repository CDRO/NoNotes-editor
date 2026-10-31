# NoNotes-editor – Entwurf

Stand v1.0.0 (2026-10-31). Herausgelöst aus NoNotes v3.3.0. Kurz und verbindlich für alle Gastgeber: NoNotes, SteeringBoard,
NoNotes-SaaS und die Erweiterungen in NoNotes-plugins.

## 1. Ziele

- **Ein Editor, mehrere Gastgeber.** Die Markdown-Engine und der Editor von NoNotes leben an einer Stelle. SteeringBoard braucht keine
  Kopie mehr (`packages/ui/mdfield.js`, 2000 Zeilen), Korrekturen kommen allen zugute.
- **Gleiche Technik wie NoNotes.** Reine Browser-Skripte, je Datei eine IIFE mit einem globalen Namen; Werkzeuge in CommonJS (`.cjs`).
  Kein Framework, kein Bündler, kein Übersetzer, keine Abhängigkeit zur Laufzeit. Läuft per `file://` und offline.
- **Verschoben, nicht neu geschrieben.** Die Module sind die Dateien aus NoNotes v3.3.0; geändert ist nur, was die Grenze verlangt (die
  Texte, siehe 5). Der Editor ist der Editor aus `packages/ui/app.js`, aus dem Ablauf der App gelöst und zu einem Baustein gemacht.
- **Nichts bricht.** Die bisherigen globalen Namen bleiben (siehe 2), damit Erweiterungen, der Server von NoNotes-SaaS und SteeringBoard
  ohne Änderung an ihren Aufrufen weiterlaufen.
- **Texte ohne NoNotesI18n.** Das Paket bringt Deutsch und Englisch mit; jeder Gastgeber kann jeden Text ersetzen.
- **MIT.** NoNotes bleibt, wie es ist (UNLICENSED, NOTICE); NoNotes-editor steht unter MIT.

## 2. Was ins Paket wandert

| NoNotes v3.3.0 | Globaler Name | Im Paket | Anmerkung |
| --- | --- | --- | --- |
| `packages/core/markdown.js` | `NoNotesMarkdown` | `src/markdown.js` | Name bleibt |
| `packages/core/tasks.js` | `NoNotesTasks` | `src/tasks.js` | Name bleibt |
| `packages/core/questions.js` | `NoNotesQuestions` | `src/questions.js` | Name bleibt |
| `packages/core/tables.js` | `NoNotesTables` | `src/tables.js` | Name bleibt |
| `packages/core/editing.js` | `NoNotesEditing` | `src/editing.js` | Name bleibt |
| `packages/core/mentions.js` | `NoNotesMentions` | `src/mentions.js` | Name bleibt |
| `packages/core/embeds.js` | `NoNotesEmbeds` | `src/embeds.js` | Name bleibt |
| `packages/core/dates.js` | `NoNotesDates` | `src/dates.js` | Name bleibt |
| `packages/core/placeholders.js` | `NoNotesPlaceholders` | `src/placeholders.js` | Name bleibt |
| `packages/ui/datepicker.js` | `NoNotesDatePicker` | `src/datepicker.js` | Name bleibt |
| `packages/ui/scrollsync.js` | `NoNotesScrollSync` | `src/scrollsync.js` | Name bleibt |
| Editor in `packages/ui/app.js` | – | `src/editor.js` → `NoNotesEditor` | neu: der Baustein (siehe 4) |
| Editor-Regeln in `packages/ui/app.css` | – | `src/editor.css` | Editor, Vorschau, Markdown-Darstellung, Datumsauswahl, Listen, Abzeichen |
| – | – | `src/labels.js` → `NoNotesEditorLabels` | neu: Texte des Pakets (siehe 5) |
| – | – | `lang/editor.de.js`, `lang/editor.en.js` | neu: Katalog Deutsch (alle Schlüssel) und Englisch |
| – | – | `files.cjs` | neu: Dateiliste für den Build des Gastgebers (siehe 6) |

**Entscheid zu den Namen:** Die bisherigen globalen Namen bleiben die eigentlichen Namen (keine Aliase, keine neuen Namen wie
`NoNotesEditorMarkdown`). Wer `window.NoNotesMarkdown`, `NoNotesEditing`, `NoNotesTables` … benutzt (Erweiterungen wie *tag-colors*, der
Server von NoNotes-SaaS im vm-Kontext, SteeringBoard), merkt keinen Unterschied. Neu sind nur `NoNotesEditor` und `NoNotesEditorLabels`.
Die Dateinamen bleiben ebenfalls; ein Gastgeber, der flach nach `js/` kopiert, bekommt dieselben Namen wie bisher (wichtig für das
MCP-Programm von NoNotes, das `js/<name>.js` lädt).

**Bleibt in NoNotes:** Sprachsystem (`i18n.js`, `NoNotesI18n`), Speicher, Backend, Datenbank, Verweise (`links.js`: Index in der
Datenbank und Auflösung über den Titel; der Editor bekommt sie über `refs`), Vorlagen als Dateien (`templates.js`), Export, ZIP, iCal,
Verlauf (`history.js`, der Dialog), Erweiterungen (`plugins.js`), Mindmap, Druck, die App. Ebenso Titel, Tags, Pfad, Notizmenü,
Konfliktdialog und Zusammenführen.

## 3. Abhängigkeiten zwischen den Modulen

`labels.js` zuerst, dann die Sprachdateien, dann die Engine, dann die Teile mit DOM:

```
labels.js  lang/editor.de.js  lang/editor.en.js
placeholders.js  dates.js  questions.js  mentions.js  tasks.js  embeds.js  tables.js  markdown.js  editing.js     (Engine, ohne DOM)
datepicker.js  scrollsync.js  editor.js                                                                            (Oberfläche)
```

Die Engine läuft wie bisher auch in Node (vm-Kontext, `window` = Kontext): NoNotes-SaaS (Server) und das MCP-Programm von NoNotes laden
`dates.js`, `questions.js`, `tasks.js`, `tables.js`, `placeholders.js`, `embeds.js` dort. Neu müssen sie `labels.js` vorher laden (wie bisher
`i18n.js`). `labels.js` braucht kein DOM; ohne Angaben ist es Deutsch.

## 4. Der Baustein `NoNotesEditor`

```js
const ed = NoNotesEditor.create(host, options);   // host: ein Element, in das der Editor (div.nn-editor) gehängt wird
```

Der Baustein baut Toolleiste, Umschalter der Darstellung, Bilderleiste, Textfeld, Vorschau, Spiegel für das synchrone Scrollen und die
Listen unter dem Cursor (Personen, Verweise, Platzhalter, Datumsauswahl, Tabellenraster) – Markup und Klassen wie in NoNotes
`index.html`, damit das CSS und die Tests der Gastgeber passen. Alles, was dem Gastgeber gehört, kommt über Rückrufe:

| Option | Wofür | NoNotes | SteeringBoard |
| --- | --- | --- | --- |
| `value`, `updatedAt`, `readOnly`, `mode`, `kind`, `remember`, `onMode(mode, ed)` | Inhalt, Stand, Schreibschutz, Darstellung (`edit`/`split`/`preview`, unter `kind` gemerkt oder vom Gastgeber) | Notiz, `readOnly()` der Hülle, Archiv, Papierkorb; Darstellung unter `nonotes.editorMode` wie bisher | Feld eines Eintrags, `kind: 'long'/'short'` |
| `ids` | feste Kennungen (`body`, `preview`, `toolbar`, `heading`, `modeSwitch`, `help`, `attach`, `attachInput`, `attachments`, `mentionPopup`, `wikiPopup`, `wikiCount`, `wikiList`, `phHint`, `root`) | `#body`, `#preview`, `#mdToolbar`, `#modeSwitch`, `#attachBtn` … wie heute (Tests, CSS) | ohne |
| `onInput(text, ed)` | nach jeder Änderung, sofort | eigenes Speichern mit Zusammenführen (`onEdit`/`saveNote`) | – |
| `onChange(text, { baseUpdatedAt })`, `saveDelay`, `reload()`, `resolveConflict({ mine, theirs })` | Speichern durch das Paket: verzögert, Ctrl+S, beim Verlassen, `flush()`; `CONFLICT`/`NOTE_CONFLICT` → `reload` → Wahl `'reload'`/`'mine'` | – | Speichern des Felds, Dialog «Neu laden / Meine Fassung behalten» |
| `attachments: { list, get, add, remove, maxBytes, maxEdge }` | Bilder `![Name](att:ID)`: Leiste, Einfügen, Ablegen, Zwischenablage, Verkleinern | `B.listAttachments`, `getAttachment` (`data`), `addAttachment`, `deleteAttachment` | Bilder des Eintrags (`bytes`) |
| `refs: { list, resolver, open, cross }` | `[[…]]`: Vorschläge (`title`, `insert`, `parent`, `path`, `dup`, `archived`, `updated`), Auflösung für die Vorschau (`resolver(text)` → `resolveRef`), Klick | `getTree` + `NoNotesLinks.resolver(titleIndex)`, `openNote`, Querverweise | Codes `[[V-001]]` über `SteeringBoardRefs` |
| `render(text, ed)` | weitere Angaben an `NoNotesMarkdown.render` (`highlight`, `noteLink` …) | Suchtreffer, Links auf Notizen (`noteLinkResolver`) | – |
| `onLinkClick(a, event, ed)` | eigene Links in der Vorschau (true = erledigt) | `a.md-note` (`followNoteLink`) | Links auf Einträge |
| `people` | `@kürzel` über `NoNotesMentions` (Lieferanten meldet der Gastgeber an) | lokale Kürzel, `ctx.people.provide` | Personen des Portfolios |
| `placeholders: { keep(), onFill(name, value, keep), extraText() }` | ausfüllbare Platzhalter: Einstellung «behalten», gleiche Namen ausserhalb des Texts | der Titel der Notiz (`leaveTitleField`) | Vorlagen der Felder |
| `history: { label, title, open(ed) }`, `templates: { insert(ed), save(ed) }`, `actions: [{ id, label, title, run(ed) }]`, `help(ed)` | Knöpfe des Gastgebers neben der Toolleiste, F1 | Verlauf und Vorlagen bleiben im Notizmenü; `help` öffnet die Hilfe | Verlauf…, Vorlagen, «Entscheid erfassen…» |
| `showMenu(items, x, y)`, `confirm(text, opts)`, `hint(text)`, `onError(e)` | Kontextmenüs (Tabellen, Pfade, Platzhalter), Rückfragen, Hinweise | `showContextMenu`, `confirm`, Statuszeile | `SteeringBoardUI` |
| `counts`, `answers`, `modernizeDates`, `dates`, `entity` | Zähler in der Fusszeile, «Beantworten»/«Entscheiden» in der Vorschau, alte `@Datum` umschreiben, Datumsauswahl, Angaben für Erweiterungen | `modernizeDates: true` | `counts`, `answers`, `entity` |

Rückgabe: `el`, `textarea`, `preview`, `toolbar`, `get()`, `set(text, updatedAt)`, `focus()`, `setReadOnly(b)`, `isReadOnly()`,
`isWritable()`, `mode(name?)`, `insert(text, { keep })` (startet das Ausfüllen von Platzhaltern), `insertAtCursor(text)`, `selection()`,
`replaceSelection(text)`, `applyEdit({ text, selStart, selEnd })`, `runCommand(cmd)`, `counts()`, `isDirty()`, `flush()`, `renderPreview()`,
`renderAttachments()`, `addAttachments(files)`, `forgetAttachment(id)`, `fillPlaceholders({ keep })`, `startPlaceholders(opts)`,
`updateTableMeta(line, fn)`, `refreshExtensions()`, `closePopups()`, `destroy()`.

Für die ganze Seite:

- `NoNotesEditor.configure({ localFiles, embeds: 'ask' | 'off', t, tn, messages, language, locale })` – Pfade öffnen (lokal), Videos,
  Texte (an `NoNotesEditorLabels.configure`).
- `NoNotesEditor.extend({ toolbar(ed) → [{ plugin, label, title, run(ed) }], tableFormat(ed) → fn, tableMenu(target) → Einträge })` – die
  Brücke zur Erweiterungs-Schnittstelle des Gastgebers. In NoNotes bleiben `ctx.ui.addToolbarButton`, `ctx.tables.format`,
  `ctx.ui.addTableMenuItem` und `ctx.editor` unverändert; die App setzt sie über `extend` (bzw. `ed.textarea`, `ed.replaceSelection`) um.
- `NoNotesEditor.of(node)`, `all()`, `focused()` – der Editor um ein Element, alle auf der Seite, der zuletzt benutzte.

Was der Baustein **nicht** macht: Titel, Tags, Speichern in eine Datenbank, Zusammenführen, Konfliktdialog, Verlaufsdialog, Vorlagen
wählen, Hilfe, Menüs zeichnen. Er ruft dafür den Gastgeber.

## 5. Texte und Ersetzungen

Der deutsche Text (Schweiz, `ss`) im Quelltext ist der Schlüssel, wie in NoNotes. `lang/editor.de.js` ist der Katalog aller Schlüssel
(`tools/labels.cjs update` schreibt ihn aus dem Quelltext), `lang/editor.en.js` die englische Fassung (aus dem englischen Paket von NoNotes
v3.3.0 übernommen). `tools/labels.cjs check` (Teil von `npm test`) verlangt, dass beide genau zum Quelltext passen.

```js
NoNotesEditor.configure({
  t: NoNotesI18n.t, tn: NoNotesI18n.tn, language: () => NoNotesI18n.language(),   // Übersetzer des Gastgebers (wahlweise)
  messages: { en: { 'Übernehmen': 'Apply' }, de: { '{n} passende Notiz': { one: '{n} passender Eintrag', other: '{n} passende Einträge' } } },
});
```

Reihenfolge je Schlüssel, der erste Treffer gewinnt:

1. `messages` des Gastgebers für die aktuelle Sprache (auch Deutsch; Mehrzahl als `{ one, other }`; `null` nimmt eine Ersetzung zurück),
2. der Übersetzer des Gastgebers, wenn er etwas anderes liefert als den deutschen Text. Ohne Angabe ist das `NoNotesI18n`, sofern es auf
   der Seite oder im vm-Kontext liegt (beim Aufruf nachgesehen; Sprache und Gebietsschema kommen dann auch von dort); `t: false` schaltet
   das ab, `t: null` kehrt zur Vorgabe zurück. Das Paket hängt nicht von NoNotesI18n ab, es benutzt es nur, wenn es da ist,
3. der Katalog des Pakets (`en`, Region fällt auf die Sprache zurück: `en-US` → `en`),
4. der deutsche Text.

So gewinnt immer, was der Gastgeber ausdrücklich sagt. Das löst das Problem von SteeringBoard, dass `NoNotesI18n.extend()` Texte des
Grundpakets nie ersetzt («Gelb» → "Yellow", «Übernehmen» → "Add"): für den Editor gibt SteeringBoard seine Wörter als `messages`. Für die
übrigen Texte ändert NoNotes v4.0.0 `extend()` so, dass das Paket des Gastgebers gewinnt (Major, weil sich das Verhalten ändert).
In NoNotes (und im Server von NoNotes-SaaS, im MCP-Programm) ist NoNotesI18n da: ohne jede Angabe übersetzen seine neun Sprachpakete die
Texte des Editors wie bisher, die Pseudo-Sprache (`qps`) kommt durch, und was ein Paket nicht kennt, kommt aus dem Katalog des Pakets. Weitere Sprachen im Paket:
`NoNotesEditorLabels.register('fr', { … }, { locale: 'fr-CH' })`.

## 6. Dateien und Einbinden

```
src/      labels.js placeholders.js dates.js questions.js mentions.js tasks.js embeds.js tables.js markdown.js editing.js
          datepicker.js scrollsync.js editor.js editor.css
lang/     editor.de.js editor.en.js
files.cjs Dateiliste mit Reihenfolge und Rolle (labels, lang, engine, ui) für den Build
tools/    labels.cjs (Katalog)
test/     engine.cjs (Node), editor.cjs (Chromium), page/ (Testseite), lib.cjs
docs/     DESIGN.md
```

Einbinden: als devDependency auf den Tag, ohne Registry:

```json
"devDependencies": { "nonotes-editor": "github:CDRO/NoNotes-editor#v1.0.0" }
```

Der Build des Gastgebers kopiert die Dateien wie seine eigenen (nichts wird übersetzt oder gebündelt). Zwei Wege:

- **Verweise in der Seitenvorlage** auf `node_modules/nonotes-editor/src/*.js` und `…/lang/editor.*.js`; der Build von NoNotes legt alles,
  was nicht `vendor/`, `lang/` oder `plugins/` ist, flach nach `js/` (bzw. `css/`) – ohne Änderung am Build.
- **`require('nonotes-editor')`** (`files.cjs`): `scripts` (in Ladereihenfolge, mit `role`), `styles`, `engine` (nur ohne DOM, für Node),
  `root`, `version`. So findet ein Build das Paket auch, wenn es bei einem Submodul weiter oben liegt (`require.resolve` sucht aufwärts).

`editor.css` nimmt die Farben aus den Variablen des Gastgebers (`--bg`, `--panel`, `--text`, `--muted`, `--border`, `--accent`,
`--accent-contrast`, `--accent-ink`, `--danger`, `--ok`, `--warn`, `--hover`, `--active`, `--radius`, `--shadow`); seine Vorgaben stehen
unter `:where(:root)` und verlieren gegen jede Angabe des Gastgebers. Themes und Hauptfarbe von NoNotes wirken unverändert.

## 7. Tests

`npm test` = `tools/labels.cjs check` + `test/engine.cjs` (Node: Texte, Toolleisten-Funktionen, @kürzel, und die Abschnitte aus NoNotes
`test/core.cjs`, die nur die Engine prüfen: Videos, mehrzeilige Einträge, Tabellen, Tabellen mit Rahmen, Personen und Tabellenfelder, Pfade,
Platzhalter, Termine) + `test/editor.cjs` (Chromium per `file://` auf `test/page/index.html`: Aufbau, Darstellungen, Toolleiste, Tasten,
Aufgaben in der Vorschau, Speichern und Konflikt, @kürzel, Verweise, Datumsauswahl, Tabellen, Platzhalter, Bilder, Erweiterungen,
Schreibschutz, Englisch mit Ersetzung). Chromium: `NONOTES_EDITOR_CHROMIUM` (oder `STEERINGBOARD_CHROMIUM`) nennt ein vorhandenes
Programm, sonst das von Playwright. Was Datenbank, Export, Agenten und die App braucht, testet weiter NoNotes – gegen das Paket.

## 8. Versionen und Tags

- Semantische Versionen. v1.0.0 = Stand von NoNotes v3.3.0. Neue Optionen: Minor; geänderte Rückrufe, Klassen oder Texte (Schlüssel):
  Major. Ein geänderter Schlüssel ist für Gastgeber mit eigenen Übersetzungen eine Änderung der Schnittstelle.
- Release = Tag. Workflow «Version taggen» (`.github/workflows/tag.yml`, von Hand mit `version`, z. B. `v1.0.0`): prüft das Format und
  `package.json`, testet, legt den Tag mit dem `GITHUB_TOKEN` an. Kein GitHub-Release, keine Registry.
- `ci.yml` testet jeden Push und Pull Request nach `main`.
- Zum Paket gehören: NoNotes v4.0.0 (Modulgrenzen und `extend()` ändern sich), SteeringBoard v1.1.0.

## 9. Umstellung der Gastgeber

### NoNotes v4.0.0

Erprobt in einer Arbeitskopie von v3.3.0 (nichts davon ist in NoNotes eingecheckt): mit den Schritten 1–6 läuft `npm test` von NoNotes
gegen das Paket vollständig durch.

1. `package.json`: `"nonotes-editor": "github:CDRO/NoNotes-editor#v1.0.0"` in `devDependencies`.
2. `packages/ui/index.html`: die elf Skripte durch die des Pakets ersetzen, `labels.js` und `lang/editor.*.js` zuerst, `editor.css` vor
   `app.css`; die Dateien in `packages/core/` und `packages/ui/` löschen. `tools/build.cjs` bleibt, wie es ist.
3. `packages/ui/app.css`: die nach `editor.css` gewanderten Regeln löschen (geteilte Regeln wie `.md a, .q-item a` behalten die App-Hälfte);
   `#editorPane` bekommt die Klasse `nn-editor`, solange die App ihren eigenen Editor noch nicht durch den Baustein ersetzt hat.
4. Texte: nichts zu tun – `labels.js` nimmt NoNotesI18n als Übersetzer (siehe 5). Wer es ausdrücklich will:
   `NoNotesEditor.configure({ t: I18n.t, tn: I18n.tn, language: () => I18n.language(), locale: () => I18n.locale() })`.
5. `tools/i18n.cjs`: die Quelltexte des Pakets mitlesen (`SOURCE_DIRS` + `node_modules/nonotes-editor/src`, ohne `labels.js`), sonst
   gelten die Texte des Editors in den neun Sprachpaketen als veraltet. Drei Texte des Bausteins sind neu («Aktionen», «Frühere
   Fassungen dieses Texts», «Vorlage einfügen oder diesen Text als Vorlage speichern»); `npm run i18n -- update <code>` und übersetzen.
6. Node-Teile: `editions/local/agent/nonotes-mcp.cjs` lädt `labels` vor `placeholders`; im Quelltext-Modus liegen die Dateien unter
   `node_modules/nonotes-editor/src/`. Tests, die `packages/core/<Datei>` laden (`test/core.cjs`, `test/collab.cjs`), über eine Hilfe auf das
   Paket zeigen und `labels.js` zuerst laden.
7. Danach (eigener Schritt): den Editor in `app.js` durch `NoNotesEditor.create(el.editorHost, { ids: { body: 'body', preview: 'preview', … },
   onInput, attachments, refs, render, onLinkClick, placeholders, showMenu, hint, modernizeDates: true })` ersetzen; `ctx.editor`,
   `ctx.ui.addToolbarButton`, `ctx.tables.*` über `ed` und `NoNotesEditor.extend` bedienen. Die Tests von NoNotes bleiben dank `ids` gleich.
8. `NoNotesI18n.extend()`: das Paket des Gastgebers gewinnt (Major). `docs/ARCHITECTURE.md`, `PLUGINS.md`, `LANGUAGES.md`: Verweis auf das Paket.

### SteeringBoard v1.1.0

- Nach NoNotes v4.0.0 (Submodul auf den Tag): `nonotes-editor` als devDependency; `tools/build.cjs` kopiert dessen Dateien
  (`require('nonotes-editor').scripts`) nach `js/nonotes/` wie die des Kerns.
- `packages/ui/mdfield.js` wird eine dünne Hülle um `NoNotesEditor.create`: `entity`, `counts: true`, `answers: true`, `onChange`/`reload`/
  `resolveConflict` (Dialog in `SteeringBoardUI`), `refs` mit Codes (`list` → `{ title: 'V-001 Titel', insert: 'V-001' }`, `resolver` über
  `SteeringBoardRefs`), `attachments`, `history: { open }` (der Verlaufsdialog bleibt in SteeringBoard), `templates`, `actions`, `showMenu`,
  `confirm`. `SteeringBoardMdField.extend` wird `NoNotesEditor.extend`. Klasse `.sb-md` → `.nn-editor` (CSS anpassen).
- Texte: `NoNotesEditor.configure({ t, tn, language, messages })` mit den Wörtern von SteeringBoard («Eintrag» statt «Notiz» in den
  Vorschlägen für Verweise, englische Begriffe nach dem Glossar). Wunsch 11 in `docs/WUENSCHE-AN-DEN-KERN.md` ist mit NoNotes v4.0.0 erfüllt.

### NoNotes-SaaS

- Der Server (`community/server/core.cjs`) lädt die Engine aus dem Paket statt aus `vendor/nonotes/packages/core/`: `dates.js`,
  `questions.js`, `tasks.js` (Pflicht), `placeholders.js`, `embeds.js`, `tables.js` (wahlweise), davor `labels.js` (z. B. über
  `require('nonotes-editor').engine`). `nonotes-editor` als devDependency (dieselbe Version wie NoNotes); der Build über
  `vendor/nonotes/tools/build.cjs` findet das Paket, wenn es im `node_modules` von SaaS liegt.
- Die Ausprägungen (`saas/client/edition.js`) bleiben: `NoNotesMentions.provide` und `NoNotesTemplates` haben dieselben Namen.

### NoNotes-plugins

- Keine Änderung nötig: Erweiterungen benutzen `ctx.*` (unverändert) und die globalen Namen (`NoNotesEditing`, `NoNotesMarkdown` in
  *tag-colors*), die bleiben. `table-format` (ctx.tables.format, ctx.ui.addTableMenuItem) läuft über `NoNotesEditor.extend` weiter.
- Später können Erweiterungen `NoNotesEditor.focused()` und die Rückgabe des Bausteins nutzen; das bleibt Sache der Plugin-Schnittstelle
  von NoNotes (Version 1.x).

## 10. Offene Fragen

1. Soll das Paket die weiteren Sprachpakete von NoNotes (fr-CH, it-CH, es, pt, de-DE) für den Editor mitbringen? Heute: nur de/en; NoNotes
   übersetzt über seinen Übersetzer.
2. `links.js` (Querverweise, `[[Titel#42]]`) bleibt in NoNotes, weil der Index in der Datenbank liegt. Gehört die reine Syntax (`parseRef`,
   `lookup`) später ins Paket?
3. Der Verlaufsdialog bleibt beim Gastgeber (`history.open`). SteeringBoard hat einen eigenen Dialog für Felder; ein gemeinsamer Dialog
   im Paket wäre möglich (`NoNotesHistory` bliebe in NoNotes).
4. Zwei Befunde in den Tests von NoNotes v3.3.0, unabhängig vom Paket: `test/core.cjs` (Platzhalter) hängt vom Datum ab – am 31.10.2026
   schreibt die Vorschau «heute · 31.10.2026» und der Vergleich schlägt fehl (im Paket mit fester Uhr gelöst; NoNotes v4.0.0 ebenso);
   `test/app.cjs` (Pfade, «Ordner öffnen») liest die Adresse des neuen Tabs, bevor er geladen ist (`await folder.waitForLoadState()` fehlt;
   mit neuerem Chromium leer).
