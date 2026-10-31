/* Gemeinsames für die Testläufe (wie NoNotes test/lib.cjs): Playwright laden, Schritte melden, Abschnitte nacheinander ausführen.
   Ein Lauf druckt je Abschnitt eine Zeile; die Teilschritte bleiben still (NONOTES_EDITOR_TEST_VERBOSE=1 zeigt sie) und werden beim
   Fehlschlag genannt. NONOTES_EDITOR_TEST_ONLY=<Wort> führt nur Abschnitte aus, deren Name das Wort enthält.
   Chromium: NONOTES_EDITOR_CHROMIUM (oder STEERINGBOARD_CHROMIUM) nennt ein vorhandenes Programm; sonst das von Playwright. */
'use strict';

function loadPlaywright() {
  try { return require('playwright'); }
  catch (e) {
    if (process.env.PLAYWRIGHT_MODULE) return require(process.env.PLAYWRIGHT_MODULE);
    throw e;
  }
}

function launchOptions() {
  const exe = process.env.NONOTES_EDITOR_CHROMIUM || process.env.STEERINGBOARD_CHROMIUM;
  return exe ? { executablePath: exe } : {};
}

const state = { part: null };
const step = name => console.log('  ✓ ' + name);
const part = name => { state.part = name; if (process.env.NONOTES_EDITOR_TEST_VERBOSE) console.log('      · ' + name); };

async function suite(title, sections, options) {
  let browser = null;
  const started = Date.now();
  try {
    if (options && options.browser) browser = await loadPlaywright().chromium.launch(launchOptions());
    const only = process.env.NONOTES_EDITOR_TEST_ONLY;
    for (const s of sections) {
      if (only && !(s.name || '').includes(only)) continue;
      state.part = null;
      await s.run(browser, part, step);
      if (s.name) step(s.name);
    }
    console.log(`\n${title} bestanden (${Math.round((Date.now() - started) / 1000)} s).`);
  } catch (e) {
    console.error(`\n${title} FEHLGESCHLAGEN${state.part ? ` – nach Teilschritt: ${state.part}` : ''}`);
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
  if (process.exitCode) process.exit(process.exitCode);
}

module.exports = { loadPlaywright, launchOptions, suite, step, part };
