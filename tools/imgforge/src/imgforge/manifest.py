"""Manifest assembly: a frontend-ready description of every derivative.

The manifest lets a frontend build <picture>/srcset with zero guesswork and
reserve layout space (intrinsic width/height) to avoid CLS.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from . import __version__

_FALLBACK_TARGET = 1024


def build_srcset(variants: list[dict]) -> dict[str, str]:
    """Group variants by format into srcset strings ("path Nw, path Nw")."""
    by_fmt: dict[str, list[dict]] = {}
    for v in variants:
        by_fmt.setdefault(v["format"], []).append(v)
    out: dict[str, str] = {}
    for fmt, vs in by_fmt.items():
        vs = sorted(vs, key=lambda v: v["width"])
        out[fmt] = ", ".join(f'{v["path"]} {v["width"]}w' for v in vs)
    return out


def pick_fallback(variants: list[dict], formats: list[str]) -> str | None:
    """Choose the universal <img src> fallback: the last format, ~1024px wide."""
    fallback_fmt = formats[-1] if formats else "jpeg"
    candidates = [v for v in variants if v["format"] == fallback_fmt] or variants
    if not candidates:
        return None
    best = min(candidates, key=lambda v: abs(v["width"] - _FALLBACK_TARGET))
    return best["path"]


def assemble_manifest(profile_name: str, records: list[dict]) -> dict:
    records = sorted(records, key=lambda r: r["id"])
    return {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tool": f"imgforge {__version__}",
        "profile": profile_name,
        "count": len(records),
        "images": records,
    }


def write_manifest(path: Path, manifest: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), "utf-8")
    tmp.replace(path)
