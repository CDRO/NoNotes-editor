/* NoNotes – Vorschläge für "@kürzel" (Personen) beim Schreiben.
   Wer Personen kennt, meldet einen Lieferanten: NoNotesMentions.provide(async prefix => [{ handle, name }]).
   Die lokale Version liefert die Kürzel, die in der Datei schon vorkommen; eine Ausprägung mit Konten kann die
   Mitglieder liefern, eine Erweiterung über ctx.people.provide(). Mehrere Lieferanten werden zusammengeführt,
   jedes Kürzel erscheint einmal. Keine DOM-Abhängigkeit. */
(function (global) {
  'use strict';

  // Übersetzung nur, wenn das Label-Modul (labels.js) geladen ist (die Datei läuft auch ohne Browser).
  const t = key => (global.NoNotesEditorLabels ? global.NoNotesEditorLabels.t(key) : key); // i18n-dynamic

  const providers = new Map();
  let seq = 0;

  /** Meldet einen Lieferanten an; die Rückgabe meldet ihn wieder ab. */
  function provide(fn) {
    if (typeof fn !== 'function') throw new Error(t('provide braucht eine Funktion'));
    const id = ++seq;
    providers.set(id, fn);
    return () => { providers.delete(id); };
  }

  function normalize(item) {
    if (typeof item === 'string') return { handle: item, name: '' };
    if (item && typeof item.handle === 'string') return { handle: item.handle, name: typeof item.name === 'string' ? item.name : '' };
    return null;
  }

  /** Vorschläge zu einem begonnenen Kürzel (ohne @): passende Kürzel oder Namen, zuerst die, die so beginnen. */
  async function suggest(prefix, limit) {
    const p = String(prefix || '').trim().toLowerCase();
    const out = [];
    const seen = new Set();
    for (const fn of [...providers.values()]) {
      let items;
      try { items = await fn(p); } catch (e) { continue; } // ein Lieferant, der scheitert, nimmt den anderen nichts
      for (const raw of Array.isArray(items) ? items : []) {
        const it = normalize(raw);
        if (!it || !it.handle.trim()) continue;
        const handle = it.handle.trim().replace(/^@/, '');
        const key = handle.toLowerCase();
        if (seen.has(key)) continue;
        if (p && !key.includes(p) && !it.name.toLowerCase().includes(p)) continue;
        seen.add(key);
        out.push({ handle, name: it.name.trim() });
      }
    }
    const rank = it => (it.handle.toLowerCase().startsWith(p) ? 0 : it.name.toLowerCase().startsWith(p) ? 1 : 2);
    out.sort((a, b) => rank(a) - rank(b) || a.handle.localeCompare(b.handle));
    return out.slice(0, limit || 8);
  }

  global.NoNotesMentions = { provide, suggest, count: () => providers.size };
})(window);
