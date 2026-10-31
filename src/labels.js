/* NoNotes-editor – Texte (Labels) des Pakets.
   Der deutsche Text im Quelltext ist der Schlüssel (wie bei NoNotesI18n). Das Paket bringt seine Texte selbst mit (lang/editor.de.js ist
   der Katalog aller Schlüssel, lang/editor.en.js die englische Fassung) und braucht kein NoNotesI18n. Jeder Gastgeber kann jeden Text
   ersetzen, Text für Text, und seinen eigenen Übersetzer einhängen. Ist NoNotesI18n auf der Seite (oder im vm-Kontext) und nennt der
   Gastgeber keinen Übersetzer, gilt NoNotesI18n (t, tn, Sprache, Gebietsschema): so laufen NoNotes, der Server von NoNotes-SaaS und das
   MCP-Programm ohne Zusatz wie mit v3.3.0. t: false schaltet das ab.

   Laden: diese Datei vor allen anderen des Pakets, danach die Sprachdateien (lang/editor.de.js, lang/editor.en.js), danach die Module.

   Im Code:   t('Fett')                                   einfacher Text
              t('Spalte {n}', { n: 3 })                   mit Platzhaltern
              tn('{n} Bild', '{n} Bilder', n)             Einzahl und Mehrzahl
              N_('Fett')                                  nur markieren (Tabellen, Konstanten), übersetzt wird später mit t()

   Gastgeber:
     NoNotesEditorLabels.configure({
       language: 'en' | () => 'en',       Sprache für den Katalog des Pakets (ohne Angabe: Sprache des Übersetzers, sonst <html lang>, sonst de)
       locale: 'en-GB' | () => 'en-GB',   Gebietsschema für Datum und Monat (ohne Angabe: aus dem Übersetzer, dem Katalog oder de-CH)
       t(key, params), tn(one, other, n, params),   Übersetzer des Gastgebers (Vorgabe: NoNotesI18n, falls vorhanden; false: keiner;
                                                    null: zurück zur Vorgabe)
       messages: { en: { 'Übernehmen': 'Apply' }, de: { 'Notiz': 'Eintrag' } },   einzelne Texte ersetzen (Mehrzahl: { one, other })
     })
   Reihenfolge für einen Schlüssel (der erste Treffer gewinnt):
     1. messages des Gastgebers für die aktuelle Sprache (configure, mehrfach aufrufbar; spätere Angaben ersetzen frühere)
     2. der Übersetzer des Gastgebers, wenn er etwas anderes liefert als den deutschen Text (er kennt den Schlüssel)
     3. der Katalog des Pakets für die aktuelle Sprache (lang/editor.en.js …)
     4. der deutsche Text selbst
   So gewinnt immer, was der Gastgeber ausdrücklich angibt; ein Text, den sein Übersetzer nicht kennt, kommt aus dem Paket.

   Weitere Sprachen: NoNotesEditorLabels.register('fr', { … }, { locale: 'fr-CH' }) (oder über den Übersetzer des Gastgebers).
   Keine DOM-Abhängigkeit: läuft auch in Node (vm), dort ohne <html lang> auf Deutsch. */
(function (global) {
  'use strict';

  const SOURCE = 'de';
  const catalog = new Map(); // Sprache → { locale, messages: Map }
  const overrides = new Map(); // Sprache → Map(Schlüssel → Text oder { one, other … })
  const conf = { language: null, locale: null, t: null, tn: null, auto: true };

  const call = v => (typeof v === 'function' ? v() : v);
  /** NoNotesI18n als Übersetzer, solange der Gastgeber keinen eigenen nennt (beim Aufruf nachgesehen: die Ladereihenfolge ist egal). */
  const bridge = () => (conf.auto && !conf.t && global.NoNotesI18n && typeof global.NoNotesI18n.t === 'function' ? global.NoNotesI18n : null);
  const hostT = () => conf.t || (bridge() ? bridge().t : null);
  const hostTn = () => conf.tn || (bridge() && typeof bridge().tn === 'function' ? bridge().tn : null);

  function format(text, params) {
    if (!params) return text;
    return String(text).replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  }

  /** Katalog einer Sprache anmelden (lang/editor.<code>.js); ein zweiter Aufruf ergänzt und ersetzt Texte. */
  function register(code, messages, options) {
    const c = String(code || '').toLowerCase();
    if (!c) return;
    const entry = catalog.get(c) || { locale: null, messages: new Map() };
    for (const [k, v] of Object.entries(messages || {})) if (v !== '' && v != null) entry.messages.set(k, v);
    if (options && options.locale) entry.locale = String(options.locale);
    catalog.set(c, entry);
  }

  /** Einstellungen des Gastgebers; jeder Aufruf ändert nur, was er nennt. t: null zurück zur Vorgabe (NoNotesI18n, falls vorhanden),
   *  t: false ohne Übersetzer. */
  function configure(o) {
    if (!o) return;
    if (o.language !== undefined) conf.language = o.language || null;
    if (o.locale !== undefined) conf.locale = o.locale || null;
    if (o.t !== undefined) { conf.t = typeof o.t === 'function' ? o.t : null; conf.auto = o.t !== false; }
    if (o.tn !== undefined) conf.tn = typeof o.tn === 'function' ? o.tn : null;
    if (o.messages && typeof o.messages === 'object') {
      for (const [code, map] of Object.entries(o.messages)) {
        const c = code.toLowerCase();
        if (!overrides.has(c)) overrides.set(c, new Map());
        for (const [k, v] of Object.entries(map || {})) {
          if (v == null || v === '') overrides.get(c).delete(k); else overrides.get(c).set(k, v);
        }
      }
    }
  }

  /** Aktuelle Sprache: angegeben, sonst die von NoNotesI18n (Vorgabe), sonst <html lang>, sonst Deutsch. Kennungen wie de-CH oder en-GB
   *  fallen im Katalog auf de/en zurück. */
  function language() {
    let lang = call(conf.language);
    const b = bridge();
    if (!lang && b && typeof b.language === 'function') lang = b.language();
    if (!lang && global.document && global.document.documentElement) lang = global.document.documentElement.lang;
    return String(lang || SOURCE).toLowerCase();
  }

  /** Einträge einer Sprache aus einer Quelle (Map je Sprache): genau die Kennung, sonst die Grundsprache (de-ch → de). */
  function lookup(store, lang, key) {
    const exact = store.get(lang);
    const read = s => (s ? (s.messages || s).get(key) : undefined);
    let v = read(exact);
    if (v === undefined && lang.includes('-')) v = read(store.get(lang.split('-')[0]));
    return v;
  }

  function locale() {
    const own = call(conf.locale);
    if (own) return String(own);
    const b = bridge();
    if (b && typeof b.locale === 'function') return b.locale();
    const lang = language();
    const c = catalog.get(lang) || catalog.get(lang.split('-')[0]);
    if (c && c.locale) return c.locale;
    if (lang === SOURCE) return 'de-CH';
    return lang;
  }

  function N_(key) { return key; }

  function t(key, params) {
    const lang = language();
    const own = lookup(overrides, lang, key);
    if (typeof own === 'string') return format(own, params);
    const ht = hostT();
    if (ht) {
      const v = ht(key, params);
      if (typeof v === 'string' && v !== format(key, params)) return v;
    }
    const pack = lookup(catalog, lang, key);
    return format(typeof pack === 'string' ? pack : key, params);
  }

  function plural(forms, n, fallback) {
    if (typeof forms === 'string') return forms;
    if (!forms || typeof forms !== 'object') return fallback;
    let cat = 'other';
    try { cat = new Intl.PluralRules(locale()).select(n); } catch (e) { /* bleibt other */ }
    return forms[cat] || forms.other || fallback;
  }

  function tn(one, other, n, params) {
    const all = Object.assign({ n }, params || {});
    const plain = n === 1 ? one : other;
    const lang = language();
    const own = lookup(overrides, lang, one);
    if (own !== undefined) return format(plural(own, n, plain), all);
    const htn = hostTn();
    if (htn) {
      const v = htn(one, other, n, params);
      if (typeof v === 'string' && v !== format(plain, all)) return v;
    }
    const pack = lookup(catalog, lang, one);
    return format(plural(pack, n, plain), all);
  }

  /** Alle Schlüssel des Katalogs (aus lang/editor.de.js), etwa für ein Werkzeug des Gastgebers. */
  function keys() {
    const de = catalog.get(SOURCE);
    return de ? [...de.messages.keys()] : [];
  }

  /** Die Texte einer Sprache im Katalog des Pakets als Objekt (ohne Ersetzungen des Gastgebers). */
  function messages(code) {
    const c = catalog.get(String(code || '').toLowerCase());
    return c ? Object.fromEntries(c.messages) : {};
  }

  global.NoNotesEditorLabels = { SOURCE, N_, t, tn, format, configure, register, language, locale, keys, messages };
})(typeof window !== 'undefined' ? window : globalThis);
