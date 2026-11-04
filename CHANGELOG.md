# Änderungen

Semantische Versionen (siehe [docs/DESIGN.md](docs/DESIGN.md) §8). Ein Release ist ein Tag; Gastgeber zeigen in `devDependencies` darauf.

## v1.3.0 (2026-11-04)

Wunsch E9 von SteeringBoard (`docs/WUENSCHE-AN-DEN-KERN.md` dort): Fragen und Entscheide je Editor einzeln abschaltbar. Wahlweise und
rückwärtskompatibel (ohne die Option gelten beide, wie bisher); Einzelheiten in [docs/DESIGN.md](docs/DESIGN.md) §4c. Keine neuen oder
geänderten Schlüssel im Katalog: die Sprachpakete der Gastgeber bleiben vollständig.

- **`questionKinds`** an `NoNotesEditor.create`: `{ questions: true, decisions: true }` (Vorgabe), `false` schaltet beide ab. Eine
  abgeschaltete Art hat keinen Knopf (die «Antwort» bleibt, solange eine Art gilt), keine Taste (Ctrl+Shift+F / D, auch `runCommand`
  tut nichts), in der Vorschau ist die Zeile gewöhnlicher Text oder Listenpunkt (kein Abzeichen, kein «Beantworten»/«Entscheiden», keine
  Frist), `counts()` und die Zähler im Fuss zählen sie nicht, und der Block «?!```» dieser Art ist keiner. **Der Text wird nie verändert.**
- **`ed.questionKinds()`** liest die Einstellung, **`ed.setQuestionKinds({ decisions: false })`** ändert sie später (nur die genannten
  Arten; `true`/`false` für beide); Toolleiste, Zähler und Vorschau folgen sofort.
- **`NoNotesQuestions.parse(text, { questionKinds })`**, `parseBlock(lines, i, { questionKinds, … })`, `cellEntries(line, cols, { questionKinds })`
  und **`NoNotesMarkdown.render(text, { questionKinds })`** nehmen dieselbe Angabe (zum Auswerten und Zeichnen ausserhalb des Editors,
  zum Beispiel für den Index im Backend); neu auch `NoNotesQuestions.kindsOf(options)`.
- `editor.css`: `.toolbar button[hidden]` und `.tb-sep[hidden]` sind ausgeblendet.

## v1.2.0 (2026-11-03)

Ausfüllen von Platzhaltern, nach einer Vorlage in SteeringBoard; Einzelheiten und Tabelle der Tasten in [docs/DESIGN.md](docs/DESIGN.md) §4b.
Keine neuen oder geänderten Schlüssel im Katalog.

- **Enter im Platzhalter** im Text ist eine neue Zeile im Wert und springt nie, auch mit «behalten» (bisher sprang es dann). Ein Wert mit
  Zeilenumbruch wird beim Verlassen als Text geschrieben, der Platzhalter bleibt nicht stehen; `onFill(name, value, keep, …)` meldet es mit
  `keep = false` (und wird jetzt auch für Werte mit Zeilenumbruch gerufen). Gleiche Namen im Text bekommen denselben Text, im Feld des
  Gastgebers steht er auf einer Zeile.
- **Feld des Gastgebers** (`placeholders.field`): Enter bestätigt den Wert und beendet das Ausfüllen, statt in den Text zu springen. Tab bleibt.
- **Fortsetzen:** ein Klick in einen übrigen Platzhalter beginnt das Ausfüllen wieder (nach Esc und nach Enter im Feld), Tab geht weiter.
- **Termine:** ein Platzhalter nach «>» oder mit einem Datum als Vorgabe öffnet beim Anwählen (Tab, Umschalt+Tab, Klick) die Datumsauswahl,
  vorgewählt die Vorgabe oder heute. Wahl mit Klick oder Enter füllt ihn, das Ausfüllen geht weiter; erstes Esc schliesst nur die Auswahl,
  zweites beendet das Ausfüllen; bei offener Auswahl springen Tab und Umschalt+Tab weiter.

## v1.1.0 (2026-10-31)

Die Wünsche E1–E5 von SteeringBoard (`docs/WUENSCHE-AN-DEN-KERN.md` dort), alle wahlweise und rückwärtskompatibel; Einzelheiten in
[docs/DESIGN.md](docs/DESIGN.md) §4a. Keine neuen oder geänderten Schlüssel im Katalog: die Sprachpakete der Gastgeber bleiben vollständig.

- **E1** `afterRender(preview, ed)`: Rückruf nach jedem Zeichnen der Vorschau. `resolveRef` (über `refs.resolver`) darf neben `id` und
  `label` auch `href`, `title`, `className` und `data` (→ `data-*`) liefern; mit Ctrl/Cmd/Umschalt öffnet ein solches Ziel wie ein Link.
- **E2** `onMode(mode, ed, { remember })`: `remember` sagt, ob die Person die Darstellung gewählt hat (oder der Gastgeber `ed.mode(name)`
  gerufen hat) oder ob der Editor selbst umgeschaltet hat.
- **E3** `NoNotesEditor.configure({ storagePrefix })`: eigene Schlüssel für Darstellung und «Mit Rahmen» (`<prefix>.mode`,
  `<prefix>.tableGrid`); `NoNotesEditor.storageKey(name)`, `MODE_KEY` und `GRID_KEY` folgen dem Präfix.
- **E4** Fett, Kursiv, Durchgestrichen und Code setzen ohne Auswahl das übersetzte Wort ein (die Beschriftung des Knopfs, klein
  geschrieben): *bold*, *italic* … auf Englisch; auf Deutsch wie bisher «fett», «kursiv», «durchgestrichen», «code».
- **E5** `readOnlyTools: 'hide'`: bei Schreibschutz Toolleiste und Bilderleiste verbergen statt nur sperren.
- `editor.css`: `.toolbar[hidden]` und `.attachments[hidden]` sind verborgen, auch ohne globale Regel `[hidden]` des Gastgebers.
- `markdown.js`: `data-note-id` wird maskiert; ein Resolver ohne Ergebnis (`null`) gilt als unbekanntes Ziel statt eines Fehlers.

## v1.0.0 (2026-10-31)

Markdown-Engine und Editor aus NoNotes v3.3.0 als eigenes Paket (MIT).

- Die Module von NoNotes (`NoNotesMarkdown`, `NoNotesTasks`, `NoNotesQuestions`, `NoNotesTables`, `NoNotesEditing`, `NoNotesMentions`,
  `NoNotesEmbeds`, `NoNotesDates`, `NoNotesPlaceholders`, `NoNotesDatePicker`, `NoNotesScrollSync`) mit ihren bisherigen Namen.
- Neu: der Baustein `NoNotesEditor` (mehrere Editoren auf einer Seite, Speichern, Konflikt, Verweise, Bilder, Platzhalter, Knöpfe des
  Gastgebers, Erweiterungen über `extend`) und die Texte `NoNotesEditorLabels` (Katalog Deutsch und Englisch, Übersetzer und Ersetzungen
  des Gastgebers, NoNotesI18n als Vorgabe, wenn es da ist).
- Für NoNotes v4.0.0: `ids.editorBody`, `ids.mirror`, `ids.tablePicker`, `placeholders.field`, `onFill(…, { field, data })`,
  `people.keepTyped`, `refresh()`, `selectLine()`, `forgetAttachment()` ohne Kennung, `hint(text, kind)`.
- `files.cjs` für den Build des Gastgebers, Tests für Engine (Node) und Editor (Chromium per `file://`).
