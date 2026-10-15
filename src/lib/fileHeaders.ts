import { Context } from 'hono';
import { env } from './env';

// Hanya tipe ini yang boleh ditampilkan inline oleh browser. Tipe lain (HTML, SVG, JS, dll)
// selalu dipaksa menjadi download agar tidak bisa dieksekusi di origin API (stored XSS).
const INLINE_SAFE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/pdf',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
]);

export const isInlineSafe = (mimeType: string) => INLINE_SAFE_TYPES.has(mimeType.toLowerCase());

/** Content-Disposition sesuai RFC 6266/5987, aman dari header injection & karakter non-ASCII. */
export const contentDisposition = (type: 'inline' | 'attachment', fileName: string) => {
  const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').slice(0, 200) || 'file';
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
};

/** Pasang header yang aman untuk respons berisi konten file milik pengguna. */
export const setFileResponseHeaders = (
  c: Context,
  file: { fileName: string; fileType: string; fileSize?: number | null },
  options: { download?: boolean; cache?: 'private' | 'public' } = {},
) => {
  const inline = !options.download && isInlineSafe(file.fileType);
  c.header('Content-Type', inline ? file.fileType : 'application/octet-stream');
  c.header('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', file.fileName));
  if (file.fileSize && file.fileSize > 0) c.header('Content-Length', String(file.fileSize));
  c.header('X-Content-Type-Options', 'nosniff');
  // Konten file tidak boleh menjalankan script apa pun; hanya frontend yang boleh meng-embed (preview PDF).
  c.header(
    'Content-Security-Policy',
    `default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors ${env.allowedOrigin()}`,
  );
  c.header('Cache-Control', `${options.cache ?? 'private'}, max-age=300`);
};
