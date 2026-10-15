/**
 * Migrasi satu kali: cabut izin "anyone with link" dari semua file yang dulu dibuat publik
 * langsung di Google Drive. Setelah ini, akses publik hanya lewat backend yang menegakkan
 * password, kedaluwarsa, dan status trash.
 *
 * Jalankan: npm run revoke-public-links
 */
import { asc, gt } from 'drizzle-orm';
import { db } from '../db';
import { files } from '../db/schema';
import { DriveService } from '../services/drive.service';

const BATCH = 100;

const main = async () => {
  let lastId = '00000000-0000-0000-0000-000000000000';
  let revoked = 0;
  let failed = 0;

  for (;;) {
    const batch = await db
      .select({ id: files.id, driveFileId: files.driveFileId, userId: files.userId })
      .from(files)
      .where(gt(files.id, lastId))
      .orderBy(asc(files.id))
      .limit(BATCH);
    if (batch.length === 0) break;

    for (const file of batch) {
      try {
        await DriveService.revokePublicAccess(file.driveFileId, file.userId);
        revoked++;
      } catch (error) {
        failed++;
        console.error(`Gagal mencabut akses publik file ${file.id}:`, error instanceof Error ? error.message : error);
      }
    }
    lastId = batch[batch.length - 1].id;
  }

  console.log(`Selesai. Diproses: ${revoked}, gagal: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
