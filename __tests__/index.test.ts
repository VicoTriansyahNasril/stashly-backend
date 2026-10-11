import { describe, it, expect } from 'vitest';
import app from '../src/app';

describe('Stashly API', () => {
  it('GET / should return healthcheck message', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: 'Stashly API is running' });
  });
});
