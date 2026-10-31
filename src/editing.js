/* NoNotes – reine Textfunktionen für die Toolleiste des Editors.
   Jede Funktion bekommt (text, selStart, selEnd) und liefert { text, selStart, selEnd }.
   Keine DOM-Abhängigkeit, damit sich alles in Node prüfen lässt. */
(function (global) {
  'use strict';

  // Übersetzung nur, wenn das Label-Modul (labels.js) geladen ist (die Funktionen laufen auch ohne Browser).
  const t = key => (global.NoNotesEditorLabels ? global.NoNotesEditorLabels.t(key) : key); // i18n-dynamic

  function lineBounds(text, start, end) {
    const from = text.lastIndexOf('\n', start - 1) + 1;
    let to = text.indexOf('\n', Math.max(end, start));
    if (to < 0) to = text.length;
    // Endet die Markierung genau am Zeilenanfang, gehört diese Zeile nicht mehr dazu.
    if (end > start && end > from && text[end - 1] === '\n') to = end - 1;
    return { from, to };
  }

  /** Umschliesst die Markierung mit before/after oder entfernt eine bestehende Umschliessung. */
  function wrap(text, s, e, before, after, placeholder) {
    after = after == null ? before : after;
    const sel = text.slice(s, e);
    // Bereits umschlossen (Marker innerhalb oder ausserhalb der Markierung)?
    if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
      const inner = sel.slice(before.length, sel.length - after.length);
      return { text: text.slice(0, s) + inner + text.slice(e), selStart: s, selEnd: s + inner.length };
    }
    if (text.slice(s - before.length, s) === before && text.slice(e, e + after.length) === after) {
      return { text: text.slice(0, s - before.length) + sel + text.slice(e + after.length), selStart: s - before.length, selEnd: s - before.length + sel.length };
    }
    if (!sel) {
      const ph = placeholder || t('Text');
      return { text: text.slice(0, s) + before + ph + after + text.slice(e), selStart: s + before.length, selEnd: s + before.length + ph.length };
    }
    return { text: text.slice(0, s) + before + sel + after + text.slice(e), selStart: s + before.length, selEnd: s + before.length + sel.length };
  }

  const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/;
  const PREFIX_RE = {
    quote: /^(\s*)>\s?/,
    question: /^(\s*)\?(?![?!])\s?/,
    decision: /^(\s*)\?!\s?/,
    answer: /^(\s*)!(?!\[)!?\s?/,
    heading: /^(\s*)#{1,6}\s+/,
  };

  /** Wendet fn auf jede Zeile der Markierung an und hält die Markierung auf den Zeilen. */
  function mapLines(text, s, e, fn) {
    const { from, to } = lineBounds(text, s, e);
    const lines = text.slice(from, to).split('\n');
    const out = lines.map((l, i) => fn(l, i, lines)).join('\n');
    return { text: text.slice(0, from) + out + text.slice(to), selStart: from, selEnd: from + out.length };
  }

  function stripLinePrefixes(line) {
    return line.replace(LIST_RE, '$1').replace(PREFIX_RE.quote, '$1').replace(PREFIX_RE.decision, '$1').replace(PREFIX_RE.question, '$1').replace(PREFIX_RE.answer, '$1');
  }

  /** Listen umschalten: kind = 'bullet' | 'ordered' | 'task'. */
  function toggleList(text, s, e, kind) {
    const { from, to } = lineBounds(text, s, e);
    const lines = text.slice(from, to).split('\n');
    const isKind = l => kind === 'task' ? /^\s*[-*+]\s+\[[ xX]\]\s+/.test(l)
      : kind === 'ordered' ? /^\s*\d+[.)]\s+(?!\[[ xX]\]\s)/.test(l)
      : /^\s*[-*+]\s+(?!\[[ xX]\]\s)/.test(l);
    const all = lines.filter(l => l.trim()).every(isKind);
    return mapLines(text, s, e, (l, i) => {
      if (!l.trim() && lines.length > 1) return l;
      const indent = (l.match(/^\s*/) || [''])[0];
      const body = stripLinePrefixes(l).replace(/^\s*/, '');
      if (all) return indent + body;
      if (kind === 'task') return indent + '- [ ] ' + body;
      if (kind === 'ordered') return indent + (i + 1) + '. ' + body;
      return indent + '- ' + body;
    });
  }

  const LIST_ITEM_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)(?!\[[ xX]\]\s)/; // Listenpunkt ohne Kästchen
  const BLOCK_OPEN_RE = /^(\s*)((?:[-*+]|\d+[.)])\s+)?\?(!?)\s?```(.*)$/; // "?!``` Titel", auch als Listenpunkt "- ?!``` Titel" (v2.6.0)
  const BLOCK_CLOSE_RE = /^\s*```\s*$/;

  /** Mehrere Zeilen als Block "?!``` Titel" … "```" (die erste Zeile wird der Titel); ein markierter Block wird wieder Text, mit dem
   *  anderen Zeichen wechselt er die Art. Ist die erste Zeile ein Listenpunkt, wird der Block dieser Listenpunkt ("- ?!``` Titel"),
   *  die übrigen Zeilen rücken unter seinen Text (und zurück). null, wenn das nicht passt (dann gilt das Umschalten Zeile für Zeile). */
  function toggleBlock(text, s, e, kind) {
    const marker = kind === 'decision' ? '?!' : '?';
    const { from, to } = lineBounds(text, s, e);
    const lines = text.slice(from, to).split('\n');
    const filled = lines.map((l, i) => [l, i]).filter(([l]) => l.trim());
    if (filled.length < 2) return null;
    const [first, fi] = filled[0];
    const [last, li] = filled[filled.length - 1];
    const open = BLOCK_OPEN_RE.exec(first);
    let out;
    if (open && BLOCK_CLOSE_RE.test(last)) {
      const list = open[2] || '';
      const title = open[4].trim();
      if ((open[3] ? '?!' : '?') !== marker) {
        out = lines.slice();
        out[fi] = open[1] + list + marker + '```' + (title ? ' ' + title : '');
      } else {
        const unpad = ' '.repeat(list.length);
        const inner = lines.slice(fi + 1, li).map(l => (list && l.startsWith(unpad) ? l.slice(unpad.length) : l));
        out = lines.slice(0, fi).concat(title ? [open[1] + list + title] : [], inner, lines.slice(li + 1));
      }
    } else {
      const re = PREFIX_RE[kind];
      if (filled.every(([l]) => re.test(l.replace(LIST_ITEM_RE, '')))) return null; // alles schon markiert: Zeile für Zeile entfernen
      const indent = (first.match(/^\s*/) || [''])[0];
      const item = LIST_ITEM_RE.exec(first);
      if (item) {
        // Block als Listenpunkt: die weiteren Zeilen rücken um das Listenzeichen ein, unter den Text des Punkts
        const pad = ' '.repeat(item[1].length - indent.length);
        const inner = lines.slice(fi + 1, li + 1).map(l => (l.trim() ? pad + l : l));
        out = lines.slice(0, fi).concat([item[1] + marker + '``` ' + stripLinePrefixes(first).trim()], inner, [' '.repeat(item[1].length) + '```'], lines.slice(li + 1));
      } else {
        out = lines.slice(0, fi).concat([indent + marker + '``` ' + stripLinePrefixes(first).trim()], lines.slice(fi + 1, li + 1), [indent + '```'], lines.slice(li + 1));
      }
    }
    const joined = out.join('\n');
    return { text: text.slice(0, from) + joined + text.slice(to), selStart: from, selEnd: from + joined.length };
  }

  /** Zitat, Frage, Entscheid oder Antwort umschalten (kind = 'quote' | 'question' | 'decision' | 'answer'). Frage und Entscheid stehen
   *  in einer Liste hinter dem Listenzeichen ("- ?! …"); über mehrere Zeilen werden sie ein Block (toggleBlock). */
  function togglePrefix(text, s, e, kind) {
    if (kind === 'question' || kind === 'decision') {
      const block = toggleBlock(text, s, e, kind);
      if (block) return block;
    }
    const re = PREFIX_RE[kind];
    const marker = kind === 'quote' ? '> ' : kind === 'question' ? '? ' : kind === 'decision' ? '?! ' : '! ';
    const inList = kind === 'question' || kind === 'decision';
    const split = l => { const m = inList ? LIST_ITEM_RE.exec(l) : null; return m ? [m[1], l.slice(m[1].length)] : ['', l]; };
    const { from, to } = lineBounds(text, s, e);
    const lines = text.slice(from, to).split('\n');
    const all = lines.filter(l => l.trim()).every(l => re.test(split(l)[1]));
    return mapLines(text, s, e, l => {
      if (!l.trim() && lines.length > 1) return l;
      const [list, rest] = split(l);
      if (all) return list + rest.replace(re, '$1');
      if (re.test(rest)) return l;
      const others = kind === 'quote' ? [] : [PREFIX_RE.decision, PREFIX_RE.question, PREFIX_RE.answer].filter(o => o !== re);
      const base = others.reduce((acc, o) => acc.replace(o, '$1'), rest);
      return list + base.replace(/^(\s*)/, '$1' + marker);
    });
  }

  /** Überschrift setzen (level 1–6) oder entfernen (0). */
  function setHeading(text, s, e, level) {
    return mapLines(text, s, e, l => {
      const base = l.replace(PREFIX_RE.heading, '$1');
      if (!level) return base;
      return base.replace(/^(\s*)/, '$1' + '#'.repeat(level) + ' ');
    });
  }

  /** Codeblock um die markierten Zeilen oder leere Vorlage. */
  function codeBlock(text, s, e) {
    const { from, to } = lineBounds(text, s, e);
    const block = text.slice(from, to);
    if (!block.trim()) {
      const code = t('Code');
      const ins = '```\n' + code + '\n```';
      return { text: text.slice(0, from) + ins + text.slice(to), selStart: from + 4, selEnd: from + 4 + code.length };
    }
    if (/^```/.test(block) && /```\s*$/.test(block)) {
      const inner = block.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
      return { text: text.slice(0, from) + inner + text.slice(to), selStart: from, selEnd: from + inner.length };
    }
    const out = '```\n' + block + '\n```';
    return { text: text.slice(0, from) + out + text.slice(to), selStart: from, selEnd: from + out.length };
  }

  /** Link einfügen: markierte URL → [Text](url), markierter Text → [Text](https://), sonst Vorlage. */
  function link(text, s, e) {
    const sel = text.slice(s, e).trim();
    if (/^(https?:\/\/|www\.|mailto:)\S+$/i.test(sel)) {
      const url = /^www\./i.test(sel) ? 'https://' + sel : sel;
      const word = t('Text');
      const ins = `[${word}](${url})`;
      return { text: text.slice(0, s) + ins + text.slice(e), selStart: s + 1, selEnd: s + 1 + word.length };
    }
    const label = sel || t('Text');
    const ins = `[${label}](https://)`;
    const urlStart = s + label.length + 3;
    return { text: text.slice(0, s) + ins + text.slice(e), selStart: urlStart, selEnd: urlStart + 8 };
  }

  /** Verweis auf eine Notiz: [[Titel]]. Ohne Markierung «[[]]» mit dem Cursor dazwischen, mit Markierung «[[markiert]]» und dem Cursor
   *  vor «]]»; die Vorschlagsliste im Editor (seit 2.9.0) sucht dann nach dem Text. Steht der Verweis schon da, wird der Text wieder frei. */
  function wikiLink(text, s, e) {
    const sel = text.slice(s, e);
    const wrapped = (sel.startsWith('[[') && sel.endsWith(']]') && sel.length >= 4) || (text.slice(s - 2, s) === '[[' && text.slice(e, e + 2) === ']]');
    if (wrapped) return wrap(text, s, e, '[[', ']]', t('Titel'));
    const caret = s + 2 + sel.length;
    return { text: text.slice(0, s) + '[[' + sel + ']]' + text.slice(e), selStart: caret, selEnd: caret };
  }

  /** Trennlinie auf eigener Zeile. */
  function horizontalRule(text, s, e) {
    const before = text.slice(0, s);
    const after = text.slice(e);
    const pre = before.length && !before.endsWith('\n') ? '\n' : '';
    const post = after.startsWith('\n') || !after.length ? '\n' : '\n\n';
    const ins = pre + '---' + post;
    return { text: before + ins + after, selStart: s + ins.length, selEnd: s + ins.length };
  }

  // ---------- Listen weiterführen, ein- und ausrücken ----------

  const ITEM_RE = /^(\s*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?(.*)$/;
  const QUOTE_LINE_RE = /^(\s*)>\s?(.*)$/;
  const ANSWER_LINE_RE = /^(\s*)(!!|!(?!\[))\s?(.*)$/;

  /** Zerlegt eine Zeile in Einrückung, Marker und Inhalt, oder null. */
  function parseItem(line) {
    let m = ITEM_RE.exec(line);
    if (m) {
      const indent = m[1];
      const content = m[6] || '';
      const prefixLength = line.length - content.length;
      if (m[5]) return { kind: 'task', indent, bullet: m[2] || null, number: m[3] ? Number(m[3]) : null, delim: m[4] || null, content, prefixLength };
      if (m[3]) return { kind: 'ordered', indent, number: Number(m[3]), delim: m[4], content, prefixLength };
      return { kind: 'bullet', indent, bullet: m[2], content, prefixLength };
    }
    m = QUOTE_LINE_RE.exec(line);
    if (m) return { kind: 'quote', indent: m[1], content: m[2], prefixLength: line.length - m[2].length };
    m = ANSWER_LINE_RE.exec(line);
    if (m) return { kind: 'answer', indent: m[1], marker: m[2], content: m[3], prefixLength: line.length - m[3].length };
    return null;
  }

  function markerFor(item, next) {
    switch (item.kind) {
      case 'task': return item.number != null ? `${item.number + (next ? 1 : 0)}${item.delim} [ ] ` : `${item.bullet || '-'} [ ] `;
      case 'ordered': return `${item.number + (next ? 1 : 0)}${item.delim} `;
      case 'bullet': return `${item.bullet} `;
      case 'quote': return '> ';
      case 'answer': return (item.marker || '!') + ' ';
      default: return '';
    }
  }

  /** Nummerierte Listen im ganzen Text neu durchzählen; jeder Lauf behält seine Startnummer.
   *  Ein Lauf endet an Leerzeilen, Nicht-Listenzeilen, bei Aufzählungszeichen derselben Stufe
   *  oder beim Ausrücken. */
  function renumberAll(text) {
    const lines = text.split('\n');
    const counters = new Map(); // Einrückung → letzte Nummer
    for (let i = 0; i < lines.length; i++) {
      const item = parseItem(lines[i]);
      if (!item || item.kind === 'quote' || item.kind === 'answer' || !lines[i].trim()) { counters.clear(); continue; }
      const level = item.indent.length;
      for (const k of [...counters.keys()]) if (k > level) counters.delete(k);
      const ordered = item.kind === 'ordered' || (item.kind === 'task' && item.number != null);
      if (!ordered) { counters.delete(level); continue; }
      const n = counters.has(level) ? counters.get(level) + 1 : item.number;
      counters.set(level, n);
      if (n !== item.number) {
        lines[i] = lines[i].replace(/^(\s*)\d+([.)])/, `$1${n}$2`);
      }
    }
    return lines.join('\n');
  }

  function offsetOfLine(lines, index) {
    let off = 0;
    for (let i = 0; i < index; i++) off += lines[i].length + 1;
    return off;
  }

  /** Enter am Ende von "?!``` Titel" ohne "```" weiter unten: eine leere Zeile für die Beschreibung und das "```" darunter. Als
   *  Listenpunkt ("- ?!``` Titel") eingerückt auf den Text des Punkts, und auch mit "```" weiter unten nur eingerückt (kein neuer Punkt). */
  function closeBlock(base, s, lineStart, lineEnd) {
    const line = base.slice(lineStart, lineEnd);
    const m = BLOCK_OPEN_RE.exec(line);
    if (!m || s !== lineEnd) return null;
    const pad = m[1] + ' '.repeat((m[2] || '').length);
    let closed = false;
    for (const l of base.slice(lineEnd + 1).split('\n')) {
      if (BLOCK_CLOSE_RE.test(l)) { closed = true; break; }
      if (BLOCK_OPEN_RE.test(l)) break;
    }
    if (closed && !m[2]) return null;
    const out = base.slice(0, s) + '\n' + pad + (closed ? '' : '\n' + pad + '```') + base.slice(s);
    const caret = s + 1 + pad.length;
    return { text: out, selStart: caret, selEnd: caret };
  }

  /** Enter in einer Listen-, Aufgaben-, Zitat- oder Antwortzeile. Liefert null, wenn der Browser
   *  die normale neue Zeile einfügen soll. */
  function continueLine(text, s, e) {
    const base = text.slice(0, s) + text.slice(e);
    const lineStart = base.lastIndexOf('\n', s - 1) + 1;
    let lineEnd = base.indexOf('\n', s);
    if (lineEnd < 0) lineEnd = base.length;
    const block = closeBlock(base, s, lineStart, lineEnd);
    if (block) return block;
    const line = base.slice(lineStart, lineEnd);
    const item = parseItem(line);
    if (!item) return null;
    if (s < lineStart + item.prefixLength) return null; // Cursor steht noch vor dem Inhalt

    let out, caret;
    if (!item.content.trim()) {
      // Leeres Element: zuerst ausrücken, dann beenden.
      if (item.indent.length >= 2 && item.kind !== 'quote' && item.kind !== 'answer') {
        const newIndent = item.indent.slice(0, item.indent.length - 2);
        const newLine = newIndent + markerFor(item, false);
        out = base.slice(0, lineStart) + newLine + base.slice(lineEnd);
        caret = lineStart + newLine.length;
      } else {
        out = base.slice(0, lineStart) + base.slice(lineEnd);
        caret = lineStart;
      }
    } else {
      const marker = item.indent + markerFor(item, true);
      out = base.slice(0, s) + '\n' + marker + base.slice(s);
      caret = s + 1 + marker.length;
    }

    if (item.kind === 'ordered' || (item.kind === 'task' && item.number != null)) {
      // Nach dem Neunummerieren den Cursor über Zeile und Spalte wiederfinden.
      const before = out.slice(0, caret).split('\n');
      const lineIdx = before.length - 1;
      const col = before[before.length - 1].length;
      out = renumberAll(out);
      const lines = out.split('\n');
      caret = offsetOfLine(lines, lineIdx) + Math.min(col, lines[lineIdx].length);
    }
    return { text: out, selStart: caret, selEnd: caret };
  }

  /** Tab / Shift+Tab: Listenzeilen in der Markierung ein- (delta 1) oder ausrücken (delta -1).
   *  Liefert null, wenn die Cursorzeile keine Listenzeile ist. */
  function indentLines(text, s, e, delta) {
    const { from, to } = lineBounds(text, s, e);
    const lines = text.slice(from, to).split('\n');
    const items = lines.map(parseItem);
    const isList = it => it && it.kind !== 'quote' && it.kind !== 'answer';
    const startLine = text.slice(0, from).split('\n').length - 1;
    const caretLine = text.slice(0, s).split('\n').length - 1;
    const k = caretLine - startLine;
    if (!isList(items[k])) return null;

    const changed = lines.map((l, i) => {
      if (!isList(items[i])) return l;
      if (delta > 0) {
        // Eine neu eingerückte Unterliste beginnt bei 1; renumberAll zählt dann hoch.
        return '  ' + l.replace(/^(\s*)\d+([.)])/, '$11$2');
      }
      return l.replace(/^ {1,2}/, '');
    });
    let out = text.slice(0, from) + changed.join('\n') + text.slice(to);
    out = renumberAll(out);
    const outLines = out.split('\n');

    if (e > s) {
      const endLine = startLine + lines.length - 1;
      return { text: out, selStart: offsetOfLine(outLines, startLine), selEnd: offsetOfLine(outLines, endLine) + outLines[endLine].length };
    }
    const col = s - (text.lastIndexOf('\n', s - 1) + 1);
    const shift = changed[k].length - lines[k].length;
    const caret = offsetOfLine(outLines, caretLine) + Math.max(0, Math.min(col + shift, outLines[caretLine].length));
    return { text: out, selStart: caret, selEnd: caret };
  }

  /** Text an der Cursorposition einfügen (ersetzt die Markierung). */
  function insert(text, s, e, snippet, selectInner) {
    const out = text.slice(0, s) + snippet + text.slice(e);
    if (selectInner) return { text: out, selStart: s + selectInner[0], selEnd: s + selectInner[1] };
    return { text: out, selStart: s + snippet.length, selEnd: s + snippet.length };
  }

  global.NoNotesEditing = { wrap, toggleList, togglePrefix, setHeading, codeBlock, link, wikiLink, horizontalRule, insert, lineBounds, continueLine, indentLines, renumberAll, parseItem };
})(window);
