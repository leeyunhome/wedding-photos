# Cloudflare R2 + Next.js 포토 호스팅 가이드

이 프로젝트(leehyunart)에서 검증된 스택을 기반으로 새 호스팅 서비스를 빠르게 만들기 위한 가이드.

## 스택

- **Next.js 15** (App Router, TypeScript, Tailwind CSS)
- **Cloudflare R2** — 이미지/영상 저장소 (egress 무료)
- **Cloudflare Pages** — 웹 호스팅 (무료)
- **GitHub** — 코드 저장 + Pages 자동 배포

---

## 1. 프로젝트 생성

```bash
npx create-next-app@latest my-gallery --typescript --tailwind --app --src-dir no --import-alias "@/*"
cd my-gallery
npm install
```

---

## 2. Cloudflare R2 버킷 설정

### 버킷 생성
1. [Cloudflare Dashboard](https://dash.cloudflare.com) → R2 Object Storage → Create bucket
2. 버킷 이름 입력 (예: `wedding-photos`)
3. 생성 후 **Settings → Public access → Allow Access** 활성화
   - "Public Development URL" 활성화 → `https://pub-xxxx.r2.dev` URL 발급

### R2 API 자격증명 생성
1. R2 메인 페이지 → **Manage R2 API Tokens** (우측 상단)
2. **Create API Token** → Object Read & Write → 해당 버킷만 선택
3. 다음 4가지 값 저장:
   - Account ID (Dashboard URL에서 확인)
   - Access Key ID
   - Secret Access Key
   - Bucket Name

> **주의**: API Token은 생성 직후 한 번만 표시됨. 반드시 즉시 복사.

---

## 3. 환경변수 설정

`.env.local` (gitignore에 포함됨, 절대 커밋 금지):
```env
R2_ACCOUNT_ID=your_account_id
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET_NAME=wedding-photos
NEXT_PUBLIC_R2_PUBLIC_URL=https://pub-xxxx.r2.dev
```

`.env.example` (커밋용, 실제 값 없음):
```env
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
NEXT_PUBLIC_R2_PUBLIC_URL=
```

`.gitignore`에 반드시 포함:
```
.env.local
```

---

## 4. R2 파일 구조 설계

```
wedding-photos (R2 버킷)
├── manifest.json          # 전체 사진 메타데이터 목록
├── photos/{uuid}.jpg      # 원본 이미지
└── thumbnails/{uuid}.jpg  # 썸네일 (저용량)
```

`manifest.json` 형식:
```json
{
  "version": "1.0",
  "updatedAt": "2024-01-01T00:00:00Z",
  "items": [
    {
      "id": "uuid-here",
      "title": "부케 웨딩",
      "category": "ceremony",
      "url": "https://pub-xxxx.r2.dev/photos/uuid.jpg",
      "thumbnailUrl": "https://pub-xxxx.r2.dev/thumbnails/uuid.jpg",
      "tags": ["부케", "웨딩드레스"],
      "createdAt": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

## 5. 핵심 파일 구현

### `lib/types.ts`
```typescript
export type PhotoCategory = "ceremony" | "reception" | "portrait" | "family" | "etc";

export interface Photo {
  id: string;
  title: string;
  category: PhotoCategory;
  url: string;
  thumbnailUrl: string;
  tags: string[];
  description?: string;
  createdAt: string;
}

export interface Manifest {
  version: string;
  updatedAt: string;
  items: Photo[];
}
```

### `lib/storage.ts`
```typescript
import type { Photo, Manifest } from "./types";

const R2_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;

export async function getPhotos(): Promise<Photo[]> {
  if (!R2_URL) return MOCK_PHOTOS; // 개발용 목 데이터
  const res = await fetch(`${R2_URL}/manifest.json`, {
    next: { revalidate: 300 }, // 5분 캐시
  });
  const manifest: Manifest = await res.json();
  return manifest.items;
}

export async function getPhoto(id: string): Promise<Photo | null> {
  const photos = await getPhotos();
  return photos.find((p) => p.id === id) ?? null;
}

const MOCK_PHOTOS: Photo[] = [
  {
    id: "mock-1",
    title: "웨딩 사진 1",
    category: "ceremony",
    url: "https://picsum.photos/seed/wedding1/800/600",
    thumbnailUrl: "https://picsum.photos/seed/wedding1/400/300",
    tags: ["웨딩"],
    createdAt: new Date().toISOString(),
  },
];
```

### `app/api/contact/route.ts` (Edge Runtime 필수)
```typescript
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge"; // Cloudflare Pages 필수

export async function POST(req: NextRequest) {
  const { name, email, message } = await req.json();
  // TODO: 이메일 전송 (Resend 등)
  return NextResponse.json({ ok: true });
}
```

---

## 6. Cloudflare Pages 배포 설정

### `wrangler.toml` (프로젝트 루트)
```toml
name = "my-gallery"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]
```

### `package.json` build 명령
```json
{
  "scripts": {
    "build": "npx @cloudflare/next-on-pages@1",
    "pages:build": "npx @cloudflare/next-on-pages@1"
  }
}
```

### Cloudflare Pages 연결
1. [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → Create → **Pages** → Connect to Git
2. GitHub 저장소 선택
3. Build settings:
   - Framework preset: Next.js
   - Build command: `npx @cloudflare/next-on-pages@1`
   - Output directory: `.vercel/output/static`
4. **Settings → Environment variables** → `.env.local`의 모든 변수 추가
5. **Settings → Runtime → Compatibility flags** → `nodejs_compat` 추가

---

## 7. 이미지 업로드 스크립트

```bash
pip install boto3 pillow
```

`scripts/upload_photos.py`:
```python
import boto3
import json
import os
import uuid
from pathlib import Path
from PIL import Image

R2_ACCOUNT_ID = os.environ["R2_ACCOUNT_ID"]
R2_ACCESS_KEY_ID = os.environ["R2_ACCESS_KEY_ID"]
R2_SECRET_ACCESS_KEY = os.environ["R2_SECRET_ACCESS_KEY"]
R2_BUCKET_NAME = os.environ["R2_BUCKET_NAME"]
R2_PUBLIC_URL = os.environ["NEXT_PUBLIC_R2_PUBLIC_URL"]

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    region_name="auto",
)

INPUT_DIR = Path("input/photos")
THUMB_SIZE = (400, 300)

items = []
for img_path in INPUT_DIR.glob("*.jpg"):
    photo_id = str(uuid.uuid4())
    
    # 원본 업로드
    s3.upload_file(str(img_path), R2_BUCKET_NAME, f"photos/{photo_id}.jpg",
                   ExtraArgs={"ContentType": "image/jpeg"})
    
    # 썸네일 생성 & 업로드
    thumb_path = Path(f"tmp_{photo_id}_thumb.jpg")
    img = Image.open(img_path)
    img.thumbnail(THUMB_SIZE)
    img.save(thumb_path)
    s3.upload_file(str(thumb_path), R2_BUCKET_NAME, f"thumbnails/{photo_id}.jpg",
                   ExtraArgs={"ContentType": "image/jpeg"})
    thumb_path.unlink()
    
    items.append({
        "id": photo_id,
        "title": img_path.stem,
        "category": "etc",
        "url": f"{R2_PUBLIC_URL}/photos/{photo_id}.jpg",
        "thumbnailUrl": f"{R2_PUBLIC_URL}/thumbnails/{photo_id}.jpg",
        "tags": [],
        "createdAt": "2024-01-01T00:00:00Z",
    })
    print(f"  OK {photo_id}")

manifest = {"version": "1.0", "updatedAt": "2024-01-01T00:00:00Z", "items": items}
with open("manifest.json", "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

s3.put_object(
    Bucket=R2_BUCKET_NAME,
    Key="manifest.json",
    Body=json.dumps(manifest, ensure_ascii=False).encode("utf-8"),
    ContentType="application/json",
)
print(f"Done: {len(items)} photos uploaded")
```

실행:
```bash
C:\Users\neuez\miniconda3\python.exe scripts/upload_photos.py
```

---

## 8. 비용 (월간 무료 한도)

| R2 | 무료 한도 |
|----|-----------|
| 저장 | 10GB |
| 업로드 | 100만 건 |
| 다운로드 | 1000만 건 |
| **Egress** | **무제한 무료** |

웨딩 사진 500장 × 5MB = 2.5GB → **무료**

Cloudflare Pages 호스팅도 무료.

---

## 참고: 이 가이드 기반 프로젝트

- [leehyunart](../leehyunart) — Procreate 타임랩스 갤러리 (이 스택으로 만든 원본)
