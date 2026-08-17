import { getDriveService } from '../lib/googleAuth';
import { Readable } from 'stream';

export class DriveService {
  static async uploadToDrive(file: File): Promise<string> {
    const drive = getDriveService();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!folderId) {
      throw new Error('GOOGLE_DRIVE_FOLDER_ID is not defined');
    }

    // Gunakan stream untuk menghindari memory bloat pada file besar
    const stream = Readable.fromWeb(file.stream() as import("stream/web").ReadableStream);

    const fileMetadata = {
      name: file.name,
      parents: [folderId],
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
    } catch (error) {
      console.error('Error uploading to drive:', error);
      throw error;
    }
  }

  static async deleteFromDrive(fileId: string): Promise<void> {
    const drive = getDriveService();
    try {
      await drive.files.delete({
        fileId: fileId,
      });
    } catch (error) {
      console.error('Error deleting from drive:', error);
      throw error;
    }
  }

  static async generatePublicLink(fileId: string): Promise<{ webContentLink: string | null, webViewLink: string | null }> {
    const drive = getDriveService();
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
    } catch (error) {
      console.error('Error generating public link:', error);
      throw error;
    }
  }
}
