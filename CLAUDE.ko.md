# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 현재 상태: 그린필드 프로젝트

**아직 애플리케이션 코드가 없습니다.** 저장소에는 현재 다음만 있습니다:
- `images/` — 게시할 웨딩 사진 원본 (아래 구조 참고)
- `references/` — 빌드 계획. 스캐폴딩 전에 반드시 먼저 읽을 것:
  - [references/CLOUDFLARE_R2_HOSTING_GUIDE.md](references/CLOUDFLARE_R2_HOSTING_GUIDE.md) — 이 프로젝트를 위한 검증된 단계별 빌드 계획 (스택, R2 설정, 환경변수, 배포, 업로드 스크립트). 스펙 문서로 취급할 것.
  - [references/reference_CLAUDE.md](references/reference_CLAUDE.md) — 동일 스택으로 검증된 형제 프로젝트 `leehyunart`의 CLAUDE.md. 이 컨벤션을 따를 것.

목표: 이윤호·진수빈 (2026-03-28) 웨딩 사진 갤러리를 Next.js 15 + Cloudflare Pages로 호스팅하고, 이미지는 Cloudflare R2에서 서빙.

스캐폴딩 시 가이드를 따르고 구조를 임의로 만들지 말 것. 아래 섹션들은 현재 존재하는 코드가 아닌 **의도된** 아키텍처(가이드 기준)를 설명한다.

## 커맨드 (예정 툴체인)

```bash
npm run dev      # 로컬 개발 서버 (localhost:3000)
npm run build    # 프로덕션 빌드 (Cloudflare Pages: npx @cloudflare/next-on-pages@1)
npm run lint     # ESLint
```

Python 스크립트(R2 업로드 스크립트 등)는 반드시 miniconda 전체 경로로 실행할 것 (bare `python` 사용 금지):
```bash
C:\Users\neuez\miniconda3\python.exe scripts/upload_photos.py
```

## 아키텍처 (예정)

**Next.js 15 App Router** (TypeScript, Tailwind) → **Cloudflare Pages** 배포. 모든 사진은 **Cloudflare R2** 저장 (egress 무료).

### 데이터 흐름 — 단일 진입점

`lib/storage.ts`가 페이지 컴포넌트의 **유일한** 데이터 소스. `NEXT_PUBLIC_R2_PUBLIC_URL` 환경변수를 감지해: 설정되어 있으면 R2에서 `manifest.json`을 fetch (`next: { revalidate: 300 }`), 없으면 목 데이터를 반환해 R2 자격증명 없이 로컬 실행 가능. 페이지에서 R2에 직접 접근하거나 manifest를 직접 읽으면 안 됨 — 반드시 `getPhotos()` / `getPhoto(id)`를 통할 것.

### R2 버킷 구조

```
wedding-photos (R2 버킷)
├── manifest.json          # 전체 사진 메타데이터 목록 (데이터 소스)
├── photos/{uuid}.jpg      # 원본 이미지
└── thumbnails/{uuid}.jpg  # 저용량 썸네일
```

`manifest.json`은 **업로드 스크립트가 자동 생성**하며 R2에서 직접 편집하지 않는다. 제목·카테고리·태그를 변경하려면 로컬 `manifest.json`(또는 스크립트 메타데이터)을 수정한 뒤 업로드 스크립트를 재실행하면 manifest가 재생성·재업로드된다.

### 소스 사진 구조 (`images/` 현재 내용)

모두 `images/260328이윤호.진수빈/` 아래 (~1300장 JPG). 서브폴더는 manifest 카테고리·세트로 활용할 의미 있는 구분:
- 루트 (`260328이윤호.진수빈/`) — 메인 세트 (~884장)
- `3.28 이윤호 진수빈11` — 추가 세트 (~230장)
- `기념촬영` — 기념·단체 촬영 (~121장)
- `신부대기실` — 신부 대기실 (~86장)
- `진수빈13x10-54p화보집` — 인쇄용 앨범 선별 (~54장)
- `(진수빈)신랑댁12p`, `(진수빈)신부댁12p` — 신랑·신부 가족 세트 (~12장씩)

파일명은 `.JPG` (대문자)이며, macOS/Windows 아티팩트(`.DS_Store`, `Thumbs.db`)가 포함되어 있으므로 업로드 시 제외할 것.

### 환경변수

`.env.local` 생성 (gitignore 등록, 절대 커밋 금지). 값이 없는 `.env.example`은 커밋용. R2 자격증명(`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`)은 서버 사이드 전용; `NEXT_PUBLIC_` 접두사가 있는 변수만(`NEXT_PUBLIC_R2_PUBLIC_URL` 등) 클라이언트에 노출된다.

### 배포

Cloudflare Pages, 연결된 GitHub 브랜치 푸시 시 자동 배포. `wrangler.toml`에 `nodejs_compat` 호환 플래그 필수 (Pages 대시보드 런타임 설정에서도 활성화). 모든 API route는 `export const runtime = "edge"` 선언 필수. Pages 빌드 커맨드: `npx @cloudflare/next-on-pages@1`, 출력 디렉토리: `.vercel/output/static`.
