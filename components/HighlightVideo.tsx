"use client";

const VIDEO_PATH = "videos/highlight_web.mp4";
const R2_URL = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? "").replace(/\/$/, "");

export default function HighlightVideo() {
  if (!R2_URL) return null;

  const src = `${R2_URL}/${VIDEO_PATH}`;

  return (
    <section className="py-10 px-4 max-w-4xl mx-auto">
      <p className="text-center text-xs tracking-[0.25em] text-stone-400 mb-5 select-none uppercase">
        Highlight
      </p>
      <div className="relative w-full rounded-xl overflow-hidden shadow-lg bg-black" style={{ aspectRatio: "16/9" }}>
        <video
          controls
          playsInline
          preload="metadata"
          className="w-full h-full"
          poster=""
        >
          <source src={src} type="video/mp4" />
          브라우저가 동영상을 지원하지 않습니다.
        </video>
      </div>
    </section>
  );
}
