import os, boto3
from pathlib import Path

def load_dotenv(path):
    env = {}
    for line in Path(path).read_text("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env

env = {**load_dotenv(".env.local"), **os.environ}
print("Bucket:", env.get("R2_BUCKET_NAME"))
print("Account:", env.get("R2_ACCOUNT_ID", "")[:8] + "...")

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
    aws_access_key_id=env["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
    region_name="auto",
)
try:
    resp = s3.list_objects_v2(Bucket=env["R2_BUCKET_NAME"], MaxKeys=1)
    print("OK - bucket accessible, HTTP", resp["ResponseMetadata"]["HTTPStatusCode"])
except Exception as e:
    print("ERROR:", type(e).__name__, e)
