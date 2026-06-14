# imgforge

A general-purpose CLI that turns a directory of photos into responsive,
web/mobile-optimized derivatives — **AVIF + WebP + JPEG** at multiple widths —
plus a frontend-ready `manifest.json` for building `<picture>`/`srcset`.

It is project-agnostic: point it at any folder of images. It was built for a
wedding-photo gallery but ships sensible defaults for any photo site.

## Why it exists / what it gets right

Naïve "loop over `*.jpg` and `thumbnail()`" scripts mishandle real camera
exports. imgforge handles the cases that actually occur:

- **EXIF orientation** — auto-rotates (`exif_transpose`) *before* resizing, then
  strips the tag, so phone/rotated shots aren't sideways and width targets hit
  the right axis.
- **Color** — converts ICC-profiled images to sRGB (assumes sRGB when untagged),
  flattens CMYK / grayscale / 16-bit / alpha, and embeds a tiny sRGB profile.
- **MPO / multi-frame JPEGs** — decodes the primary frame (branches on real
  format, not the `.JPG` extension).
- **Junk** — skips macOS AppleDouble (`._*`), `.DS_Store`, `Thumbs.db`, hidden
  and zero-byte files; matches extensions case-insensitively (`.JPG` == `.jpg`).
- **No upscaling** — never emits a width larger than the source.
- **Robustness** — atomic writes (temp + rename), truncated-file tolerance,
  decompression-bomb guard, parallel across CPU cores, and an incremental cache
  so re-runs only touch new/changed files.

## Install

Modern Pillow wheels (≥ 11.3) bundle AVIF, WebP and JPEG encoders, so the base
install is just Pillow:

```bash
pip install -e tools/imgforge          # from the repo root
# optional: pip install -e "tools/imgforge[heic]"   # to also read .heic/.heif
```

Requires Python ≥ 3.11.

## Usage

```bash
imgforge ./photos                      # optimize -> ./optimized + manifest.json
imgforge ./photos -o ./public/img      # choose output root
imgforge inspect ./photos              # plan only: counts, no writes
imgforge ./photos -p hero              # use a different profile
imgforge ./photos -s 512,1024,2048 -f avif,webp   # override sizes/formats
imgforge ./photos -q avif=60,webp=82,jpeg=84       # per-format quality
imgforge ./photos -j 8 -v              # 8 workers, per-file logging
imgforge init                          # scaffold an imgforge.toml
imgforge profiles                      # list available profiles
imgforge clean ./optimized --yes       # delete derivatives no longer in manifest
```

Re-running is cheap: unchanged sources are skipped via the `.imgforge-cache.json`
sidecar. Changing a profile's sizes/quality/formats correctly invalidates the
cache.

## Output layout

```
optimized/
  manifest.json
  <source-subdir>/                # source folder tree is preserved
    avif/  <stem>_400.avif … <stem>_2048.avif
    webp/  <stem>_400.webp …
    jpeg/  <stem>_400.jpg …       # the <img> fallback format
  .imgforge-cache.json            # incremental-build cache
```

## Manifest

One entry per source image with intrinsic dimensions (to avoid CLS), a
placeholder, and pre-built `srcset` strings:

```json
{
  "version": 1,
  "profile": "web-gallery",
  "images": [
    {
      "id": "album/ceremony-01",
      "source": { "path": "album/ceremony-01.jpg", "width": 6000, "height": 4000,
                  "bytes": 8421003, "hash": "sha256:…", "format": "JPEG" },
      "aspectRatio": 1.5,
      "placeholder": { "type": "lqip", "width": 24, "height": 16,
                       "dataURI": "data:image/webp;base64,…", "color": "#8a7f6b" },
      "variants": [
        { "format": "avif", "width": 1024, "height": 683, "bytes": 71234,
          "path": "album/avif/ceremony-01_1024.avif" }
      ],
      "srcset": {
        "avif": "album/avif/ceremony-01_400.avif 400w, … 2048w",
        "webp": "…", "jpeg": "…"
      },
      "fallback": "album/jpeg/ceremony-01_1024.jpg"
    }
  ]
}
```

Frontend: group `variants`/`srcset` by format into `<source>` elements (AVIF →
WebP → JPEG), put `fallback` on the `<img>`, set `width`/`height` from `source`,
and use `placeholder.dataURI` (blurred via CSS) until the image loads.

## Configuration

`imgforge.toml` (auto-discovered, walking up from the source dir) defines named
**profiles** so settings are reusable across projects. See
[`imgforge.example.toml`](imgforge.example.toml). Built-in profiles:
`web-gallery` (default), `thumbnail-only`, `hero`, `full`.
