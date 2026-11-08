# Checking the extension

`check-bench.mjs` runs `test/` - the extension's own bench - in headless
Chromium and turns its reports into a pass/fail answer, so a regression in the
format table, the registry client or the page runtime is caught without anybody
opening a browser.

The bench is the real thing: `test/harness.js` stands in for the
isolated-world half of the content script, and the page-world runtime, the
format registry and the accessors are the ones the extension ships.
`window.__BEVARA_REPORTS__` gives one entry per element:

| status | meaning | verdict |
|---|---|---|
| `done` | decoded | pass |
| `error` | the pipeline failed | **fail** |
| `started`, never settled | the job hung | **fail** |
| `unavailable` | no accessor published for that format | skipped |

`unavailable` is not a failure: QOI, JBIG2, PDF and Monkey's Audio are in the
format table on purpose while their accessors are missing from the registry,
and patent-restricted modules are refused unless `--encumbered` is on.

`test/index.html` only puts a handful of elements on the page, so each sample
in `test/media/` is also driven through `single.html` on a page of its own -
one format cannot then hang the rest, and each gets its own line in the report.

## The baseline

`known-failures.json` lists the samples that do not decode today, with the
reason. They are reported as skipped so the job turns red on a *new* break
instead of on the backlog it inherited. The list cannot quietly rot either: a
listed sample that starts passing is reported as a failure, which is the signal
to delete its entry.

Today that is the four MPEG-1/2 samples. The same content decodes through the
player - the Showcase `mpeg2` demo passes - so it is the extension's route that
breaks, not the codec. Not yet diagnosed.

## Running it

```sh
node ci/check-bench.mjs                   # test/?force, then every sample
node ci/check-bench.mjs --mixed-only      # the mixed page alone
node ci/check-bench.mjs --no-force        # only formats the browser cannot play
node ci/check-bench.mjs --bundle          # prefer accessors/ over the registry
node ci/check-bench.mjs --timeout 300000 --sample-timeout 120000
```

`?force` is the default: it treats every known format as unsupported, so the
extension takes over everything and the coverage is maximal.

It needs `puppeteer`. On the `filters-builder` agent Chromium is in the image
and `CHROME_BIN` points at it, so `npm install --no-save puppeteer` with
`PUPPETEER_SKIP_DOWNLOAD=1` is enough.

Writes `ci/bench-results.xml` (JUnit); exits non-zero on failure.

## The Jenkins job

Freestyle, label `filters-builder`, this repository, branch `main`, GitHub hook
trigger, JUnit from `ci/bench-results.xml`:

```sh
export PUPPETEER_SKIP_DOWNLOAD=1
npm install --no-save puppeteer@22.15.0
node ci/check-bench.mjs
```

No credentials: the repository is public.
