"""Profiles: named bundles of output settings.

A Profile is everything that determines what derivatives get produced for a
source image. It is a plain dataclass so it pickles cleanly across the process
pool. The ``signature`` of a profile is hashed into the idempotency cache, so
changing any output-affecting field (sizes, quality, formats, ...) correctly
invalidates previously produced derivatives.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field, replace

from . import __version__

# Quality numbers are NOT interchangeable across codecs. The same perceptual
# quality is reached at roughly AVIF q63 ~= WebP q80 ~= JPEG q82, so each format
# carries its own default rather than one shared number.
DEFAULT_QUALITY: dict[str, int] = {"avif": 63, "webp": 80, "jpeg": 82}

# Map a logical format name to (Pillow save format, file extension).
FORMAT_EXT: dict[str, str] = {"avif": "avif", "webp": "webp", "jpeg": "jpg"}
PILLOW_FORMAT: dict[str, str] = {"avif": "AVIF", "webp": "WEBP", "jpeg": "JPEG"}


@dataclass
class Profile:
    """Resolved output settings for one run."""

    name: str = "web-gallery"
    # Ordered list; the LAST format is the universal <img> fallback.
    formats: list[str] = field(default_factory=lambda: ["avif", "webp", "jpeg"])
    # Long-edge target widths for the responsive ladder.
    sizes: list[int] = field(default_factory=lambda: [400, 640, 1024, 1600, 2048])
    quality: dict[str, int] = field(default_factory=lambda: dict(DEFAULT_QUALITY))

    enlarge: bool = False          # never produce a derivative larger than source
    sharpen: bool = True           # light unsharp mask after downscale
    # NOTE: EXIF/GPS are always stripped from outputs (orientation is baked into
    # pixels; re-attaching the original EXIF would re-introduce a double-rotation
    # bug). Only the sRGB ICC profile is optionally embedded:
    embed_srgb: bool = True        # embed a tiny sRGB ICC profile (skipped on thumbs)
    placeholder: str = "lqip"      # none | color | lqip
    naming: str = "{stem}_{width}.{ext}"

    # Per-format encoder knobs.
    avif_speed: int = 6            # 0=slowest/best .. 10=fastest; aom codec
    webp_method: int = 6           # 0..6, 6 = best compression
    jpeg_progressive: bool = True
    # A width <= this is treated as a "thumbnail": metadata fully stripped and
    # quality nudged down a touch, since it renders small.
    thumb_max_width: int = 480
    thumb_quality_drop: int = 7

    def quality_for(self, fmt: str, width: int) -> int:
        q = self.quality.get(fmt, DEFAULT_QUALITY.get(fmt, 80))
        if width <= self.thumb_max_width:
            q = max(1, q - self.thumb_quality_drop)
        return q

    def signature(self) -> str:
        """Stable hash of everything that affects produced bytes (+ tool version)."""
        payload = asdict(self)
        payload["__tool_version__"] = __version__
        blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def _p(name: str, **overrides) -> Profile:
    return replace(Profile(), name=name, **overrides)


# Built-in profiles so the tool is useful with zero config.
BUILTIN_PROFILES: dict[str, Profile] = {
    "web-gallery": Profile(),  # the default
    "thumbnail-only": _p(
        "thumbnail-only",
        formats=["webp", "jpeg"],
        sizes=[200, 400],
        quality={"webp": 74, "jpeg": 78},
        placeholder="color",
    ),
    "hero": _p(
        "hero",
        sizes=[768, 1280, 1920, 2560],
        quality={"avif": 58, "webp": 82, "jpeg": 85},
    ),
    "full": _p(
        "full",
        sizes=[640, 1024, 1600, 2048, 2560, 3840],
        quality={"avif": 60, "webp": 82, "jpeg": 84},
    ),
}


def get_builtin(name: str) -> Profile:
    if name not in BUILTIN_PROFILES:
        raise KeyError(name)
    # Return a copy so callers can mutate freely.
    return replace(BUILTIN_PROFILES[name])
