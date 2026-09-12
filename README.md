# Bevara Universal Media
By installing and using Bevara Universal Media you confirm that you agree to the [Terms of Service](https://bevara.com/terms_of_service/).

By using the Bevara open-source accessors and/or creating or modifying any filters, you agree to be bound by the Open-Source Developer's EULA as found at: https://bevara.com/terms_of_service/. You further agree to be bound by the underlying code licenses as described in [LICENSE.md](LICENSE.md).

A browser extension based on Bevara open-source libraries that displays and plays the file formats your browser does not support. It watches every page you visit for images, audio and video, and whenever the browser cannot decode a source on its own, a WebAssembly decoding pipeline steps in and hands back a format the browser plays natively. No change to the website is needed: the tags stay standard `<img>`, `<audio>` and `<video>`.

<!-- Fill in once published / pushed -->
[Packaged version](#) &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; [Source code](#) &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; &emsp; [Help](https://bevara.com/documentation/)

## What it does

- **Images** — JPEG XL, AVIF, HEIF/HEIC, JPEG 2000, JPEG XR, JPEG-LS, WebP, TIFF, BMP, BPG, QOI, FLIF, DDS, JBIG/JBIG2, ICNS, MNG, PSD, XCF, PGF, PCX, TGA, SGI, PNM, XBM, camera RAW, Amiga/Atari retro formats, PDF (first page)… are decoded and shown as PNG.
- **Audio** — MP3, FLAC, Vorbis, Opus, Speex, AC-3, DTS, ALAC, AIFF, AMR, APE, WavPack, Musepack, TTA, GSM, G.711/G.72x, iLBC, Codec 2, LC3, SBC, MIDI, tracker modules… are decoded to WAV.
- **Video** — Theora, HEVC, VVC, VP8/VP9, AV1, MPEG-1/2, AVS2, AVS3, EVC, Dirac, AVI (H.261/H.263, MJPEG, Ut Video)… are transcoded to MP4/H.264, progressively through Media Source Extensions so playback starts before the transcode ends.

The browser always gets the first try: a format it may support is only taken over when it actually fails to decode it. The toolbar badge counts the elements taken over on the current tab; the popup lists them and lets you switch the extension off per site.

It is the browser-extension form of the MutationObserver approach described in *Enabling Browser Support of Arbitrary Multimedia via Dynamic WebAssembly-Based Pipelines* (§4.2), built on the Showcase `scripts/MutationObserver.js` demo and the `universal-*` Web Components.

## Layout

```
manifest.json
src/
  common/formats.js      format registry: extensions, MIME types, magic bytes,
                         native-support hints and accessor pipelines (shared)
  background.js          service worker: byte sniffing, CORS-free media fetch
                         (streamed over a Port), per-tab state for the popup
  content/bootstrap.js   isolated-world content script: the MutationObserver,
                         detection and decision logic, bridge to the page
  page/runtime.js        page-world runtime: runs the pipelines (Worker or main
                         thread), upgrades <video> to universal-video_1
  options/               settings page
  popup/                 per-tab summary and per-site on/off switch
accessors/               solver_*.{js,wasm}, *_1.wasm, universal-tags_1.js
                         (not committed - see below)
scripts/sync-accessors.sh
test/                    stand-alone test bench (no extension needed)
```

## Install (unpacked)

1. Populate `accessors/` from a checkout of the Showcase repository:

   ```bash
   scripts/sync-accessors.sh ../Showcase/accessors
   ```

   Only the modules the registry can ask for are copied (~31 MB). `--all`
   copies every accessor instead.

2. Chrome / Edge / Brave: open `chrome://extensions`, enable *Developer mode*,
   *Load unpacked*, pick this directory.

   Firefox: `about:debugging` → *This Firefox* → *Load Temporary Add-on* →
   `manifest.json`. (Firefox needs a `browser_specific_settings.gecko.id`
   entry in the manifest for a permanent install.)

3. Visit a page with an exotic format, e.g. the Showcase demos or `test/`.
   The toolbar badge counts the elements taken over on the current tab; the
   popup lists them and lets you disable the extension for the site.

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

- **images**: runs `solver_minimal_1` + accessor in a Web Worker (built from a
  page-origin blob of the solver script, since a `chrome-extension://` worker
  is cross-origin), gets raw RGB back, converts it to PNG on an
  `OffscreenCanvas`, sets it as `srcset` — the original `src` is left in place.
- **audio**: same, output WAV, set as `src`.
- **video**: loads `universal-tags_1.js` on demand and swaps the element for
  `<video is="universal-video_1" progressive ...>` pointing
  `script-directory` at the extension's accessors, so playback starts on the
  first MSE segment. If the tag fails, or produces no data within 20 s, the
  element is swapped back and the file is transcoded whole in a worker.

If the page's CSP refuses blob workers, the same pipeline runs on the main
thread through a `<script src="chrome-extension://…/solver_minimal_1.js">`
(extension URLs are exempt from page CSP).

## Formats

`src/common/formats.js` lists 65 formats. Images: JPEG XL, AVIF, HEIF, WebP,
JPEG 2000, GIF, PNG, JPEG, TIFF, BMP, JPEG-LS, JPEG XR, BPG, QOI, FLIF, DDS,
JBIG, JBIG2, ICNS, MNG, PSD, XCF, PGF, PCX, TGA, SGI, PNM, XBM, camera RAW,
Amiga/Atari retro formats, PDF (first page). Audio: MP3, FLAC, Vorbis, Opus,
Speex, AC-3, DTS, ALAC, AIFF, AMR, APE, WavPack, Musepack, TTA, GSM, G.711/G.72x,
iLBC, Codec 2, LC3, SBC, MIDI, tracker modules. Video: Theora, HEVC, VVC,
VP8/VP9, AV1, MPEG-1/2, AVS2, AVS3, EVC, Dirac, AVI (H.261/H.263, MJPEG, Ut
Video), H.264. Each entry mirrors the pipeline used by the corresponding
Showcase demo; every video pipeline gets `isobmff_1 + libx264_1 +
libopusenc_1` appended (MP4/H.264 output, Opus audio for MSE).

## Test bench

`test/` exercises the real registry, runtime and accessors from a plain page,
with `harness.js` standing in for the content script:

```bash
python3 -m http.server 8765        # from this directory
open http://localhost:8765/test/           # mixed page
open "http://localhost:8765/test/?force"   # treat every known format as unsupported
open "http://localhost:8765/test/single.html?src=media/vvc.mp4&tag=video"
open "http://localhost:8765/test/tag.html?src=media/trailer.ogg&with=ogg_1;vorbis_1;theora_1;isobmff_1;libx264_1;libopusenc_1&progressive"
```

`window.__BEVARA_REPORTS__` collects the per-element outcome.

## Known limitations

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
