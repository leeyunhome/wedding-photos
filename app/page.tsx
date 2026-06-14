import dynamic from "next/dynamic";

// Both components are large client-only bundles — skip SSR entirely so the
// edge Worker only serves a lightweight HTML shell and never touches their
// module graphs (which include @huggingface/transformers etc.).
const HighlightVideo = dynamic(() => import("@/components/HighlightVideo"), { ssr: false });
const Gallery = dynamic(() => import("@/components/Gallery"), { ssr: false });

export const runtime = "edge";

export default function HomePage() {
  return (
    <main>
      <header className="py-12 text-center select-none">
        <p className="text-xs tracking-[0.3em] text-stone-400 mb-3">
          2026 · 03 · 28
        </p>
        <h1 className="text-3xl font-light tracking-[0.2em] text-stone-700">
          이윤호 · 진수빈
        </h1>
      </header>
      <HighlightVideo />
      <Gallery />
    </main>
  );
}
