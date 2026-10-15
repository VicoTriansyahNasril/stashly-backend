import { describe, expect, it } from 'vitest';
import { createStreamToken, verifyStreamToken } from '../../src/lib/streamToken';
import { contentDisposition, isInlineSafe } from '../../src/lib/fileHeaders';
import { matchesSignature } from '../../src/lib/fileSignature';
import { escapeLike } from '../../src/lib/validation';

describe('streamToken', () => {
  const id = 'file-1';
  const hash = '$2a$12$abc';

  it('token valid untuk file & password yang sama', () => {
    const { token } = createStreamToken(id, hash);
    expect(verifyStreamToken(token, id, hash)).toBe(true);
  });

  it('ditolak untuk file lain, password lain, atau token dimodifikasi', () => {
    const { token } = createStreamToken(id, hash);
    expect(verifyStreamToken(token, 'file-2', hash)).toBe(false);
    expect(verifyStreamToken(token, id, '$2a$12$other')).toBe(false);
    expect(verifyStreamToken(`${token}x`, id, hash)).toBe(false);
    const [exp, sig] = token.split('.');
    expect(verifyStreamToken(`${Number(exp) + 9999}.${sig}`, id, hash)).toBe(false);
    expect(verifyStreamToken('', id, hash)).toBe(false);
    expect(verifyStreamToken('garbage', id, hash)).toBe(false);
  });

  it('kedaluwarsa setelah TTL', () => {
    const { token } = createStreamToken(id, hash, Date.now() - 11 * 60 * 1000);
    expect(verifyStreamToken(token, id, hash)).toBe(false);
  });
});

describe('fileHeaders', () => {
  it('hanya tipe aman yang boleh inline', () => {
    expect(isInlineSafe('image/png')).toBe(true);
    expect(isInlineSafe('text/html')).toBe(false);
    expect(isInlineSafe('image/svg+xml')).toBe(false);
    expect(isInlineSafe('application/javascript')).toBe(false);
  });

  it('Content-Disposition tidak bisa disisipi header baru', () => {
    const value = contentDisposition('attachment', 'a\r\nSet-Cookie: x=1.png');
    expect(value).not.toMatch(/[\r\n]/);
  });
});

describe('matchesSignature', () => {
  it('mendeteksi PNG/PDF asli dan menolak file palsu', async () => {
    const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]);
    expect(await matchesSignature(png, 'image/png')).toBe(true);
    expect(await matchesSignature(new Blob(['%PDF-1.7']), 'application/pdf')).toBe(true);
    expect(await matchesSignature(new Blob(['<html>']), 'image/png')).toBe(false);
    expect(await matchesSignature(png, 'text/html')).toBe(false);
  });
});

describe('escapeLike', () => {
  it('meng-escape wildcard LIKE', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
