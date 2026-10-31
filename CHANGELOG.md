# Änderungen

Semantische Versionen (siehe [docs/DESIGN.md](docs/DESIGN.md) §8). Ein Release ist ein Tag; Gastgeber zeigen in `devDependencies` darauf.

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
