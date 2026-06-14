"""Idempotency cache: skip sources whose content + settings are unchanged.

Stored as a sidecar ``.imgforge-cache.json`` in the output root. Each entry
holds the produced manifest ``record`` plus a freshness key. Freshness is a
two-tier check: a fast ``(size, mtime_ns)`` pre-filter avoids hashing unchanged
files; only on a mismatch do we fall back to the content hash (the source of
truth), which catches "copied/touched but identical" files.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from . import __version__

CACHE_FILENAME = ".imgforge-cache.json"
_CHUNK = 1 << 20


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


class Cache:
    def __init__(self, entries: dict | None = None):
        # relpath -> {"record": {...}, "fresh": {hash,size,mtime_ns,profile_sig}}
        self.entries: dict[str, dict] = entries or {}

    @classmethod
    def load(cls, out_root: Path) -> "Cache":
        path = out_root / CACHE_FILENAME
        if not path.is_file():
            return cls()
        try:
            data = json.loads(path.read_text("utf-8"))
            return cls(data.get("entries", {}))
        except (OSError, ValueError):
            return cls()

    def save(self, out_root: Path) -> None:
        out_root.mkdir(parents=True, exist_ok=True)
        path = out_root / CACHE_FILENAME
        payload = {"version": 1, "tool": f"imgforge {__version__}", "entries": self.entries}
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), "utf-8")
        tmp.replace(path)

    def _outputs_exist(self, record: dict, out_root: Path) -> bool:
        for v in record.get("variants", []):
            if not (out_root / v["path"]).is_file():
                return False
        return True

    def lookup(self, relpath: str, src_path: Path, profile_sig: str,
               out_root: Path) -> dict | None:
        """Return the cached manifest record if the source is fresh, else None.

        Side effect: refreshes the stored mtime when the file was merely touched
        (content hash still matches), so the next run hits the fast path.
        """
        entry = self.entries.get(relpath)
        if not entry:
            return None
        fresh = entry.get("fresh", {})
        record = entry.get("record")
        if not record or fresh.get("profile_sig") != profile_sig:
            return None
        if not self._outputs_exist(record, out_root):
            return None
        try:
            st = src_path.stat()
        except OSError:
            return None
        if fresh.get("size") == st.st_size and fresh.get("mtime_ns") == st.st_mtime_ns:
            return record  # fast path: unchanged
        # mtime/size differ -> confirm via content hash.
        if fresh.get("hash") and fresh["hash"] == sha256_file(src_path):
            fresh["size"] = st.st_size
            fresh["mtime_ns"] = st.st_mtime_ns
            return record
        return None

    def store(self, relpath: str, record: dict, src_hash: str,
              src_path: Path, profile_sig: str) -> None:
        st = src_path.stat()
        self.entries[relpath] = {
            "record": record,
            "fresh": {
                "hash": src_hash,
                "size": st.st_size,
                "mtime_ns": st.st_mtime_ns,
                "profile_sig": profile_sig,
            },
        }

    def prune_missing(self, existing_relpaths: set[str]) -> list[str]:
        """Drop entries whose source no longer exists. Returns removed relpaths."""
        removed = [k for k in self.entries if k not in existing_relpaths]
        for k in removed:
            del self.entries[k]
        return removed
