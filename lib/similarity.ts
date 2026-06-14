/// <reference types="@webgpu/types" />
/**
 * Visual similarity search via color histograms.
 *
 * Compute path:
 *   WebGPU — all 1268 images processed in ONE compute dispatch (WGSL shader)
 *   Fallback — Canvas 2D per-image on CPU
 *
 * Input: LQIP data URIs already in memory (from manifest). No network requests.
 * Speed: first run ~1–2 s (WebGPU) or ~3 s (CPU). Subsequent: instant (IndexedDB).
 */

import type { Photo } from "./types";

// ── Config ────────────────────────────────────────────────────────────────────
const BINS = 8;               // bins per RGB channel (8 = 3 bits)
const NUM_BINS = BINS ** 3;   // 512 total histogram buckets
const THUMB = 32;             // resize every LQIP to 32×32 before histogramming

// ── IndexedDB ─────────────────────────────────────────────────────────────────
const DB_NAME = "wedding-sim-v3";
const DB_STORE = "hists";

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

// ── Cosine similarity ─────────────────────────────────────────────────────────
function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) + 1e-10);
}

// ── LQIP → 32×32 RGBA pixels ──────────────────────────────────────────────────
function photoToPixels(photo: Photo): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = THUMB;
    canvas.height = THUMB;
    const ctx = canvas.getContext("2d")!;

    if (photo.placeholder.type === "lqip" && photo.placeholder.dataURI) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, THUMB, THUMB);
        resolve(ctx.getImageData(0, 0, THUMB, THUMB).data);
      };
      img.onerror = reject;
      img.src = photo.placeholder.dataURI;
    } else {
      // Solid-color placeholder → fill canvas
      ctx.fillStyle = photo.placeholder.color ?? "#888888";
      ctx.fillRect(0, 0, THUMB, THUMB);
      resolve(ctx.getImageData(0, 0, THUMB, THUMB).data);
    }
  });
}

// ── CPU histogram (Canvas fallback) ──────────────────────────────────────────
function cpuHistogram(pixels: Uint8ClampedArray): Float32Array {
  const hist = new Float32Array(NUM_BINS);
  const shift = 5; // 8 bits → 3 bits (8 bins)
  const n = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    hist[(pixels[i] >> shift) * 64 + (pixels[i + 1] >> shift) * 8 + (pixels[i + 2] >> shift)]++;
  }
  for (let i = 0; i < NUM_BINS; i++) hist[i] /= n;
  return hist;
}

// ── WebGPU batch histogram (WGSL compute shader) ──────────────────────────────
//
// One workgroup per image; 256 threads stride over that image's pixels.
// atomicAdd accumulates per-image, per-bin counts into a flat storage buffer.
//
const WGSL = /* wgsl */ `
struct Params { num_images: u32, ppi: u32, num_bins: u32 }

@group(0) @binding(0) var<uniform>              params    : Params;
@group(0) @binding(1) var<storage, read>         all_px   : array<u32>;
@group(0) @binding(2) var<storage, read_write>   all_hist : array<atomic<u32>>;

@compute @workgroup_size(256)
fn main(
  @builtin(workgroup_id)       wg  : vec3<u32>,
  @builtin(local_invocation_id) lid : vec3<u32>,
) {
  let img = wg.x;
  if (img >= params.num_images) { return; }

  let px_base   = img * params.ppi;
  let hist_base = img * params.num_bins;

  var i = lid.x;
  loop {
    if (i >= params.ppi) { break; }
    let p = all_px[px_base + i];
    let r = (p         & 0xFFu) >> 5u;   // 0-7
    let g = ((p >> 8u) & 0xFFu) >> 5u;
    let b = ((p >>16u) & 0xFFu) >> 5u;
    atomicAdd(&all_hist[hist_base + r * 64u + g * 8u + b], 1u);
    i += 256u;  // stride by workgroup_size
  }
}
`;

async function webgpuBatchHistogram(
  pixelArrays: Uint8ClampedArray[]
): Promise<{ hists: Float32Array[]; backend: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gpu = (navigator as any).gpu as GPU | undefined;
  if (!gpu) throw new Error("WebGPU not available");

  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter");
  const device = await adapter.requestDevice();

  const N = pixelArrays.length;
  const ppi = THUMB * THUMB; // pixels per image

  // Pack all RGBA arrays into one flat Uint32Array
  const flat = new Uint32Array(N * ppi);
  for (let img = 0; img < N; img++) {
    const src = pixelArrays[img];
    const base = img * ppi;
    for (let j = 0; j < ppi; j++) {
      const s = j * 4;
      flat[base + j] = src[s] | (src[s + 1] << 8) | (src[s + 2] << 16) | (src[s + 3] << 24);
    }
  }

  // GPU buffers
  const pBuf = device.createBuffer({ size: 12, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(pBuf, 0, new Uint32Array([N, ppi, NUM_BINS]));

  const pxBuf = device.createBuffer({ size: flat.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(pxBuf, 0, flat);

  const histSize = N * NUM_BINS * 4;
  const histGPU = device.createBuffer({ size: histSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readBuf = device.createBuffer({ size: histSize, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });

  // Pipeline & bind group
  const pipeline = await device.createComputePipelineAsync({
    layout: "auto",
    compute: { module: device.createShaderModule({ code: WGSL }), entryPoint: "main" },
  });
  const bg = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: pBuf } },
      { binding: 1, resource: { buffer: pxBuf } },
      { binding: 2, resource: { buffer: histGPU } },
    ],
  });

  // Dispatch all images in one call
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(N); // one workgroup per image
  pass.end();
  enc.copyBufferToBuffer(histGPU, 0, readBuf, 0, histSize);
  device.queue.submit([enc.finish()]);

  await readBuf.mapAsync(GPUMapMode.READ);
  const raw = new Uint32Array(readBuf.getMappedRange());

  const hists: Float32Array[] = [];
  for (let i = 0; i < N; i++) {
    const hist = new Float32Array(NUM_BINS);
    const base = i * NUM_BINS;
    for (let j = 0; j < NUM_BINS; j++) hist[j] = raw[base + j] / ppi;
    hists.push(hist);
  }

  readBuf.unmap();
  device.destroy();
  return { hists, backend: "webgpu" };
}

// ── Public API ────────────────────────────────────────────────────────────────

export type ProgressCallback = (done: number, total: number, backend: string) => void;

export async function findSimilar(
  allPhotos: Photo[],
  target: Photo,
  topN = 12,
  onProgress?: ProgressCallback
): Promise<Photo[]> {
  const db = await idbOpen();

  // Load cached histograms; collect uncached photos
  const cached = new Map<string, Float32Array>();
  const uncached: Photo[] = [];

  for (const p of allPhotos) {
    const h = await idbGet(db, p.id);
    if (h) cached.set(p.id, h);
    else uncached.push(p);
  }

  onProgress?.(allPhotos.length - uncached.length, allPhotos.length, "cache");

  if (uncached.length > 0) {
    onProgress?.(0, uncached.length, "decoding");

    // Decode LQIP → pixel arrays (fast, in-memory data URIs)
    const pixelArrays = await Promise.all(uncached.map(photoToPixels));

    // Compute histograms — WebGPU batch (single dispatch) or CPU fallback
    let hists: Float32Array[];
    let backend: string;

    try {
      ({ hists, backend } = await webgpuBatchHistogram(pixelArrays));
    } catch {
      hists = pixelArrays.map(cpuHistogram);
      backend = "canvas";
    }

    onProgress?.(uncached.length, uncached.length, backend);

    // Cache
    for (let i = 0; i < uncached.length; i++) {
      await idbPut(db, uncached[i].id, hists[i]);
      cached.set(uncached[i].id, hists[i]);
    }
  }

  // Score all photos against target
  const targetHist = cached.get(target.id);
  if (!targetHist) throw new Error("target histogram missing");

  return allPhotos
    .filter((p) => p.id !== target.id)
    .map((p) => ({ photo: p, score: cosine(targetHist, cached.get(p.id)!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
    .map((r) => r.photo);
}
