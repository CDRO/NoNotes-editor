/* NoNotes – ausfüllbare Platzhalter in Vorlagen (v2.12.0, Beschluss 2026-10-27).
   Neben den automatischen Platzhaltern ({{datum}} …, templates.js) gibt es solche, die man beim Einfügen selbst ausfüllt:

     {{?Kunde}}              offen: beim Einfügen ausgewählt, Tippen ersetzt ihn, Tab springt zum nächsten
     {{?Kunde: Firma AG}}    ausgefüllt und stehen gelassen (Einstellung «Platzhalter behalten»), oder in einer Vorlage ein Vorschlag

   Gleiche Namen meinen dasselbe: einmal ausgefüllt, steht der Wert überall (auch im Titel und in den Unternotizen der Vorlage).
   Eine Beschreibung je Name steht als Block irgendwo in der Vorlage:

     ```template-description Kunde
     Firmenname wie im Handelsregister, **ohne** Rechtsform.
     ```

   Beim Einfügen wandern die Blöcke ans Ende der Notiz und bleiben dort unsichtbar (Vorschau, Druck und Export zeigen sie nicht), solange
   es Platzhalter mit diesem Namen gibt. In Code (``` … ``` und `…`) ist nichts ein Platzhalter.

   Für Aufgaben, Fragen, Personen und Termine zählt der Wert (flatten): «- [ ] Angebot @{{?Wer: anna}} @{{?Bis wann: 31.10.2026}}» ist eine
   Aufgabe für @anna bis 31.10.2026. Offene Platzhalter erscheinen dort als «[Name]». */
(function (global) {
  'use strict';

  // Ein Wert darf automatische Platzhalter enthalten: {{?Bis wann: {{datum+7}}}}
  const TOKEN_SRC = String.raw`\{\{\?([^{}:\n]+?)(?::[ \t]?((?:\{\{[^{}\n]*\}\}|[^\n])*?))?\}\}`;
  const TOKEN_RE = new RegExp(TOKEN_SRC, 'g');
  const DESC_OPEN_RE = /^[ \t]*```template-description[ \t]+(\S[^\n]*?)[ \t]*$/;
  const FENCE_RE = /^[ \t]*(```|~~~)/;
  const DESC_TAG = 'template-description';

  const clean = name => String(name || '').trim().replace(/\s+/g, ' ');
  const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

  /** Bereiche mit Code (Blöcke und `…` in der Zeile): [[von, bis)] als Zeichenpositionen. */
  function codeRanges(text) {
    const out = [];
    const lines = text.split('\n');
    let pos = 0, fence = null, start = 0;
    for (const line of lines) {
      const m = FENCE_RE.exec(line);
      if (fence) {
        if (m && m[1] === fence && /^[ \t]*(```|~~~)[ \t]*$/.test(line)) { out.push([start, pos + line.length]); fence = null; }
      } else if (m) { fence = m[1]; start = pos; }
      else {
        const re = /`[^`\n]*`/g;
        let c;
        while ((c = re.exec(line))) out.push([pos + c.index, pos + c.index + c[0].length]);
      }
      pos += line.length + 1;
    }
    if (fence) out.push([start, text.length]);
    return out;
  }

  /** Alle Platzhalter ausserhalb von Code: [{ name, value (null = offen), start, end, valueStart, valueEnd }]. */
  function scan(text) {
    const s = String(text == null ? '' : text);
    if (!s.includes('{{?')) return [];
    const code = codeRanges(s);
    const inCode = i => code.some(([a, b]) => i >= a && i < b);
    const out = [];
    TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = TOKEN_RE.exec(s))) {
      if (inCode(m.index)) continue;
      const name = clean(m[1]);
      if (!name) continue;
      const hasValue = m[2] !== undefined;
      const valueStart = hasValue ? m.index + m[0].length - 2 - m[2].length : m.index + m[0].length - 2;
      out.push({ name, value: hasValue ? m[2] : null, start: m.index, end: m.index + m[0].length, valueStart, valueEnd: m.index + m[0].length - 2 });
    }
    return out;
  }

  /** Der Platzhalter an dieser Stelle (pos zwischen start und end, Ränder eingeschlossen), oder null. */
  function at(text, pos) {
    return scan(text).find(p => pos >= p.start && pos <= p.end) || null;
  }

  const token = (name, value) => (value == null ? `{{?${name}}}` : `{{?${name}: ${value}}}`);
  const visible = p => (p.value == null ? `[${p.name}]` : p.value);

  /** Ersetzt Platzhalter von hinten nach vorn: fn(p) → neuer Text oder undefined (bleibt). */
  function replaceAll(text, fn) {
    let s = String(text == null ? '' : text);
    for (const p of scan(s).reverse()) {
      const r = fn(p);
      if (r !== undefined) s = s.slice(0, p.start) + r + s.slice(p.end);
    }
    return s;
  }

  /** Text, wie ihn Aufgaben, Fragen, Export und Druck sehen: Werte statt Platzhalter, offene als «[Name]». */
  function flatten(text, options) {
    const open = options && typeof options.open === 'function' ? options.open : n => `[${n}]`;
    if (!String(text || '').includes('{{?')) return text;
    return replaceAll(text, p => (p.value == null ? open(p.name) : p.value));
  }

  /** Für die Vorschau: ausgefüllte Platzhalter, die an einem anderen Zeichen hängen (@{{?Wer: anna}}, [[{{?Ziel: …}}]]), werden zum Wert,
   *  damit Personen, Termine und Verweise wirken; frei stehende bleiben Platzhalter (fein unterstrichen), offene immer. */
  function forPreview(text) {
    const s = String(text == null ? '' : text);
    if (!s.includes('{{?')) return s;
    return replaceAll(s, p => {
      if (p.value == null) return undefined;
      const before = p.start ? s[p.start - 1] : '';
      const after = s[p.end] || '';
      const free = (!before || /[\s("'«„*_~]/.test(before)) && (!after || /[\s.,;:!?)\]"'»“*_~]/.test(after));
      return free ? undefined : p.value;
    });
  }

  /** Setzt Werte ein: values { Name: Wert } (Gross-/Kleinschreibung egal); keep: als {{?Name: Wert}} stehen lassen. */
  function fill(text, values, options) {
    const keep = !!(options && options.keep);
    const entries = Object.entries(values || {}).filter(([, v]) => v != null);
    if (!entries.length) return text;
    return replaceAll(text, p => {
      const hit = entries.find(([k]) => same(k, p.name));
      if (!hit) return undefined;
      const v = String(hit[1]).replace(/\n+/g, ' ');
      return keep ? token(p.name, v) : v;
    });
  }

  /** Platzhalter auflösen: name (oder alle, wenn leer) → sichtbarer Text (Wert, bei offenen der Name). */
  function resolve(text, name) {
    return replaceAll(text, p => (!name || same(name, p.name) ? (p.value == null ? p.name : p.value) : undefined));
  }

  // ---------- Beschreibungen ----------

  /** Beschreibungsblöcke: [{ name, text, from, to }] (Zeilen from bis to, einschliesslich). */
  function blocks(text) {
    const lines = String(text == null ? '' : text).split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const m = DESC_OPEN_RE.exec(lines[i]);
      if (!m) {
        const f = FENCE_RE.exec(lines[i]); // anderer Codeblock: überspringen
        if (f) { let j = i + 1; while (j < lines.length && !/^[ \t]*(```|~~~)[ \t]*$/.test(lines[j])) j++; i = j; }
        continue;
      }
      let j = i + 1;
      while (j < lines.length && !/^[ \t]*```[ \t]*$/.test(lines[j])) j++;
      out.push({ name: clean(m[1]), text: lines.slice(i + 1, j).join('\n').trim(), from: i, to: Math.min(j, lines.length - 1) });
      i = j;
    }
    return out;
  }

  /** Beschreibungen je Name (der erste Block eines Namens gilt): Map Name → Markdown. */
  function descriptions(text) {
    const map = new Map();
    for (const b of blocks(text)) if (!map.has(b.name.toLowerCase())) map.set(b.name.toLowerCase(), { name: b.name, text: b.text });
    return map;
  }

  /** Beschreibung zu einem Namen aus einer Map von descriptions() (oder null). */
  function describe(map, name) {
    const d = map && map.get(clean(name).toLowerCase());
    return d ? d.text : null;
  }

  /** Text ohne Beschreibungsblöcke (Leerzeilen, die dadurch am Ende stehen, fallen weg). */
  function stripDescriptions(text) {
    const s = String(text == null ? '' : text);
    const bs = blocks(s);
    if (!bs.length) return s;
    const lines = s.split('\n');
    for (const b of bs.reverse()) {
      let from = b.from;
      if (from > 0 && lines[from - 1].trim() === '' && (b.to + 1 >= lines.length || lines[b.to + 1].trim() === '')) from--; // eine Leerzeile davor mit
      lines.splice(from, b.to - from + 1);
    }
    return lines.join('\n').replace(/\s+$/, s.endsWith('\n') ? '\n' : '');
  }

  /** Hängt die Beschreibungen der Namen, die im Text (oder in extra, etwa dem Titel) als Platzhalter vorkommen und noch keinen Block
   *  haben, am Ende an. map aus descriptions(). */
  function appendDescriptions(text, map, extra) {
    const s = String(text == null ? '' : text);
    if (!map || !map.size) return s;
    const names = new Set(scan(s).concat(scan(extra || '')).map(p => p.name.toLowerCase()));
    const have = descriptions(s);
    const add = [];
    for (const [key, d] of map) if (names.has(key) && !have.has(key)) add.push('```' + DESC_TAG + ' ' + d.name + '\n' + d.text + '\n```');
    if (!add.length) return s;
    return s.replace(/\s+$/, '') + '\n\n' + add.join('\n') + '\n';
  }

  /** Entfernt Beschreibungen, zu denen es im Text (und in extra) keinen Platzhalter mehr gibt. */
  function pruneDescriptions(text, extra) {
    const s = String(text == null ? '' : text);
    const bs = blocks(s);
    if (!bs.length) return s;
    const names = new Set(scan(s).concat(scan(extra || '')).map(p => p.name.toLowerCase()));
    const gone = bs.filter(b => !names.has(b.name.toLowerCase()));
    if (!gone.length) return s;
    const lines = s.split('\n');
    for (const b of gone.slice().reverse()) {
      let from = b.from;
      // die Leerzeile davor nur mit, wenn danach nichts oder eine Leerzeile kommt (sonst rückt der nächste Block an den Text)
      if (from > 0 && lines[from - 1].trim() === '' && (b.to + 1 >= lines.length || lines[b.to + 1].trim() === '')) from--;
      lines.splice(from, b.to - from + 1);
    }
    // alle weg: auch der Zeilenumbruch, den das Anhängen gebracht hat
    return lines.join('\n').replace(/\s+$/, gone.length === bs.length ? '' : s.endsWith('\n') ? '\n' : '');
  }

  /** Für Export und Druck: Werte statt Platzhalter, ohne Beschreibungen. */
  function plain(text) {
    return flatten(stripDescriptions(text));
  }

  global.NoNotesPlaceholders = { TOKEN_RE, TOKEN_SRC, DESC_TAG, scan, at, token, visible, flatten, forPreview, fill, resolve, blocks, descriptions, describe, stripDescriptions, appendDescriptions, pruneDescriptions, plain, same };
})(typeof window !== 'undefined' ? window : globalThis);
