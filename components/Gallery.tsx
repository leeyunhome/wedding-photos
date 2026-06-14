"use client";

import { useState, useCallback, useEffect } from "react";
import type { Photo } from "@/lib/types";
import { getCategory } from "@/lib/storage";

const FAVORITES_KEY = "wedding-favorites";

// ── useFavorites ──────────────────────────────────────────────────────────────

function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  // Load from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(FAVORITES_KEY);
      if (stored) setFavorites(new Set(JSON.parse(stored)));
    } catch {}
  }, []);

  const toggle = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }, []);

  return { favorites, toggle };
}

// ── PhotoCard ─────────────────────────────────────────────────────────────────

function PhotoCard({
  photo,
  isFavorited,
  onToggleFavorite,
  onClick,
}: {
  photo: Photo;
  isFavorited: boolean;
  onToggleFavorite: (id: string) => void;
  onClick: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const bg = photo.placeholder.color ?? "#c8b8a2";
  const lqip =
    photo.placeholder.type === "lqip" ? photo.placeholder.dataURI : null;

  return (
    <div
      className="group relative w-full overflow-hidden"
      style={{ aspectRatio: photo.aspectRatio }}
    >
      {/* Clickable image area */}
      <button
        onClick={onClick}
        className="absolute inset-0 w-full h-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
      >
        {/* Placeholder */}
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
            transform: "scale(1.1)",
          }}
        />
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

      {/* Favorite button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(photo.id);
        }}
        aria-label={isFavorited ? "즐겨찾기 해제" : "즐겨찾기"}
        className={`absolute top-1.5 right-1.5 z-10 w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200
          ${isFavorited
            ? "opacity-100 bg-black/30"
            : "opacity-0 group-hover:opacity-100 bg-black/20"
          }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4 transition-colors duration-200"
          fill={isFavorited ? "#f87171" : "none"}
          stroke={isFavorited ? "#f87171" : "white"}
          strokeWidth={2}
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>
    </div>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({
  photos,
  initialIndex,
  favorites,
  onToggleFavorite,
  onClose,
}: {
  photos: Photo[];
  initialIndex: number;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
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
    return () => { document.body.style.overflow = ""; };
  }, []);

  if (!photo) return null;

  const isFav = favorites.has(photo.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/92"
      onClick={onClose}
    >
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <picture>
          {photo.srcset.avif && (
            <source type="image/avif" srcSet={photo.srcset.avif} sizes="90vw" />
          )}
          {photo.srcset.webp && (
            <source type="image/webp" srcSet={photo.srcset.webp} sizes="90vw" />
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

      {/* Favorite in lightbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(photo.id); }}
        aria-label={isFav ? "즐겨찾기 해제" : "즐겨찾기"}
        className="absolute top-4 right-14 flex items-center justify-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5"
          fill={isFav ? "#f87171" : "none"}
          stroke={isFav ? "#f87171" : "white"}
          strokeWidth={2}
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>

      {/* Prev */}
      {total > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); prev(); }}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white text-5xl leading-none px-2 py-4 transition-colors"
          aria-label="이전"
        >
          ‹
        </button>
      )}

      {/* Next */}
      {total > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); next(); }}
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

const FAVORITES_FILTER = "즐겨찾기";

export default function Gallery({
  photos,
  categories,
}: {
  photos: Photo[];
  categories: string[];
}) {
  const [active, setActive] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const { favorites, toggle: toggleFavorite } = useFavorites();

  const filtered =
    active === FAVORITES_FILTER
      ? photos.filter((p) => favorites.has(p.id))
      : active
      ? photos.filter((p) => getCategory(p) === active)
      : photos;

  const openLightbox = useCallback((idx: number) => setLightboxIndex(idx), []);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  return (
    <div className="px-2 pb-16 max-w-screen-2xl mx-auto">
      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap justify-center mb-6">
        {/* 전체 */}
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

        {/* Category tabs */}
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

        {/* Favorites tab */}
        <button
          onClick={() =>
            setActive(
              active === FAVORITES_FILTER ? null : FAVORITES_FILTER
            )
          }
          className={`px-4 py-1.5 text-sm rounded-full border transition-colors flex items-center gap-1.5 ${
            active === FAVORITES_FILTER
              ? "bg-red-400 text-white border-red-400"
              : "border-stone-300 text-stone-500 hover:border-red-300 hover:text-red-400"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className="w-3.5 h-3.5"
            fill={active === FAVORITES_FILTER ? "white" : "none"}
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          즐겨찾기
          {favorites.size > 0 && (
            <span className={`text-xs ${active === FAVORITES_FILTER ? "text-white/80" : "text-red-400"}`}>
              {favorites.size}
            </span>
          )}
        </button>
      </div>

      {/* Empty favorites state */}
      {active === FAVORITES_FILTER && filtered.length === 0 && (
        <div className="text-center py-20 text-stone-400">
          <svg viewBox="0 0 24 24" className="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <p className="text-sm">사진에 마우스를 올려 ♥ 를 눌러보세요</p>
        </div>
      )}

      {/* Photo grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-0.5">
        {filtered.map((photo, i) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            isFavorited={favorites.has(photo.id)}
            onToggleFavorite={toggleFavorite}
            onClick={() => openLightbox(i)}
          />
        ))}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          photos={filtered}
          initialIndex={lightboxIndex}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}
