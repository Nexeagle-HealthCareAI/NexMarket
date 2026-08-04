/**
 * Client-side photo compression before it goes into IndexedDB / the sync
 * outbox. Raw camera captures can be several MB — on a 2G/3G field
 * connection that turns one contact's outbox entry into a slow, easy-to-fail
 * upload. Downscale + re-encode as JPEG via a canvas before storing.
 */
interface CompressOptions {
  maxDimension?: number;
  quality?: number;
}

async function compressToCanvas(file: File, { maxDimension = 1024 }: CompressOptions): Promise<HTMLCanvasElement | null> {
  const dataUri = await readFileAsDataUri(file);

  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to decode image'));
  });
  img.src = dataUri;
  await loaded;

  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null; // canvas unavailable — caller falls back to the original

  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

export async function compressImage(file: File, options: CompressOptions = {}): Promise<string> {
  const canvas = await compressToCanvas(file, options);
  if (!canvas) return readFileAsDataUri(file);
  return canvas.toDataURL('image/jpeg', options.quality ?? 0.72);
}

/** Same compression, but for callers (multipart photo upload) that need a Blob rather than a data URI. */
export async function compressImageToBlob(file: File, options: CompressOptions = {}): Promise<Blob> {
  const canvas = await compressToCanvas(file, options);
  if (!canvas) return file;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', options.quality ?? 0.72));
  return blob ?? file;
}

function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
