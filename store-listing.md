# Chrome Web Store listing — Bevara Universal Media

Field-by-field copy for
<https://chrome.google.com/webstore/devconsole/.../cgfhhhdalbhfammimblcclkjghpaicdl/edit>.
Version in `manifest.json`: **2.1.0** (bump it before every upload; the store
refuses a version it already has).

---

## Package

`scripts/package.sh` builds the zip. **Which bundle mode you ship changes
whether the listing is policy-compliant — read "Remote code" below before
uploading.**

| mode | command | zip |
|---|---|---|
| everything packaged | `scripts/sync-accessors.sh --all && scripts/package.sh` | ~7.6 MB |
| solvers + tags packaged, decoders fetched | `scripts/sync-accessors.sh && scripts/package.sh` | ~3.1 MB |
| nothing packaged | `scripts/sync-accessors.sh --none && scripts/package.sh` | ~40 kB |

---

## Store listing tab

**Name** (45 max)

```
Bevara Universal Media
```

**Summary** (132 max — this is exactly 132)

```
Plays the image, audio and video formats your browser can't, decoding them with WebAssembly accessors from a Bevara filter registry.
```

**Category**: Workflow & Planning (or Tools). **Language**: English.

**Detailed description**

```
Your browser decodes a handful of media formats and ignores the rest. Bevara
Universal Media gives it the others.

It watches each page for <img>, <audio> and <video> elements, notices the ones
the browser cannot decode, and hands them to a WebAssembly decoding pipeline
that returns something the browser does play — PNG for images, WAV for audio,
MP4/H.264 for video. Nothing changes on the sites you visit: the markup stays
standard, and the page needs no plugin, no script and no cooperation.

The browser always goes first. A format it might handle is left alone until it
actually fails, so nothing is slowed down or re-decoded needlessly.

WHAT IT PLAYS

Images — JPEG XL, JPEG 2000, JPEG XR, JPEG-LS, TIFF, BMP, GIF, WebP, FLIF,
PGF, DDS, JBIG, ICNS, MNG, Photoshop PSD, GIMP XCF, PCX, TGA, SGI, PNM, XBM,
camera raw (DNG, CR2, NEF, ARW, ORF, RAF, RW2…), Amiga and Atari pictures.

Audio — AC-3, Speex, ALAC, AIFF, Musepack, WavPack, True Audio, Monkey's
Audio, GSM 06.10, G.711/G.721, iLBC, Codec 2, LC3, SBC, AMR, DTS, MIDI, and
tracker modules (MOD, XM, S3M, IT).

Video — Theora, HEVC, VVC (H.266), VP8/VP9, AV1, MPEG-1/2, AVS2, AVS3, EVC,
Dirac, and AVI contents (H.261, H.263, MJPEG, Ut Video).

PATENTS ARE NOT DECIDED FOR YOU

Every decoder in the Bevara registry declares a patent status. By default the
extension uses only those marked royalty-free or expired. A format whose
decoder is marked licence-required or under-review is left to the browser and
reported in the popup, with the module and the status that stopped it. One
checkbox in the options lifts that, if practising those formats is something
you are entitled to do.

WHAT IT DOES NOT DO

No account, no tracking, no analytics, no data sent anywhere. Decoding happens
on your machine, in a Web Worker. The extension reads the registry's public
catalogue and downloads decoders from it; it never uploads anything about the
pages you visit.

OPEN SOURCE

The decoders are the Bevara open-source accessors, each published with its
licence, its patent status, its source and an Ed25519 signature recorded in
the registry's transparency log. Documentation: https://bevara.com/documentation/
Demonstration of every format: https://bevara.github.io/Showcase/
```

**Support URL**: `https://bevara.com/documentation/`
**Privacy policy URL**: required — the listing cannot be published with
`<all_urls>` and no policy. Point it at a page on bevara.com stating what the
"no data collected" declaration below says.

**Screenshots** (1280×800 or 640×400, at least one): the demo page at
`https://bevara.github.io/Showcase/extension/` is built for this — one capture
without the extension (broken frames) and one with it (the same grid decoded)
makes the point in two images. A third of the popup shows the per-element
report and the patent statuses.

---

## Privacy tab

**Single purpose**

```
Display and play multimedia files that the browser cannot decode natively, by
transcoding them in the page with WebAssembly decoders.
```

**Justification — `storage`**

```
Stores the user's own settings (which registry to use, whether to allow
patent-encumbered decoders, worker and progressive-playback preferences, the
list of sites the extension is switched off on) and caches the registry's
catalogue of available decoders so that browsing does not re-request it.
```

**Justification — host permissions (`<all_urls>`)**

```
The extension cannot know in advance which site will serve a format the
browser does not support, so it must be able to examine <img>, <audio> and
<video> elements on any page. Host access is also what lets it read the first
bytes of a media file to identify its format when the URL and MIME type do not
say, and fetch a media file the page itself is not allowed to read because the
server sends no CORS header. No page content is collected or transmitted.
```

**Data usage**: declare *no* data collected in every category, and tick the
three certifications. This is accurate: the extension sends nothing anywhere;
its only outbound requests are to the filter registry for public decoder files,
and to the media URL the page already references.

---

## Remote code — settle this before uploading

Manifest V3 requires that all code an extension runs be contained in its
package; remotely hosted code, **WebAssembly included**, is not allowed.

In `--glue` and `--none` modes this extension downloads `.wasm` decoders from
`registry.bevara.ddns.net` and instantiates them. That is remotely hosted code,
and a reviewer who notices it can reject the item.

The safe build is `scripts/sync-accessors.sh --all`: every decoder travels in
the package (~7.6 MB), the registry is used only for its catalogue, and nothing
executable is fetched at run time. To be fully compliant the registry fallback
for modules absent from the bundle should also be disabled in that build —
otherwise the path still exists even if it is rarely taken.

The trade-off is real: `--all` loses the property that a decoder published to
the registry becomes playable without an extension update. That is a product
decision, not a technical one.

---

## What changed since the published version

- Accessors come from a Bevara filter registry instead of being hard-wired;
  the catalogue carries versions, licences and patent statuses.
- Patent gate: only royalty-free and expired decoders are used by default; an
  option allows the others.
- 17 new decoders published to the registry, which makes video work (H.264
  encoding) and adds HEVC, VVC, VP8/VP9, AV1, AVS2/AVS3, EVC, HEIF, BPG, AMR,
  DTS, LC3, SBC, AIFF.
- Popup reports what was decoded, what was declined and why, plus the registry
  in use and the patent status of the accessors involved.
- Options: registry address, catalogue refresh, patent policy, worker,
  progressive playback, cross-origin proxy.
