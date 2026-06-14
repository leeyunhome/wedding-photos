import type { Photo, ImgforgeManifest } from "./types";

const R2_URL = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "").replace(/\/$/, "");

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function prefixUrl(path: string): string {
  if (!R2_URL) return path;
  return `${R2_URL}/${encodePath(path)}`;
}

function resolveSrcset(srcset: string): string {
  return srcset
    .split(",")
    .map((item) => {
      const s = item.trim();
      // Split on the LAST space to separate path from descriptor (e.g. "400w").
      // This is correct even when the path contains spaces (Korean folder names).
      const lastSpace = s.lastIndexOf(" ");
      if (lastSpace === -1) return prefixUrl(s);
      return prefixUrl(s.slice(0, lastSpace)) + s.slice(lastSpace);
    })
    .join(", ");
}

function resolvePhoto(photo: Photo): Photo {
  return {
    ...photo,
    variants: photo.variants.map((v) => ({ ...v, path: prefixUrl(v.path) })),
    srcset: Object.fromEntries(
      Object.entries(photo.srcset).map(([fmt, s]) => [fmt, resolveSrcset(s)])
    ),
    fallback: prefixUrl(photo.fallback),
  };
}

export async function getPhotos(): Promise<Photo[]> {
  if (!R2_URL) return MOCK_PHOTOS;

  try {
    const res = await fetch(`${R2_URL}/manifest.json`);
    if (!res.ok) return MOCK_PHOTOS;
    const manifest: ImgforgeManifest = await res.json();
    return manifest.images.map(resolvePhoto);
  } catch {
    return MOCK_PHOTOS;
  }
}

export async function getPhoto(id: string): Promise<Photo | null> {
  const photos = await getPhotos();
  return photos.find((p) => p.id === id) ?? null;
}

export function getCategory(photo: Photo): string {
  const slash = photo.id.indexOf("/");
  return slash === -1 ? "메인" : photo.id.slice(0, slash);
}

export function getCategories(photos: Photo[]): string[] {
  const cats = new Set(photos.map(getCategory));
  return Array.from(cats).sort();
}

// ── mock data (used when NEXT_PUBLIC_R2_PUBLIC_URL is not set) ────────────────

const SEEDS = [
  "arch", "bride", "bouquet", "venue", "ring",
  "dance", "toast", "kiss", "cake", "family", "groom", "vows",
];

const MOCK_PHOTOS: Photo[] = SEEDS.map((seed, i) => {
  const landscape = i % 4 !== 0;
  const w = 1024;
  const h = landscape ? 683 : 1365;
  const src = `https://picsum.photos/seed/${seed}/${w}/${h}`;
  return {
    id: `mock/${seed}`,
    source: {
      path: `mock/${seed}.jpg`,
      width: landscape ? 4000 : 2667,
      height: landscape ? 2667 : 4000,
      bytes: 6_000_000,
      hash: "mock",
      format: "JPEG",
    },
    aspectRatio: landscape ? 1.5 : 0.75,
    placeholder: { type: "color", color: "#c8b8a2" },
    variants: [{ format: "jpeg", width: w, height: h, bytes: 200_000, path: src }],
    srcset: { jpeg: `${src} 1024w` },
    fallback: src,
  };
});
