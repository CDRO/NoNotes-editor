#!/usr/bin/env node
/* NoNotes-editor – Werkzeug für den Katalog der Texte (lang/).

   node tools/labels.cjs list                       alle Schlüssel mit Fundstellen
   node tools/labels.cjs update [--from <Datei>]    lang/editor.de.js neu schreiben (alle Schlüssel), lang/editor.en.js abgleichen; fehlende englische
                                                    Texte wahlweise aus einem Sprachpaket von NoNotes (lang/en.js mit NoNotesI18n.register)
   node tools/labels.cjs check                      lang/editor.de.js und lang/editor.en.js passen genau zum Quelltext (sonst Fehler)

   Der deutsche Text ist der Schlüssel. Gesammelt wird aus src/*.js (Aufrufe t('…'), tn('…', '…', n), N_('…')), wie in NoNotes
   tools/i18n.cjs (Schlüssel müssen Textliterale sein; Ausnahmen mit dem Kommentar i18n-dynamic). */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const LANG = path.join(ROOT, 'lang');
const SKIP = new Set(['labels.js']);

function unescapeLiteral(body) {
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, c) => {
    if (c[0] === 'u') return String.fromCodePoint(parseInt(c.replace(/^u\{?|\}$/g, ''), 16));
    if (c[0] === 'x') return String.fromCharCode(parseInt(c.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[c] ?? c;
  });
}

function readLiteral(src, i) {
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (q === '`' && c === '$' && src[j + 1] === '{') return { dynamic: true, end: j };
    if (c === q) return { value: unescapeLiteral(src.slice(i + 1, j)), end: j + 1 };
    if (c === '\n' && q !== '`') return null;
    j++;
  }
  return null;
}

const skipSpace = (src, i) => { while (/\s/.test(src[i] || '')) i++; return i; };
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Schlüssel aus dem Quelltext: Map(Schlüssel → { other: Mehrzahl oder null, where: [] }) und gefundene Probleme. */
function scan() {
  const keys = new Map();
  const problems = [];
  const add = (key, where, other) => {
    if (!keys.has(key)) keys.set(key, { other: null, where: [] });
    const e = keys.get(key);
    e.where.push(where);
    if (other != null) {
      if (e.other != null && e.other !== other) problems.push(`${where}: Mehrzahl zu «${key}» weicht von einer früheren Stelle ab`);
      e.other = other;
    }
  };
  const call = /(?<![\w$.])(tn|t|N_)\s*\(/g;
  for (const f of fs.readdirSync(SRC).filter(n => n.endsWith('.js') && !SKIP.has(n)).sort()) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    let m;
    call.lastIndex = 0;
    while ((m = call.exec(src))) {
      const name = m[1];
      const where = `src/${f}:${lineOf(src, m.index)}`;
      if (/(function|const|let|var)\s+$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
      let i = skipSpace(src, m.index + m[0].length);
      const first = readLiteral(src, i);
      if (!first || first.dynamic) {
        if (src[i] === ')' || src[i] === '.') continue;
        if (/i18n-dynamic/.test(src.split('\n')[lineOf(src, m.index) - 1])) continue;
        problems.push(`${where}: ${name}() braucht ein Textliteral als Schlüssel`);
        continue;
      }
      if (name === 'tn') {
        i = skipSpace(src, first.end);
        if (src[i] !== ',') { problems.push(`${where}: tn() braucht Einzahl, Mehrzahl und Zahl`); continue; }
        const second = readLiteral(src, skipSpace(src, i + 1));
        if (!second || second.dynamic) { problems.push(`${where}: tn() braucht die Mehrzahl als Textliteral`); continue; }
        add(first.value, where, second.value);
      } else add(first.value, where, null);
    }
  }
  return { keys, problems };
}

/** Liest eine Sprachdatei des Pakets (NoNotesEditorLabels.register) oder von NoNotes (NoNotesI18n.register): { code, messages, options }. */
function loadPack(file) {
  const got = [];
  const sandbox = {
    NoNotesEditorLabels: { register: (code, messages, options) => got.push({ code, messages, options: options || {} }) },
    NoNotesI18n: { register: (code, name, messages, options) => got.push({ code, messages, options: options || {} }) },
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  if (got.length !== 1) throw new Error(`${file}: genau ein register()-Aufruf erwartet`);
  return got[0];
}

const quote = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
function entry(key, value) {
  if (value && typeof value === 'object') return `  ${quote(key)}: { ${Object.entries(value).map(([k, v]) => `${k}: ${quote(v)}`).join(', ')} },`;
  return `  ${quote(key)}: ${quote(value || '')},`;
}

function writePack(file, head, code, rows, options) {
  const body = rows.map(([k, v]) => entry(k, v)).join('\n');
  fs.writeFileSync(file, `${head}\nNoNotesEditorLabels.register('${code}', {\n${body}\n}, { ${Object.entries(options).map(([k, v]) => `${k}: ${quote(v)}`).join(', ')} });\n`);
}

const HEAD_DE = `/* NoNotes-editor – Katalog aller Texte (Deutsch, Schweiz: die Ausgangssprache; der Text ist der Schlüssel).
   Mit tools/labels.cjs update erzeugt. Ein Gastgeber ersetzt einzelne Texte mit NoNotesEditor.configure({ messages: { de: { … } } }). */`;
const HEAD_EN = `/* NoNotes-editor – English. Mit tools/labels.cjs update abgeglichen; Schlüssel ist der deutsche Text.
   Ein Gastgeber ersetzt einzelne Texte mit NoNotesEditor.configure({ messages: { en: { … } } }). */`;

function deRows(keys) {
  return [...keys].sort((a, b) => a[0].localeCompare(b[0], 'de')).map(([k, info]) => [k, info.other != null ? { one: k, other: info.other } : k]);
}

function cmdUpdate(from) {
  const { keys, problems } = scan();
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  writePack(path.join(LANG, 'editor.de.js'), HEAD_DE, 'de', deRows(keys), { locale: 'de-CH' });
  const enFile = path.join(LANG, 'editor.en.js');
  const old = fs.existsSync(enFile) ? loadPack(enFile).messages : {};
  const extra = from ? loadPack(path.resolve(from)).messages : {};
  const missing = [];
  const rows = deRows(keys).map(([k, deValue]) => {
    let v = old[k] != null && old[k] !== '' ? old[k] : extra[k];
    if (v == null || v === '') { missing.push(k); v = ''; }
    if (typeof deValue === 'object' && typeof v === 'string' && v) v = { one: v, other: v };
    return [k, v];
  });
  writePack(enFile, HEAD_EN, 'en', rows, { locale: 'en-GB' });
  console.log(`lang/editor.de.js: ${keys.size} Schlüssel; lang/editor.en.js: ${missing.length} ohne Übersetzung`);
  for (const k of missing) console.log('  fehlt: ' + k);
}

function cmdCheck() {
  const { keys, problems } = scan();
  const errors = [...problems];
  for (const code of ['de', 'en']) {
    const file = path.join(LANG, `editor.${code}.js`);
    if (!fs.existsSync(file)) { errors.push(`lang/editor.${code}.js fehlt`); continue; }
    const { messages } = loadPack(file);
    for (const k of Object.keys(messages)) if (!keys.has(k)) errors.push(`lang/editor.${code}.js: unbekannter (veralteter) Schlüssel «${k}»`);
    for (const [k, info] of keys) {
      const v = messages[k];
      if (v == null || v === '') { errors.push(`lang/editor.${code}.js: «${k}» fehlt`); continue; }
      if (info.other != null && (typeof v !== 'object' || !v.other)) errors.push(`lang/editor.${code}.js: «${k}» braucht Einzahl und Mehrzahl ({ one, other })`);
      const names = s => [...new Set([...String(s).matchAll(/\{([a-zA-Z_]\w*)\}/g)].map(m => m[1]))].filter(p => p !== 'n').sort().join(',');
      const want = names(k + ' ' + (info.other || ''));
      const forms = typeof v === 'object' ? Object.values(v) : [v];
      for (const f of forms) if (names(f) !== want) errors.push(`lang/editor.${code}.js: «${k}»: Platzhalter {${want}} statt {${names(f)}}`);
    }
  }
  if (errors.length) { console.error(errors.join('\n')); console.error(`\n${errors.length} Fehler im Katalog`); process.exit(1); }
  console.log(`Katalog in Ordnung: ${keys.size} Schlüssel in lang/editor.de.js und lang/editor.en.js`);
}

function cmdList() {
  const { keys } = scan();
  for (const [k, info] of [...keys].sort((a, b) => a[0].localeCompare(b[0], 'de'))) console.log(`${k}${info.other ? ` | ${info.other}` : ''}\n    ${info.where.join(', ')}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'list') cmdList();
else if (cmd === 'update') cmdUpdate(rest[0] === '--from' ? rest[1] : null);
else if (cmd === 'check') cmdCheck();
else { console.error('Aufruf: node tools/labels.cjs list | update [--from <lang/en.js von NoNotes>] | check'); process.exit(1); }

module.exports = { scan, loadPack };
