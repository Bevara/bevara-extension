/*
 * Runs test/ - the extension's own bench - in headless Chromium and turns its
 * reports into a pass/fail answer, so a regression in the format table, the
 * registry client or the page runtime is caught without anybody opening a
 * browser.
 *
 * The bench is the real thing: test/harness.js stands in for the isolated-world
 * half of the content script, and the page-world runtime, the format registry
 * and the accessors are the ones the extension ships. window.__BEVARA_REPORTS__
 * collects one entry per element, with status:
 *
 *   started      - the extension took the element over
 *   done         - it decoded
 *   error        - it failed; this is what this script exists to catch
 *   unavailable  - no accessor published for that format, so nothing was
 *                  attempted. Reported as skipped, not failed: QOI, JBIG2, PDF
 *                  and Monkey's Audio are in the format table on purpose while
 *                  their accessors are still missing from the registry.
 *
 * A started job that never reaches done or error is a failure too - that is a
 * hang, and it is how the progressive-playback bug showed up.
 *
 * Usage:
 *   node ci/check-bench.mjs                  # serve this checkout, open test/?force
 *   node ci/check-bench.mjs --no-force       # only the formats the browser cannot play
 *   node ci/check-bench.mjs --bundle         # prefer accessors/ over the registry
 *   node ci/check-bench.mjs --timeout 180000
 *
 * Writes ci/bench-results.xml (JUnit) and exits non-zero on failure.
 */
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i < 0 ? d : (argv[i + 1] ?? true); };
const TIMEOUT = Number(flag('timeout', 240000));
const QUERY = [argv.includes('--no-force') ? null : 'force', argv.includes('--bundle') ? 'bundle' : null]
  .filter(Boolean).join('&');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.ogv': 'video/ogg', '.mp4': 'video/mp4', '.avi': 'video/x-msvideo',
  '.mpg': 'video/mpeg', '.m2v': 'video/mpeg', '.ac3': 'audio/ac3', '.jxl': 'image/jxl',
  '.psd': 'image/vnd.adobe.photoshop', '.drc': 'application/octet-stream'
};

/* The bench loads ../src/common/*.js, so the server root must be the extension
 * directory, not test/. */
function serve() {
  const srv = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const file = join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      const s = await stat(file).catch(() => null);
      if (!s || !s.isFile()) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': s.size, 'Cache-Control': 'no-store'
      });
      res.end(await readFile(file));
    } catch (e) { res.writeHead(500).end(String(e)); }
  });
  return new Promise(r => srv.listen(0, () => r({ srv, port: srv.address().port })));
}

const xml = (s) => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/* test/index.html only puts a handful of elements on the page, while
 * test/media/ holds one sample per format the extension claims. single.html
 * takes ?src=&tag=, so each sample can be exercised on its own and named in
 * the report - that is the difference between a smoke test and a regression
 * net. The tag is what the extension itself would pick for the extension. */
const SAMPLES = [
  ['media/photo.jxl',        'img'],
  ['media/testcard.psd',     'img'],
  ['media/canyon.ac3',       'audio'],
  ['media/median.ogg',       'audio'],
  ['media/trailer.ogg',      'video'],
  ['media/theora_short.ogv', 'video'],
  ['media/dirac.drc',        'video'],
  ['media/mjpeg.avi',        'video'],
  ['media/utvideo.avi',      'video'],
  ['media/mpeg1_short.mpg',  'video'],
  ['media/mpeg2_audio.mpg',  'video'],
  ['media/mpeg2_centaur.mpg','video'],
  ['media/mpeg2_noaudio.m2v','video'],
  ['media/vvc.mp4',          'video']
];

const { srv, port } = await serve();
const base = `http://127.0.0.1:${port}`;
const url = `${base}/test/${QUERY ? '?' + QUERY : ''}`;
console.log('bench: ' + url + '\n');

const puppeteer = (await import('puppeteer')).default;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_BIN || undefined,
  args: [
    '--no-sandbox', '--disable-gpu',
    /* 64 MB of /dev/shm in a pod breaks fetches of a few hundred KB, which is
     * what the media here weigh. */
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader'
  ]
});

const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 200)));
page.on('requestfailed', r => consoleErrors.push('request failed: ' + r.url().replace(base, '') + ' ' + (r.failure()?.errorText || '')));

let reports = [];
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  /* Wait until every element the bench took over has settled: no "started"
   * without a matching done/error, and at least one report in hand. */
  const deadline = Date.now() + TIMEOUT;
  let last = -1, stableSince = Date.now();
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const r = window.__BEVARA_REPORTS__ || [];
      const byId = new Map();
      for (const e of r) if (e.id) byId.set(e.id, e.status);
      return {
        total: r.length,
        pending: [...byId.values()].filter(s => s === 'started').length
      };
    });
    if (state.total && !state.pending) break;
    if (state.total !== last) { last = state.total; stableSince = Date.now(); }
    /* Nothing new for 30 s and still pending: it is not going to settle. */
    else if (state.pending && Date.now() - stableSince > 30000) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  reports = await page.evaluate(() => window.__BEVARA_REPORTS__ || []);
} catch (e) {
  console.error('bench did not run: ' + (e && e.message || e));
}
await page.close();

/* One page per sample: a hang on one format then cannot swallow the others,
 * and each gets its own line in the report. */
const perSample = Number(flag('sample-timeout', 90000));
for (const [src, tag] of (argv.includes('--mixed-only') ? [] : SAMPLES)) {
  const p2 = await browser.newPage();
  p2.on('pageerror', e => consoleErrors.push(src + ' pageerror: ' + String(e.message).slice(0, 160)));
  try {
    await p2.goto(`${base}/test/single.html?src=${encodeURIComponent(src)}&tag=${tag}${QUERY ? '&' + QUERY : ''}`,
      { waitUntil: 'load', timeout: 60000 });
    const deadline = Date.now() + perSample;
    while (Date.now() < deadline) {
      const st = await p2.evaluate(() => {
        const r = window.__BEVARA_REPORTS__ || [];
        const byId = new Map();
        for (const e of r) if (e.id) byId.set(e.id, e.status);
        return { total: r.length, pending: [...byId.values()].filter(s => s === 'started').length };
      });
      if (st.total && !st.pending) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    const got = await p2.evaluate(() => window.__BEVARA_REPORTS__ || []);
    reports = reports.concat(got.length ? got : [{ kind: tag, format: '?', url: src, status: 'started', detail: 'the bench reported nothing for this sample' }]);
  } catch (e) {
    reports.push({ kind: tag, format: '?', url: src, status: 'error', detail: String(e && e.message || e).slice(0, 160) });
  }
  await p2.close();
}

await browser.close();
srv.close();

/* Fold the per-element reports into one verdict per element id. */
const byId = new Map();
const unavailable = [];
for (const e of reports) {
  if (e.status === 'unavailable') { unavailable.push(e); continue; }
  /* ids restart at 1 on every page, so they are not unique across samples. */
  const k = (e.url || '?') + '#' + (e.kind || '') + '#' + (e.id || '');
  byId.set(k, { ...(byId.get(k) || {}), ...e });
}
const elements = [...byId.values()];
const name = (e) => `${e.kind || '?'} ${e.format || '?'} ${(e.url || '').split('/').pop()}`;

/* A baseline of samples known not to decode, so this job reports a new break
 * rather than the backlog it inherited - and so the baseline cannot rot: a
 * listed sample that starts passing is a failure too, telling us to drop it. */
let KNOWN = {};
try { KNOWN = JSON.parse(await readFile(join(ROOT, 'ci', 'known-failures.json'), 'utf8')).known || {}; } catch {}
const keyOf = (e) => (e.url || '').split('/').pop();

const done = elements.filter(e => e.status === 'done');
const broke = elements.filter(e => e.status !== 'done');

const passed = done.filter(e => !KNOWN[keyOf(e)]);
const fixed = done.filter(e => KNOWN[keyOf(e)]);
const failed = broke.filter(e => !KNOWN[keyOf(e)]);
const expected = broke.filter(e => KNOWN[keyOf(e)]);

for (const e of passed) console.log(`  ok   ${name(e)}`);
for (const e of failed) console.log(`  FAIL ${name(e)}  ${e.status}${e.detail ? ': ' + e.detail : ''}`);
for (const e of fixed) console.log(`  FIXED ${name(e)}  decodes now - remove it from ci/known-failures.json`);
for (const e of expected) console.log(`  known ${name(e)}  ${KNOWN[keyOf(e)]}`);
for (const e of unavailable) console.log(`  skip ${name(e)}  ${e.detail || 'no accessor published'}`);

console.log(`\n  ${passed.length}/${passed.length + failed.length} decoded, ${expected.length} known broken, ${unavailable.length} unavailable${reports.length ? '' : ' (no reports at all)'}`);

const suite = (nm, cases, tag) =>
  `  <testsuite name="${xml(nm)}" tests="${cases.length}" failures="${tag === 'failure' ? cases.length : 0}" skipped="${tag === 'skipped' ? cases.length : 0}">\n` +
  cases.map(c => `    <testcase classname="extension.bench" name="${xml(c.n)}">` +
    (tag ? `\n      <${tag} message="${xml(c.why)}"/>\n    ` : '') + `</testcase>`).join('\n') +
  `\n  </testsuite>`;

const suites = [suite('decoded', passed.map(e => ({ n: name(e) })), null)];
if (failed.length) suites.push(suite('failed', failed.map(e => ({
  n: name(e), why: (e.status === 'started' ? 'never settled - the job hung' : e.status) + (e.detail ? ': ' + e.detail : '') +
    (consoleErrors.length ? ' || ' + [...new Set(consoleErrors)].slice(0, 3).join(' ; ') : '')
})), 'failure'));
if (fixed.length) suites.push(suite('fixed', fixed.map(e => ({
  n: name(e), why: 'this sample decodes now; delete its entry from ci/known-failures.json so a future break is caught'
})), 'failure'));
if (expected.length) suites.push(suite('known-broken', expected.map(e => ({
  n: name(e), why: KNOWN[keyOf(e)]
})), 'skipped'));
if (unavailable.length) suites.push(suite('unavailable', unavailable.map(e => ({
  n: name(e), why: e.detail || 'no accessor published for this format'
})), 'skipped'));
if (!reports.length) suites.push(suite('bench', [{ n: 'the bench produced no report', why: 'the page did not run: ' + [...new Set(consoleErrors)].slice(0, 3).join(' ; ') }], 'failure'));

await writeFile(join(ROOT, 'ci', 'bench-results.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>\n`);
console.log('wrote ci/bench-results.xml');

const bad = failed.length + fixed.length;
if (!reports.length || bad) { console.error(`\n${bad || 1} failing checks`); process.exit(1); }
console.log('\nevery element the extension took over decoded, or is a known break');
