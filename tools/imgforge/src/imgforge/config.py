"""Config discovery + merge.

Precedence (highest wins): CLI flags > config file > built-in profile defaults.

A config file (``imgforge.toml`` or ``imgforge.json``) is auto-discovered by
walking up from the source directory, then CWD. It may define top-level
defaults and named ``profiles``; a profile may ``extends`` another profile or a
built-in. CLI overrides are applied last by the caller.
"""

from __future__ import annotations

import json
import tomllib
from dataclasses import fields, replace
from pathlib import Path
from typing import Any

from .profiles import BUILTIN_PROFILES, Profile, get_builtin

CONFIG_NAMES = ("imgforge.toml", "imgforge.json")
_PROFILE_FIELDS = {f.name for f in fields(Profile)} - {"name"}


def discover_config(start: Path) -> Path | None:
    """Walk up from ``start`` (and CWD) looking for a config file."""
    seen: set[Path] = set()
    for base in (start, Path.cwd()):
        base = base.resolve()
        for d in (base, *base.parents):
            if d in seen:
                continue
            seen.add(d)
            for name in CONFIG_NAMES:
                cand = d / name
                if cand.is_file():
                    return cand
    return None


def load_config_file(path: Path) -> dict[str, Any]:
    text = path.read_bytes()
    if path.suffix == ".toml":
        return tomllib.loads(text.decode("utf-8"))
    return json.loads(text.decode("utf-8"))


def _apply_overrides(base: Profile, data: dict[str, Any]) -> Profile:
    """Return ``base`` with only known, output-affecting fields overridden."""
    clean: dict[str, Any] = {}
    for key, val in data.items():
        if key in _PROFILE_FIELDS:
            if key == "quality" and isinstance(val, dict):
                merged = dict(base.quality)
                merged.update(val)
                clean[key] = merged
            else:
                clean[key] = val
    return replace(base, **clean)


def resolve_profile(
    name: str,
    config: dict[str, Any] | None,
    config_path: Path | None = None,
    _seen: tuple[str, ...] = (),
) -> Profile:
    """Resolve a profile by name from config (with ``extends``) or built-ins."""
    if name in _seen:
        raise ValueError(f"circular 'extends' chain through profile {name!r}")

    config = config or {}
    file_profiles = config.get("profiles", {}) or {}
    entry = file_profiles.get(name)
    # Top-level [defaults] sit below every profile (the profile's own settings win).
    top_defaults = config.get("defaults", {}) or {}

    if entry is None:
        # Not defined in config -> must be a built-in.
        if name not in BUILTIN_PROFILES:
            known = ", ".join(sorted({*BUILTIN_PROFILES, *file_profiles}))
            where = f" in {config_path}" if config_path else ""
            raise KeyError(f"unknown profile {name!r}{where}. Known: {known}")
        base = _apply_overrides(get_builtin(name), top_defaults)
    else:
        parent = entry.get("extends", "web-gallery")
        base = replace(
            resolve_profile(parent, config, config_path, _seen + (name,)),
            name=name,
        )
        base = _apply_overrides(base, top_defaults)
        base = _apply_overrides(base, entry)
    return base
