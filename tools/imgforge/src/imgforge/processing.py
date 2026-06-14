"""Image processing core: load/normalize -> resize -> encode, plus placeholders.

The single most important rule is the *order* of operations:

    open -> exif_transpose (rotate) -> mode/color normalize to sRGB
         -> resize (no upscale) -> light sharpen -> encode (strip metadata)

Getting this order wrong rotates ~4% of phone photos sideways or applies the
width/height targets to the wrong axis.
"""

from __future__ import annotations

import base64
import functools
import io
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageCms, ImageFile, ImageFilter, ImageOps

from .profiles import FORMAT_EXT, PILLOW_FORMAT, Profile

# Slightly-truncated files (common on copied SD cards) decode their valid
# portion instead of raising; genuinely broken files still raise and get skipped.
ImageFile.LOAD_TRUNCATED_IMAGES = True

# EXIF orientation values that swap width/height.
_SWAP_ORIENTATIONS = {5, 6, 7, 8}

_heif_registered = False


def register_optional_decoders() -> None:
    """Enable HEIC/HEIF decoding if pillow-heif is installed (idempotent)."""
    global _heif_registered
    if _heif_registered:
        return
    try:
        import pillow_heif  # type: ignore

        pillow_heif.register_heif_opener()
    except Exception:
        pass
    _heif_registered = True


@functools.lru_cache(maxsize=1)
def _srgb_profile() -> ImageCms.ImageCmsProfile:
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))


@functools.lru_cache(maxsize=1)
def srgb_icc_bytes() -> bytes:
    """A compact (~588 byte) sRGB ICC profile to embed in delivery images."""
    return _srgb_profile().tobytes()


@dataclass
class SourceImage:
    """A normalized, orientation-corrected sRGB RGB image + its true source facts."""

    image: Image.Image          # working image (sRGB, mode RGB, possibly drafted)
    src_width: int              # true full-res, orientation-corrected width
    src_height: int
    src_format: str             # original Pillow format (e.g. JPEG, MPO, PNG)

    @property
    def src_long_edge(self) -> int:
        return max(self.src_width, self.src_height)


def _composite_on_white(img: Image.Image) -> Image.Image:
    img = img.convert("RGBA")
    bg = Image.new("RGB", img.size, (255, 255, 255))
    bg.paste(img, mask=img.split()[-1])
    return bg


def _to_srgb_rgb(img: Image.Image) -> Image.Image:
    """Normalize any mode to 8-bit sRGB RGB; convert via ICC when present."""
    # Flatten transparency first (delivery formats here are opaque photos).
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        return _composite_on_white(img)

    icc = img.info.get("icc_profile")
    if icc and img.mode in ("RGB", "CMYK", "L"):
        try:
            out = ImageCms.profileToProfile(
                img,
                ImageCms.ImageCmsProfile(io.BytesIO(icc)),
                _srgb_profile(),
                outputMode="RGB",
            )
            if out is not None:
                return out
        except Exception:
            pass  # fall back to a plain mode conversion (assume sRGB)

    if img.mode != "RGB":
        return img.convert("RGB")
    return img


def sized_widths(profile: Profile, src_long_edge: int) -> list[int]:
    """Long-edge widths to emit; never larger than the source unless enlarge=True."""
    widths: set[int] = set()
    for s in profile.sizes:
        widths.add(s if profile.enlarge else min(s, src_long_edge))
    return sorted(w for w in widths if w > 0)


def load_normalized(path: Path, max_target: int) -> SourceImage:
    """Open, (draft-)decode, rotate, and color-normalize a source image.

    ``max_target`` is the largest long-edge width that will be produced; it lets
    libjpeg decode big JPEGs at a reduced scale (big speed/memory win) while
    guaranteeing the decoded image is still >= every target (so no upscaling).
    """
    img = Image.open(path)
    header_w, header_h = img.size
    orientation = (img.getexif() or {}).get(274, 1)
    if orientation in _SWAP_ORIENTATIONS:
        src_w, src_h = header_h, header_w
    else:
        src_w, src_h = header_w, header_h
    src_format = img.format or "UNKNOWN"

    if src_format in ("JPEG", "MPO") and max_target > 0:
        try:
            img.draft("RGB", (max_target, max_target))
        except Exception:
            pass

    # Rotate to display orientation (loads pixels; flattens MPO to frame 0; drops tag).
    img = ImageOps.exif_transpose(img)
    img = _to_srgb_rgb(img)
    return SourceImage(image=img, src_width=src_w, src_height=src_h, src_format=src_format)


def resize_long_edge(img: Image.Image, target_long: int, sharpen: bool) -> Image.Image:
    """Downscale so the long edge == target_long (aspect preserved). Never upscales."""
    w, h = img.size
    long_edge = max(w, h)
    if target_long >= long_edge:
        return img
    scale = target_long / long_edge
    out = img.resize((max(1, round(w * scale)), max(1, round(h * scale))),
                     Image.Resampling.LANCZOS)
    if sharpen:
        # Mild unsharp to recover the softness that downscaling introduces.
        out = out.filter(ImageFilter.UnsharpMask(radius=1.0, percent=60, threshold=2))
    return out


def encode_to_bytes(img: Image.Image, fmt: str, quality: int,
                    profile: Profile, embed_icc: bool) -> bytes:
    """Encode ``img`` to ``fmt`` and return the bytes (metadata stripped)."""
    buf = io.BytesIO()
    params: dict = {}
    if embed_icc:
        params["icc_profile"] = srgb_icc_bytes()

    if fmt == "jpeg":
        params.update(quality=quality, optimize=True,
                      progressive=profile.jpeg_progressive, subsampling="4:2:0")
    elif fmt == "webp":
        params.update(quality=quality, method=profile.webp_method)
    elif fmt == "avif":
        params.update(quality=quality, speed=profile.avif_speed,
                      subsampling="4:2:0", codec="aom")
    else:
        raise ValueError(f"unsupported format: {fmt!r}")

    img.save(buf, PILLOW_FORMAT[fmt], **params)
    return buf.getvalue()


def _dominant_color(img: Image.Image) -> str:
    px = img.resize((1, 1), Image.Resampling.LANCZOS).getpixel((0, 0))
    r, g, b = (px[:3] if isinstance(px, (tuple, list)) else (px, px, px))
    return f"#{r:02x}{g:02x}{b:02x}"


def make_placeholder(img: Image.Image, mode: str) -> dict | None:
    """Build a placeholder descriptor: None, dominant color, or a base64 LQIP."""
    if mode == "none":
        return None
    color = _dominant_color(img)
    if mode == "color":
        return {"type": "color", "color": color}
    # lqip: ~24px-long-edge WebP, base64-inlined (no extra request, blur via CSS).
    w, h = img.size
    scale = 24 / max(w, h)
    tw, th = max(1, round(w * scale)), max(1, round(h * scale))
    small = img.resize((tw, th), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    small.save(buf, "WEBP", quality=30, method=4)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return {
        "type": "lqip",
        "width": tw,
        "height": th,
        "dataURI": f"data:image/webp;base64,{b64}",
        "color": color,
    }


def output_name(profile: Profile, stem: str, width: int, fmt: str) -> str:
    return profile.naming.format(stem=stem, width=width, ext=FORMAT_EXT[fmt],
                                 format=fmt)
