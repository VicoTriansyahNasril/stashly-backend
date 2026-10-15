import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queueResults, resetDb, calledWith } from '../helpers/mockDb';
import { fileRecord } from '../helpers/testApp';

vi.mock('../../src/db', async () => await import('../helpers/mockDb'));
vi.mock('../../src/services/drive.service', () => ({
  DriveService: { deleteFromDrive: vi.fn().mockResolvedValue(undefined) },
}));

const { default: app } = await import('../../src/app');

const cleanup = (headers: Record<string, string> = {}) =>
  app.request('/cron/cleanup-trash', { method: 'POST', headers: { 'x-forwarded-for': '10.9.9.9', ...headers } });

describe('Cron cleanup-trash', () => {
  beforeEach(() => resetDb());

  it('menolak request tanpa secret', async () => {
    expect((await cleanup()).status).toBe(401);
    expect(calledWith('select')).toHaveLength(0);
  });

  it('menolak secret yang salah', async () => {
    expect((await cleanup({ Authorization: 'Bearer salah' })).status).toBe(401);
  });

  it('dinonaktifkan bila CRON_SECRET belum diset', async () => {
    const original = process.env.CRON_SECRET;
    process.env.CRON_SECRET = '';
    try {
      expect((await cleanup({ Authorization: 'Bearer ' })).status).toBe(503);
    } finally {
      process.env.CRON_SECRET = original;
    }
  });

  it('memproses file trash lama dengan secret yang benar', async () => {
    queueResults([fileRecord({ deletedAt: new Date('2020-01-01') })]);
    const res = await cleanup({ Authorization: `Bearer ${process.env.CRON_SECRET}` });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ deletedCount: 1, failedCount: 0, hasMore: false });
    expect(calledWith('transaction')).toHaveLength(1);
  });
});
