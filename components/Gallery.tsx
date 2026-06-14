"use client";

import { useState, useCallback, useEffect } from "react";
import type { Photo } from "@/lib/types";
import { getCategory } from "@/lib/storage";

// ── PhotoCard ─────────────────────────────────────────────────────────────────

function PhotoCard({
  photo,
  onClick,
}: {
  photo: Photo;
  onClick: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const bg = photo.placeholder.color ?? "#c8b8a2";
  const lqip =
    photo.placeholder.type === "lqip" ? photo.placeholder.dataURI : null;

  return (
    <button
      onClick={onClick}
      className="group relative w-full overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
      style={{ aspectRatio: photo.aspectRatio }}
    >
      {/* Placeholder: solid color or LQIP blur */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${
          loaded ? "opacity-0" : "opacity-100"
        }`}
        style={{
          backgroundColor: bg,
          backgroundImage: lqip ? `url(${lqip})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: lqip ? "blur(24px)" : undefined,
          transform: "scale(1.1)", // hide blur edge artifact
        }}
      />

      {/* Actual image */}
      <picture className="block w-full h-full">
        {photo.srcset.avif && (
          <source type="image/avif" srcSet={photo.srcset.avif} />
        )}
        {photo.srcset.webp && (
          <source type="image/webp" srcSet={photo.srcset.webp} />
        )}
        <img
          src={photo.fallback}
          srcSet={photo.srcset.jpeg}
          alt=""
          loading="lazy"
          decoding="async"
          width={photo.source.width}
          height={photo.source.height}
          onLoad={() => setLoaded(true)}
          className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-[1.03] ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      </picture>
    </button>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({
  photos,
  initialIndex,
  onClose,
}: {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const photo = photos[index];
  const total = photos.length;

  const prev = useCallback(
    () => setIndex((i) => (i > 0 ? i - 1 : total - 1)),
    [total]
  );
  const next = useCallback(
    () => setIndex((i) => (i < total - 1 ? i + 1 : 0)),
    [total]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, prev, next]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  if (!photo) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/92"
      onClick={onClose}
    >
      {/* Image */}
      <div
        className="relative"
        onClick={(e) => e.stopPropagation()}
      >
        <picture>
          {photo.srcset.avif && (
            <source
              type="image/avif"
              srcSet={photo.srcset.avif}
              sizes="90vw"
            />
          )}
          {photo.srcset.webp && (
            <source
              type="image/webp"
              srcSet={photo.srcset.webp}
              sizes="90vw"
            />
          )}
          <img
            src={photo.fallback}
            srcSet={photo.srcset.jpeg}
            sizes="90vw"
            alt=""
            draggable={false}
            className="max-w-[90vw] max-h-[90vh] object-contain select-none"
          />
        </picture>
      </div>

      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-5 text-white/60 hover:text-white text-4xl leading-none transition-colors"
        aria-label="닫기"
      >
        ×
      </button>

      {/* Prev */}
      {total > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-5xl leading-none px-2 py-4 transition-colors"
          aria-label="이전"
        >
          ‹
        </button>
      )}

      {/* Next */}
      {total > 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-5xl leading-none px-2 py-4 transition-colors"
          aria-label="다음"
        >
          ›
        </button>
      )}

      {/* Counter */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/40 text-sm tabular-nums">
        {index + 1} / {total}
      </div>
    </div>
  );
}

// ── Gallery ───────────────────────────────────────────────────────────────────

export default function Gallery({
  photos,
  categories,
}: {
  photos: Photo[];
  categories: string[];
}) {
  const [active, setActive] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const filtered = active
    ? photos.filter((p) => getCategory(p) === active)
    : photos;

  const openLightbox = useCallback((idx: number) => setLightboxIndex(idx), []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  return (
    <div className="px-2 pb-16 max-w-screen-2xl mx-auto">
      {/* Category filter */}
      {categories.length > 1 && (
        <div className="flex gap-2 flex-wrap justify-center mb-6">
          <button
            onClick={() => setActive(null)}
            className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${
              active === null
                ? "bg-stone-700 text-white border-stone-700"
                : "border-stone-300 text-stone-500 hover:border-stone-500 hover:text-stone-700"
            }`}
          >
            전체
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActive(cat === active ? null : cat)}
              className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${
                active === cat
                  ? "bg-stone-700 text-white border-stone-700"
                  : "border-stone-300 text-stone-500 hover:border-stone-500 hover:text-stone-700"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Photo grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-0.5">
        {filtered.map((photo, i) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            onClick={() => openLightbox(i)}
          />
        ))}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          photos={filtered}
          initialIndex={lightboxIndex}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}
