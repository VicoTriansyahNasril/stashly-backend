import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calledWith, dbError, queueResults, resetDb } from '../helpers/mockDb';
import { jsonHeaders } from '../helpers/testApp';

vi.mock('../../src/db', async () => await import('../helpers/mockDb'));
vi.mock('../../src/middlewares/auth.middleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'user-1');
    await next();
  },
}));

vi.mock('../../src/services/drive.service', () => ({
  DriveService: { getPickerAccessToken: vi.fn().mockResolvedValue({ accessToken: 'ya29.x', expiresAt: 1 }) },
}));

const { default: app } = await import('../../src/app');

const updateSettings = (body: unknown) =>
  app.request('/users/settings', { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(body) });

describe('PUT /users/settings', () => {
  beforeEach(() => resetDb());

  it.each([
    ['terlalu pendek', 'ab'],
    ['route yang dipakai aplikasi', 'dashboard'],
    ['karakter path', '../admin'],
    ['karakter HTML', '<script>'],
    ['spasi', 'budi santoso'],
  ])('menolak username %s', async (_label, username) => {
    const res = await updateSettings({ username });
    expect(res.status).toBe(400);
    expect(calledWith('update')).toHaveLength(0);
  });

  it('menolak field yang tidak diizinkan (mass assignment)', async () => {
    const res = await updateSettings({ storageLimit: 999999999999 });
    expect(res.status).toBe(400);
  });

  it('menormalkan username ke huruf kecil', async () => {
    queueResults([], [{ id: 'user-1', username: 'budi_s' }]);
    const res = await updateSettings({ username: 'Budi_S' });
    expect(res.status).toBe(200);
    expect(calledWith('set')[0].args[0]).toEqual({ username: 'budi_s' });
  });

  it('username yang sudah dipakai → 409', async () => {
    queueResults([{ id: 'user-2' }]);
    expect((await updateSettings({ username: 'budi' })).status).toBe(409);
  });

  it('unique violation saat race condition → 409', async () => {
    queueResults([], dbError(Object.assign(new Error('unique'), { code: '23505' })));
    expect((await updateSettings({ username: 'budi' })).status).toBe(409);
  });

  it('GET /users/me tidak mengembalikan kolom sensitif', async () => {
    queueResults([{ id: 'user-1', email: 'a@b.c' }]);
    const res = await app.request('/users/me');
    expect(res.status).toBe(200);
    const selected = Object.keys(calledWith('select')[0].args[0] as object);
    expect(selected).not.toContain('emailVerified');
  });
});

describe('GET /users/drive-token', () => {
  it('mengembalikan token Picker dan tidak boleh di-cache', async () => {
    const res = await app.request('/users/drive-token', { headers: { 'x-forwarded-for': '10.7.7.7' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.json()).data.accessToken).toBe('ya29.x');
  });
});
