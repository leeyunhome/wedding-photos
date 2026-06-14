"""Orchestration: discover -> (cache filter) -> parallel process -> manifest.

Also implements the `inspect` (plan-only) and `clean` (remove orphans) flows.
"""

from __future__ import annotations

import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image

from .cache import Cache
from .discovery import iter_source_images
from .manifest import assemble_manifest, write_manifest
from .processing import register_optional_decoders, sized_widths
from .profiles import Profile
from .worker import WorkerInput, WorkerResult, process_source


@dataclass
class RunOptions:
    src: Path
    out: Path
    profile: Profile
    recursive: bool = True
    include: list[str] = field(default_factory=list)
    exclude: list[str] = field(default_factory=list)
    jobs: int = 0                 # 0 -> os.cpu_count()
    force: bool = False
    dry_run: bool = False
    manifest_path: Path | None = None
    quiet: bool = False
    verbose: int = 0
    fail_fast: bool = False


@dataclass
class RunSummary:
    total: int = 0
    processed: int = 0
    skipped: int = 0
    failed: int = 0
    planned_variants: int = 0
    src_bytes: int = 0
    out_bytes: int = 0
    failures: list[tuple[str, str]] = field(default_factory=list)
    manifest: dict | None = None


def _relpath(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def _eprint(opts: RunOptions, *args) -> None:
    if not opts.quiet:
        print(*args, file=sys.stderr, flush=True)


def run_optimize(opts: RunOptions) -> RunSummary:
    register_optional_decoders()
    src_root = opts.src.resolve()
    out_root = opts.out.resolve()
    profile = opts.profile
    sig = profile.signature()

    files = list(iter_source_images(
        src_root, recursive=opts.recursive,
        include=opts.include, exclude=opts.exclude))
    summary = RunSummary(total=len(files))
    if not files:
        _eprint(opts, "No images found.")
        return summary

    cache = Cache() if opts.force else Cache.load(out_root)

    tasks: list[WorkerInput] = []
    records: list[dict] = []
    for f in files:
        rel = _relpath(f, src_root)
        summary.src_bytes += f.stat().st_size
        if not opts.force:
            cached = cache.lookup(rel, f, sig, out_root)
            if cached is not None:
                records.append(cached)
                summary.skipped += 1
                continue
        tasks.append(WorkerInput(str(f), rel, str(out_root), profile, sig))

    # Plan-only path (inspect / --dry-run): report what *would* be produced.
    if opts.dry_run:
        for t in tasks:
            try:
                with Image.open(t.src_path) as im:
                    long_edge = max(im.size)
                summary.planned_variants += len(sized_widths(profile, long_edge)) * len(profile.formats)
            except Exception as e:
                summary.failures.append((t.rel_path, f"{type(e).__name__}: {e}"))
        summary.processed = len(tasks)  # "would process"
        return summary

    # Process new/changed files.
    jobs = opts.jobs or None
    if tasks:
        _eprint(opts, f"Processing {len(tasks)} image(s) "
                      f"({summary.skipped} cached) with {jobs or 'auto'} workers...")

    def handle(res: WorkerResult) -> bool:
        if res.ok and res.record is not None:
            records.append(res.record)
            f = src_root / res.rel_path
            cache.store(res.rel_path, res.record, res.src_hash, f, sig)
            summary.processed += 1
            summary.out_bytes += res.out_bytes
            if opts.verbose:
                _eprint(opts, f"  ok  {res.rel_path}  "
                              f"({res.n_variants} variants, {res.out_bytes // 1024} KB)")
            return True
        summary.failed += 1
        summary.failures.append((res.rel_path, res.error or "unknown error"))
        _eprint(opts, f"  FAIL {res.rel_path}: {res.error}")
        return False

    done = 0
    n = len(tasks)
    if jobs == 1 or n <= 1:
        for t in tasks:
            ok = handle(process_source(t))
            done += 1
            _progress(opts, done, n)
            if not ok and opts.fail_fast:
                break
    else:
        with ProcessPoolExecutor(max_workers=jobs) as ex:
            futures = {ex.submit(process_source, t): t for t in tasks}
            for fut in as_completed(futures):
                handle(fut.result())
                done += 1
                _progress(opts, done, n)
                if opts.fail_fast and summary.failed:
                    for other in futures:
                        other.cancel()
                    break

    # Drop cache entries whose source file no longer exists on disk.
    for rel in [k for k in cache.entries if not (src_root / k).exists()]:
        del cache.entries[rel]

    manifest = assemble_manifest(profile.name, records)
    summary.manifest = manifest
    manifest_path = opts.manifest_path or (out_root / "manifest.json")
    write_manifest(manifest_path, manifest)
    cache.save(out_root)
    return summary


def _progress(opts: RunOptions, done: int, total: int) -> None:
    if opts.quiet or opts.verbose or total == 0:
        return
    print(f"\r  {done}/{total}", end="", file=sys.stderr, flush=True)
    if done == total:
        print(file=sys.stderr, flush=True)


def run_clean(out: Path, manifest_path: Path | None, dry_run: bool,
              quiet: bool = False) -> list[str]:
    """Delete files under ``out`` not referenced by the manifest. Returns removed."""
    import json

    out_root = out.resolve()
    mpath = manifest_path or (out_root / "manifest.json")
    referenced: set[Path] = set()
    if mpath.is_file():
        manifest = json.loads(mpath.read_text("utf-8"))
        for img in manifest.get("images", []):
            for v in img.get("variants", []):
                referenced.add((out_root / v["path"]).resolve())
    # Never remove the manifest or cache sidecar themselves.
    keep = {mpath.resolve(), (out_root / ".imgforge-cache.json").resolve()}

    removed: list[str] = []
    for p in out_root.rglob("*"):
        if not p.is_file():
            continue
        rp = p.resolve()
        if rp in referenced or rp in keep:
            continue
        removed.append(p.relative_to(out_root).as_posix())
        if not dry_run:
            try:
                p.unlink()
            except OSError:
                pass
    if not quiet:
        verb = "Would remove" if dry_run else "Removed"
        print(f"{verb} {len(removed)} orphaned file(s).", file=sys.stderr)
    return removed
