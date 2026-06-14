/**
 * WebGPU-accelerated visual similarity search using MobileNetV2 embeddings.
 * All computation runs client-side; embeddings are cached in IndexedDB so
 * subsequent searches are instant.
 *
 * Backend priority: WebGPU → WebGL → CPU
 */

import type { Photo } from "./types";

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

const DB_NAME = "wedding-sim-v1";
const DB_STORE = "embeddings";

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(DB_STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<Float32Array | null> {
  return new Promise((res) => {
    const req = db.transaction(DB_STORE).objectStore(DB_STORE).get(key);
    req.onsuccess = () => res(req.result ?? null);
    req.onerror = () => res(null);
  });
}

function idbPut(db: IDBDatabase, key: string, val: Float32Array): Promise<void> {
  return new Promise((res, rej) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ── Math ──────────────────────────────────────────────────────────────────────

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) + 1e-10);
}

// ── Image helpers ─────────────────────────────────────────────────────────────

function smallestJpeg(photo: Photo): string {
  const jpegs = photo.variants
    .filter((v) => v.format === "jpeg")
    .sort((a, b) => a.bytes - b.bytes);
  return jpegs[0]?.path ?? photo.fallback;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// ── Model singleton ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _model: any = null;
let _backend = "unknown";

async function getModel() {
  if (_model) return { model: _model, backend: _backend };

  const tf = await import("@tensorflow/tfjs");

  // Try WebGPU first (Chrome/Edge 113+), fall back to WebGL GPU
  try {
    await import("@tensorflow/tfjs-backend-webgpu");
    await tf.setBackend("webgpu");
    await tf.ready();
    _backend = "webgpu";
  } catch {
    await tf.setBackend("webgl");
    await tf.ready();
    _backend = "webgl";
  }

  const mn = await import("@tensorflow-models/mobilenet");
  _model = await mn.load({ version: 2, alpha: 1.0 });

  return { model: _model as typeof _model, backend: _backend };
}

// ── Embedding extraction ──────────────────────────────────────────────────────

async function embed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  db: IDBDatabase,
  photo: Photo
): Promise<Float32Array> {
  const cached = await idbGet(db, photo.id);
  if (cached) return cached;

  const img = await loadImg(smallestJpeg(photo));

  // MobileNetV2 infer with embedding=true → Tensor2D [1, 1280]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = model.infer(img, true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flat: any = raw.squeeze();
  const data = new Float32Array(await flat.data());
  raw.dispose();
  flat.dispose();

  await idbPut(db, photo.id, data);
  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

export type ProgressCallback = (done: number, total: number, backend: string) => void;

/**
 * Returns the top `topN` photos most visually similar to `target`.
 * First call loads the model (~16 MB from Google CDN, then browser-cached).
 * Embeddings are cached per-photo in IndexedDB after first computation.
 */
export async function findSimilar(
  allPhotos: Photo[],
  target: Photo,
  topN = 12,
  onProgress?: ProgressCallback
): Promise<Photo[]> {
  const [{ model, backend }, db] = await Promise.all([getModel(), idbOpen()]);

  const targetEmb = await embed(model, db, target);
  const others = allPhotos.filter((p) => p.id !== target.id);

  const scored: Array<{ photo: Photo; score: number }> = [];
  let done = 0;

  for (const photo of others) {
    const emb = await embed(model, db, photo);
    scored.push({ photo, score: cosine(targetEmb, emb) });
    done++;
    onProgress?.(done, others.length, backend);
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((r) => r.photo);
}
