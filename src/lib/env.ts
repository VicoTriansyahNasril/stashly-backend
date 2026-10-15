// Akses konfigurasi lewat fungsi agar nilai dibaca saat dipakai (memudahkan test).
export const env = {
  allowedOrigin: () => process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  cronSecret: () => process.env.CRON_SECRET || '',
  trustProxy: () => process.env.TRUST_PROXY === 'true',
  streamTokenSecret: () => {
    const secret = process.env.STREAM_TOKEN_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('STREAM_TOKEN_SECRET must be set (min 32 chars)');
    }
    return secret;
  },
};
