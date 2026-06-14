"""Source discovery: walk a tree and yield real image files, skipping junk.

Extension matching is case-insensitive (handles ``.JPG`` vs ``.jpg``). Junk is
filtered by *basename*, not extension, because macOS AppleDouble forks
(``._foo.JPG``) carry an image extension but are not decodable images.
"""

from __future__ import annotations

import fnmatch
import os
from pathlib import Path
from typing import Iterator

# Case-insensitive extension allowlist.
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff",
              ".bmp", ".gif", ".heic", ".heif"}

# Exact basenames that are never images.
JUNK_NAMES = {".ds_store", "thumbs.db", "desktop.ini"}


def is_junk(name: str) -> bool:
    low = name.lower()
    if name.startswith("._"):      # AppleDouble resource fork
        return True
    if name.startswith("."):       # hidden / dotfiles (incl. .DS_Store)
        return True
    if low in JUNK_NAMES:
        return True
    if low.endswith(".db"):        # Thumbs.db and friends
        return True
    return False


def _matches_any(rel_posix: str, name: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatch(rel_posix, p) or fnmatch.fnmatch(name, p)
               for p in patterns)


def iter_source_images(
    root: Path,
    *,
    recursive: bool = True,
    include: list[str] | None = None,
    exclude: list[str] | None = None,
) -> Iterator[Path]:
    """Yield image file paths under ``root`` (sorted, deterministic order)."""
    root = root.resolve()
    include = include or []
    exclude = exclude or []

    if root.is_file():
        if not is_junk(root.name) and root.suffix.lower() in IMAGE_EXTS:
            yield root
        return

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        # Don't descend into hidden / junk directories.
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        if not recursive:
            dirnames[:] = []
        for name in sorted(filenames):
            if is_junk(name):
                continue
            p = Path(dirpath) / name
            if p.suffix.lower() not in IMAGE_EXTS:
                continue
            rel = p.relative_to(root).as_posix()
            if include and not _matches_any(rel, name, include):
                continue
            if exclude and _matches_any(rel, name, exclude):
                continue
            try:
                if p.stat().st_size == 0:   # skip zero-byte files
                    continue
            except OSError:
                continue
            yield p
