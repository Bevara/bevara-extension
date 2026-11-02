/* Format registry shared by the background service worker (sniffing) and the
 * page-world observer (native-support decision + accessor selection).
 *
 * Loaded as a classic script in both contexts, so it attaches to globalThis
 * rather than using ES module exports.
 *
 * Each entry:
 *   id        short identifier
 *   kind      "image" | "audio" | "video"
 *   ext       file extensions (lowercase, no dot)
 *   mime      MIME types this format may be served/declared with
 *   probe     the MIME string handed to HTMLMediaElement.canPlayType(); for
 *             audio/video only. Carries codecs when the container alone is not
 *             enough to answer (video/ogg is "maybe" even when Theora is gone).
 *   native    true when at least one mainstream browser decodes it natively.
 *             Images have no canPlayType, so this is how the observer decides
 *             whether to let the browser try first (and take over on `error`)
 *             or to step in immediately.
 *   using     main module (solver) - mm_solver_minimal_1.0.1 for images/audio,
 *             mm_solver_1.0.1 for anything that needs the video encoders.
 *   with      side modules (accessors), mirrors the Showcase demos.
 *   magic     byte signatures at offsets, used by the background sniffer.
 *
 * The pipelines are those exercised by the Showcase demos - see README.
 */
(function (root) {
  "use strict";

  const IMAGE = "image", AUDIO = "audio", VIDEO = "video";

  const FORMATS = [
    /* -------------------------------------------------------------- images */
    { id: "jxl", kind: IMAGE, ext: ["jxl"], mime: ["image/jxl"], native: true,
      using: "mm_solver_minimal_1.0.1", with: ["libjxl_1"],
      magic: [[0, "FF0A"], [0, "0000000C4A584C200D0A870A"]] },
    { id: "avif", kind: IMAGE, ext: ["avif", "avifs"], mime: ["image/avif"], native: true,
      using: "mm_solver_minimal_1.0.1", with: ["avif_1", "libaom_1"],
      magic: [[4, "6674797061766966"], [4, "6674797061766973"]] },
    { id: "heif", kind: IMAGE, ext: ["heif", "heic", "heifs", "heics", "hif"], mime: ["image/heif", "image/heic", "image/heif-sequence", "image/heic-sequence"], native: true,
      using: "mm_solver_minimal_1.0.1", with: ["libheif_1"],
      magic: [[4, "6674797068656963"], [4, "6674797068656978"], [4, "667479706D696631"], [4, "667479706D736631"], [4, "6674797068656966"]] },
    { id: "webp", kind: IMAGE, ext: ["webp"], mime: ["image/webp"], native: true,
      using: "mm_solver_minimal_1.0.1", with: ["libwebp_1"],
      magic: [[0, "52494646", 8, "57454250"]] },
    { id: "jp2", kind: IMAGE, ext: ["jp2", "j2k", "jpx", "jpf", "j2c", "jpc"], mime: ["image/jp2", "image/jpx", "image/jpm", "image/j2k"], native: true,
      using: "mm_solver_minimal_1.0.1", with: ["openjpeg_1"],
      magic: [[0, "0000000C6A5020200D0A870A"], [0, "FF4FFF51"]] },
    { id: "gif", kind: IMAGE, ext: ["gif"], mime: ["image/gif"], native: true,
      using: "mm_solver_minimal_1.0.1", with: ["libgif_1"],
      magic: [[0, "47494638"]] },
    { id: "png", kind: IMAGE, ext: ["png", "apng"], mime: ["image/png", "image/apng"], native: true,
      using: "mm_solver_minimal_1.0.1", with: ["libpng_1"],
      magic: [[0, "89504E470D0A1A0A"]] },
    { id: "jpeg", kind: IMAGE, ext: ["jpg", "jpeg", "jpe", "jfif"], mime: ["image/jpeg", "image/pjpeg"], native: true,
      using: "mm_solver_minimal_1.0.1", with: ["libpng_1", "libjpeg_1"],
      magic: [[0, "FFD8FF"]] },
    { id: "tiff", kind: IMAGE, ext: ["tif", "tiff"], mime: ["image/tiff", "image/tiff-fx"], native: true,
      using: "mm_solver_minimal_1.0.1", with: ["libtiff_1"],
      magic: [[0, "49492A00"], [0, "4D4D002A"]] },
    { id: "bmp", kind: IMAGE, ext: ["bmp", "dib"], mime: ["image/bmp", "image/x-bmp", "image/x-ms-bmp"], native: true,
      using: "mm_solver_minimal_1.0.1", with: ["simpleimg_1"],
      magic: [[0, "424D"]] },
    { id: "jpegls", kind: IMAGE, ext: ["jls"], mime: ["image/jls"], native: false,
      using: "mm_solver_1.0.1", with: ["libcharls_1"],
      magic: [] },
    { id: "jxr", kind: IMAGE, ext: ["jxr", "hdp", "wdp"], mime: ["image/jxr", "image/vnd.ms-photo"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libjxr_1"],
      magic: [[0, "4949BC"]] },
    { id: "bpg", kind: IMAGE, ext: ["bpg"], mime: ["image/bpg"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libbpg_1"],
      magic: [[0, "425047FB"]] },
    { id: "qoi", kind: IMAGE, ext: ["qoi"], mime: ["image/qoi"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libqoi_1"],
      magic: [[0, "716F6966"]] },
    { id: "flif", kind: IMAGE, ext: ["flif"], mime: ["image/flif"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libflif_1"],
      magic: [[0, "464C4946"]] },
    { id: "dds", kind: IMAGE, ext: ["dds"], mime: ["image/vnd-ms.dds", "image/x-dds"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libdds_1"],
      magic: [[0, "44445320"]] },
    { id: "jbig", kind: IMAGE, ext: ["jbg", "jbig", "jb1"], mime: ["image/jbig"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libjbig_1"],
      magic: [] },
    { id: "jbig2", kind: IMAGE, ext: ["jb2", "jbig2"], mime: ["image/jbig2", "image/x-jbig2"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libjbig2_1"],
      magic: [[0, "974A42320D0A1A0A"]] },
    { id: "icns", kind: IMAGE, ext: ["icns"], mime: ["image/icns", "image/x-icns"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libicns_1"],
      magic: [[0, "69636E73"]] },
    { id: "mng", kind: IMAGE, ext: ["mng", "jng"], mime: ["video/x-mng", "image/x-mng", "image/x-jng"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libmng_1"],
      magic: [[0, "8A4D4E470D0A1A0A"], [0, "8B4A4E470D0A1A0A"]] },
    { id: "psd", kind: IMAGE, ext: ["psd", "psb", "pdd"], mime: ["image/vnd.adobe.photoshop", "image/x-photoshop", "application/x-photoshop"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libpsd_1"],
      magic: [[0, "38425053"]] },
    { id: "xcf", kind: IMAGE, ext: ["xcf"], mime: ["image/x-xcf"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libxcf_1"],
      magic: [[0, "67696D7020786366"]] },
    { id: "pgf", kind: IMAGE, ext: ["pgf"], mime: ["image/x-pgf"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libpgf_1"],
      magic: [[0, "504746"]] },
    { id: "pcx", kind: IMAGE, ext: ["pcx"], mime: ["image/x-pcx", "image/vnd.zbrush.pcx"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["simpleimg_1"],
      magic: [] },
    { id: "tga", kind: IMAGE, ext: ["tga", "targa"], mime: ["image/x-tga", "image/x-targa"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["simpleimg_1"],
      magic: [] },
    { id: "sgi", kind: IMAGE, ext: ["sgi", "rgb", "rgba", "bw"], mime: ["image/x-sgi", "image/x-rgb"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["simpleimg_1"],
      magic: [[0, "01DA"]] },
    { id: "pnm", kind: IMAGE, ext: ["pbm", "pgm", "ppm", "pnm", "pam"], mime: ["image/x-portable-bitmap", "image/x-portable-graymap", "image/x-portable-pixmap", "image/x-portable-anymap"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["simpleimg_1"],
      magic: [] },
    { id: "xbm", kind: IMAGE, ext: ["xbm"], mime: ["image/x-xbitmap"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["simpleimg_1"],
      magic: [] },
    { id: "raw", kind: IMAGE, ext: ["dng", "cr2", "cr3", "nef", "arw", "orf", "raf", "rw2", "pef", "srf", "sr2", "erf", "kdc", "dcr", "mrw", "3fr", "x3f"], mime: ["image/x-adobe-dng", "image/x-canon-cr2", "image/x-canon-cr3", "image/x-nikon-nef", "image/x-sony-arw", "image/x-olympus-orf", "image/x-fuji-raf", "image/x-panasonic-rw2", "image/x-pentax-pef"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libraw_1"],
      magic: [] },
    { id: "retro", kind: IMAGE, ext: ["iff", "ilbm", "lbm", "pi1", "pc1", "msp"], mime: ["image/x-ilbm", "image/x-iff"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["librecoil_1"],
      magic: [[0, "464F524D", 8, "494C424D"]] },
    { id: "pdf", kind: IMAGE, ext: ["pdf"], mime: ["application/pdf"], native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libpoppler_1"],
      magic: [[0, "25504446"]] },

    /* --------------------------------------------------------------- audio */
    { id: "mp3", kind: AUDIO, ext: ["mp3", "mp2", "mp1", "mpga"], mime: ["audio/mpeg", "audio/mp3"], probe: "audio/mpeg", native: true,
      using: "mm_solver_minimal_1.0.1", with: ["libmpg123_1"],
      magic: [[0, "494433"], [0, "FFFB"], [0, "FFF3"], [0, "FFF2"], [0, "FFFA"]] },
    { id: "flac", kind: AUDIO, ext: ["flac"], mime: ["audio/flac", "audio/x-flac"], probe: "audio/flac", native: true,
      using: "mm_solver_minimal_1.0.1", with: ["libflac_1"],
      magic: [[0, "664C6143"]] },
    { id: "vorbis", kind: AUDIO, ext: ["ogg", "oga"], mime: ["audio/ogg", "audio/vorbis"], probe: 'audio/ogg; codecs="vorbis"', native: true,
      using: "mm_solver_minimal_1.0.1", with: ["ogg_1", "vorbis_1"],
      magic: [[0, "4F676753", "*", "01766F72626973"]] },
    { id: "opus", kind: AUDIO, ext: ["opus"], mime: ["audio/opus"], probe: 'audio/ogg; codecs="opus"', native: true,
      using: "mm_solver_minimal_1.0.1", with: ["ogg_1", "libopus_1"],
      magic: [[0, "4F676753", "*", "4F70757348656164"]] },
    { id: "speex", kind: AUDIO, ext: ["spx"], mime: ["audio/speex", "audio/x-speex"], probe: 'audio/ogg; codecs="speex"', native: false,
      using: "mm_solver_minimal_1.0.1", with: ["ogg_1", "libspeex_1"],
      magic: [[0, "4F676753", "*", "5370656578202020"]] },
    { id: "ac3", kind: AUDIO, ext: ["ac3", "ec3", "eac3"], mime: ["audio/ac3", "audio/eac3", "audio/x-ac3"], probe: "audio/ac3", native: true,
      using: "mm_solver_minimal_1.0.1", with: ["liba52_1"],
      magic: [[0, "0B77"]] },
    { id: "dts", kind: AUDIO, ext: ["dts", "dtshd"], mime: ["audio/vnd.dts", "audio/vnd.dts.hd"], probe: "audio/vnd.dts", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libdca_1"],
      magic: [[0, "7FFE8001"]] },
    { id: "alac", kind: AUDIO, ext: ["m4a", "caf"], mime: ["audio/x-m4a", "audio/mp4", "audio/x-caf"], probe: 'audio/mp4; codecs="alac"', native: true,
      using: "mm_solver_1.0.1", with: ["isobmff_1", "libalac_1"],
      magic: [] },
    { id: "aiff", kind: AUDIO, ext: ["aif", "aiff", "aifc"], mime: ["audio/aiff", "audio/x-aiff"], probe: "audio/aiff", native: true,
      using: "mm_solver_minimal_1.0.1", with: ["libaiff_1"],
      magic: [[0, "464F524D", 8, "41494646"], [0, "464F524D", 8, "41494643"]] },
    { id: "amr", kind: AUDIO, ext: ["amr", "awb"], mime: ["audio/amr", "audio/amr-wb", "audio/3gpp"], probe: "audio/amr", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libamr_1"],
      magic: [[0, "2321414D52"]] },
    { id: "ape", kind: AUDIO, ext: ["ape"], mime: ["audio/ape", "audio/x-ape", "audio/x-monkeys-audio"], probe: "audio/x-ape", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libape_1"],
      magic: [[0, "4D414320"]] },
    { id: "wavpack", kind: AUDIO, ext: ["wv"], mime: ["audio/wavpack", "audio/x-wavpack"], probe: "audio/x-wavpack", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libwavpack_1"],
      magic: [[0, "7776706B"]] },
    { id: "musepack", kind: AUDIO, ext: ["mpc", "mp+", "mpp"], mime: ["audio/musepack", "audio/x-musepack"], probe: "audio/x-musepack", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libmpc_1"],
      magic: [[0, "4D50434B"], [0, "4D502B"]] },
    { id: "tta", kind: AUDIO, ext: ["tta"], mime: ["audio/tta", "audio/x-tta"], probe: "audio/x-tta", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libtta_1"],
      magic: [[0, "54544131"]] },
    { id: "gsm", kind: AUDIO, ext: ["gsm"], mime: ["audio/gsm", "audio/x-gsm"], probe: "audio/x-gsm", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libgsm_1"],
      magic: [] },
    { id: "g72x", kind: AUDIO, ext: ["au", "snd"], mime: ["audio/basic", "audio/x-au"], probe: "audio/basic", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libg711_1"],
      magic: [[0, "2E736E64"]] },
    { id: "ilbc", kind: AUDIO, ext: ["lbc", "ilbc"], mime: ["audio/ilbc"], probe: "audio/ilbc", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libilbc_1"],
      magic: [] },
    { id: "codec2", kind: AUDIO, ext: ["c2"], mime: ["audio/codec2"], probe: "audio/codec2", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libcodec2_1"],
      magic: [[0, "C0DEC2"]] },
    { id: "lc3", kind: AUDIO, ext: ["lc3"], mime: ["audio/lc3"], probe: "audio/lc3", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["liblc3_1"],
      magic: [[0, "1CCC"]] },
    { id: "sbc", kind: AUDIO, ext: ["sbc"], mime: ["audio/sbc", "audio/x-sbc"], probe: "audio/x-sbc", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libsbc_1"],
      magic: [[0, "9C"]] },
    { id: "midi", kind: AUDIO, ext: ["mid", "midi", "kar"], mime: ["audio/midi", "audio/x-midi"], probe: "audio/midi", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libmidi_1"],
      magic: [[0, "4D546864"]] },
    { id: "tracker", kind: AUDIO, ext: ["mod", "xm", "s3m", "it", "mptm", "669", "med", "okt", "stm"], mime: ["audio/x-mod", "audio/mod", "audio/xm", "audio/x-xm", "audio/s3m", "audio/x-s3m", "audio/it", "audio/x-it"], probe: "audio/x-mod", native: false,
      using: "mm_solver_minimal_1.0.1", with: ["libxmp_1"],
      magic: [[0, "457874656E646564204D6F64756C653A"], [0, "494D504D"], [44, "5343524D"]] },

    /* --------------------------------------------------------------- video */
    /* Every video pipeline ends in isobmff_1 + libx264_1 (fragmented MP4 /
     * H.264, the one thing every browser plays) plus libopusenc_1 so that
     * progressive playback has an MSE-accepted audio codec; those three are
     * appended by the observer, `with` lists only the demuxer/decoders. */
    /* Ogg: the BOS pages of a multiplexed file may come in any order, so the
     * codec header is searched for ("*") in the sniffed window rather than
     * read at offset 28; Theora is listed before the audio-only Ogg formats so
     * that a video file with a Vorbis track is not taken for plain Vorbis. */
    { id: "theora", kind: VIDEO, ext: ["ogv", "ogm", "ogx", "ogg"], mime: ["video/ogg", "application/ogg"], probe: 'video/ogg; codecs="theora, vorbis"', native: true,
      using: "mm_solver_1.0.1", with: ["ogg_1", "vorbis_1", "theora_1"],
      magic: [[0, "4F676753", "*", "807468656F7261"]] },
    { id: "hevc", kind: VIDEO, ext: ["hevc", "h265", "265"], mime: ["video/hevc", "video/h265"], probe: 'video/mp4; codecs="hvc1.1.6.L93.B0"', native: true,
      using: "mm_solver_1.0.1", with: ["libde265_1", "libfaad_1"],
      magic: [] },
    { id: "vvc", kind: VIDEO, ext: ["vvc", "h266", "266"], mime: ["video/vvc", "video/h266"], probe: 'video/mp4; codecs="vvc1.1.L93.CQA.O0+3"', native: false,
      using: "mm_solver_1.0.1", with: ["libOpenVVC_1", "libfaad_1"],
      magic: [] },
    { id: "vp9", kind: VIDEO, ext: ["webm"], mime: ["video/webm"], probe: 'video/webm; codecs="vp9, opus"', native: true,
      using: "mm_solver_1.0.1", with: ["libvpx_1", "webmdmx_1"],
      magic: [[0, "1A45DFA3"]] },
    { id: "av1", kind: VIDEO, ext: ["av1", "obu"], mime: ["video/av1", "video/AV1"], probe: 'video/webm; codecs="av01.0.04M.08"', native: true,
      using: "mm_solver_1.0.1", with: ["libaom_1", "webmdmx_1"],
      magic: [] },
    { id: "mpeg2", kind: VIDEO, ext: ["mpg", "mpeg", "m2v", "mpv", "m1v", "vob", "ps"], mime: ["video/mpeg", "video/mp2p", "video/x-mpeg"], probe: "video/mpeg", native: false,
      using: "mm_solver_1.0.1", with: ["libmpeg2_1", "libmpg123_1"],
      magic: [[0, "000001BA"], [0, "000001B3"]] },
    { id: "avs2", kind: VIDEO, ext: ["avs2"], mime: ["video/avs2"], probe: "video/avs2", native: false,
      using: "mm_solver_1.0.1", with: ["libdavs2_1"],
      magic: [] },
    { id: "avs3", kind: VIDEO, ext: ["avs3"], mime: ["video/avs3"], probe: "video/avs3", native: false,
      using: "mm_solver_1.0.1", with: ["libuavs3d_1"],
      magic: [] },
    { id: "evc", kind: VIDEO, ext: ["evc"], mime: ["video/evc"], probe: "video/evc", native: false,
      using: "mm_solver_1.0.1", with: ["libxevd_1"],
      magic: [] },
    { id: "dirac", kind: VIDEO, ext: ["drc", "dirac"], mime: ["video/x-dirac"], probe: "video/x-dirac", native: false,
      using: "mm_solver_1.0.1", with: ["libschro_1"],
      magic: [[0, "42424344"]] },
    /* AVI carries too many codecs to pick a decoder from the extension alone;
     * this bundle covers the demos (H.261/H.263, MJPEG, Ut Video). */
    { id: "avi", kind: VIDEO, ext: ["avi"], mime: ["video/avi", "video/x-msvideo", "video/msvideo"], probe: "video/x-msvideo", native: false,
      using: "mm_solver_1.0.1", with: ["avidmx_1", "ffmpeg-h26x_1", "libjpeg_1", "rgbyuv_1", "libutvideo_1", "libmpg123_1"],
      magic: [[0, "52494646", 8, "41564920"]] },
    /* H.264 in MP4 is native everywhere; kept so a broken/edge-case stream
     * still has a route (the `error` fallback). */
    { id: "h264", kind: VIDEO, ext: ["mp4", "m4v", "mov", "3gp"], mime: ["video/mp4", "video/quicktime", "video/3gpp"], probe: 'video/mp4; codecs="avc1.42E01E"', native: true,
      using: "mm_solver_1.0.1", with: ["isobmff_1", "h264bsd_1", "libde265_1", "libOpenVVC_1", "libaom_1", "libfaad_1"],
      magic: [[4, "66747970"]] }
  ];

  /* Every video pipeline has to end in something the browser plays. The
   * decoders above only get the frames out; an MP4 multiplexer and an H.264
   * encoder turn them back into a stream a <video> accepts, and an Opus
   * encoder gives progressive playback an audio codec MSE admits. Which of
   * these exist is a property of the registry, not of this file, so the tail
   * is assembled by pipelineFor() against the catalogue. */
  const VIDEO_MUX = "isobmff_1";
  const VIDEO_ENCODERS = { video: "libx264_1", audio: "libopusenc_1" };

  const byId = new Map(FORMATS.map(f => [f.id, f]));
  const byExt = new Map();   /* ext -> [formats], several when ambiguous (.ogg) */
  const byMime = new Map();
  for (const f of FORMATS) {
    for (const e of f.ext) { if (!byExt.has(e)) byExt.set(e, []); byExt.get(e).push(f); }
    for (const m of f.mime) if (!byMime.has(m)) byMime.set(m, f);
  }

  function extensionOf(url) {
    try {
      const path = new URL(url, "http://x/").pathname;
      const m = /\.([A-Za-z0-9+]+)$/.exec(path);
      return m ? m[1].toLowerCase() : "";
    } catch (e) {
      return "";
    }
  }

  /* `kind` is the element's own nature ("video" for <video>): an ambiguous
   * extension resolves to the format of that kind when one exists. */
  function fromExtension(url, kind) {
    const ext = extensionOf(url);
    const list = ext ? byExt.get(ext) : null;
    if (!list) return null;
    if (kind) { const k = list.find(f => f.kind === kind); if (k) return k; }
    return list[0];
  }

  function fromMime(mime) {
    if (!mime) return null;
    const base = mime.split(";")[0].trim().toLowerCase();
    return byMime.get(base) || null;
  }

  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  function matchAt(bytes, offset, pattern) {
    if (offset + pattern.length > bytes.length) return false;
    for (let i = 0; i < pattern.length; i++) if (bytes[offset + i] !== pattern[i]) return false;
    return true;
  }

  function hexAt(bytes, offset, hex) {
    const pattern = hexToBytes(hex);
    if (offset === "*") {
      for (let o = 0; o + pattern.length <= bytes.length; o++) if (matchAt(bytes, o, pattern)) return true;
      return false;
    }
    return matchAt(bytes, offset, pattern);
  }

  /* Identify from the first bytes of the file. Signatures are
   * [offset, hex, offset, hex, ...] and every pair must hold; an offset of
   * "*" means "anywhere in the window". Video formats are tried first so
   * that a container carrying both video and audio (Ogg Theora+Vorbis) is
   * not reported as its audio track. */
  const MAGIC_ORDER = FORMATS.slice().sort((a, b) => {
    const rank = k => (k === VIDEO ? 0 : k === AUDIO ? 1 : 2);
    return rank(a.kind) - rank(b.kind);
  });

  function fromMagic(bytes) {
    for (const f of MAGIC_ORDER) {
      for (const sig of f.magic) {
        let ok = true;
        for (let i = 0; i < sig.length; i += 2) {
          if (!hexAt(bytes, sig[i], sig[i + 1])) { ok = false; break; }
        }
        if (ok) return f;
      }
    }
    return null;
  }

  /* Resolve a format to a runnable pipeline against a registry catalogue
   * (src/common/registry.js). Returns `missing` when the registry does not
   * publish something the format needs; the caller then leaves the element
   * to the browser rather than starting a pipeline that cannot finish.
   *
   * `has` is a predicate on module names; passing none assumes everything is
   * available, which is what the offline tests want.
   */
  /* `runtimeOf` maps the solver the table names to the one the registry
   * publishes (BevaraRegistry.runtimeFor). */
  function pipelineFor(f, has, runtimeOf) {
    const available = has || (() => true);
    const list = f.with.slice();
    const using = runtimeOf ? runtimeOf(f.using) : f.using;
    const result = { using, with: list, useWebcodec: false, missing: [], notes: [] };

    if (!available(using)) result.missing.push(using);

    if (f.kind === VIDEO) {
      if (list.indexOf(VIDEO_MUX) === -1) list.push(VIDEO_MUX);
      if (available(VIDEO_ENCODERS.video)) {
        if (list.indexOf(VIDEO_ENCODERS.video) === -1) list.push(VIDEO_ENCODERS.video);
        if (available(VIDEO_ENCODERS.audio) && list.indexOf(VIDEO_ENCODERS.audio) === -1) {
          list.push(VIDEO_ENCODERS.audio);
        }
      } else {
        /* No WebAssembly H.264 encoder in the registry. mm_solver_1.0.1 carries the
         * WebCodecs filters as builtins, so the platform encoder can stand in
         * - but registering them also registers the WebCodecs *decoder*,
         * which competes with the wasm decoders for the input codec. The
         * caller decides whether to accept that (option webcodecEncoder). */
        result.useWebcodec = true;
        result.notes.push("no wasm H.264 encoder published; would rely on WebCodecs");
      }
    }

    for (const m of list) if (!available(m)) result.missing.push(m);
    return result;
  }

  /* Every module the registry may be asked for, across all formats. */
  function allModules() {
    const set = new Set();
    for (const f of FORMATS) {
      set.add(f.using);
      for (const m of pipelineFor(f).with) set.add(m);
    }
    set.add(VIDEO_MUX);
    set.add(VIDEO_ENCODERS.video);
    set.add(VIDEO_ENCODERS.audio);
    return Array.from(set).sort();
  }

  root.BevaraFormats = {
    FORMATS, VIDEO_MUX, VIDEO_ENCODERS, byId, byExt, byMime,
    extensionOf, fromExtension, fromMime, fromMagic, pipelineFor, allModules
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
