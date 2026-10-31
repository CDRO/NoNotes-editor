/* NoNotes-editor – welche Dateien ein Gastgeber in seinen Build kopiert, in der Reihenfolge, in der die Seite sie lädt.
   Für die Werkzeuge des Gastgebers (Node, CommonJS); im Browser wird diese Datei nicht gebraucht.

     const editor = require('nonotes-editor');      // oder require('nonotes-editor/files.cjs')
     editor.version                                 '1.1.0'
     editor.root                                    Ordner des Pakets (absolut)
     editor.scripts                                 [{ name: 'labels.js', file: '/…/src/labels.js', role: 'labels' | 'lang' | 'engine' | 'ui' }, …]
     editor.styles                                  [{ name: 'editor.css', file: '/…/src/editor.css' }]
     editor.engine                                  nur die Module ohne DOM (für Node, vm-Kontext): labels, Sprachen, Engine

   role: labels = Texte (immer zuerst), lang = Katalog der Sprachen, engine = reine Funktionen (laufen auch in Node), ui = braucht ein DOM. */
'use strict';

const path = require('node:path');

const ROOT = __dirname;
const SCRIPTS = [
  ['src/labels.js', 'labels'],
  ['lang/editor.de.js', 'lang'],
  ['lang/editor.en.js', 'lang'],
  ['src/placeholders.js', 'engine'],
  ['src/dates.js', 'engine'],
  ['src/questions.js', 'engine'],
  ['src/mentions.js', 'engine'],
  ['src/tasks.js', 'engine'],
  ['src/embeds.js', 'engine'],
  ['src/tables.js', 'engine'],
  ['src/markdown.js', 'engine'],
  ['src/editing.js', 'engine'],
  ['src/datepicker.js', 'ui'],
  ['src/scrollsync.js', 'ui'],
  ['src/editor.js', 'ui'],
];

const entry = ([rel, role]) => ({ name: path.basename(rel), rel, file: path.join(ROOT, rel), role });
const scripts = SCRIPTS.map(entry);

module.exports = {
  version: require('./package.json').version,
  root: ROOT,
  scripts,
  engine: scripts.filter(s => s.role !== 'ui'),
  styles: [{ name: 'editor.css', rel: 'src/editor.css', file: path.join(ROOT, 'src', 'editor.css') }],
};
