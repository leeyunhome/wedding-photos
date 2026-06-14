export const runtime = "edge";

import { getPhotos, getCategories } from "@/lib/storage";
import Gallery from "@/components/Gallery";

export default async function HomePage() {
  const photos = await getPhotos();
  const categories = getCategories(photos);

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
      <Gallery photos={photos} categories={categories} />
      <footer className="py-8 text-center text-xs text-stone-300 select-none">
        {photos.length} photos
      </footer>
    </main>
  );
}
