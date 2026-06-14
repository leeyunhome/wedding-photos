/**
 * CLIP text-to-image search via @huggingface/transformers (Transformers.js).
 *
 * Model : Xenova/clip-vit-base-patch32  (ViT-B/32, 512-dim embedding space)
 * Device: WebGPU (fp16) → WASM (q8) fallback
 * Cache : IndexedDB — image embeddings computed once, then instant on reuse
 *
 * First call downloads ~150 MB of model weights from HuggingFace CDN.
 * After that the browser caches both weights and embeddings; all free.
 */

import type { Photo } from "./types";

const MODEL_ID = "Xenova/clip-vit-base-patch32";
const DB_NAME  = "wedding-clip-v1";
const DB_STORE = "emb";

// ── IndexedDB ─────────────────────────────────────────────────────────────────

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
    const r = db.transaction(DB_STORE).objectStore(DB_STORE).get(key);
    r.onsuccess = () => res(r.result ?? null);
    r.onerror = () => res(null);
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function l2normalize(data: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < data.length; i++) norm += data[i] * data[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return data;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] / norm;
  return out;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // already L2-normalised, so dot == cosine
}

function smallestJpeg(photo: Photo): string {
  const j = photo.variants.filter((v) => v.format === "jpeg").sort((a, b) => a.bytes - b.bytes);
  return j[0]?.path ?? photo.fallback;
}

// ── Model singleton ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _vision: any = null, _text: any = null, _processor: any = null, _tokenizer: any = null;
let _device = "unknown";

async function loadModels(): Promise<string> {
  if (_vision) return _device;

  const {
    CLIPVisionModelWithProjection,
    CLIPTextModelWithProjection,
    AutoProcessor,
    AutoTokenizer,
    env,
  } = await import("@huggingface/transformers");

  env.allowLocalModels = false; // always fetch from HuggingFace CDN
  env.useBrowserCache  = true;  // cache model weights in browser (default)

  const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
  const device    = hasWebGPU ? "webgpu" : "wasm";
  const dtype     = hasWebGPU ? "fp16"   : "q8";

  // Load all four components in parallel (tokenizer + processor are tiny)
  [_processor, _tokenizer, _vision, _text] = await Promise.all([
    AutoProcessor.from_pretrained(MODEL_ID),
    AutoTokenizer.from_pretrained(MODEL_ID),
    CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { device, dtype }),
    CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { device, dtype }),
  ]);

  _device = device;
  return device;
}

// ── Per-photo image embedding ─────────────────────────────────────────────────

async function imageEmbedding(photo: Photo, db: IDBDatabase): Promise<Float32Array> {
  const cached = await idbGet(db, photo.id);
  if (cached) return cached;

  const { RawImage } = await import("@huggingface/transformers");
  const image  = await RawImage.fromURL(smallestJpeg(photo));
  const inputs = await _processor(image);
  const { image_embeds } = await _vision(inputs);

  // image_embeds: Tensor [1, 512] → Float32Array
  const data = l2normalize(new Float32Array(image_embeds.data));
  await idbPut(db, photo.id, data);
  return data;
}

// ── Text embedding ────────────────────────────────────────────────────────────

async function textEmbedding(query: string): Promise<Float32Array> {
  const inputs = await _tokenizer(query, { padding: true, truncation: true });
  const { text_embeds } = await _text(inputs);
  return l2normalize(new Float32Array(text_embeds.data));
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface SearchResult { photo: Photo; score: number }

export type SearchProgressCallback = (done: number, total: number, device: string) => void;

/**
 * Search photos by a free-form text query using CLIP embeddings.
 *
 * Progress callback fires once per photo as embeddings are computed.
 * On first run: slow (model download + image inference for all photos).
 * On repeat: near-instant (all embeddings cached in IndexedDB).
 */
export async function searchByText(
  photos: Photo[],
  query: string,
  topN  = 20,
  onProgress?: SearchProgressCallback,
): Promise<SearchResult[]> {
  const [db, device] = await Promise.all([idbOpen(), loadModels()]);

  const textEmb = await textEmbedding(query);

  const results: SearchResult[] = [];
  let done = 0;

  for (const photo of photos) {
    const imgEmb = await imageEmbedding(photo, db);
    results.push({ photo, score: cosine(textEmb, imgEmb) });
    done++;
    onProgress?.(done, photos.length, device);
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topN);
}
