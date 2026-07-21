// Turn uploaded pay-plan files into the /api/parse-payplan request payload.
// Shared by onboarding (first upload) and Settings (re-upload when the plan
// changes). Text files ride as text; PDFs and photos ride as base64 for vision.
// Pay plans are often several pages photographed one at a time, so the payload
// carries a LIST of files — and phone photos are compressed on-device first
// (a raw iPhone photo is ~3MB; four of them would blow any request cap).

export interface FilePart { dataB64: string; mediaType: string; name: string }
export interface ParsePayload { text?: string; files?: FilePart[]; skipped?: string[] }

// Image types the vision model accepts as-is. Anything else (HEIC on a browser
// that can't decode it, exotic formats) must go through canvas re-encoding —
// if that fails too, the page is reported back as skipped, not sent to die.
const VISION_MEDIA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Longest edge Claude vision reads best at — bigger only costs bytes.
const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.82;

export async function filesToPayload(files: File[]): Promise<ParsePayload> {
  const out: ParsePayload = {};
  const texts: string[] = [];
  const parts: FilePart[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const isText = file.type.startsWith("text") || /\.(txt|rtf|csv|md)$/i.test(file.name);
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isImage = file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name);
    if (isText) texts.push((await file.text()).slice(0, 200000));
    else if (isPdf) parts.push({ dataB64: await fileToBase64(file), mediaType: "application/pdf", name: file.name });
    else if (isImage) {
      try { parts.push(await compressImage(file)); } catch { skipped.push(file.name); }
    }
    // Anything else (Word docs etc.) can't be parsed — report it, never
    // let a page silently vanish from a multi-pick.
    else skipped.push(file.name);
  }
  if (texts.length) out.text = texts.join("\n\n--- next page ---\n\n").slice(0, 200000);
  if (parts.length) out.files = parts;
  if (skipped.length) out.skipped = skipped;
  return out;
}

// Downscale + re-encode a photo so a full-res phone picture becomes a few
// hundred KB without losing legibility. If the browser can't decode it
// (e.g. HEIC outside Safari), fall back to the raw bytes ONLY when the vision
// model accepts that format — otherwise throw so the page is reported as
// skipped instead of failing the whole parse downstream.
export async function compressImage(file: File): Promise<FilePart> {
  try {
    const bitmap = await loadBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    // White backing so transparent PNGs don't turn black as JPEG.
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    if ("close" in bitmap) (bitmap as ImageBitmap).close();
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const dataB64 = dataUrl.split(",")[1] || "";
    if (!dataB64) throw new Error("encode failed");
    return { dataB64, mediaType: "image/jpeg", name: file.name };
  } catch (e) {
    if (VISION_MEDIA.has(file.type)) return { dataB64: await fileToBase64(file), mediaType: file.type, name: file.name };
    throw e;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file); } catch { /* fall through to <img> */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
    img.src = url;
  });
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
