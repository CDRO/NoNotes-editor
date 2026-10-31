/* NoNotes – Aufgaben im Notiztext.
   Syntax: Markdown-Checkbox "- [ ] Text" (offen) bzw. "- [x] Text" (erledigt), optional mit
   Termin am Zeilenende: ">15.10.2026" oder ">2026-10-15" (siehe dates.js); mehrere Termine: der späteste ist die Frist (due), die
   früheren sind Erinnerungen (reminders, seit v3.0.0). Der Text bleibt die einzige Wahrheit; die Tabelle "tasks" ist ein Index darüber.
   Unteraufgaben: Eine Checkbox-Zeile, die tiefer eingerückt direkt unter einer Aufgabe steht, gehört
   zu ihr (beliebig tief). Eine Zeile ohne Kästchen, die nicht tiefer eingerückt ist, beendet den
   Teilbaum; Leerzeilen und tiefer eingerückter Text tun das nicht. Eine Aufgabe lässt sich erst
   abschliessen, wenn alle Unteraufgaben erledigt sind.
   Personen (v2.11.0): "@kürzel" im Text ist verantwortlich, "(@kürzel)" beteiligt, wie bei Fragen (questions.js). Eine Unteraufgabe
   ohne eigene Person gehört den Personen ihrer Hauptaufgabe (inherited: true).
   In Tabellen (v2.11.0): ein Teil eines Felds "[ ] Text" (Teile trennt "<br>") ist eine Aufgabe; mehrere in einer Zeile unterscheidet
   slot (die wievielte Aufgabe der Zeile). Sie haben keine Unteraufgaben. */
(function (global) {
  'use strict';

  /** Ausfüllbare Platzhalter (v2.12.0, placeholders.js): es zählt der Wert, offene als «[Name]»; die Zeilen bleiben, wie sie sind. */
  const flat = body => (global.NoNotesPlaceholders && body ? global.NoNotesPlaceholders.flatten(body) : body);

  // Texte über das Label-Modul des Pakets (labels.js, wird zuerst geladen); der Gastgeber kann jeden Text ersetzen.
  const { t, tn } = global.NoNotesEditorLabels;

  const TASK_RE = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
  const CELL_TASK_RE = /^\[([ xX])\]\s+(.*)$/;
  const D = () => global.NoNotesDates;
  const Tb = () => global.NoNotesTables;

  /** Genannte Personen im Text einer Aufgabe (ohne Termin): [{ handle, optional }]. */
  function peopleIn(text) {
    const Q = global.NoNotesQuestions;
    return Q ? Q.people(text) : [];
  }

  /** Aufgaben in den Feldern einer Tabellenzeile, in der Reihenfolge der Felder und Teile: [{ done, text, due, reminders, from }]; from ist die
   *  Lage von "[" in der Zeile. Ohne Text (nur Termin) ist es keine Aufgabe. cols: nur so viele Felder wie die Tabelle Spalten hat. */
  function cellTasks(line, cols) {
    const tb = Tb();
    if (!tb) return [];
    const out = [];
    for (const p of tb.cellParts(line, cols)) {
      const m = CELL_TASK_RE.exec(p.text);
      if (!m) continue;
      const { text, due, reminders } = D().splitDue(m[2]);
      if (text) out.push({ done: m[1] !== ' ', text, due, reminders, from: p.from });
    }
    return out;
  }

  function normalize(text) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** Breite der Einrückung; ein Tabulator zählt vier. */
  function indentOf(ws) {
    let n = 0;
    for (const c of ws) n += c === '\t' ? 4 : 1;
    return n;
  }

  /** Alle Aufgaben eines Notiztexts, mit Einrückung, Tiefe und Verweis auf die Hauptaufgabe
   *  (parent = Index in der Ergebnisliste, -1 ohne Hauptaufgabe). */
  function parse(body) {
    const lines = (flat(body) || '').split('\n');
    const out = [];
    const stack = []; // offene Hauptaufgaben: { indent, index }
    const tb = Tb();
    const code = tb ? tb.codeMask(lines) : null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const table = tb && !code[i] && (tb.isTableLine ? tb.isTableLine(line) : tb.isRow(line)) ? tb.parseAt(lines, i) : null;
      if (table) {
        stack.length = 0; // eine Tabelle beendet jede Liste darüber
        // Aufgaben in den Feldern (nicht in der Titelzeile); slot zählt je Textzeile von links nach rechts, wie cellTasks(Zeile)
        const slots = new Map();
        for (const cell of tb.cellsOf(table, lines)) {
          if (cell.r === 'h') continue;
          for (const p of cell.parts) {
            const m = CELL_TASK_RE.exec(p.text);
            if (!m) continue;
            const { text, due, reminders } = D().splitDue(m[2]);
            if (!text) continue;
            const slot = slots.get(p.line) || 0;
            slots.set(p.line, slot + 1);
            out.push({ text, norm: normalize(text), done: m[1] !== ' ', due, reminders, lineIndex: p.line, slot, cell: true, indent: 0, parent: -1, depth: 0, people: peopleIn(text) });
          }
        }
        i = table.end - 1;
        continue;
      }
      const m = TASK_RE.exec(line);
      const indent = indentOf(m ? m[1] : /^\s*/.exec(line)[0]);
      if (!m || !D().splitDue(m[4]).text) {
        if (line.trim()) while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
        continue;
      }
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const { text, due, reminders } = D().splitDue(m[4]);
      const parent = stack.length ? stack[stack.length - 1].index : -1;
      let people = peopleIn(text);
      if (!people.length && parent >= 0) people = out[parent].people.map(p => ({ handle: p.handle, optional: p.optional, inherited: true }));
      out.push({ text, norm: normalize(text), done: m[3] !== ' ', due, reminders, lineIndex: i, indent, parent, depth: stack.length, people });
      stack.push({ indent, index: out.length - 1 });
    }
    return out;
  }

  /** Indizes aller Unteraufgaben (jeder Tiefe) der Aufgabe an Position idx in der Ergebnisliste von parse. */
  function descendantIndexes(parsed, idx) {
    const found = [];
    for (let k = idx + 1; k < parsed.length; k++) {
      let p = parsed[k].parent;
      while (p > idx) p = parsed[p].parent;
      if (p !== idx) break; // der Teilbaum ist zusammenhängend
      found.push(k);
    }
    return found;
  }

  /** Indizes aller übergeordneten Aufgaben, von der nächsten bis zur obersten. */
  function ancestorIndexes(parsed, idx) {
    const found = [];
    for (let p = parsed[idx].parent; p >= 0; p = parsed[p].parent) found.push(p);
    return found;
  }

  /** Stelle der Aufgabe in parse(): über die Zeile, in einer Tabellenzeile dazu slot (ohne slot die erste der Zeile). */
  function indexOfLine(parsed, lineIndex, slot) {
    return parsed.findIndex(p => p.lineIndex === lineIndex && (slot == null || p.slot == null || p.slot === slot));
  }

  /** Kästchen einer Aufgabe setzen: in einer Liste das erste "[ ]" der Zeile, in einer Tabelle das der slot-ten Aufgabe der Zeile. */
  function mark(lines, task, done) {
    const line = lines[task.lineIndex];
    if (line == null) return;
    if (task.cell) {
      const c = cellTasks(line)[task.slot];
      if (c) lines[task.lineIndex] = line.slice(0, c.from + 1) + (done ? 'x' : ' ') + line.slice(c.from + 2);
    } else if (TASK_RE.test(line)) {
      lines[task.lineIndex] = line.replace(/\[([ xX])\]/, done ? '[x]' : '[ ]');
    }
  }

  /** Hinweistext, wenn eine Aufgabe wegen offener Unteraufgaben nicht abgeschlossen werden kann. */
  function openMessage(n) {
    return tn('{n} Unteraufgabe ist noch offen', '{n} Unteraufgaben sind noch offen', n);
  }

  /** Anzahl noch offener Unteraufgaben der Aufgabe in dieser Zeile (slot: in einer Tabellenzeile die wievielte Aufgabe). */
  function openSubtasks(body, lineIndex, slot) {
    const parsed = parse(body);
    const idx = indexOfLine(parsed, lineIndex, slot);
    if (idx < 0) return 0;
    return descendantIndexes(parsed, idx).filter(k => !parsed[k].done).length;
  }

  function setTasks(body, tasks, done) {
    const lines = (body || '').split('\n');
    for (const task of tasks) mark(lines, task, done);
    return lines.join('\n');
  }

  /** Schliesst die Aufgabe und alle ihre Unteraufgaben ab. */
  function completeTree(body, lineIndex, slot) {
    const parsed = parse(body);
    const idx = indexOfLine(parsed, lineIndex, slot);
    if (idx < 0) return body;
    return setTasks(body, [idx, ...descendantIndexes(parsed, idx)].map(k => parsed[k]), true);
  }

  /** Öffnet die Aufgabe wieder und mit ihr alle erledigten übergeordneten Aufgaben. Unteraufgaben bleiben. */
  function reopen(body, lineIndex, slot) {
    const parsed = parse(body);
    const idx = indexOfLine(parsed, lineIndex, slot);
    if (idx < 0) return body;
    return setTasks(body, [idx, ...ancestorIndexes(parsed, idx)].map(k => parsed[k]), false);
  }

  /** Doppelklick: Ist im Teilbaum etwas offen, wird alles abgeschlossen, sonst die Aufgabe wieder geöffnet.
   *  Gibt { body, action: 'completed' | 'reopened' } zurück. */
  function doubleClick(body, lineIndex, slot) {
    const parsed = parse(body);
    const idx = indexOfLine(parsed, lineIndex, slot);
    if (idx < 0) return { body, action: null };
    const anythingOpen = !parsed[idx].done || descendantIndexes(parsed, idx).some(k => !parsed[k].done);
    return anythingOpen ? { body: completeTree(body, lineIndex, slot), action: 'completed' } : { body: reopen(body, lineIndex, slot), action: 'reopened' };
  }

  /** Setzt das Kästchen einer Aufgabe auf erledigt/offen (slot: in einer Tabellenzeile die wievielte Aufgabe der Zeile). */
  function setDone(body, lineIndex, done, slot) {
    const lines = (body || '').split('\n');
    if (lines[lineIndex] == null) return body;
    if (slot != null) {
      const task = parse(body).find(p => p.lineIndex === lineIndex && p.slot === slot);
      if (!task) return body;
      mark(lines, task, done);
    } else {
      mark(lines, { lineIndex }, done);
    }
    return lines.join('\n');
  }

  /** Findet die Aufgabe zu einem Indexeintrag: zuerst über die Zeile, sonst über den Text. */
  function locate(body, row) {
    const parsed = parse(body);
    let found = parsed.find(p => p.lineIndex === row.line_no && p.norm === row.norm);
    if (!found) found = parsed.find(p => p.norm === row.norm);
    return found || null;
  }

  const splitDue = raw => D().splitDue(raw);
  const todayIso = () => D().todayIso();
  const formatDue = iso => D().formatDue(iso);
  const urgency = (iso, today) => D().urgency(iso, today);

  global.NoNotesTasks = {
    parse, setDone, locate, splitDue, normalize, todayIso, formatDue, urgency, TASK_RE, CELL_TASK_RE, cellTasks,
    descendantIndexes, ancestorIndexes, openSubtasks, openMessage, completeTree, reopen, doubleClick,
  };
})(typeof window !== 'undefined' ? window : globalThis);
