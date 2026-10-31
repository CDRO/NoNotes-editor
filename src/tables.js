/* NoNotes – Tabellen (v2.10.0). Markdown-Tabellen wie bei GitHub: Zeilen beginnen mit «|», unter der Kopfzeile steht die
   Trennzeile («|---|:---:|», Doppelpunkte richten die Spalte aus). Eine leere Kopfzeile heisst: keine Titelzeile. Eine Zeile
   «<!-- tabelle: {…} -->» direkt über der Tabelle trägt ihr Format als JSON; andere Markdown-Programme blenden sie aus.
   Der Kern kennt «kopfspalte» (erste Spalte als Titel) und «hervorheben» (Titel im Ton der Hauptfarbe); Erweiterungen legen
   ihre Angaben unter ihrer Kennung ab (docs/PLUGINS.md in NoNotes). Was dort in «rows», «cols» und «cells» steht (Schlüssel «2», «h»
   für die Titelzeile, «2,1»), wandert beim Einfügen und Löschen von Zeilen und Spalten mit.
   Reine Funktionen ohne Datenzugriff: lesen (splitRow, parseAt, at), schreiben (format, insert) und die Schritte des Editors
   (Feld wechseln, Zeile anfügen, Zeilen und Spalten einfügen oder löschen, Titelzeile, Format). Jeder Schritt richtet die
   senkrechten Striche neu aus und liefert { text, selStart, selEnd } wie editing.js.

   Seit v3.3.0 auch Tabellen mit Rahmen («Grid Tables» wie bei Pandoc): Rahmen und Trennlinien aus «+» und «-», unter der Titelzeile
   «+===+»; jede Zeile der Tabelle steht zwischen zwei Trennlinien und darf mehrere Textzeilen haben, ein Feld kann sich über mehrere
   Spalten ziehen. Beide Arten liefern dasselbe Modell (kind 'pipe' oder 'grid'); siehe den Abschnitt «Tabellen mit Rahmen». */
(function (global) {
  'use strict';

  const META_RE = /^\s{0,3}<!--\s*(?:tabelle|table)\s*:\s*(\{.*\})\s*-->\s*$/i;
  const ROW_RE = /^\s{0,3}\|/;
  const DELIM_RE = /^\s*:?-+:?\s*$/;

  /** Felder einer Zeile mit ihrer Lage: [{ text, from, to }], text getrimmt und wie geschrieben, from/to die Lage dieses Texts
   *  in der Zeile. «\|» trennt nicht; was nach dem letzten «|» nur Leerraum ist, ist kein Feld. */
  function rowCells(line) {
    const s = String(line);
    let i = 0;
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === '|') i++;
    const cells = [];
    const push = (a, b) => {
      while (a < b && /\s/.test(s[a])) a++;
      while (b > a && /\s/.test(s[b - 1])) b--;
      cells.push({ text: s.slice(a, b), from: a, to: b });
    };
    let start = i;
    for (; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { i++; continue; }
      if (s[i] === '|') { push(start, i); start = i + 1; }
    }
    if (s.slice(start).trim()) push(start, s.length);
    return cells;
  }

  /** Felder einer Zeile «| a | b |» → ['a', 'b'] (getrimmt, Text wie geschrieben); «\|» trennt nicht. */
  function splitRow(line) {
    return rowCells(line).map(c => c.text);
  }

  // ---------- Teile eines Felds (v2.11.0): «<br>» trennt Zeilen in einem Feld ----------

  const BR_RE = /<br\s*\/?>/gi;

  /** Teile eines Feldtexts, getrennt durch «<br>»: [{ text, from, to }] (getrimmt, Lage im Feldtext). */
  function splitParts(text) {
    const s = String(text);
    const out = [];
    const push = (a, b) => {
      while (a < b && /\s/.test(s[a])) a++;
      while (b > a && /\s/.test(s[b - 1])) b--;
      out.push({ text: s.slice(a, b), from: a, to: b });
    };
    let start = 0;
    BR_RE.lastIndex = 0;
    for (let m; (m = BR_RE.exec(s));) { push(start, m.index); start = m.index + m[0].length; }
    push(start, s.length);
    return out;
  }

  /** Alle Teile aller Felder einer Zeile: [{ cell, part, text, from }] mit from als Lage in der Zeile. Für Aufgaben, Fragen und
   *  Entscheide in Feldern (tasks.js, questions.js); höchstens cols Felder, wenn angegeben. */
  function cellParts(line, cols) {
    const out = [];
    rowCells(line).forEach((c, ci) => {
      if (cols != null && ci >= cols) return;
      splitParts(c.text).forEach((p, k) => out.push({ cell: ci, part: k, text: p.text, from: c.from + p.from }));
    });
    return out;
  }

  const isRow = line => ROW_RE.test(String(line || ''));
  const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;
  const BLOCK_OPEN_RE = /^\s*(?:(?:[-*+]|\d+[.)])\s+)?\?!?\s?```/;

  /** Für jede Zeile: steht sie in einem Codeblock («```»/«~~~»)? Dort ist «|» nur Text. Blöcke «?!``` …» bis «```» sind kein Code. */
  function codeMask(lines) {
    const mask = new Array(lines.length);
    let fence = null, block = false;
    for (let k = 0; k < lines.length; k++) {
      mask[k] = !!fence;
      const s = lines[k];
      const m = FENCE_RE.exec(s);
      if (fence) { if (m && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2].trim()) fence = null; continue; }
      if (BLOCK_OPEN_RE.test(s)) { block = true; continue; }
      if (block && /^\s*```\s*$/.test(s)) { block = false; continue; }
      if (m) fence = m[1];
    }
    return mask;
  }

  /** Steht Zeile L in einem Codeblock? */
  function inCode(lines, L) {
    return !!codeMask(lines.slice(0, L + 1))[L];
  }
  function isDelimiter(line) {
    if (!isRow(line)) return false;
    const cells = splitRow(line);
    return cells.length > 0 && cells.every(c => DELIM_RE.test(c));
  }
  const alignOf = c => { const l = c.startsWith(':'), r = c.endsWith(':'); return l && r ? 'center' : r ? 'right' : l ? 'left' : null; };

  /** Format aus der Zeile «<!-- tabelle: {…} -->» (oder null, wenn die Zeile keine gültige ist). */
  function readMeta(line) {
    const m = META_RE.exec(String(line || ''));
    if (!m) return null;
    try {
      const v = JSON.parse(m[1]);
      return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
    } catch (e) { return null; }
  }

  /** Tabelle mit der Kopfzeile in lines[i]: { start (erste Zeile, mit Format-Zeile), head, end (exklusiv), meta, metaLine,
   *  header (Felder oder null bei leerer Kopfzeile), align, rows, cols } oder null. */
  function parseAt(lines, i, hint) {
    if (isBorder(lines[i])) return parseGrid(lines, i, hint);
    if (!isRow(lines[i]) || !isDelimiter(lines[i + 1])) return null;
    const head = splitRow(lines[i]);
    const delim = splitRow(lines[i + 1]);
    if (head.length !== delim.length) return null;
    const cols = delim.length;
    const fit = cells => { const c = cells.slice(0, cols); while (c.length < cols) c.push(''); return c; };
    const rows = [];
    let j = i + 2;
    while (j < lines.length && isRow(lines[j]) && !isDelimiter(lines[j])) rows.push(fit(splitRow(lines[j++])));
    const meta = i > 0 ? readMeta(lines[i - 1]) : null;
    return {
      kind: 'pipe', start: meta ? i - 1 : i, head: i, end: j, meta: meta || {}, metaLine: meta ? i - 1 : -1,
      header: head.every(c => !c) ? null : head, align: delim.map(alignOf), rows, cols,
    };
  }

  const width = s => Array.from(String(s)).length;
  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - width(s)));

  /** Text einer Tabelle, ausgerichtet: { lines, cell(r, c) } mit r = -1 für die Kopfzeile; cell liefert { line, from, to }
   *  (Zeile in lines, Anfang und Ende des Feldinhalts in dieser Zeile). */
  function format(t) {
    if (t.kind === 'grid') return formatGrid(t);
    const cols = t.cols;
    const head = t.header || new Array(cols).fill('');
    const w = [];
    for (let c = 0; c < cols; c++) w[c] = Math.max(3, width(head[c] || ''), ...t.rows.map(r => width(r[c] || '')));
    const row = cells => '| ' + cells.map((x, c) => pad(x || '', w[c])).join(' | ') + ' |';
    const dash = (n, a) => (a === 'center' ? ':' + '-'.repeat(n - 2) + ':' : a === 'right' ? '-'.repeat(n - 1) + ':' : a === 'left' ? ':' + '-'.repeat(n - 1) : '-'.repeat(n));
    const keys = Object.keys(t.meta || {});
    const lines = [];
    if (keys.length) lines.push(`<!-- tabelle: ${JSON.stringify(t.meta)} -->`);
    const first = lines.length;
    lines.push(row(head), '| ' + w.map((n, c) => dash(n, t.align[c])).join(' | ') + ' |', ...t.rows.map(row));
    const cell = (r, c) => {
      const cells = r < 0 ? head : t.rows[r];
      let from = 2;
      for (let k = 0; k < c; k++) from += w[k] + 3;
      return { line: first + (r < 0 ? 0 : 2 + r), from, to: from + width(cells[c] || '') };
    };
    return { lines, cell };
  }

  // ---------- Tabellen mit Rahmen (v3.3.0, wie die «Grid Tables» von Pandoc) ----------
  //
  //   +----------+-------------+        Rahmen und Trennlinien aus «+» und «-», unter der Titelzeile «=»; «:» darin richtet die Spalte
  //   | Name     | Aufgaben    |        aus (ohne Titelzeile in der obersten Linie). Zwischen zwei Trennlinien steht eine Zeile der
  //   +==========+=============+        Tabelle, so viele Textzeilen hoch wie nötig: jede Textzeile eines Felds ist ein Teil (wie «<br>»
  //   | Anna     | [ ] Offerte |        in einfachen Tabellen). Ein Feld über mehrere Spalten hat dort keinen «|».
  //   |          | [ ] Termin  |
  //   +----------+-------------+        Gelesen wird nachsichtig: die Felder ergeben sich aus den «|» einer Textzeile; nur wenn eine
  //   | über beide Spalten     |        Zeile weniger Felder als Spalten hat, entscheidet die Lage der «|» zu den «+», welche Spalten
  //   +------------------------+        ein Feld umfasst. Auch «| --- | --- |» unter der Titelzeile gilt als deren Trennlinie.
  //
  // Modell wie bei einfachen Tabellen, dazu kind 'grid' und spans: { h, rows } je Spalte die Zahl der Spalten des Felds, das dort
  // beginnt (0: von einem Feld links überdeckt; dort steht ''). Der Text eines Felds sind seine Textzeilen, verbunden mit «<br>»
  // (leere am Ende fallen weg). Beim Lesen kommen frags (Lage jeder Textzeile eines Felds) und lineRows (Textzeilen je Zeile) dazu.

  const BORDER_RE = /^\s{0,3}\+(?:[-=: ]*[-=][-=: ]*\+)+\s*$/;
  const isBorder = line => BORDER_RE.test(String(line == null ? '' : line));
  /** Beginnt hier eine Tabelle oder gehört die Zeile zu einer (Zeile mit «|» oder Rahmen)? */
  const isTableLine = line => isRow(line) || isBorder(line);
  /** Enthält der Text eine Tabelle mit Rahmen (eine Randlinie neben einer Zeile mit «|»)? Für die Schrift des Editors. */
  function hasGrid(text) {
    const s = String(text || '');
    if (!/^\s{0,3}\+[-=: ]*[-=]/m.test(s)) return false;
    const lines = s.split('\n');
    return lines.some((l, i) => isBorder(l) && (isRow(lines[i + 1] || '') || isRow(lines[i - 1] || '')));
  }
  const ones = n => new Array(n).fill(1);
  const startCols = spans => spans.reduce((a, sp, c) => (sp > 0 ? a.concat(c) : a), []);
  const startOf = (spans, c) => { let s = Math.min(c, spans.length - 1); while (s > 0 && !spans[s]) s--; return s; };
  const spanWidth = (w, c, n) => { let x = 3 * (n - 1); for (let k = c; k < c + n; k++) x += w[k]; return x; };

  /** Spannen je Spalte prüfen: jedes Feld beginnt mit einer Zahl ≥ 1, danach so viele Nullen; sonst jede Spalte für sich. */
  function normSpans(spans, cols) {
    if (!Array.isArray(spans) || spans.length !== cols || !(spans[0] > 0)) return ones(cols);
    for (let c = 0; c < cols;) {
      const n = spans[c];
      if (!(n >= 1) || c + n > cols) return ones(cols);
      for (let k = c + 1; k < c + n; k++) if (spans[k] !== 0) return ones(cols);
      c += n;
    }
    return spans.slice();
  }

  /** Lage der Spaltengrenzen in einer Trennlinie, in Zeichen: die «+» eines Rahmens oder die «|» von «| --- | --- |»; dazu die
   *  Abschnitte dazwischen (für «:»). */
  function borderInfo(line) {
    const plus = [], segs = [];
    const mark = isBorder(line) ? '+' : '|';
    let c = 0, seg = null;
    for (const ch of String(line)) {
      if (ch === mark) { if (seg != null) segs.push(seg); seg = ''; plus.push(c); } else if (seg != null) seg += ch;
      c++;
    }
    return { plus, segs };
  }

  /** Lage der «|» einer Zeile in Zeichen (Code-Punkten); «\|» zählt nicht (wie rowCells). */
  function pipesAt(line) {
    const chars = Array.from(String(line));
    const out = [];
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === '\\' && chars[i + 1] === '|') { i++; continue; }
      if (chars[i] === '|') out.push(i);
    }
    return out;
  }

  /** Welche Spalten die Felder einer Textzeile umfassen: die «|» zwischen den Feldern (seps, in Zeichen) auf die Spaltengrenzen
   *  (bounds) legen, die am nächsten liegen, in der richtigen Reihenfolge. { spans: je Feld die Zahl der Spalten, cost }. */
  function fitSpans(seps, bounds, cols) {
    const m = seps.length;
    if (!m) return { spans: [cols], cost: 0 };
    const cost = [], back = [];
    for (let k = 0; k < m; k++) {
      cost.push(new Array(cols).fill(Infinity));
      back.push(new Array(cols).fill(-1));
      for (let b = k + 1; b <= cols - (m - k); b++) {
        const d = Math.abs(bounds[b] - seps[k]);
        if (k === 0) { cost[k][b] = d; continue; }
        for (let p = k; p < b; p++) if (cost[k - 1][p] + d < cost[k][b]) { cost[k][b] = cost[k - 1][p] + d; back[k][b] = p; }
      }
    }
    let b = -1, best = Infinity;
    for (let x = 1; x < cols; x++) if (cost[m - 1][x] < best) { best = cost[m - 1][x]; b = x; }
    const at = [];
    for (let k = m - 1; k >= 0; k--) { at.unshift(b); b = back[k][b]; }
    const edges = [0, ...at, cols];
    return { spans: edges.slice(1).map((e, k) => e - edges[k]), cost: best };
  }

  /** Spannen je Feld ([3, 1]) → je Spalte ([3, 0, 0, 1]). */
  function toColSpans(list, cols) {
    const out = new Array(cols).fill(0);
    let c = 0;
    for (const n of list) { out[c] = n; c += n; }
    return out;
  }

  const isGridDelimiter = line => isRow(line) && isDelimiter(line);

  /** Tabelle mit Rahmen, deren oberste Linie lines[i] ist (oder null). hint: eine vorher gelesene Fassung derselben Tabelle; stimmt die
   *  Zahl der Felder einer Zeile, gelten ihre Spannen (beim Tippen verschieben sich die «|», bis neu ausgerichtet wird). */
  function parseGrid(lines, i, hint) {
    if (!isBorder(lines[i])) return null;
    const borders = [i];
    const heads = new Set();
    const blocks = [];
    let cur = null;
    let k = i + 1;
    for (; k < lines.length; k++) {
      const line = lines[k];
      const delim = cur && isGridDelimiter(line);
      if (isBorder(line) || delim) {
        if (cur) { blocks.push(cur); cur = null; }
        borders.push(k);
        if (delim || String(line).includes('=')) heads.add(k);
        continue;
      }
      if (isRow(line)) { if (!cur) cur = { lines: [] }; cur.lines.push(k); continue; }
      break;
    }
    const open = !!cur;
    if (cur) blocks.push(cur);
    if (!blocks.length) return null;
    const end = open ? k : borders[borders.length - 1] + 1;

    // Spaltengrenzen: die Trennlinie mit den meisten «+»
    let bounds = [];
    for (const b of borders) { const p = borderInfo(lines[b]).plus; if (p.length > bounds.length) bounds = p; }
    const cols = bounds.length - 1;
    if (cols < 1) return null;
    const lastOf = bl => bl.lines[bl.lines.length - 1];
    const below0 = borders.find(b => b > lastOf(blocks[0]));
    const hasHeader = below0 != null && heads.has(below0);
    const ab = borderInfo(lines[hasHeader ? below0 : i]);
    const align = ab.segs.length === cols ? ab.segs.map(sg => alignOf(sg.trim().replace(/=/g, '-'))) : new Array(cols).fill(null);

    const readRow = (bl, hintSpans) => {
      const infos = bl.lines.map(L => ({ L, cells: rowCells(lines[L]), pipes: pipesAt(lines[L]) }));
      // Zahl der Felder: die häufigste unter den Textzeilen (bei Gleichstand die der ersten)
      const counts = new Map();
      for (const x of infos) counts.set(x.cells.length, (counts.get(x.cells.length) || 0) + 1);
      let n = 0, top = 0;
      for (const [cnt, f] of counts) if (f > top) { n = cnt; top = f; }
      n = Math.max(1, Math.min(cols, n));
      let spans;
      const hinted = hintSpans ? normSpans(hintSpans, cols) : null;
      if (hinted && startCols(hinted).length === n) spans = hinted;
      else if (n >= cols) spans = ones(cols);
      else {
        let fit = null;
        for (const x of infos) {
          if (x.cells.length !== n || x.pipes.length < n) continue;
          const f = fitSpans(x.pipes.slice(1, n), bounds, cols);
          if (!fit || f.cost < fit.cost) fit = f;
        }
        spans = toColSpans(fit ? fit.spans : [cols - n + 1, ...ones(n - 1)], cols);
      }
      const starts = startCols(spans);
      const texts = new Array(cols).fill('');
      const frags = new Array(cols).fill(null);
      starts.forEach((c, q) => {
        const list = infos.map(x => {
          let cell = x.cells[q];
          if (cell && q === starts.length - 1 && x.cells.length > starts.length) {
            // mehr «|» als Felder: der Rest gehört ins letzte Feld, das «|» darin gilt als Text
            const rest = x.cells.slice(q);
            cell = { text: rest.map(cc => cc.text).join(' \\| '), from: rest[0].from, to: rest[rest.length - 1].to };
          }
          return cell ? { line: x.L, text: cell.text, from: cell.from, to: cell.to } : { line: x.L, text: '', from: null, to: null };
        });
        let len = list.length;
        while (len > 1 && !list[len - 1].text) len--;
        frags[c] = list.slice(0, len);
        texts[c] = len === 1 && !list[0].text ? '' : list.slice(0, len).map(f => f.text).join('<br>');
      });
      return { texts, spans, frags, lines: bl.lines };
    };

    const hs = hint && hint.kind === 'grid' && hint.spans ? hint.spans : null;
    const bodyBlocks = hasHeader ? blocks.slice(1) : blocks;
    const h = hasHeader ? readRow(blocks[0], hs && hs.h) : null;
    const sameRows = hs && hs.rows && hs.rows.length === bodyBlocks.length;
    const body = bodyBlocks.map((bl, r) => readRow(bl, sameRows ? hs.rows[r] : null));
    const meta = i > 0 ? readMeta(lines[i - 1]) : null;
    return {
      kind: 'grid', start: meta ? i - 1 : i, head: i, end, meta: meta || {}, metaLine: meta ? i - 1 : -1,
      header: h ? h.texts : null, align, rows: body.map(b => b.texts), cols,
      spans: { h: h ? h.spans : null, rows: body.map(b => b.spans) },
      frags: { h: h ? h.frags : null, rows: body.map(b => b.frags) },
      lineRows: { h: h ? h.lines : null, rows: body.map(b => b.lines) },
    };
  }

  /** Textzeilen eines Felds aus seinem Text (Teile mit «<br>»), getrimmt; ein «|» darin wird zu «\|». */
  function cellLinesOf(text) {
    const esc = x => x.replace(/(^|[^\\])\|/g, '$1\\|').replace(/(^|[^\\])\|/g, '$1\\|');
    return text ? String(text).split(/<br\s*\/?>/i).map(x => esc(x.trim())) : [''];
  }

  /** Text einer Tabelle mit Rahmen, ausgerichtet: { lines, cell(r, c, k) } mit r = -1 für die Titelzeile, k der Textzeile im Feld. */
  function formatGrid(t) {
    const cols = t.cols;
    const spans = t.spans || {};
    const rowsAll = [];
    if (t.header) rowsAll.push({ r: -1, texts: t.header, spans: normSpans(spans.h, cols) });
    t.rows.forEach((texts, r) => rowsAll.push({ r, texts, spans: normSpans(spans.rows && spans.rows[r], cols) }));
    if (!rowsAll.length) rowsAll.push({ r: 0, texts: new Array(cols).fill(''), spans: ones(cols) });
    for (const row of rowsAll) row.cells = row.spans.map((n, c) => (n > 0 ? cellLinesOf(row.texts[c]) : null));
    const w = ones(cols).map(() => 3);
    for (const row of rowsAll) row.spans.forEach((n, c) => { if (n === 1) w[c] = Math.max(w[c], ...row.cells[c].map(width)); });
    // Felder über mehrere Spalten: reicht die Breite nicht, wird die letzte ihrer Spalten breiter
    for (const row of rowsAll) row.spans.forEach((n, c) => {
      if (n > 1) { const need = Math.max(...row.cells[c].map(width)); const have = spanWidth(w, c, n); if (need > have) w[c + n - 1] += need - have; }
    });
    const starts = sp => b => sp && sp[b] > 0;
    // Pandoc setzt «+» dort, wo darüber oder darunter ein Feld beginnt
    const border = (above, below, ch, withAlign) => {
      let line = '+';
      for (let c = 0; c < cols; c++) {
        let seg = ch.repeat(w[c] + 2);
        const a = withAlign ? t.align[c] : null;
        if (a === 'left' || a === 'center') seg = ':' + seg.slice(1);
        if (a === 'right' || a === 'center') seg = seg.slice(0, -1) + ':';
        line += seg + (c === cols - 1 ? '+' : starts(above)(c + 1) || starts(below)(c + 1) ? '+' : ch);
      }
      return line;
    };
    const lines = [];
    if (Object.keys(t.meta || {}).length) lines.push(`<!-- tabelle: ${JSON.stringify(t.meta)} -->`);
    const where = new Map();
    lines.push(border(null, rowsAll[0].spans, '-', !t.header));
    rowsAll.forEach((row, idx) => {
      const height = Math.max(1, ...row.cells.filter(Boolean).map(x => x.length));
      for (let k = 0; k < height; k++) {
        let line = '|';
        for (let c = 0; c < cols; c++) {
          const n = row.spans[c];
          if (!n) continue;
          const text = row.cells[c][k] || '';
          where.set(`${row.r},${c},${k}`, { line: lines.length, from: line.length + 1, to: line.length + 1 + text.length });
          line += ' ' + pad(text, spanWidth(w, c, n)) + ' |';
        }
        lines.push(line);
      }
      row.height = height;
      const next = rowsAll[idx + 1];
      lines.push(border(row.spans, next ? next.spans : null, row.r === -1 ? '=' : '-', row.r === -1));
    });
    const cell = (r, c, k) => {
      const row = rowsAll.find(x => x.r === r) || rowsAll[0];
      const s = startOf(row.spans, Math.max(0, Math.min(cols - 1, c)));
      const kk = Math.max(0, Math.min(row.height - 1, k || 0));
      return where.get(`${row.r},${s},${kk}`);
    };
    return { lines, cell };
  }

  /** Text eines Felds mit Teilen (Text mit «<br>») und Stelle darin → Textzeile k im Feld und Stelle in ihr (getrimmt). */
  function lineOffset(value, offset) {
    const re = /<br\s*\/?>/gi;
    let k = 0, from = 0, m;
    while ((m = re.exec(value)) && m.index + m[0].length <= offset) { k++; from = m.index + m[0].length; }
    re.lastIndex = from;
    const next = re.exec(value);
    const raw = value.slice(from, next ? next.index : value.length);
    const lead = raw.length - raw.trimStart().length;
    return { k, off: Math.max(0, Math.min(raw.trim().length, offset - from - lead)) };
  }

  /** Felder einer Tabelle mit ihren Teilen und deren Lage im Text (lines: die Zeilen, aus denen t gelesen wurde):
   *  [{ r ('h' für die Titelzeile, sonst die Zeile), c (erste Spalte), span, index (das wievielte Feld seiner Textzeile), text,
   *  parts: [{ text, line, from }] }], nach Zeilen, dann Spalten. Teile trennt «<br>», bei Tabellen mit Rahmen auch die Textzeile. */
  function cellsOf(t, lines) {
    const out = [];
    if (t.kind === 'grid') {
      const row = (r, texts, spans, frags) => {
        let index = 0;
        spans.forEach((n, c) => {
          if (!n) return;
          const parts = [];
          for (const f of frags[c] || []) {
            if (f.from == null) { parts.push({ text: '', line: f.line, from: null }); continue; }
            for (const p of splitParts(f.text)) parts.push({ text: p.text, line: f.line, from: f.from + p.from });
          }
          out.push({ r, c, span: n, index: index++, text: texts[c], parts });
        });
      };
      if (t.header && t.frags) row('h', t.header, t.spans.h, t.frags.h);
      if (t.frags) t.rows.forEach((texts, r) => row(r, texts, t.spans.rows[r], t.frags.rows[r]));
      return out;
    }
    const row = (r, L) => rowCells(lines[L] || '').slice(0, t.cols).forEach((cell, c) => out.push({
      r, c, span: 1, index: c, text: cell.text, parts: splitParts(cell.text).map(p => ({ text: p.text, line: L, from: cell.from + p.from })),
    }));
    if (t.header) row('h', t.head);
    t.rows.forEach((_, r) => row(r, t.head + 2 + r));
    return out;
  }

  // ---------- Text und Positionen ----------

  function linesOf(text) { return String(text).split('\n'); }
  function offsets(lines) { const o = []; let p = 0; for (const l of lines) { o.push(p); p += l.length + 1; } return o; }
  function lineAt(starts, pos) { let k = 0; while (k + 1 < starts.length && starts[k + 1] <= pos) k++; return k; }

  /** Tabelle, die in Zeile line (0-basiert) beginnt: mit der Format-Zeile oder, ohne sie, mit der Kopfzeile. Oder null.
   *  Diese erste Zeile bleibt, wo sie ist, wenn das Format dazukommt oder wegfällt. */
  function tableAtLine(text, line) {
    const lines = linesOf(text);
    const t = readMeta(lines[line]) ? parseAt(lines, line + 1) : parseAt(lines, line);
    return t ? { lines, t } : null;
  }

  // ---------- Angaben der Erweiterungen je Zeile, Spalte und Feld ----------

  const isMap = v => v && typeof v === 'object' && !Array.isArray(v);
  const CELL_KEY = /^(\d+|h),(\d+)$/;
  function rekey(obj, fn) {
    if (!isMap(obj)) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) { const nk = fn(k); if (nk != null) out[nk] = v; }
    return out;
  }
  function eachPluginMeta(meta, fn) { for (const v of Object.values(meta || {})) if (isMap(v)) fn(v); }

  /** Zeilen (kind 'row') oder Spalten ('col') ab Nummer at um delta verschieben; mit delta < 0 fällt at weg. */
  function shift(meta, kind, at, delta) {
    const idx = k => {
      if (!/^\d+$/.test(k)) return k;
      const n = Number(k);
      if (n < at) return k;
      return delta < 0 && n === at ? null : String(n + delta);
    };
    eachPluginMeta(meta, ns => {
      if (kind === 'row') ns.rows = rekey(ns.rows, idx);
      else ns.cols = rekey(ns.cols, idx);
      ns.cells = rekey(ns.cells, k => {
        const m = CELL_KEY.exec(k);
        if (!m) return k;
        const r = kind === 'row' ? idx(m[1]) : m[1], c = kind === 'col' ? idx(m[2]) : m[2];
        return r == null || c == null ? null : `${r},${c}`;
      });
    });
  }

  /** Titelzeile aus (on false: «h» wird zu Zeile 0, die anderen rücken nach) oder an (Zeile 0 wird zu «h»). */
  function swapHeader(meta, on) {
    if (!on) shift(meta, 'row', 0, 1);
    const from = on ? '0' : 'h', to = on ? 'h' : '0';
    eachPluginMeta(meta, ns => {
      ns.rows = rekey(ns.rows, k => (k === from ? to : k === to ? null : k));
      ns.cells = rekey(ns.cells, k => { const m = CELL_KEY.exec(k); return !m ? k : m[1] === from ? `${to},${m[2]}` : m[1] === to ? null : k; });
    });
    if (on) shift(meta, 'row', 0, -1); // «0» ist schon «h», die übrigen rücken auf
  }

  /** Tabelle, zu der Zeile L gehört (einfach oder mit Rahmen), oder null. Mehrere Tabellen ohne Leerzeile dazwischen: die passende. */
  function tableAround(lines, L, hint) {
    if (!isTableLine(lines[L]) || inCode(lines, L)) return null;
    let h = L;
    while (h > 0 && isTableLine(lines[h - 1])) h--;
    for (let k = h; k <= L;) {
      const t = parseAt(lines, k, hint);
      if (!t) { k++; continue; }
      if (L < t.end) return L >= t.head ? t : null;
      k = t.end;
    }
    return null;
  }

  /** Tabelle am Cursor: { lines, t, row (-1 Kopf, -2 Trennzeile oder Rahmen, 0.. Zeile), col (erste Spalte des Felds), k (Textzeile im
   *  Feld), line } oder null. */
  function at(text, pos, hint) {
    const lines = linesOf(text);
    const starts = offsets(lines);
    const L = lineAt(starts, pos);
    const t = tableAround(lines, L, hint);
    if (!t) return null;
    const before = lines[L].slice(0, pos - starts[L]);
    const seps = (before.match(/(?<!\\)\|/g) || []).length;
    if (t.kind === 'grid') {
      let row = -2, k = 0;
      if (t.lineRows.h && t.lineRows.h.includes(L)) { row = -1; k = t.lineRows.h.indexOf(L); }
      t.lineRows.rows.forEach((ls, r) => { const j = ls.indexOf(L); if (j >= 0) { row = r; k = j; } });
      let col = 0;
      if (row !== -2) {
        const list = startCols(row === -1 ? t.spans.h : t.spans.rows[row]);
        col = list[Math.max(0, Math.min(list.length - 1, seps - 1))];
      }
      return { lines, t, row, col, k, line: L };
    }
    const row = L === t.head ? -1 : L === t.head + 1 ? -2 : L - t.head - 2;
    const col = Math.max(0, Math.min(t.cols - 1, seps - 1));
    return { lines, t, row, col, k: 0, line: L };
  }

  /** Richtet die Tabelle neu aus, in der Zeile lineIndex steht (nach einer Änderung an einem Feld); sonst bleibt der Text. */
  function realign(text, lineIndex) {
    const lines = linesOf(text);
    const a = at(text, offsets(lines)[lineIndex] || 0);
    if (!a) return text;
    return [...lines.slice(0, a.t.start), ...format(a.t).lines, ...lines.slice(a.t.end)].join('\n');
  }

  /** Ersetzt die Tabelle t in lines durch ihren neuen Stand und setzt die Auswahl ins Feld (r, c) – bei Tabellen mit Rahmen in dessen
   *  Textzeile k –, ganz (select) oder an den Anfang. */
  function replace(lines, t, r, c, select, k) {
    const f = format(t);
    const out = [...lines.slice(0, t.start), ...f.lines, ...lines.slice(t.end)];
    const starts = offsets(out);
    const pos = f.cell(r, c, k || 0);
    const base = starts[t.start + pos.line];
    return { text: out.join('\n'), selStart: base + pos.from, selEnd: base + (select ? pos.to : pos.from) };
  }

  const emptyRow = t => new Array(t.cols).fill('');
  const copy = t => Object.assign({}, t, {
    meta: JSON.parse(JSON.stringify(t.meta || {})), header: t.header && t.header.slice(), align: t.align.slice(), rows: t.rows.map(r => r.slice()),
    spans: t.spans ? { h: t.spans.h ? t.spans.h.slice() : null, rows: t.spans.rows.map(x => x.slice()) } : undefined,
  });
  /** Leere Zeile an Stelle i (Spannen 1 bei Tabellen mit Rahmen). */
  function addRow(t, i) {
    t.rows.splice(i, 0, emptyRow(t));
    if (t.spans) t.spans.rows.splice(i, 0, ones(t.cols));
  }
  function removeRow(t, i) {
    t.rows.splice(i, 1);
    if (t.spans) t.spans.rows.splice(i, 1);
  }
  const rowSpans = (t, r) => (t.spans ? normSpans(r < 0 ? t.spans.h : t.spans.rows[r], t.cols) : ones(t.cols));

  // ---------- Schritte im Editor ----------

  /** Tab (dir 1) und Umschalt+Tab (dir -1): ins nächste oder vorige Feld, Inhalt markiert (bei Tabellen mit Rahmen die erste Textzeile).
   *  Hinter dem letzten Feld kommt eine neue Zeile dazu. Ohne Titelzeile wird die (leere) Kopfzeile übersprungen. null ausserhalb. */
  function move(text, pos, dir) {
    const a = at(text, pos);
    if (!a) return null;
    const t = copy(a.t);
    const order = [];
    if (t.header) for (const c of startCols(rowSpans(t, -1))) order.push([-1, c]);
    for (let r = 0; r < t.rows.length; r++) for (const c of startCols(rowSpans(t, r))) order.push([r, c]);
    let row = a.row;
    if (row === -2) {
      if (t.kind === 'grid') {
        // auf einer Trennlinie: wie in der Zeile darunter (vorwärts) oder darüber (rückwärts)
        const firstLines = [t.header ? a.t.lineRows.h[0] : null, ...a.t.lineRows.rows.map(ls => ls[0])];
        const idx = firstLines.findIndex(L => L != null && L > a.line);
        const below = idx < 0 ? null : idx === 0 ? -1 : idx - 1;
        if (dir > 0) { if (below == null) { addRow(t, t.rows.length); return replace(a.lines, t, t.rows.length - 1, 0, false); } return replace(a.lines, t, below, 0, true); }
        const aboveRow = below == null ? t.rows.length - 1 : below - 1;
        if (aboveRow < -1 || (aboveRow === -1 && !t.header)) return replace(a.lines, t, t.header ? -1 : 0, 0, true);
        const cs = startCols(rowSpans(t, aboveRow));
        return replace(a.lines, t, aboveRow, cs[cs.length - 1], true);
      }
      row = -1; // in der Trennzeile wie im Kopf
    }
    let k = order.findIndex(([r, c]) => r === row && c === a.col);
    if (k < 0) k = dir > 0 ? -1 : 0;
    let next = k + dir;
    if (next >= order.length) { addRow(t, t.rows.length); return replace(a.lines, t, t.rows.length - 1, 0, false); }
    if (next < 0) next = 0;
    const [r, c] = order[next];
    return replace(a.lines, t, r, c, true);
  }

  /** Letzte Zeile entfernen und den Cursor eine Leerzeile unter die Tabelle setzen (die Tabelle endet). Die Leerzeile braucht es, sonst
   *  wäre der nächste Text nach GitHub-Markdown eine weitere Zeile der Tabelle; folgt Text, steht auch vor ihm eine. */
  function leave(a, t) {
    const last = t.rows.length - 1;
    removeRow(t, last);
    shift(t.meta, 'row', last, -1);
    const f = format(t);
    const after = a.lines.slice(a.t.end);
    let k = 0;
    while (k < after.length && !after[k].trim()) k++;
    const need = k < after.length ? 3 : 2; // Leerzeile, Zeile für den Cursor, (Leerzeile vor dem Text)
    const blanks = after.slice(0, k).concat(new Array(Math.max(0, need - k)).fill(''));
    const out = [...a.lines.slice(0, a.t.start), ...f.lines, ...blanks, ...after.slice(k)];
    const caret = offsets(out)[a.t.start + f.lines.length + 1];
    return { text: out.join('\n'), selStart: caret, selEnd: caret };
  }

  /** Neue Zeile der Tabelle unter der aktuellen (in der Kopf- oder Trennzeile als erste Zeile); in einer leeren letzten Zeile endet
   *  die Tabelle. Bei einfachen Tabellen Enter, bei beiden Strg+Enter. null ausserhalb einer Tabelle. */
  function newRow(text, pos) {
    const a = at(text, pos);
    if (!a) return null;
    const t = copy(a.t);
    const last = t.rows.length - 1;
    if (a.row >= 0 && a.row === last && t.rows[last].every(x => !x)) return leave(a, t);
    let at0 = a.row < 0 ? 0 : a.row + 1;
    if (a.row === -2 && t.kind === 'grid') {
      const firstLines = a.t.lineRows.rows.map(ls => ls[0]);
      at0 = firstLines.findIndex(L => L > a.line);
      if (at0 < 0) at0 = t.rows.length;
    }
    addRow(t, at0);
    shift(t.meta, 'row', at0, 1);
    return replace(a.lines, t, at0, 0, false);
  }

  /** Enter in einer Tabelle: einfache Tabelle – neue Zeile (wie newRow); mit Rahmen – neue Textzeile im Feld an der Stelle des Cursors
   *  (auf einer Trennlinie eine neue Zeile der Tabelle, auf der untersten nichts: dort geht es normal weiter). */
  function enter(text, pos) {
    const a = at(text, pos);
    if (!a) return null;
    if (a.t.kind !== 'grid') return newRow(text, pos);
    if (a.row === -2) return a.line === a.t.end - 1 ? null : newRow(text, pos);
    return lineBreak(text, pos);
  }

  /** Feld und Stelle des Cursors: { a, r, c, offset, text } – text der ganze Feldtext (Teile mit «<br>», bei Tabellen mit Rahmen die
   *  Textzeilen bis mindestens zu der des Cursors), offset die Stelle darin. null in Trennzeilen und ausserhalb. */
  function cellAt(text, pos, hint) {
    const a = at(text, pos, hint);
    if (!a || a.row === -2) return null;
    const starts = offsets(a.lines);
    const col = pos - starts[a.line];
    if (a.t.kind === 'grid') {
      const frs = (a.row === -1 ? a.t.frags.h : a.t.frags.rows[a.row])[a.col] || [];
      const blockLines = a.row === -1 ? a.t.lineRows.h : a.t.lineRows.rows[a.row];
      const list = blockLines.map((L, j) => frs[j] || { line: L, text: '', from: null, to: null });
      const upto = Math.max(frs.length, a.k + 1);
      const texts = list.slice(0, upto).map(f => f.text);
      const cur = list[a.k];
      const within = cur.from == null ? 0 : Math.max(0, Math.min(cur.text.length, col - cur.from));
      let offset = within;
      for (let j = 0; j < a.k; j++) offset += texts[j].length + 4;
      return { a, r: a.row, c: a.col, offset, text: texts.join('<br>') };
    }
    const cells = rowCells(a.lines[a.line]);
    const c = Math.min(a.col, a.t.cols - 1);
    const cell = cells[c] || { text: '', from: col, to: col };
    const offset = Math.max(0, Math.min(cell.text.length, col - cell.from));
    return { a, r: a.row, c, offset, text: cell.text };
  }

  /** Text des Felds (r, c) ersetzen, Tabelle ausrichten, Cursor an offset im neuen Feldtext. */
  function withCell(at0, value, offset) {
    const t = copy(at0.a.t);
    if (at0.r < 0) { if (!t.header) return null; t.header[at0.c] = value; } else t.rows[at0.r][at0.c] = value;
    if (t.kind === 'grid') {
      const { k, off } = lineOffset(value, offset);
      const r = replace(at0.a.lines, t, at0.r, at0.c, false, k);
      r.selStart += off;
      r.selEnd = r.selStart;
      return r;
    }
    const r = replace(at0.a.lines, t, at0.r, at0.c, false);
    r.selStart += offset;
    r.selEnd = r.selStart;
    return r;
  }

  /** Umschalt+Enter in einem Feld: eine neue Zeile im Feld an der Stelle des Cursors («<br>»; in Tabellen mit Rahmen eine neue
   *  Textzeile). null ausserhalb einer Tabelle. */
  function lineBreak(text, pos) {
    const at0 = cellAt(text, pos);
    if (!at0 || (at0.r < 0 && !at0.a.t.header)) return null;
    return withCell(at0, at0.text.slice(0, at0.offset) + '<br>' + at0.text.slice(at0.offset), at0.offset + 4);
  }

  /** Rücktaste (dir -1) am Anfang einer Textzeile im Feld und Entf (dir 1) an ihrem Ende, in Tabellen mit Rahmen: die Textzeile wird mit
   *  der davor oder danach im selben Feld verbunden; an der ersten oder letzten Zeile des Felds geschieht nichts (der Rahmen bleibt
   *  heil). null, wenn die Taste normal wirken soll (mitten im Text, einfache Tabelle, ausserhalb). */
  function joinLine(text, pos, dir) {
    const at0 = cellAt(text, pos);
    if (!at0 || at0.a.t.kind !== 'grid') {
      const a = !at0 && at(text, pos);
      if (a && a.t.kind === 'grid') return { text, selStart: pos, selEnd: pos }; // auf einer Trennlinie: nichts löschen
      return null;
    }
    const value = at0.text;
    const re = /<br\s*\/?>/gi;
    const marks = [];
    for (let m; (m = re.exec(value));) marks.push({ from: m.index, to: m.index + m[0].length });
    const k = marks.filter(m => m.to <= at0.offset).length;
    const lineFrom = k ? marks[k - 1].to : 0;
    const lineTo = k < marks.length ? marks[k].from : value.length;
    if (dir < 0 && at0.offset > lineFrom) return null;
    if (dir > 0 && at0.offset < lineTo) return null;
    if (dir < 0 && k === 0) return { text, selStart: pos, selEnd: pos };
    if (dir > 0 && k >= marks.length) return { text, selStart: pos, selEnd: pos };
    const m = dir < 0 ? marks[k - 1] : marks[k];
    return withCell(at0, value.slice(0, m.from) + value.slice(m.to), m.from);
  }

  const SPACE_MARK = '';

  /** Nach einer Eingabe in einer Tabelle mit Rahmen (prev: der Text davor, pos: Cursor danach): die «|» bleiben untereinander. Ist im
   *  Feld noch Platz, nimmt der Zwischenraum vor dem nächsten «|» auf, was hinzukam oder wegfiel; sonst wird die Tabelle neu
   *  ausgerichtet (mit den Spannen von vorher, getippte Leerzeichen vor dem Cursor bleiben). Ein getipptes «|» wird zu «\|».
   *  { text, selStart, selEnd } oder null, wenn nichts zu tun ist. */
  function typed(prev, text, pos) {
    const from = text.lastIndexOf('\n', pos - 1) + 1;
    if (!ROW_RE.test(text.slice(from, from + 8))) return null; // nur in Zeilen mit «|» (schnell, bei jeder Eingabe)
    const lines = linesOf(text);
    const before = linesOf(prev);
    if (lines.length !== before.length) return null;
    const starts = offsets(lines);
    const L = lineAt(starts, pos);
    const old = before[L];
    let line = lines[L];
    if (line === old || !ROW_RE.test(line) || !ROW_RE.test(old)) return null;
    const oldTable = tableAround(before, L);
    if (!oldTable || oldTable.kind !== 'grid') return null;
    let caret = pos - starts[L];
    // was hinzukam (zwischen gleichem Anfang und gleichem Ende): ein «|» darin gilt als Text
    let p = 0;
    while (p < old.length && p < line.length && old[p] === line[p]) p++;
    let q = 0;
    while (q < old.length - p && q < line.length - p && old[old.length - 1 - q] === line[line.length - 1 - q]) q++;
    const added = line.slice(p, line.length - q);
    if (added.includes('|')) {
      let fixed = '';
      for (let i = 0; i < added.length; i++) fixed += added[i] === '|' && (i ? added[i - 1] : line[p - 1]) !== '\\' ? '\\|' : added[i];
      line = line.slice(0, p) + fixed + line.slice(line.length - q);
      if (caret >= p) caret += fixed.length - added.length;
    }
    const done = next => {
      lines[L] = next;
      return { text: lines.join('\n'), selStart: starts[L] + caret, selEnd: starts[L] + caret };
    };
    const d = Array.from(line).length - Array.from(old).length;
    let next = -1;
    for (let i = caret; i < line.length; i++) {
      if (line[i] === '\\' && line[i + 1] === '|') { i++; continue; }
      if (line[i] === '|') { next = i; break; }
    }
    if (next > 0) {
      let sp = 0;
      while (next - 1 - sp >= caret && line[next - 1 - sp] === ' ') sp++;
      if (d === 0) return line === lines[L] ? null : done(line);
      if (d > 0 && sp - d >= 1) return done(line.slice(0, next - d) + line.slice(next));
      if (d < 0) return done(line.slice(0, next) + ' '.repeat(-d) + line.slice(next));
    }
    // kein Platz mehr im Feld: neu ausrichten
    lines[L] = line;
    const now = lines.join('\n');
    const at0 = cellAt(now, starts[L] + caret, oldTable);
    if (!at0) return null;
    const a = at0.a;
    let value = at0.text;
    let offset = at0.offset;
    const idx = startCols(a.row === -1 ? a.t.spans.h : a.t.spans.rows[a.row]).indexOf(a.col);
    const raw = rowCells(line)[idx];
    const gap = raw && caret > raw.to ? line.slice(raw.to, caret) : '';
    if (/^ +$/.test(gap)) {
      // Leerzeichen am Ende der Textzeile, vor dem Cursor: als Zeichen mitnehmen, damit die Ausrichtung sie nicht wegschneidet
      const parts = value.split('<br>');
      let end = 0;
      for (let j = 0; j < a.k; j++) end += parts[j].length + 4;
      end += (parts[a.k] || '').length;
      value = value.slice(0, end) + SPACE_MARK.repeat(gap.length) + value.slice(end);
      offset = end + gap.length;
    }
    const t = copy(a.t);
    if (a.row < 0) t.header[a.col] = value; else t.rows[a.row][a.col] = value;
    const f = format(t);
    const out = [...a.lines.slice(0, a.t.start), ...f.lines.map(x => x.split(SPACE_MARK).join(' ')), ...a.lines.slice(a.t.end)];
    const lo = lineOffset(value, offset);
    const cp = f.cell(a.row, a.col, lo.k);
    const caretAt = offsets(out)[a.t.start + cp.line] + cp.from + lo.off;
    return { text: out.join('\n'), selStart: caretAt, selEnd: caretAt };
  }

  /** Klick in den Zwischenraum hinter dem Text eines Felds (Tabelle mit Rahmen): die Stelle direkt hinter dem Text (in einem leeren
   *  Feld am Anfang), sonst null. */
  function snap(text, pos) {
    const a = at(text, pos);
    if (!a || a.t.kind !== 'grid' || a.row === -2) return null;
    const starts = offsets(a.lines);
    const line = a.lines[a.line];
    const col = pos - starts[a.line];
    const idx = startCols(a.row === -1 ? a.t.spans.h : a.t.spans.rows[a.row]).indexOf(a.col);
    const cell = rowCells(line)[idx];
    if (!cell) return null;
    let left = -1;
    for (let i = 0, n = -1; i < line.length; i++) {
      if (line[i] === '\\' && line[i + 1] === '|') { i++; continue; }
      if (line[i] === '|' && ++n === idx) { left = i; break; }
    }
    const target = cell.text ? cell.to : Math.min(left + 2, cell.to);
    if (left >= 0 && col < left + 2) return starts[a.line] + Math.min(left + 2, cell.text ? cell.from : target); // auf oder vor dem «|»
    return col > target ? starts[a.line] + target : null;
  }

  const PREFIXES = { task: /^\[[ xX]\]\s*/, decision: /^\?!\s?/, question: /^\?(?!!)\s?/, answer: /^!!?(?!\[)\s?/ };
  const PREFIX_TEXT = { task: '[ ] ', decision: '?! ', question: '? ', answer: '! ' };

  /** Knöpfe der Toolleiste in einem Feld (nicht in der Titelzeile): Aufgabe, Frage, Entscheid schalten das Zeichen am Anfang des Teils
   *  um, in dem der Cursor steht (ein anderes wird ersetzt); Antwort hängt einen Teil «<br>! » an (bei einem Entscheid «!! »), steht der
   *  Cursor schon in einer Antwort, fällt ihr Zeichen weg. null ausserhalb eines Felds. */
  function togglePrefix(text, pos, kind) {
    const at0 = cellAt(text, pos);
    if (!at0 || at0.r < 0 || !PREFIX_TEXT[kind]) return null;
    const parts = splitParts(at0.text);
    let k = parts.findIndex(p => at0.offset <= p.to + 4);
    if (k < 0) k = parts.length - 1;
    const part = parts[k];
    const value = at0.text;
    const has = kind => PREFIXES[kind].exec(part.text);
    if (kind === 'answer' && !has('answer')) {
      const isDecision = parts.some(p => PREFIXES.decision.test(p.text));
      const add = (value ? '<br>' : '') + (isDecision ? '!! ' : '! ');
      return withCell(at0, value + add, value.length + add.length);
    }
    const own = has(kind);
    const other = own ? null : ['task', 'decision', 'question', 'answer'].map(has).find(Boolean);
    const cut = own ? own[0].length : other ? other[0].length : 0;
    const insert = own ? '' : PREFIX_TEXT[kind];
    const next = value.slice(0, part.from) + insert + part.text.slice(cut) + value.slice(part.to);
    const caret = Math.max(part.from + insert.length, at0.offset - cut + insert.length);
    return withCell(at0, next, Math.min(caret, next.length));
  }

  /** Neue Tabelle an Stelle der Markierung: cols Spalten, rows Zeilen insgesamt (mit Titelzeile ist die erste davon der Kopf).
   *  options: { header (Titelzeile), headerColumn (Titelspalte), label(n) für die Spaltentitel, grid (mit Rahmen und mehrzeiligen
   *  Feldern, v3.3.0) }. Leerzeilen davor und danach, der erste Titel ist markiert (ohne Titelzeile steht der Cursor im ersten Feld). */
  function insert(text, s, e, cols, rows, options) {
    const o = options || {};
    cols = Math.max(1, Math.min(20, cols | 0));
    rows = Math.max(1, Math.min(50, rows | 0));
    const label = typeof o.label === 'function' ? o.label : n => `Spalte ${n}`; // i18n-ignore: Vorgabe, die App übergibt die Übersetzung
    const t = {
      kind: o.grid ? 'grid' : 'pipe',
      meta: o.headerColumn ? { kopfspalte: true } : {}, cols, align: new Array(cols).fill(null),
      header: o.header === false ? null : Array.from({ length: cols }, (_, c) => label(c + 1)),
    };
    t.rows = Array.from({ length: o.header === false ? rows : Math.max(0, rows - 1) }, () => new Array(cols).fill(''));
    if (!t.header && !t.rows.length) t.rows.push(new Array(cols).fill(''));
    if (o.grid) t.spans = { h: t.header ? ones(cols) : null, rows: t.rows.map(() => ones(cols)) };
    const f = format(t);
    const before = text.slice(0, s), after = text.slice(e);
    const pre = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const post = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    const block = f.lines.join('\n');
    const base = s + pre.length;
    const lineStarts = offsets(f.lines);
    const pos = f.cell(t.header ? -1 : 0, 0, 0);
    const from = base + lineStarts[pos.line] + pos.from, to = base + lineStarts[pos.line] + pos.to;
    return { text: before + pre + block + post + after, selStart: from, selEnd: t.header ? to : from };
  }

  // ---------- Schritte per Rechtsklick in der Vorschau (line = erste Zeile der Tabelle, siehe tableAtLine) ----------

  /** Wendet fn(t) auf die Tabelle an, die in Zeile line beginnt; fn ändert t und liefert das Feld [r, c] für den Cursor (oder
   *  nichts: der Cursor bleibt, wo er war, verschoben um die Längenänderung, wenn er hinter der Tabelle stand). */
  function change(text, line, fn, caret) {
    const found = tableAtLine(text, line);
    if (!found) return null;
    const t = copy(found.t);
    const target = fn(t);
    if (target === false) return null;
    if (target) return replace(found.lines, t, target[0], target[1], false);
    const f = format(t);
    const out = [...found.lines.slice(0, found.t.start), ...f.lines, ...found.lines.slice(found.t.end)];
    const result = out.join('\n');
    const starts = offsets(found.lines);
    const tableStart = starts[found.t.start];
    const tableEnd = found.t.end < found.lines.length ? starts[found.t.end] : text.length;
    let pos = caret == null ? tableStart : caret;
    if (pos >= tableEnd) pos += result.length - text.length;
    else if (pos > tableStart) pos = tableStart;
    return { text: result, selStart: pos, selEnd: pos };
  }

  /** Format der Tabelle ändern: fn(meta) ändert das Objekt (oder liefert ein neues). Leere Angaben fallen weg. */
  function setMeta(text, line, fn, caret) {
    return change(text, line, t => {
      const next = fn(t.meta);
      t.meta = next && typeof next === 'object' && !Array.isArray(next) ? next : t.meta;
      for (const k of Object.keys(t.meta)) if (t.meta[k] == null || t.meta[k] === false) delete t.meta[k];
      return null;
    }, caret);
  }

  /** Titelzeile ein (die erste Zeile wird zum Kopf; ohne Zeilen Spaltentitel) oder aus (der Kopf wird zur ersten Zeile). */
  function toggleHeader(text, line, label, caret) {
    return change(text, line, t => {
      const name = c => (label ? label(c + 1) : `Spalte ${c + 1}`); // i18n-ignore: Vorgabe
      if (t.header) {
        t.rows.unshift(t.header);
        if (t.spans) { t.spans.rows.unshift(normSpans(t.spans.h, t.cols)); t.spans.h = null; }
        t.header = null;
      } else if (t.rows.length) {
        const sp = rowSpans(t, 0);
        t.header = t.rows.shift().map((x, c) => (sp[c] ? x || (label ? label(c + 1) : '') : ''));
        if (t.spans) { t.spans.h = sp; t.spans.rows.shift(); }
      } else {
        t.header = Array.from({ length: t.cols }, (_, c) => name(c));
        if (t.spans) t.spans.h = ones(t.cols);
      }
      swapHeader(t.meta, !!t.header);
      return null;
    }, caret);
  }

  /** Zeile einfügen über (where 'above') oder unter ('below') der Zeile r (-1 = Kopf: als erste Zeile). Cursor ins neue Feld. */
  function insertRow(text, line, r, where) {
    return change(text, line, t => {
      const i = r < 0 ? 0 : where === 'above' ? r : r + 1;
      addRow(t, i);
      shift(t.meta, 'row', i, 1);
      return [i, 0];
    });
  }

  function deleteRow(text, line, r, caret) {
    return change(text, line, t => {
      if (r >= 0 && r < t.rows.length) { removeRow(t, r); shift(t.meta, 'row', r, -1); }
      return null;
    }, caret);
  }

  /** Spalte i in einer Zeile einfügen: liegt i mitten in einem Feld über mehrere Spalten, wird dieses breiter, sonst kommt ein leeres
   *  Feld dazu. Liefert, ob dort ein neues Feld beginnt. */
  function insertColIn(texts, spans, i) {
    if (spans && i > 0 && i < spans.length && spans[i] === 0) {
      spans[startOf(spans, i)]++;
      spans.splice(i, 0, 0);
      texts.splice(i, 0, '');
      return false;
    }
    texts.splice(i, 0, '');
    if (spans) spans.splice(i, 0, 1);
    return true;
  }

  /** Spalte c einer Zeile löschen: ein Feld über mehrere Spalten wird schmaler (sein Text bleibt), ein einfaches fällt weg. */
  function deleteColIn(texts, spans, c) {
    if (spans) {
      if (spans[c] === 0) spans[startOf(spans, c)]--;
      else if (spans[c] > 1) { spans[c + 1] = spans[c] - 1; texts[c + 1] = texts[c]; }
      spans.splice(c, 1);
    }
    texts.splice(c, 1);
  }

  /** Spalte links ('left') oder rechts ('right') von Spalte c einfügen; Cursor in den Titel der neuen Spalte (oder ins erste Feld). */
  function insertColumn(text, line, c, where, label) {
    return change(text, line, t => {
      const i = where === 'left' ? c : c + 1;
      if (t.spans) {
        t.spans.h = t.header ? rowSpans(t, -1) : null;
        t.spans.rows = t.rows.map((_, r) => rowSpans(t, r));
      }
      if (t.header && insertColIn(t.header, t.spans ? t.spans.h : null, i)) t.header[i] = label ? label(i + 1) : '';
      t.align.splice(i, 0, null);
      t.rows.forEach((row, r) => insertColIn(row, t.spans ? t.spans.rows[r] : null, i));
      t.cols++;
      shift(t.meta, 'col', i, 1);
      return t.header ? [-1, i] : t.rows.length ? [0, i] : null;
    });
  }

  function deleteColumn(text, line, c, caret) {
    return change(text, line, t => {
      if (t.cols <= 1 || c < 0 || c >= t.cols) return null;
      if (t.spans) {
        t.spans.h = t.header ? rowSpans(t, -1) : null;
        t.spans.rows = t.rows.map((_, r) => rowSpans(t, r));
      }
      if (t.header) deleteColIn(t.header, t.spans ? t.spans.h : null, c);
      t.align.splice(c, 1);
      t.rows.forEach((row, r) => deleteColIn(row, t.spans ? t.spans.rows[r] : null, c));
      t.cols--;
      shift(t.meta, 'col', c, -1);
      return null;
    }, caret);
  }

  /** Einfache Tabelle in eine mit Rahmen umwandeln (Zeilen im Feld: aus «<br>» werden Textzeilen). */
  function toGrid(t) {
    t.kind = 'grid';
    t.spans = { h: t.header ? ones(t.cols) : null, rows: t.rows.map(() => ones(t.cols)) };
  }

  /** Feld (r, c; r = -1 für die Titelzeile) mit dem rechts daneben verbinden: der Text kommt untereinander, das Feld zieht sich über
   *  beide. Eine einfache Tabelle wird dafür zu einer mit Rahmen. Cursor ins Feld. */
  function mergeRight(text, line, r, c) {
    return change(text, line, t => {
      if (t.kind !== 'grid') toGrid(t);
      const texts = r < 0 ? t.header : t.rows[r];
      if (!texts) return false;
      const spans = rowSpans(t, r);
      const s = startOf(spans, c);
      const next = s + spans[s];
      if (next >= t.cols) return false;
      texts[s] = [texts[s], texts[next]].filter(Boolean).join('<br>');
      texts[next] = '';
      spans[s] += spans[next];
      spans[next] = 0;
      if (r < 0) t.spans.h = spans; else t.spans.rows[r] = spans;
      return [r, s];
    });
  }

  /** Feld über mehrere Spalten wieder teilen: der Text bleibt im ersten. */
  function splitCell(text, line, r, c) {
    return change(text, line, t => {
      if (t.kind !== 'grid') return false;
      const spans = rowSpans(t, r);
      const s = startOf(spans, c);
      if (spans[s] < 2) return false;
      for (let k = s; k < s + spans[s]; k++) spans[k] = 1;
      if (r < 0) t.spans.h = spans; else t.spans.rows[r] = spans;
      return [r, s];
    });
  }

  /** Tabelle umwandeln: 'grid' (mit Rahmen) oder 'pipe' (einfach; verbundene Felder werden geteilt, Textzeilen im Feld zu «<br>»). */
  function convert(text, line, kind, caret) {
    return change(text, line, t => {
      if (t.kind === kind) return false;
      if (kind === 'grid') toGrid(t);
      else { t.kind = 'pipe'; delete t.spans; }
      return null;
    }, caret);
  }

  /** Text eines Felds ändern, das in Zeile lineIndex steht (bei Tabellen mit Rahmen in einer seiner Textzeilen); cellIndex ist das
   *  wievielte Feld der Textzeile. fn(text) liefert den neuen Text (Teile mit «<br>»); danach wird die Tabelle ausgerichtet.
   *  Liefert den neuen Text oder null. */
  function editCell(text, lineIndex, cellIndex, fn) {
    const lines = linesOf(text);
    const a = at(text, offsets(lines)[lineIndex] || 0);
    if (!a || a.row === -2) return null;
    const t = copy(a.t);
    const spans = rowSpans(t, a.row);
    const c = startCols(spans)[cellIndex];
    if (c == null) return null;
    const texts = a.row < 0 ? t.header : t.rows[a.row];
    if (!texts) return null;
    const next = fn(texts[c] || '');
    if (next == null) return null;
    texts[c] = next;
    return [...lines.slice(0, a.t.start), ...format(t).lines, ...lines.slice(a.t.end)].join('\n');
  }

  global.NoNotesTables = {
    META_RE, rowCells, splitRow, splitParts, cellParts, cellsOf, isRow, isBorder, isTableLine, hasGrid, isDelimiter, codeMask, inCode, realign, readMeta,
    parseAt, format, at, tableAtLine, shift, swapHeader, normSpans,
    lineBreak, togglePrefix, joinLine, typed, snap, editCell,
    move, enter, newRow, insert, setMeta, toggleHeader, insertRow, deleteRow, insertColumn, deleteColumn, mergeRight, splitCell, convert,
  };
})(window);
