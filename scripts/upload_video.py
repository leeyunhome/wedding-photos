#!/usr/bin/env python3
"""Upload a single video file to R2."""
import sys
from pathlib import Path

try:
    import boto3
except ImportError:
    sys.exit("error: pip install boto3")

def load_env(path):
    env = {}
    for line in Path(path).read_text("utf-8").splitlines():
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env

env = load_env(".env.local")

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
    aws_access_key_id=env["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
)

bucket = env["R2_BUCKET_NAME"]
src = Path("videos/highlight_web.mp4")
key = "videos/highlight_web.mp4"

size_mb = src.stat().st_size // 1024 // 1024
print(f"Uploading {size_mb}MB → s3://{bucket}/{key}")

s3.upload_file(
    str(src), bucket, key,
    ExtraArgs={
        "ContentType": "video/mp4",
        "CacheControl": "public, max-age=31536000",
    },
)
print("Done.")
