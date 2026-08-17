import { getOAuthDriveService } from '../lib/googleAuth';
import { Readable } from 'stream';

export class DriveService {
  static async uploadToDrive(file: File, userId: string): Promise<string> {
    const drive = await getOAuthDriveService(userId);
    
    // Gunakan stream untuk menghindari memory bloat pada file besar
    const stream = Readable.fromWeb(file.stream() as import("stream/web").ReadableStream);

    const fileMetadata = {
      name: file.name,
      // Kita tidak perlu tentukan folderId jika ingin simpan di root Drive user
    };

    const media = {
      mimeType: file.type,
      body: stream,
    };

    try {
      const response = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: 'id',
      });
      return response.data.id!;
    } catch (error: any) {
      console.error('Error uploading to drive:', error);
      throw new Error(`Gagal mengunggah ke Google Drive: ${error.message}`);
    }
  }

  static async deleteFromDrive(fileId: string, userId: string): Promise<void> {
    const drive = await getOAuthDriveService(userId);
    try {
      await drive.files.delete({
        fileId: fileId,
      });
    } catch (error: any) {
      console.error('Error deleting from drive:', error);
      throw new Error(`Gagal menghapus dari Google Drive: ${error.message}`);
    }
  }

  static async generatePublicLink(fileId: string, userId: string): Promise<{ webContentLink: string | null, webViewLink: string | null }> {
    const drive = await getOAuthDriveService(userId);
    try {
      await drive.permissions.create({
        fileId: fileId,
        requestBody: {
          role: 'reader',
          type: 'anyone',
        },
      });

      const result = await drive.files.get({
        fileId: fileId,
        fields: 'webViewLink, webContentLink',
      });

      return {
        webContentLink: result.data.webContentLink || null,
        webViewLink: result.data.webViewLink || null
      };
    } catch (error: any) {
      console.error('Error generating public link:', error);
      throw new Error(`Gagal membuat tautan publik: ${error.message}`);
    }
  }
}
