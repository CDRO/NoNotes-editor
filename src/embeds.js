/* NoNotes – Videos von grossen Anbietern einbetten (YouTube, Vimeo, Dailymotion).
   Reine Funktionen ohne Datenzugriff und ohne Netz. Aus einer Internetadresse wird – nur wenn Host und Kennung genau zu einem Anbieter
   der Liste passen – eine Beschreibung: Anbieter, Kennung, Adresse zum Ansehen und Adresse zum Einbetten. Alles andere (fremde Hosts,
   Ähnlichkeiten wie youtube.com.boese.example, Adressen mit Zugangsdaten, Kennungen ausser Muster) ergibt null und bleibt ein normaler Link.
   Die Adressen zum Einbetten werden aus festen Bausteinen und der geprüften Kennung gebaut, nie aus Teilen der Eingabe.

   parse(url)    → { provider, name, id, watchUrl, embedUrl } | null
   frameHosts()  → Liste der Hosts, die ein Schutzkopf (frame-src) für das Einbetten zulassen muss
   providers     → Namen der Anbieter

   Ergänzen: eine Funktion in PARSERS und die Hosts in FRAME_HOSTS; Tests in test/engine.cjs (und in NoNotes test/extend.cjs). */
(function (global) {
  'use strict';

  const NAMES = { youtube: 'YouTube', vimeo: 'Vimeo', dailymotion: 'Dailymotion' }; // i18n-ignore: Markennamen

  // Hosts, die der Schutzkopf der Seite für Rahmen zulassen muss (frame-src). Dailymotion leitet auf geo.dailymotion.com weiter.
  const FRAME_HOSTS = ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.dailymotion.com', 'https://geo.dailymotion.com'];

  /** Zeitangabe wie 90, 1m30s oder 1h2m3s in Sekunden (0 bis 12 Stunden), sonst 0. */
  function seconds(value) {
    const v = String(value || '').trim().toLowerCase();
    let total = 0;
    if (/^\d{1,6}s?$/.test(v)) total = parseInt(v, 10);
    else {
      const m = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s)?$/.exec(v);
      if (!m || !v) return 0;
      total = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    }
    return total > 0 && total <= 12 * 3600 ? total : 0;
  }

  function parseYouTube(u) {
    const host = u.hostname;
    let id = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com' || host === 'www.youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else { const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)\/?$/.exec(u.pathname); if (m) id = m[1]; }
    } else return null;
    if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) return null;
    const start = seconds(u.searchParams.get('t') || u.searchParams.get('start'));
    return {
      id,
      watchUrl: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ''}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0${start ? `&start=${start}` : ''}`,
    };
  }

  function parseVimeo(u) {
    const host = u.hostname;
    let id = null;
    let hash = null;
    if (host === 'vimeo.com' || host === 'www.vimeo.com') {
      const m = /^\/(\d{6,12})(?:\/([0-9a-f]{6,16}))?\/?$/.exec(u.pathname);
      if (m) { id = m[1]; hash = m[2] || null; }
    } else if (host === 'player.vimeo.com') {
      const m = /^\/video\/(\d{6,12})\/?$/.exec(u.pathname);
      if (m) { id = m[1]; const h = u.searchParams.get('h'); hash = /^[0-9a-f]{6,16}$/.test(h || '') ? h : null; }
    } else return null;
    if (!id) return null;
    return {
      id,
      watchUrl: `https://vimeo.com/${id}${hash ? `/${hash}` : ''}`,
      embedUrl: `https://player.vimeo.com/video/${id}?dnt=1${hash ? `&h=${hash}` : ''}`,
    };
  }

  function parseDailymotion(u) {
    const host = u.hostname;
    let id = null;
    if (host === 'dai.ly') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'dailymotion.com' || host === 'www.dailymotion.com') {
      const m = /^\/(?:embed\/)?video\/([^/?#]+)\/?$/.exec(u.pathname);
      if (m) id = m[1].split('_')[0]; // ältere Adressen: x7abc12_titel
    } else return null;
    if (!/^[a-z0-9]{5,12}$/i.test(id || '')) return null;
    return {
      id,
      watchUrl: `https://www.dailymotion.com/video/${id}`,
      embedUrl: `https://www.dailymotion.com/embed/video/${id}`,
    };
  }

  const PARSERS = { youtube: parseYouTube, vimeo: parseVimeo, dailymotion: parseDailymotion };

  /** Beschreibung eines Videos zu einer Adresse, oder null, wenn die Adresse zu keinem Anbieter der Liste passt. */
  function parse(url) {
    const text = String(url == null ? '' : url).trim();
    if (!text || text.length > 300 || /[\s<>"'`\\]/.test(text)) return null;
    let u;
    try { u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : 'https://' + text); } catch (e) { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password || (u.port && u.port !== '80' && u.port !== '443')) return null;
    u.hostname = u.hostname.toLowerCase();
    for (const [provider, fn] of Object.entries(PARSERS)) {
      const r = fn(u);
      if (r) return Object.assign({ provider, name: NAMES[provider] }, r);
    }
    return null;
  }

  global.NoNotesEmbeds = { parse, frameHosts: () => FRAME_HOSTS.slice(), providers: Object.values(NAMES), seconds };
})(typeof window !== 'undefined' ? window : globalThis);
