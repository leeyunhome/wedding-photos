# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # 로컬 개발 서버 (localhost:3000)
npm run build    # 프로덕션 빌드 (Cloudflare Pages: npx @cloudflare/next-on-pages@1)
npm run lint     # ESLint
```

Python 스크립트는 반드시 `C:\Users\neuez\miniconda3\python.exe`로 실행:
```bash
C:\Users\neuez\miniconda3\python.exe scripts/extract_procreate_gif.py --format mp4
C:\Users\neuez\miniconda3\python.exe scripts/upload_to_r2.py --format mp4
```

## Architecture

**Next.js 15 App Router** + **Cloudflare Pages** 배포. 이미지/영상은 **Cloudflare R2**에 저장.

### 데이터 흐름

`lib/storage.ts`가 유일한 데이터 진입점. `NEXT_PUBLIC_R2_PUBLIC_URL` 환경변수가 있으면 R2의 `manifest.json`을 fetch하고, 없으면 `lib/mock-data.ts`의 목 데이터를 반환한다. 모든 페이지 컴포넌트는 이 함수만 사용한다.

### R2 파일 구조

```
leehyunartgallery (bucket)
├── manifest.json          # 전체 작품 메타데이터 목록
├── artworks/{uuid}.mp4    # 타임랩스 영상
└── thumbnails/{uuid}.jpg  # 정적 썸네일 (QuickLook에서 추출)
```

`manifest.json`은 `scripts/upload_to_r2.py` 실행 시 자동 생성/갱신된다. 작품 제목·카테고리·태그 수정은 `output/procreate_mp4/manifest.json`을 편집 후 upload 스크립트를 재실행하면 된다.

### 미디어 처리

`components/MediaDisplay.tsx`가 URL 확장자(`.mp4`/`.webm` → `<video>`, 그 외 → `<img>`)를 감지해 자동 분기한다. `mode` prop으로 card(hover 시 자동재생) / lightbox / detail 세 가지 렌더링 방식을 지원한다.

### Procreate 백업 → MP4 파이프라인

1. `scripts/extract_procreate_gif.py` — iTunes 백업(`C:\Users\neuez\Apple\MobileSync\Backup\00008112-001A21DA1E3BC01E`)의 `Manifest.db`를 쿼리해 타임랩스 세그먼트를 ffmpeg로 이어붙여 MP4로 변환
2. `scripts/upload_to_r2.py` — 변환된 MP4와 썸네일을 R2에 업로드하고 `manifest.json` 갱신

### 환경변수

`.env.local` 필요 (`.env.example` 참고). `NEXT_PUBLIC_` 접두사가 있는 변수만 클라이언트에 노출된다.

### 배포

Cloudflare Pages. `wrangler.toml`에 `nodejs_compat` 호환 플래그 설정됨. GitHub `master` 브랜치 푸시 시 자동 재배포. API route(`app/api/contact/route.ts`)는 Edge Runtime으로 실행된다.
