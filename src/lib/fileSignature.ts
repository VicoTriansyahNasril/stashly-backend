// Signature (magic bytes) per MIME yang diizinkan. MIME dari client bisa dipalsukan,
// jadi isi file dicek agar cocok dengan tipe yang diklaim.
const SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/webp': (b) => startsWith(b, [0x52, 0x49, 0x46, 0x46]) && ascii(b, 8, 12) === 'WEBP',
  'application/pdf': (b) => ascii(b, 0, 5) === '%PDF-',
  // APK adalah arsip ZIP
  'application/vnd.android.package-archive': (b) => startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
};

const startsWith = (bytes: Uint8Array, prefix: number[]) =>
  bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte);

const ascii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

export const ALLOWED_UPLOAD_TYPES = Object.keys(SIGNATURES);

export const matchesSignature = async (file: Blob, mimeType: string): Promise<boolean> => {
  const check = SIGNATURES[mimeType];
  if (!check) return false;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return check(head);
};
