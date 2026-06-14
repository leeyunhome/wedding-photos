#!/usr/bin/env python3
"""Upload imgforge output to Cloudflare R2.

Usage:
    python scripts/upload_r2.py [SRC] [options]

    SRC defaults to ./optimized

Options:
    -j, --jobs N        parallel uploads (default: 8)
    --force             re-upload all files, ignoring the local cache
    --dry-run           show what would be uploaded; write nothing
    --env ENV_FILE      .env file to load (default: .env.local)
    --prefix PREFIX     key prefix inside the R2 bucket (default: none / root)
    -q, --quiet         suppress progress; print errors only
    -v, --verbose       per-file logging
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

try:
    import boto3
except ImportError:
    sys.exit("error: boto3 not installed — run: pip install boto3")

# ── constants ──────────────────────────────────────────────────────────────────

CACHE_FILE = ".r2-upload-cache.json"

# Never upload these into R2.
SKIP_NAMES = frozenset({
    ".imgforge-cache.json", ".r2-upload-cache.json",
    ".DS_Store", "Thumbs.db", "desktop.ini",
})

CONTENT_TYPES: dict[str, str] = {
    ".avif": "image/avif",
    ".webp": "image/webp",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".gif":  "image/gif",
    ".json": "application/json",
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css",
    ".js":   "application/javascript",
}

# These keys are uploaded last so images are always reachable before the
# manifest points to them.
UPLOAD_LAST = frozenset({"manifest.json"})

# ── helpers ───────────────────────────────────────────────────────────────────

def _load_dotenv(path: Path) -> dict[str, str]:
    """Parse KEY=value lines from a .env file; handles quoted values."""
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        env[key.strip()] = val.strip().strip('"').strip("'")
    return env


def _load_cache(src: Path) -> dict:
    f = src / CACHE_FILE
    try:
        return json.loads(f.read_text("utf-8")) if f.exists() else {}
    except Exception:
        return {}


def _save_cache(src: Path, cache: dict) -> None:
    f = src / CACHE_FILE
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, indent=2, ensure_ascii=False), "utf-8")
    os.replace(tmp, f)


def _content_type(p: Path) -> str:
    return CONTENT_TYPES.get(p.suffix.lower(), "application/octet-stream")


def _fingerprint(p: Path) -> tuple[int, int]:
    s = p.stat()
    return (s.st_size, int(s.st_mtime_ns))


def _collect(src: Path, prefix: str) -> list[tuple[Path, str]]:
    """Walk src and return (local_path, r2_key) pairs, manifest.json last."""
    normal: list[tuple[Path, str]] = []
    deferred: list[tuple[Path, str]] = []
    for dirpath, _, filenames in os.walk(src):
        for name in filenames:
            if name in SKIP_NAMES or name.startswith("._") or name.startswith("."):
                continue
            local = Path(dirpath) / name
            if local.stat().st_size == 0:
                continue
            rel = local.relative_to(src).as_posix()
            key = f"{prefix}/{rel}" if prefix else rel
            (deferred if name in UPLOAD_LAST else normal).append((local, key))
    return normal + deferred


# ── worker ────────────────────────────────────────────────────────────────────

def _upload_one(
    s3,
    bucket: str,
    local: Path,
    key: str,
    cache: dict,
    force: bool,
) -> tuple[str, bool, str | None]:
    """Upload one file. Returns (key, was_uploaded, error_or_None)."""
    fp = _fingerprint(local)
    cached = cache.get(str(local))
    if not force and cached and tuple(cached.get("fp", [])) == fp:
        return key, False, None  # up-to-date, skip

    try:
        s3.upload_file(
            str(local), bucket, key,
            ExtraArgs={"ContentType": _content_type(local)},
        )
    except Exception as exc:
        return key, False, str(exc)

    cache[str(local)] = {"fp": list(fp), "key": key}
    return key, True, None


# ── CLI ───────────────────────────────────────────────────────────────────────

def _human(n: int) -> str:
    f = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if f < 1024 or unit == "GB":
            return f"{f:.1f} {unit}"
        f /= 1024
    return f"{f:.1f} GB"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        prog="upload_r2",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("src", nargs="?", default="./optimized",
                    help="imgforge output dir (default: ./optimized)")
    ap.add_argument("-j", "--jobs",    type=int, default=8,
                    help="parallel upload threads (default: 8)")
    ap.add_argument("--force",         action="store_true",
                    help="re-upload all files, ignoring the cache")
    ap.add_argument("--dry-run",       action="store_true",
                    help="plan only; write nothing")
    ap.add_argument("--env",           default=".env.local",
                    help="env file path (default: .env.local)")
    ap.add_argument("--prefix",        default="",
                    help="key prefix inside the bucket (default: root)")
    ap.add_argument("-q", "--quiet",   action="store_true")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)

    src = Path(args.src)
    if not src.exists():
        print(f"error: source dir not found: {src}", file=sys.stderr)
        return 2

    # Merge .env.local with real environment (real env wins).
    env = {**_load_dotenv(Path(args.env)), **os.environ}
    required = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]
    missing = [k for k in required if not env.get(k)]
    if missing:
        print(f"error: missing: {', '.join(missing)}", file=sys.stderr)
        print(f"  add them to {args.env}", file=sys.stderr)
        return 2

    bucket = env["R2_BUCKET_NAME"]
    prefix = args.prefix.strip("/")
    files  = _collect(src, prefix)
    cache  = _load_cache(src)

    if not files:
        print("No files found.")
        return 0

    total_bytes = sum(p.stat().st_size for p, _ in files)
    if not args.quiet:
        print(f"Source : {src.resolve()}")
        print(f"Bucket : {bucket}  prefix={prefix or '(root)'}")
        print(f"Files  : {len(files)}  ({_human(total_bytes)})")

    # ── dry-run ───────────────────────────────────────────────────────────────
    if args.dry_run:
        to_upload = [
            (local, key) for local, key in files
            if args.force
            or tuple(cache.get(str(local), {}).get("fp", [])) != _fingerprint(local)
        ]
        print(f"\nDry run: {len(to_upload)} to upload, {len(files)-len(to_upload)} cached")
        if args.verbose:
            for local, key in files:
                status = "UPLOAD" if (
                    args.force or
                    tuple(cache.get(str(local), {}).get("fp", [])) != _fingerprint(local)
                ) else "skip"
                print(f"  {status:6s}  {key}")
        return 0

    # ── upload ────────────────────────────────────────────────────────────────
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=env["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

    uploaded = skipped = failed = 0
    failures: list[tuple[str, str]] = []
    t0 = time.perf_counter()

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futs = {
            pool.submit(_upload_one, s3, bucket, local, key, cache, args.force): key
            for local, key in files
        }
        done = 0
        for fut in as_completed(futs):
            key, did_upload, error = fut.result()
            done += 1
            if error:
                failed += 1
                failures.append((key, error))
                if not args.quiet:
                    print(f"  FAIL  {key}: {error}", file=sys.stderr)
            elif did_upload:
                uploaded += 1
                if args.verbose:
                    print(f"  UP    {key}")
            else:
                skipped += 1
                if args.verbose:
                    print(f"  skip  {key}")

            if not args.quiet and not args.verbose and sys.stdout.isatty():
                pct = done * 100 // len(futs)
                print(
                    f"  {done}/{len(futs)} ({pct}%)  "
                    f"uploaded={uploaded}  skipped={skipped}  failed={failed}",
                    end="\r",
                )

    _save_cache(src, cache)
    dt = time.perf_counter() - t0

    if not args.quiet:
        print(f"\nDone in {dt:.1f}s  --  uploaded={uploaded}  skipped={skipped}  failed={failed}")
    if failures:
        print(f"\n{len(failures)} failure(s):", file=sys.stderr)
        for key, err in failures[:20]:
            print(f"  - {key}: {err}", file=sys.stderr)

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
