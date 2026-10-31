# NoNotes-editor

Markdown-Engine und Editor von [NoNotes](https://github.com/CDRO/NoNotes) als eigenes Paket: reine Browser-Skripte, je Datei ein globaler
Name, kein Framework, kein Bündler, keine Abhängigkeit zur Laufzeit. Läuft per `file://` und offline. Lizenz: MIT.

**Herkunft:** herausgelöst aus NoNotes v3.3.0 (`packages/core/markdown.js`, `tasks.js`, `questions.js`, `tables.js`, `editing.js`,
`mentions.js`, `embeds.js`, `dates.js`, `placeholders.js`, `packages/ui/datepicker.js`, `scrollsync.js`, der Editor aus `packages/ui/app.js`
und seine Regeln aus `app.css`). Die Module sind verschoben, nicht neu geschrieben; neu sind der Baustein `NoNotesEditor` und die Texte
`NoNotesEditorLabels`. Entwurf und Umstellung der Gastgeber: [docs/DESIGN.md](docs/DESIGN.md).

## Was drin ist

| Datei | Global | Inhalt |
| --- | --- | --- |
| `src/labels.js` | `NoNotesEditorLabels` | Texte: Katalog, Übersetzer und Ersetzungen des Gastgebers |
| `lang/editor.de.js`, `lang/editor.en.js` | – | alle Schlüssel (Deutsch, Schweiz) und Englisch |
| `src/markdown.js` | `NoNotesMarkdown` | sicherer Markdown-Renderer mit Fragen, Entscheiden, Aufgaben, Tabellen, Videos, Pfaden, Platzhaltern |
| `src/tasks.js`, `src/questions.js`, `src/dates.js` | `NoNotesTasks`, `NoNotesQuestions`, `NoNotesDates` | Aufgaben, Fragen/Entscheide, Termine im Text |
| `src/tables.js` | `NoNotesTables` | Tabellen (einfach und mit Rahmen): lesen, schreiben, Schritte des Editors |
| `src/editing.js` | `NoNotesEditing` | Textfunktionen der Toolleiste |
| `src/mentions.js` | `NoNotesMentions` | Vorschläge für `@kürzel` |
| `src/embeds.js` | `NoNotesEmbeds` | Videoadressen (YouTube, Vimeo, Dailymotion) |
| `src/placeholders.js` | `NoNotesPlaceholders` | ausfüllbare Platzhalter `{{?Name}}` |
| `src/datepicker.js`, `src/scrollsync.js` | `NoNotesDatePicker`, `NoNotesScrollSync` | Datumsauswahl, synchrones Scrollen |
| `src/editor.js` | `NoNotesEditor` | der Editor als Baustein |
| `src/editor.css` | – | Editor, Vorschau und Markdown-Darstellung |
| `files.cjs` | – | Dateiliste für den Build des Gastgebers (Node) |

## Einbinden

```json
"devDependencies": { "nonotes-editor": "github:CDRO/NoNotes-editor#v1.1.0" }
```

Der Build des Gastgebers kopiert die Dateien in sein Ergebnis, zum Beispiel:

```js
const editor = require('nonotes-editor');            // files.cjs
for (const s of editor.scripts) copy(s.file, `js/${s.name}`);   // in dieser Reihenfolge einbinden
for (const s of editor.styles) copy(s.file, `css/${s.name}`);
```

In der Seite, in dieser Reihenfolge:

```html
<link rel="stylesheet" href="css/editor.css">
<script src="js/labels.js"></script>
<script src="js/editor.de.js"></script>
<script src="js/editor.en.js"></script>
<script src="js/placeholders.js"></script>  <script src="js/dates.js"></script>     <script src="js/questions.js"></script>
<script src="js/mentions.js"></script>      <script src="js/tasks.js"></script>     <script src="js/embeds.js"></script>
<script src="js/tables.js"></script>        <script src="js/markdown.js"></script>  <script src="js/editing.js"></script>
<script src="js/datepicker.js"></script>    <script src="js/scrollsync.js"></script> <script src="js/editor.js"></script>
```

## Benutzen

```js
NoNotesEditor.configure({ language: 'en', messages: { en: { 'Fett': 'Strong' } }, storagePrefix: 'meine-app' });   // wahlweise, siehe docs/DESIGN.md §4a, §5

const ed = NoNotesEditor.create(document.getElementById('host'), {
  value: '# Hallo\n- [ ] Erste Aufgabe >31.12.2026',
  onChange: async (text, { baseUpdatedAt }) => save(text, baseUpdatedAt),   // → { updatedAt }
  attachments: { list, get, add, remove },                               // Bilder ![Name](att:ID)
  refs: { list: async () => [{ title: 'Protokoll' }], resolver: async () => target => ({ id: null, label: target }), open: x => {} },
  // Ziele dürfen auch href, title, className und data liefern (v1.1.0); afterRender(preview, ed) nach jedem Zeichnen der Vorschau
  onMode: (mode, ed, { remember }) => { if (remember) merken(mode); },     // remember: von der Person gewählt (v1.1.0)
  readOnlyTools: 'hide',                                                  // Schreibschutz: Toolleiste und Bilderleiste verborgen (v1.1.0)
  showMenu: (items, x, y) => myMenu(items, x, y),
});
ed.get(); ed.set('Neu'); ed.mode('preview'); ed.insert('Liebe {{?Name}}'); await ed.flush();
```

Ohne DOM (Node, vm-Kontext mit `window` = Kontext) laufen `labels.js`, die Sprachdateien und die Engine (`require('nonotes-editor').engine`).

## Entwickeln

```bash
npm install
npx playwright install --with-deps chromium     # oder: NONOTES_EDITOR_CHROMIUM=/pfad/zu/chrome npm test
npm test                                        # Katalog, Engine (Node), Editor (Chromium per file://)
NONOTES_EDITOR_TEST_ONLY=Tabellen node test/engine.cjs
node tools/labels.cjs update                    # Katalog nach neuen Texten abgleichen (lang/editor.en.js ergänzen)
```

Regeln wie in NoNotes: deutsche Texte (Schweiz, `ss`) nur über `t()`/`tn()`/`N_()`, Übersetzung im selben Schritt; Markdown nie über
`innerHTML` mit Daten des Benutzers ausser der Ausgabe von `NoNotesMarkdown`; keine Inline-Skripte.

## Versionen

Änderungen je Version: [CHANGELOG.md](CHANGELOG.md).

Ein Release ist ein Tag: Actions → «Version taggen» mit `version` (z. B. `v1.0.0`, muss zu `package.json` passen). Kein GitHub-Release,
keine Registry. Gastgeber zeigen in `devDependencies` auf den Tag.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
