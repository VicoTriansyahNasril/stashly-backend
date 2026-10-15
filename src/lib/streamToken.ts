import { createHmac, timingSafeEqual } from 'crypto';
import { env } from './env';

/**
 * Token berumur pendek yang diberikan setelah password file berhasil diverifikasi,
 * supaya password tidak perlu dikirim lewat query string (masuk log/history).
 * Token terikat ke fileId dan hash password saat ini, sehingga mengganti password
 * otomatis membatalkan token lama.
 */
const TOKEN_TTL_SECONDS = 10 * 60;

const sign = (payload: string) =>
  createHmac('sha256', env.streamTokenSecret()).update(payload).digest('base64url');

export const createStreamToken = (fileId: string, passwordHash: string, now = Date.now()) => {
  const exp = Math.floor(now / 1000) + TOKEN_TTL_SECONDS;
  const signature = sign(`${fileId}.${exp}.${passwordHash}`);
  return { token: `${exp}.${signature}`, expiresIn: TOKEN_TTL_SECONDS };
};

export const verifyStreamToken = (
  token: string,
  fileId: string,
  passwordHash: string,
  now = Date.now(),
): boolean => {
  const [expStr, signature] = token.split('.');
  const exp = Number(expStr);
  if (!signature || !Number.isInteger(exp) || exp < Math.floor(now / 1000)) return false;

  const expected = Buffer.from(sign(`${fileId}.${exp}.${passwordHash}`));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
