"use client";

import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { Photo } from "@/lib/types";
import { getCategory } from "@/lib/storage";

const FAVORITES_KEY = "wedding-favorites";
const FAVORITES_FILTER = "즐겨찾기";

// ── useFavorites ──────────────────────────────────────────────────────────────

function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

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
      <button
        onClick={onClick}
        className="absolute inset-0 w-full h-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
      >
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

      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(photo.id);
        }}
        aria-label={isFavorited ? "즐겨찾기 해제" : "즐겨찾기"}
        className={`absolute top-1.5 right-1.5 z-10 w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200
          ${
            isFavorited
              ? "opacity-100 bg-black/30"
              : "opacity-0 group-hover:opacity-100 bg-black/20"
          }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="w-4 h-4"
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

// ── SimilarityPanel ───────────────────────────────────────────────────────────

type SimilarState =
  | { status: "idle" }
  | { status: "loading"; done: number; total: number; backend?: string }
  | { status: "done"; photos: Photo[] }
  | { status: "error"; message?: string };

function SimilarityPanel({
  allPhotos,
  current,
  onSelect,
}: {
  allPhotos: Photo[];
  current: Photo;
  onSelect: (photo: Photo) => void;
}) {
  const [state, setState] = useState<SimilarState>({ status: "idle" });

  // Reset when target photo changes
  useEffect(() => setState({ status: "idle" }), [current.id]);

  const handleFind = useCallback(async () => {
    setState({ status: "loading", done: 0, total: allPhotos.length - 1 });
    try {
      const { findSimilar } = await import("@/lib/similarity");
      const results = await findSimilar(allPhotos, current, 12, (done, total, backend) =>
        setState({ status: "loading", done, total, backend })
      );
      setState({ status: "done", photos: results });
    } catch (err) {
      console.error("[similarity] findSimilar failed:", err);
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [allPhotos, current]);

  if (state.status === "idle") {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleFind(); }}
        className="bg-white/15 hover:bg-white/25 text-white text-xs rounded-full px-4 py-2 transition-colors flex items-center gap-2"
      >
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        유사한 사진 찾기
      </button>
    );
  }

  if (state.status === "loading") {
    const label =
      state.backend === "cache" ? "캐시 로딩 중..." :
      state.backend === "decoding" ? "LQIP 디코딩 중..." :
      state.backend === "webgpu" || state.backend === "canvas"
        ? `분석 완료 (${state.backend})`
        : "분석 중...";
    return (
      <div className="flex items-center gap-2 text-white/50 text-xs" onClick={(e) => e.stopPropagation()}>
        <div className="w-3 h-3 border border-white/25 border-t-white/70 rounded-full animate-spin" />
        {label}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={handleFind}
          className="text-white/75 text-xs hover:text-white transition-colors border border-white/35 rounded-full px-3 py-1"
        >
          분석 실패 — 다시 시도
        </button>
        {state.message && (
          <p className="text-white/25 text-xs max-w-xs text-center leading-tight">
            {state.message.slice(0, 120)}
          </p>
        )}
      </div>
    );
  }

  // done
  return (
    <div
      className="flex flex-col items-center gap-2 w-full"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-white/25 text-xs">유사한 사진</p>
      <div className="flex gap-1.5 overflow-x-auto w-full px-4 justify-center pb-1">
        {state.photos.map((photo) => (
          <button
            key={photo.id}
            onClick={() => onSelect(photo)}
            className="flex-shrink-0 w-14 h-14 overflow-hidden rounded opacity-60 hover:opacity-100 transition-opacity ring-0 hover:ring-2 ring-white/50"
          >
            <img
              src={photo.fallback}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({
  photos,
  allPhotos,
  initialIndex,
  favorites,
  onToggleFavorite,
  onClose,
}: {
  photos: Photo[];
  allPhotos: Photo[];
  initialIndex: number;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  onClose: () => void;
}) {
  // navPhotos starts as filtered set; jumps to allPhotos when navigating from similarity results
  const [navPhotos, setNavPhotos] = useState(photos);
  const [index, setIndex] = useState(initialIndex);
  const photo = navPhotos[index];
  const total = navPhotos.length;

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

  const handleSelectSimilar = useCallback(
    (selected: Photo) => {
      const idx = allPhotos.findIndex((p) => p.id === selected.id);
      if (idx !== -1) {
        setNavPhotos(allPhotos);
        setIndex(idx);
      }
    },
    [allPhotos]
  );

  if (!photo) return null;
  const isFav = favorites.has(photo.id);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/92"
      onClick={onClose}
    >
      {/* Photo */}
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
            className="max-w-[90vw] max-h-[68vh] object-contain select-none"
          />
        </picture>
      </div>

      {/* Counter + similarity — always visible below photo */}
      <div
        className="flex flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-white/50 text-sm tabular-nums">
          {index + 1} / {total}
        </div>
        <SimilarityPanel
          allPhotos={allPhotos}
          current={photo}
          onSelect={handleSelectSimilar}
        />
      </div>

      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-5 text-white/60 hover:text-white text-4xl leading-none transition-colors"
        aria-label="닫기"
      >
        ×
      </button>

      {/* Favorite */}
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
  const { favorites, toggle: toggleFavorite } = useFavorites();

  // Column count derived from container width (mirrors Tailwind breakpoints)
  const [cols, setCols] = useState(5);
  const gridRef = useRef<HTMLDivElement>(null);

  // scrollMargin = distance from page top to grid container (for virtualizer)
  const [scrollMargin, setScrollMargin] = useState(0);

  const filtered =
    active === FAVORITES_FILTER
      ? photos.filter((p) => favorites.has(p.id))
      : active
      ? photos.filter((p) => getCategory(p) === active)
      : photos;

  // Scroll to top when filter changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [active]);

  // Responsive column detection
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setCols(w < 640 ? 2 : w < 1024 ? 3 : w < 1280 ? 4 : 5);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute scrollMargin after layout (synchronous, no paint flash)
  useLayoutEffect(() => {
    if (gridRef.current) {
      setScrollMargin(
        gridRef.current.getBoundingClientRect().top + window.scrollY
      );
    }
  }, [active]);

  // Group filtered photos into rows of `cols`
  const rows = useMemo(() => {
    const r: Photo[][] = [];
    for (let i = 0; i < filtered.length; i += cols) {
      r.push(filtered.slice(i, i + cols));
    }
    return r;
  }, [filtered, cols]);

  const rowVirtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => 280,
    overscan: 3,
    scrollMargin,
  });

  return (
    <div className="px-2 pb-16 max-w-screen-2xl mx-auto">
      {/* Filter tabs */}
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

        <button
          onClick={() =>
            setActive(active === FAVORITES_FILTER ? null : FAVORITES_FILTER)
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
            <span
              className={`text-xs ${
                active === FAVORITES_FILTER ? "text-white/80" : "text-red-400"
              }`}
            >
              {favorites.size}
            </span>
          )}
        </button>
      </div>

      {/* Empty favorites state */}
      {active === FAVORITES_FILTER && filtered.length === 0 && (
        <div className="text-center py-20 text-stone-400">
          <svg
            viewBox="0 0 24 24"
            className="w-10 h-10 mx-auto mb-3 opacity-30"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <p className="text-sm">사진에 마우스를 올려 ♥ 를 눌러보세요</p>
        </div>
      )}

      {/* Virtualized photo grid */}
      <div
        ref={gridRef}
        style={{ position: "relative", height: rowVirtualizer.getTotalSize() }}
      >
        {rowVirtualizer.getVirtualItems().map((vRow) => (
          <div
            key={vRow.index}
            data-index={vRow.index}
            ref={rowVirtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${vRow.start - scrollMargin}px)`,
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gap: "2px",
            }}
          >
            {rows[vRow.index].map((photo, ci) => {
              const globalIdx = vRow.index * cols + ci;
              return (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  isFavorited={favorites.has(photo.id)}
                  onToggleFavorite={toggleFavorite}
                  onClick={() => setLightboxIndex(globalIdx)}
                />
              );
            })}
          </div>
        ))}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          photos={filtered}
          allPhotos={photos}
          initialIndex={lightboxIndex}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
