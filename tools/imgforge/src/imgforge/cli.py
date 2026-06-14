"""Command-line interface.

    imgforge <SRC>                 # optimize is the default subcommand
    imgforge optimize <SRC> [...]
    imgforge inspect <SRC> [...]   # plan only, write nothing
    imgforge init [--force]        # scaffold an imgforge.toml
    imgforge clean <OUT> [--yes]   # remove orphaned derivatives
    imgforge profiles [SRC]        # list available profiles
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import replace
from pathlib import Path

from . import __version__
from .config import discover_config, load_config_file, resolve_profile
from .profiles import BUILTIN_PROFILES, FORMAT_EXT, Profile
from .runner import RunOptions, run_clean, run_optimize

SUBCOMMANDS = {"optimize", "inspect", "init", "clean", "profiles"}
VALID_FORMATS = set(FORMAT_EXT)

CONFIG_TEMPLATE = """\
# imgforge config. Precedence: CLI flags > this file > built-in defaults.
# Auto-discovered by walking up from the source dir (or pass -c/--config).

[defaults]
# Applied under every profile (the profile's own settings win).
placeholder = "lqip"   # none | color | lqip
enlarge = false        # never produce a derivative larger than the source

[profiles.web-gallery]
formats = ["avif", "webp", "jpeg"]   # last listed = the <img> fallback
sizes   = [400, 640, 1024, 1600, 2048]
[profiles.web-gallery.quality]       # per-format (NOT interchangeable)
avif = 63
webp = 80
jpeg = 82

# Extend a built-in or another profile and override only what differs.
[profiles.thumbs]
extends = "thumbnail-only"
sizes   = [240, 480]
"""


def _human(n: int) -> str:
    f = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if f < 1024 or unit == "TB":
            return f"{f:.0f} {unit}" if unit == "B" else f"{f:.1f} {unit}"
        f /= 1024
    return f"{f:.1f} TB"


def _parse_list(spec: str) -> list[str]:
    return [x.strip() for x in spec.split(",") if x.strip()]


def _parse_quality(spec: str, base: dict[str, int]) -> dict[str, int]:
    q = dict(base)
    if "=" in spec:
        for part in _parse_list(spec):
            k, _, v = part.partition("=")
            q[k.strip().lower()] = int(v)
    else:
        val = int(spec)
        for k in list(q) or VALID_FORMATS:
            q[k] = val
        for k in VALID_FORMATS:
            q.setdefault(k, val)
    return q


def _build_profile(args) -> Profile:
    src = Path(getattr(args, "src", ".") or ".")
    config_path = Path(args.config) if getattr(args, "config", None) else discover_config(src)
    config = load_config_file(config_path) if config_path else {}
    profile = resolve_profile(args.profile, config, config_path)

    overrides: dict = {}
    if getattr(args, "format", None):
        fmts = [f.lower() for f in _parse_list(args.format)]
        bad = [f for f in fmts if f not in VALID_FORMATS]
        if bad:
            raise SystemExit(f"error: unknown format(s): {', '.join(bad)} "
                             f"(valid: {', '.join(sorted(VALID_FORMATS))})")
        overrides["formats"] = fmts
    if getattr(args, "sizes", None):
        overrides["sizes"] = sorted({int(x) for x in _parse_list(args.sizes)})
    if getattr(args, "quality", None):
        overrides["quality"] = _parse_quality(args.quality, profile.quality)
    if getattr(args, "placeholder", None):
        overrides["placeholder"] = args.placeholder
    if getattr(args, "enlarge", False):
        overrides["enlarge"] = True
    if getattr(args, "no_sharpen", False):
        overrides["sharpen"] = False
    if getattr(args, "no_embed_srgb", False):
        overrides["embed_srgb"] = False
    return replace(profile, **overrides)


def _run_options(args, dry_run: bool) -> RunOptions:
    return RunOptions(
        src=Path(args.src),
        out=Path(args.out),
        profile=_build_profile(args),
        recursive=not args.no_recursive,
        include=args.include or [],
        exclude=args.exclude or [],
        jobs=args.jobs,
        force=getattr(args, "force", False),
        dry_run=dry_run,
        manifest_path=Path(args.manifest) if getattr(args, "manifest", None) else None,
        quiet=args.quiet,
        verbose=args.verbose,
        fail_fast=getattr(args, "fail_fast", False),
    )


def _cmd_optimize(args, *, dry_run: bool) -> int:
    if not Path(args.src).exists():
        print(f"error: source not found: {args.src}", file=sys.stderr)
        return 2
    opts = _run_options(args, dry_run)
    p = opts.profile
    t0 = time.perf_counter()
    summary = run_optimize(opts)
    dt = time.perf_counter() - t0

    if dry_run:
        print(f"\nPlan (profile '{p.name}': formats={p.formats} sizes={p.sizes})")
        print(f"  sources found     : {summary.total}")
        print(f"  up-to-date (cache): {summary.skipped}")
        print(f"  to process        : {summary.processed}")
        print(f"  derivatives to emit: ~{summary.planned_variants}")
        print(f"  source size       : {_human(summary.src_bytes)}")
        if summary.failures:
            print(f"  unreadable        : {len(summary.failures)}")
        return 0

    print(f"\nDone in {dt:.1f}s  (profile '{p.name}')")
    print(f"  processed: {summary.processed}   skipped: {summary.skipped}   "
          f"failed: {summary.failed}   total: {summary.total}")
    if summary.out_bytes:
        print(f"  output (new files): {_human(summary.out_bytes)}")
    if summary.manifest:
        mpath = opts.manifest_path or (opts.out.resolve() / "manifest.json")
        print(f"  manifest: {mpath}")
    if summary.failures:
        print(f"\n  {len(summary.failures)} failure(s):", file=sys.stderr)
        for rel, err in summary.failures[:20]:
            print(f"    - {rel}: {err}", file=sys.stderr)
    return 1 if summary.failed else 0


def _cmd_init(args) -> int:
    dest = Path(args.path) if args.path else Path("imgforge.toml")
    if dest.exists() and not args.force:
        print(f"error: {dest} already exists (use --force to overwrite)", file=sys.stderr)
        return 2
    dest.write_text(CONFIG_TEMPLATE, "utf-8")
    print(f"Wrote {dest}")
    return 0


def _cmd_clean(args) -> int:
    out = Path(args.out)
    if not out.exists():
        print(f"error: output dir not found: {out}", file=sys.stderr)
        return 2
    manifest_path = Path(args.manifest) if args.manifest else None
    dry = not args.yes
    removed = run_clean(out, manifest_path, dry_run=dry, quiet=args.quiet)
    if dry and removed:
        print("  (dry run -- re-run with --yes to delete)", file=sys.stderr)
    return 0


def _cmd_profiles(args) -> int:
    src = Path(args.src) if args.src else Path(".")
    config_path = discover_config(src)
    config = load_config_file(config_path) if config_path else {}
    names = sorted({*BUILTIN_PROFILES, *(config.get("profiles", {}) or {})})
    print("Available profiles:")
    for name in names:
        try:
            p = resolve_profile(name, config, config_path)
            tag = " (built-in)" if name in BUILTIN_PROFILES and name not in (config.get("profiles", {}) or {}) else ""
            print(f"  {name}{tag}: formats={p.formats} sizes={p.sizes} quality={p.quality}")
        except Exception as e:
            print(f"  {name}: <error: {e}>")
    if config_path:
        print(f"\nconfig: {config_path}")
    return 0


def _add_optimize_flags(sp: argparse.ArgumentParser) -> None:
    sp.add_argument("src", help="source image file or directory")
    sp.add_argument("-o", "--out", default="./optimized", help="output root (default ./optimized)")
    sp.add_argument("-p", "--profile", default="web-gallery", help="profile name")
    sp.add_argument("-c", "--config", help="config file (else auto-discover)")
    sp.add_argument("--no-recursive", action="store_true", help="don't descend into subdirs")
    sp.add_argument("--include", action="append", metavar="GLOB", help="only include matching paths (repeatable)")
    sp.add_argument("--exclude", action="append", metavar="GLOB", help="exclude matching paths (repeatable)")
    sp.add_argument("-f", "--format", help="override formats, e.g. avif,webp,jpeg")
    sp.add_argument("-q", "--quality", help="override quality, e.g. 80 or avif=63,webp=80,jpeg=82")
    sp.add_argument("-s", "--sizes", help="override long-edge widths, e.g. 400,1024,2048")
    sp.add_argument("--placeholder", choices=["none", "color", "lqip"], help="placeholder mode")
    sp.add_argument("--enlarge", action="store_true", help="allow upscaling past source size")
    sp.add_argument("--no-sharpen", action="store_true", help="disable post-resize sharpening")
    sp.add_argument("--no-embed-srgb", action="store_true", help="don't embed sRGB ICC profile")
    sp.add_argument("--manifest", help="manifest output path (default <out>/manifest.json)")
    sp.add_argument("-j", "--jobs", type=int, default=0, help="worker processes (0=auto)")
    sp.add_argument("-v", "--verbose", action="count", default=0, help="per-file logging")
    sp.add_argument("-Q", "--quiet", action="store_true", help="errors only")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="imgforge", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--version", action="version", version=f"imgforge {__version__}")
    sub = parser.add_subparsers(dest="command")

    p_opt = sub.add_parser("optimize", help="produce responsive derivatives + manifest")
    _add_optimize_flags(p_opt)
    p_opt.add_argument("--force", action="store_true", help="ignore cache; re-encode all")
    p_opt.add_argument("--dry-run", action="store_true", help="plan only; write nothing")
    p_opt.add_argument("--fail-fast", action="store_true", help="stop on first failure")

    p_ins = sub.add_parser("inspect", help="report what would be produced (no writes)")
    _add_optimize_flags(p_ins)
    p_ins.add_argument("--force", action="store_true", help="ignore cache when counting")

    p_init = sub.add_parser("init", help="write a starter imgforge.toml")
    p_init.add_argument("path", nargs="?", help="config path (default ./imgforge.toml)")
    p_init.add_argument("--force", action="store_true", help="overwrite if it exists")

    p_clean = sub.add_parser("clean", help="remove derivatives not in the manifest")
    p_clean.add_argument("out", help="output root to clean")
    p_clean.add_argument("--manifest", help="manifest path (default <out>/manifest.json)")
    p_clean.add_argument("--yes", action="store_true", help="actually delete (default dry-run)")
    p_clean.add_argument("-Q", "--quiet", action="store_true")

    p_prof = sub.add_parser("profiles", help="list available profiles")
    p_prof.add_argument("src", nargs="?", help="dir to discover config from")

    return parser


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    # Default subcommand: `imgforge ./photos` == `imgforge optimize ./photos`.
    if argv and argv[0] not in SUBCOMMANDS and not argv[0].startswith("-"):
        argv = ["optimize"] + argv

    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        parser.print_help()
        return 0

    try:
        if args.command == "optimize":
            return _cmd_optimize(args, dry_run=args.dry_run)
        if args.command == "inspect":
            return _cmd_optimize(args, dry_run=True)
        if args.command == "init":
            return _cmd_init(args)
        if args.command == "clean":
            return _cmd_clean(args)
        if args.command == "profiles":
            return _cmd_profiles(args)
    except (KeyError, ValueError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
