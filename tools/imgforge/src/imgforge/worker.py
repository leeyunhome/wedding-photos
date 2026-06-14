"""Per-source worker: runs in a child process, produces all derivatives for one image.

Must be top-level and picklable (Windows uses spawn). One source image == one
unit of work, so the cache/manifest can be updated atomically per source.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

from .cache import sha256_file
from .manifest import build_srcset, pick_fallback
from .processing import (
    encode_to_bytes,
    load_normalized,
    make_placeholder,
    output_name,
    register_optional_decoders,
    resize_long_edge,
    sized_widths,
)
from .profiles import Profile


@dataclass
class WorkerInput:
    src_path: str
    rel_path: str          # source path relative to the source root (posix)
    out_root: str
    profile: Profile
    profile_sig: str


@dataclass
class WorkerResult:
    rel_path: str
    ok: bool
    record: dict | None = None
    src_hash: str | None = None
    error: str | None = None
    n_variants: int = 0
    out_bytes: int = 0


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp{os.getpid()}")
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def process_source(task: WorkerInput) -> WorkerResult:
    register_optional_decoders()
    src_path = Path(task.src_path)
    rel = Path(task.rel_path)
    out_root = Path(task.out_root)
    profile = task.profile
    stem = rel.stem
    rel_dir = rel.parent  # "." for top-level files
    image_id = (rel.with_suffix("")).as_posix()

    try:
        src_hash = sha256_file(src_path)
        src_bytes = src_path.stat().st_size

        # Peek at header dims to size the decode (long edge is orientation-invariant).
        with Image.open(src_path) as probe:
            hw, hh = probe.size
        true_long = max(hw, hh)
        widths = sized_widths(profile, true_long)
        max_target = max(widths) if widths else true_long

        src = load_normalized(src_path, max_target)
        # Re-derive widths from the authoritative (orientation-corrected) source.
        widths = sized_widths(profile, src.src_long_edge)

        variants: list[dict] = []
        total_out = 0
        for width in widths:
            resized = resize_long_edge(src.image, width, profile.sharpen)
            rw, rh = resized.size
            is_thumb = width <= profile.thumb_max_width
            embed_icc = profile.embed_srgb and not is_thumb
            for fmt in profile.formats:
                quality = profile.quality_for(fmt, width)
                data = encode_to_bytes(resized, fmt, quality, profile, embed_icc)
                out_rel = (rel_dir / fmt / output_name(profile, stem, width, fmt))
                _atomic_write(out_root / out_rel, data)
                variants.append({
                    "format": fmt,
                    "width": rw,
                    "height": rh,
                    "bytes": len(data),
                    "path": out_rel.as_posix(),
                })
                total_out += len(data)

        placeholder = make_placeholder(src.image, profile.placeholder)

        record = {
            "id": image_id,
            "source": {
                "path": rel.as_posix(),
                "width": src.src_width,
                "height": src.src_height,
                "bytes": src_bytes,
                "hash": f"sha256:{src_hash}",
                "format": src.src_format,
            },
            "aspectRatio": round(src.src_width / src.src_height, 4) if src.src_height else None,
            "placeholder": placeholder,
            "variants": variants,
            "srcset": build_srcset(variants),
            "fallback": pick_fallback(variants, profile.formats),
        }
        return WorkerResult(rel_path=task.rel_path, ok=True, record=record,
                            src_hash=src_hash, n_variants=len(variants),
                            out_bytes=total_out)
    except Exception as e:  # never let one bad file kill the batch
        return WorkerResult(rel_path=task.rel_path, ok=False,
                            error=f"{type(e).__name__}: {e}")
