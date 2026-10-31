/* NoNotes – gemeinsame Datumslogik für Fälligkeiten von Fragen und Aufgaben.
   Schreibweise im Text am Zeilenende (seit v3.0.0): ">15.10.2026", ">2026-10-15", optional mit Uhrzeit ">15.10.2026 14:30"
   (auch "14.30"). Vor ">" steht ein Leerzeichen (oder nichts): "->15.10.2026" ist kein Termin. Mehrere Termine stehen hintereinander:
   der späteste ist die Frist, die früheren sind Erinnerungen ("- [ ] Offerte >30.10.2026 >6.11.2026").
   Bis v2.x hiessen Termine "@15.10.2026"; die Umstellung beim ersten Öffnen schreibt sie um (rewriteLegacy), und wo noch eines steht
   (alter Text, eingefügte Mail), zählt es weiter als Termin.
   Gespeichert wird "YYYY-MM-DD" oder "YYYY-MM-DDTHH:MM", lokale Zeit ohne Zeitzone. */
(function (global) {
  'use strict';

  // Texte über das Label-Modul des Pakets (labels.js, wird zuerst geladen); der Gastgeber kann jeden Text ersetzen.
  const { t, tn } = global.NoNotesEditorLabels;

  const DATE_SRC = String.raw`(?:(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2}))(?:[ T](\d{1,2})[:.](\d{2}))?`;
  // Ein Termin am Ende: Leerzeichen davor (Gruppe 1), Zeichen (2), Datum (3–8), Uhrzeit (9, 10)
  const TAIL_RE = new RegExp(String.raw`(\s*)([>@])` + DATE_SRC + String.raw`\s*$`);
  /** Bis v2.x: ein Termin mit "@" am Ende (für Vorlagen und Prüfungen von aussen). */
  const DUE_RE = new RegExp(String.raw`\s*@` + DATE_SRC + String.raw`\s*$`);

  function pad(n) { return String(n).padStart(2, '0'); }

  /** Datum aus den Gruppen eines Treffers (ab Index i: Tag, Monat, Jahr, Jahr, Monat, Tag, Stunde, Minute) als ISO oder null. */
  function isoOf(m, i) {
    let y, mo, d;
    if (m[i]) { d = Number(m[i]); mo = Number(m[i + 1]); y = Number(m[i + 2]); }
    else { y = Number(m[i + 3]); mo = Number(m[i + 4]); d = Number(m[i + 5]); }
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    let iso = `${y}-${pad(mo)}-${pad(d)}`;
    if (m[i + 6] != null) {
      const h = Number(m[i + 6]), mi = Number(m[i + 7]);
      if (h >= 0 && h <= 23 && mi >= 0 && mi <= 59) iso += `T${pad(h)}:${pad(mi)}`;
    }
    return iso;
  }

  /** Die Termine am Ende eines Texts: { text (ohne sie), dates: [{ iso (null = ungültig), mark ('>' | '@'), start, end }] } in der
   *  Reihenfolge im Text; start/end sind Stellen im Text (ohne das Leerzeichen davor). Ein ">" direkt nach einem anderen Zeichen
   *  beendet die Suche ("a->1.1.2026"); ein altes "@" darf wie bis v2.x direkt am Text hängen, aber nur als letzter Termin. */
  function tail(raw) {
    let s = String(raw == null ? '' : raw);
    const dates = [];
    for (;;) {
      const m = TAIL_RE.exec(s);
      if (!m) break;
      const at = m.index + m[1].length;
      if (!m[1] && m.index > 0 && (m[2] === '>' || dates.length)) break;
      dates.unshift({ iso: isoOf(m, 3), mark: m[2], start: at, end: at + m[0].trimEnd().length - m[1].length });
      s = s.slice(0, m.index);
    }
    return { text: s.trim(), dates };
  }

  /** Trennt die Termine am Zeilenende ab: { text, due, reminders, legacy } mit due (der späteste, die Frist) und reminders (die früheren,
   *  aufsteigend, ohne Doppel) als ISO; legacy: mindestens ein Termin ist noch mit "@" geschrieben. */
  function splitDue(raw) {
    const { text, dates } = tail(raw);
    const valid = [...new Set(dates.map(d => d.iso).filter(Boolean))].sort();
    return { text, due: valid.length ? valid[valid.length - 1] : null, reminders: valid.slice(0, -1), legacy: dates.some(d => d.mark === '@') };
  }

  /** Text eines Termins: "15.10.2026" oder "15.10.2026 14:30" (immer das volle Datum, so wie ihn die Auswahl schreibt). */
  function toText(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(iso || '');
    if (!m) return '';
    return `${m[3]}.${m[2]}.${m[1]}` + (m[4] ? ` ${m[4]}:${m[5]}` : '');
  }

  // ---------- Umstellung von "@" auf ">" (v3.0.0) ----------

  // Ein alter Termin "@Datum", auch "@{{datum+7}}" (Vorlage) und "@{{?Bis wann: 3.11.2026}}" (ausgefüllter Platzhalter): vor dem "@" ein
  // Leerzeichen oder der Anfang, damit "@" zu ">" werden kann, ohne dass sich die Länge des Texts ändert (der Verlauf rechnet mit Stellen).
  const DATE_NC = DATE_SRC.replace(/\((?!\?)/g, '(?:');
  const AUTO_DATE_SRC = String.raw`\{\{\s*(?:datum|date)(?:\s*[+-]\s*\d+)?(?::[^{}\n]*)?\s*\}\}`;
  const VALUE_SRC = `(?:${DATE_NC}|${AUTO_DATE_SRC})`;
  const TOKEN_SRC = String.raw`[>@](?:${VALUE_SRC}|\{\{\?[^{}:\n]+:[ \t]?${VALUE_SRC}\}\})`;
  // Die Termine am Ende: Anfang oder Leerzeichen (1), die Termine (2)
  const RUN_RE = new RegExp(String.raw`(^|\s)(${TOKEN_SRC}(?:\s+${TOKEN_SRC})*)\s*$`);

  /** Schreibt in einem Stück Text (eine Zeile oder ein Teil eines Tabellenfelds) die alten Termine am Ende zu ">" um. */
  function rewriteTail(s) {
    const m = RUN_RE.exec(s);
    if (!m || !m[2].includes('@')) return s;
    const start = m.index + m[1].length;
    return s.slice(0, start) + m[2].replace(/(^|\s)@/g, '$1>') + s.slice(start + m[2].length);
  }

  /** Eine Tabellenzeile: jedes Feld (getrennt durch "|", "\|" gehört zum Text) und darin jeder Teil (getrennt durch "<br>") für sich. */
  function rewriteRow(line) {
    const cells = [];
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\' && line[i + 1] === '|') { cur += '\\|'; i++; continue; }
      if (line[i] === '|') { cells.push(cur, '|'); cur = ''; continue; }
      cur += line[i];
    }
    cells.push(cur);
    return cells.map(c => (c === '|' ? c : c.split(/(<br\s*\/?>)/i).map((p, j) => (j % 2 ? p : rewriteTail(p))).join(''))).join('');
  }

  /** Zeilen in Code (```/~~~), ohne Frage- und Entscheidblöcke ("?!```" … "```"), die kein Code sind. */
  function codeMask(lines) {
    const tb = global.NoNotesTables;
    if (tb && tb.codeMask) return tb.codeMask(lines);
    const mask = [];
    let fence = null, block = false;
    for (const s of lines) {
      mask.push(!!fence);
      const f = /^\s*(`{3,}|~{3,})(.*)$/.exec(s);
      if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null; continue; }
      if (/^\s*(?:(?:[-*+]|\d+[.)])\s+)?\?!?\s?```/.test(s)) { block = true; continue; }
      if (block && /^\s*```\s*$/.test(s)) { block = false; continue; }
      if (f) fence = f[1];
    }
    return mask;
  }

  /** Alte Termine "@Datum" am Ende jeder Zeile ausserhalb von Code werden zu ">Datum", auch mehrere hintereinander, auch am Ende der Teile
   *  eines Tabellenfelds (getrennt durch "|" und "<br>") und in Vorlagen ("@{{datum+7}}"). Die Länge des Texts bleibt gleich.
   *  skipLine: diese Zeile (Index) bleibt, wie sie ist (die Zeile mit dem Cursor im Editor). */
  function rewriteLegacy(text, skipLine) {
    const s = String(text == null ? '' : text);
    if (!s.includes('@')) return s;
    const lines = s.split('\n');
    const code = codeMask(lines);
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (code[i] || i === skipLine || !line.includes('@')) continue;
      const next = /^\s*\|/.test(line) ? rewriteRow(line) : rewriteTail(line);
      if (next !== line) { lines[i] = next; changed = true; }
    }
    return changed ? lines.join('\n') : s;
  }

  /** Gibt es noch alte Termine "@Datum" (ausserhalb von Code)? */
  function hasLegacy(text) {
    return rewriteLegacy(text) !== String(text == null ? '' : text);
  }

  // ---------- Heute, Format, Dringlichkeit ----------

  function hasTime(iso) { return !!iso && iso.length > 10; }
  function datePart(iso) { return iso ? iso.slice(0, 10) : ''; }
  function timePart(iso) { return hasTime(iso) ? iso.slice(11, 16) : null; }

  /** Heutiges Datum als ISO (lokale Zeit). */
  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Jetzt als ISO mit Uhrzeit (lokale Zeit), z. B. 2026-10-15T14:30. */
  function nowIso() {
    const d = new Date();
    return `${todayIso()}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** ISO → "15.10.2026" bzw. "15.10.2026, 14:30". */
  function formatDue(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    const date = `${Number(m[3])}.${Number(m[2])}.${m[1]}`;
    return hasTime(iso) ? `${date}, ${timePart(iso)}` : date;
  }

  /** ISO → Date-Objekt in lokaler Zeit (ohne Zeit: Mitternacht). */
  function toDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(iso || '');
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), m[4] ? Number(m[4]) : 0, m[5] ? Number(m[5]) : 0);
  }

  /** Date-Objekt → ISO-Tag (lokale Zeit). */
  function isoDay(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Dringlichkeit: 'overdue' | 'today' | 'week' | 'later' | 'none'.
   *  now darf ein Datum ("2026-10-15") oder Datum mit Uhrzeit ("2026-10-15T14:30") sein. */
  function urgency(iso, now) {
    if (!iso) return 'none';
    const ref = now || nowIso();
    const today = datePart(ref);
    const day = datePart(iso);
    if (day < today) return 'overdue';
    if (day === today) {
      if (hasTime(iso) && hasTime(ref) && timePart(iso) < timePart(ref)) return 'overdue';
      return 'today';
    }
    const d = new Date(today + 'T00:00:00');
    d.setDate(d.getDate() + 7);
    return day <= isoDay(d) ? 'week' : 'later';
  }

  /** Die nächste Erinnerung ab heute (ISO) oder null. */
  function nextReminder(reminders, now) {
    const today = datePart(now || nowIso());
    return (reminders || []).find(r => datePart(r) >= today) || null;
  }

  /** Kurztext für Listen, Export und Druck: «bis 6.11.2026», mit Erinnerungen «bis 6.11.2026, Erinnerung 30.10.2026». */
  function dueText(due, reminders) {
    if (!due) return '';
    const r = (reminders || []).map(formatDue);
    return t('bis {datum}', { datum: formatDue(due) }) + (r.length ? ', ' + tn('Erinnerung {daten}', 'Erinnerungen {daten}', r.length, { daten: r.join(', ') }) : '');
  }

  /** Überschrift einer Dringlichkeitsgruppe. */
  function urgencyLabel(key) {
    const labels = {
      overdue: t('Überfällig'), today: t('Heute'), week: t('Diese Woche'), later: t('Später'),
      none: t('Ohne Termin'), done: t('Erledigt'), answered: t('Beantwortet'),
    };
    return labels[key];
  }

  /** Text für ein Fälligkeits-Abzeichen, z. B. "überfällig · 4.10.2026, 14:30" oder "heute · 14:30". */
  function dueLabel(iso, now) {
    const u = urgency(iso, now);
    if (u === 'today') return t('heute') + ' · ' + (hasTime(iso) ? timePart(iso) : formatDue(iso));
    return (u === 'overdue' ? t('überfällig') + ' · ' : '') + formatDue(iso);
  }

  global.NoNotesDates = {
    splitDue, tail, toText, rewriteLegacy, hasLegacy, todayIso, nowIso, formatDue, toDate, isoDay, urgency, nextReminder, dueLabel, dueText,
    hasTime, datePart, timePart, pad, urgencyLabel, DUE_RE, TAIL_RE, DATE_SRC,
  };
})(typeof window !== 'undefined' ? window : globalThis);
