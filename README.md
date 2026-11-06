# Bevara Universal Media
By installing and using Bevara Universal Media you confirm that you agree to the [Terms of Service](https://bevara.com/terms_of_service/).

By using the Bevara open-source accessors and/or creating or modifying any filters, you agree to be bound by the Open-Source Developer's EULA as found at: https://bevara.com/terms_of_service/. You further agree to be bound by the underlying code licenses as described in [LICENSE.md](LICENSE.md).

A browser extension based on Bevara open-source libraries that displays and plays the file formats your browser does not support. It watches every page you visit for images, audio and video, and whenever the browser cannot decode a source on its own, a WebAssembly decoding pipeline steps in and hands back a format the browser plays natively. No change to the website is needed: the tags stay standard `<img>`, `<audio>` and `<video>`.

The extension ships no decoder of its own. Every accessor — the solver main modules, the format side modules, the universal-tag scripts — is fetched from a [Bevara filter registry](https://registry.bevara.ddns.net), so the extension is a few tens of kilobytes, a format becomes available the day it is published, and what is installed is auditable: the registry's catalogue carries the version, licence, patent status and signature of every module.

<!-- Fill in once published / pushed -->
[Packaged version](#) &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; [Source code](#) &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; [Help](https://bevara.com/documentation/)

## What it does

- **Images** — JPEG XL, AVIF, HEIF/HEIC, JPEG 2000, JPEG XR, JPEG-LS, WebP, TIFF, BMP, BPG, QOI, FLIF, DDS, JBIG/JBIG2, ICNS, MNG, PSD, XCF, PGF, PCX, TGA, SGI, PNM, XBM, camera RAW, Amiga/Atari retro formats, PDF (first page)… are decoded and shown as PNG.
- **Audio** — MP3, FLAC, Vorbis, Opus, Speex, AC-3, DTS, ALAC, AIFF, AMR, APE, WavPack, Musepack, TTA, GSM, G.711/G.72x, iLBC, Codec 2, LC3, SBC, MIDI, tracker modules… are decoded to WAV.
- **Video** — Theora, HEVC, VVC, VP8/VP9, AV1, MPEG-1/2, AVS2, AVS3, EVC, Dirac, AVI (H.261/H.263, MJPEG, Ut Video)… are transcoded to MP4/H.264, progressively through Media Source Extensions so playback starts before the transcode ends.

The browser always gets the first try: a format it may support is only taken over when it actually fails to decode it. A format whose pipeline the registry does not publish — or whose decoder carries patent obligations you have not agreed to — is left alone and reported as unavailable, with the reason named. The toolbar badge counts the elements taken over on the current tab; the popup lists them, shows the registry in use, flags any module whose patent status is not royalty-free, and lets you switch the extension off per site.

It is the browser-extension form of the MutationObserver approach described in *Enabling Browser Support of Arbitrary Multimedia via Dynamic WebAssembly-Based Pipelines* (§4.2), built on the Showcase `scripts/MutationObserver.js` demo and the `universal-*` Web Components.

## Layout

```
manifest.json
src/
  common/formats.js      format table: extensions, MIME types, magic bytes,
                         native-support hints, accessor pipelines (shared)
  common/registry.js     registry client: /accessors/index.json, module
                         availability, URLs, patent status (shared)
  background.js          service worker: registry catalogue (cached, hourly
                         TTL), byte sniffing, CORS-free media fetch (streamed
                         over a Port), per-tab state for the popup
  content/bootstrap.js   isolated-world content script: the MutationObserver,
                         detection and decision logic, bridge to the page
  page/runtime.js        page-world runtime: runs the pipelines (Worker or main
                         thread), upgrades <video> to universal-video_1
  options/               settings page (registry, patents, pipeline, network)
  popup/                 per-tab summary, registry health, per-site switch
accessors/               build-time copy of registry files (see below);
                         emptied by default, not committed
scripts/sync-accessors.sh
scripts/package.sh       builds the Chrome Web Store zip
test/                    stand-alone test bench (no extension needed)
```

## Install (unpacked)

1. Fetch the local copies the extension prefers (see *Local copies and page
   CSP* below; `--none` skips this entirely and works too):

   ```bash
   scripts/sync-accessors.sh
   ```

2. Chrome / Edge / Brave: open `chrome://extensions`, enable *Developer mode*,
   *Load unpacked*, pick this directory.

   Firefox: `about:debugging` → *This Firefox* → *Load Temporary Add-on* →
   `manifest.json`. (Firefox needs a `browser_specific_settings.gecko.id`
   entry in the manifest for a permanent install.)

3. Visit a page with an exotic format, e.g. the Showcase demos or `test/`.
   The toolbar badge counts the elements taken over on the current tab.

`scripts/package.sh` builds the zip for the Chrome Web Store.

## Local copies and page CSP

A `chrome-extension://` URL is exempt from the visited page's
Content-Security-Policy; a `https://registry…` URL is not. A site with a
strict `script-src` / `connect-src` can therefore block accessors loaded from
the registry that it would have let through from the extension. The cure is
to keep a build-time copy of the registry files in `accessors/`, which
`scripts/sync-accessors.sh` downloads; the extension prefers that copy and
falls back to the registry for anything not in it.

| `scripts/sync-accessors.sh …` | in `accessors/` | zip | CSP-exempt |
|---|---|---|---|
| `--none` | nothing | 40 kB | nothing — registry only |
| *(default)* `--glue` | the two solvers (JS + wasm) and the universal tags | 3.1 MB | the `<script>` and worker loads, i.e. what `script-src` / `worker-src` police |
| `--all` | every module the format table can ask for | 7.6 MB | everything, and the extension works offline |

`--glue` is the default because the scripts are the part a page's CSP refuses
most often, and they are the small part: the per-format decoders are fetched
from the registry and cached by the browser.

Each copy is recorded with its version in `accessors/bundled.json`. At run
time the extension compares that against the live catalogue and uses the
registry whenever the two disagree, so a stale bundle costs a download rather
than pairing mismatched modules. `--all` still leaves the registry as the
catalogue: a format whose decoder is published later is fetched from there
without rebuilding the bundle.

Re-run the script and `scripts/package.sh` to change mode; nothing else needs
editing.

## Patents

Every accessor on the registry declares a patent status. The extension uses
only those marked **royalty-free** or **expired**; a pipeline that needs a
module marked **licence-required** or **under-review**, or one with no
declared status, is not run — the element is left to the browser and the
popup reports which module stopped it and why.

*Use patent-encumbered accessors* in the options lifts that, with the
understanding that practising those formats may require a licence from their
patent holders in your jurisdiction. The split on the registry today:

| | formats |
|---|---|
| used by default (46) | the 42 image and audio formats listed below, plus Theora, MPEG-2, Dirac and AVI — every video format whose *decoder* is royalty-free |
| behind the option (15) | AVIF, HEIF, BPG, DTS, AMR, LC3, SBC, and the video formats whose decoder is encumbered: HEVC, VVC, VP9, AV1, AVS2, AVS3, EVC, H.264 |

Video still has to be re-encoded to H.264 to play, and the only WebAssembly
encoder for that is `libx264`, which is `licence-required`. Rather than put the
whole of video behind the option, the pipeline falls back to the H.264 encoder
the browser already ships, through WebCodecs — see the next section.

## The registry

Accessors come from `https://registry.bevara.ddns.net` by default; the
address is settable in the options, so a self-hosted or local registry works
the same way.

The background worker reads `/accessors/index.json` once an hour and keeps it
in `chrome.storage.local`; if the registry is unreachable the last catalogue
is used rather than disabling the extension. Everything under `/accessors/`
is served with `Access-Control-Allow-Origin: *`, so the page's worker fetches
the `.wasm` modules straight from the registry and the browser's HTTP cache
amortises them across elements and pages. The one file that cannot be loaded
cross-origin is the solver's JavaScript wrapper — a worker script must be
same-origin — so the content script fetches its text and re-hosts it as a
page-origin `blob:` URL.

The catalogue is also what decides whether a format is offered at all: before
touching an element the content script checks that every module of the
pipeline is published, and reports `unavailable` with the missing names
otherwise.

## How a decision is made

`bootstrap.js` scans the document at `document_start` and then follows the
DOM through a `MutationObserver` (added nodes, `<source>` children, and `src`
attribute changes, so lazy-loaded media are covered).

For each element it identifies the format from the `type` attribute, the URL
extension (kind-aware, so `x.ogg` in a `<video>` is Theora, in an `<audio>`
Vorbis) and, when neither helps, the file's first bytes, read by the
background worker.

| situation | action |
|---|---|
| image whose format no browser decodes (`native: false`) | take over immediately |
| image whose format *some* browsers decode | let the browser try; take over on `error` |
| audio/video: `canPlayType()` returns `""` for every candidate | take over immediately |
| audio/video: something looked playable | wait; take over on `MEDIA_ERR_SRC_NOT_SUPPORTED` / `MEDIA_ERR_DECODE` |

The browser therefore always gets the first try when it might succeed, and the
pipeline only steps in on a real failure.

## How a takeover runs

Everything privileged happens in the isolated world: settings, sniffing, and
fetching cross-origin sources the page could not read itself (streamed
through the background worker, without cookies, then exposed as a
same-origin `blob:` URL). The content script then posts a fully resolved
*job* to `runtime.js` in the page's main world, which:

- **images**: runs `mm_solver_minimal_1.0.1` + accessor in a Web Worker (built from a
  page-origin blob of the solver script, since a registry worker URL is
  cross-origin), gets raw RGB back, converts it to PNG on an
  `OffscreenCanvas`, sets it as `srcset` — the original `src` is left in place.
- **audio**: same, output WAV, set as `src`.
- **video**: loads `universal-tags_1.js` from the registry on demand and swaps
  the element for `<video is="universal-video_1" progressive ...>` with
  `script-directory` pointing at the registry's `/accessors/`, so playback
  starts on the first MSE segment. If the tag fails, or produces no data
  within 20 s, the element is swapped back and the file is transcoded whole
  in a worker.

If the page's CSP refuses blob workers, the same pipeline runs on the main
thread through an injected `<script>` for the solver.

## Formats

`src/common/formats.js` lists 65 formats; how many are usable depends on what
the registry publishes (45 of them today — run the test bench to see the
split). Images: JPEG XL, AVIF, HEIF, WebP,
JPEG 2000, GIF, PNG, JPEG, TIFF, BMP, JPEG-LS, JPEG XR, BPG, QOI, FLIF, DDS,
JBIG, JBIG2, ICNS, MNG, PSD, XCF, PGF, PCX, TGA, SGI, PNM, XBM, camera RAW,
Amiga/Atari retro formats, PDF (first page). Audio: MP3, FLAC, Vorbis, Opus,
Speex, AC-3, DTS, ALAC, AIFF, AMR, APE, WavPack, Musepack, TTA, GSM, G.711/G.72x,
iLBC, Codec 2, LC3, SBC, MIDI, tracker modules. Video: Theora, HEVC, VVC,
VP8/VP9, AV1, MPEG-1/2, AVS2, AVS3, EVC, Dirac, AVI (H.261/H.263, MJPEG, Ut
Video), H.264. Each entry mirrors the pipeline used by the corresponding
Showcase demo; every video pipeline gets `isobmff_1` plus an encoder tail
(`libx264_1 + libopusenc_1`) appended, resolved against the catalogue.

## Test bench

`test/` exercises the real registry, runtime and accessors from a plain page,
with `harness.js` standing in for the content script:

```bash
python3 -m http.server 8765        # from THIS directory (the one holding src/ and test/),
                                   # not from test/ - the bench loads ../src/common/*.js
open http://localhost:8765/test/           # mixed page
open "http://localhost:8765/test/?force"   # treat every known format as unsupported
open "http://localhost:8765/test/?force&bundle"       # prefer accessors/ over the registry
open "http://localhost:8765/test/?force&encumbered"  # allow patent-encumbered accessors
open "http://localhost:8765/test/?force&registry=http://localhost:9000"   # another registry
open "http://localhost:8765/test/single.html?src=media/vvc.mp4&tag=video"
open "http://localhost:8765/test/tag.html?src=media/trailer.ogg&with=ogg_1;vorbis_1;theora_1;isobmff_1&progressive"
```

`window.__BEVARA_REPORTS__` collects the per-element outcome.

## Known limitations

- **Decoders not yet published**: QOI, JBIG2, PDF and Monkey's Audio are in
  the format table but their accessors are missing from the registry; they
  are reported as unavailable, naming the module.
- **The WebCodecs encoder route** (*Allow the WebCodecs encoder*) exists for
  a registry that publishes no WebAssembly H.264 encoder: `mm_solver_1.0.1` carries
  the WebCodecs filters as builtins. It is off by default because enabling
  `wcenc` also enables `wcdec`, which hijacks the input codec and stalls the
  session (reproduced on Ogg/Theora). With `libx264` published it is not
  needed.
- **Page CSP**: a registry URL is subject to the visited page's CSP where a
  `chrome-extension://` URL is not. `scripts/sync-accessors.sh` is the answer
  (see *Local copies and page CSP*); with `--none` the strictest sites can
  block the load.
- **Progressive playback of video-only sources**: `universal-video_1` in
  `progressive` mode never emits a segment when the source has no audio track
  (reproduced with VVC-in-MP4 and MPEG-2 ES; Theora+Vorbis works). The
  extension falls back to a whole-file transcode after 20 s. This is a player
  issue (`Interface/player`), not an extension one.
- **Cross-origin proxy**: a page could plant `<img src="https://other/x.psd">`
  and read the resulting blob, i.e. use the extension as a cookie-less CORS
  proxy for public or intranet resources. Disable *Fetch cross-origin media
  through the extension* in the options if that matters in your environment.
- Sources behind cookie authentication on another origin are not proxied
  (the proxy sends no credentials).
- `<picture>`/`srcset` candidates and CSS `background-image` are not handled;
  `<canvas>`-based playback (BIFS, VRML) is out of scope.
- No Safari support (no customised built-in elements; the polyfill bundled in
  `universal-tags_1.js` is untested here).
- `HTMLMediaElement.canPlayType()` is what decides for audio/video, with all
  its "maybe" vagueness; the `error` fallback catches what it gets wrong.
