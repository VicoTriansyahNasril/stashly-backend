import { getOAuthDriveService } from '../lib/googleAuth';
import { Readable } from 'stream';

export class DriveService {
  static async uploadToDrive(file: File, userId: string, targetFolderId?: string): Promise<string> {
    const drive = await getOAuthDriveService(userId);
    
    // Gunakan stream untuk menghindari memory bloat pada file besar
    const stream = Readable.fromWeb(file.stream() as import("stream/web").ReadableStream);

    const fileMetadata: any = {
      name: file.name,
    };
    
    if (targetFolderId && targetFolderId !== 'root') {
      fileMetadata.parents = [targetFolderId];
    }

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
      
      const isQuotaError = 
        error?.code === 403 && 
        error?.errors?.[0]?.reason === 'storageQuotaExceeded' || 
        error?.message?.toLowerCase().includes('quota') ||
        error?.message?.toLowerCase().includes('storage');
        
      if (isQuotaError) {
        throw new Error('Gagal mengunggah: Kapasitas penyimpanan Google Drive pribadi Anda telah penuh. Silakan kosongkan sebagian ruang di Google Drive Anda.');
      }
      
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

  static async downloadStream(driveFileId: string, userId: string) {
    const drive = await getOAuthDriveService(userId);
    try {
      const response = await drive.files.get(
        { fileId: driveFileId, alt: 'media' },
        { responseType: 'stream' }
      );
      
      // Node.js stream to Web Stream for standard Response object
      const { Readable } = require('stream');
      const webStream = Readable.toWeb(response.data);
      
      return { stream: webStream };
    } catch (error: any) {
      console.error('Error streaming from drive:', error);
      throw new Error(`Gagal mengambil stream dari Google Drive: ${error.message}`);
    }
  }

  static async listFolders(userId: string) {
    const drive = await getOAuthDriveService(userId);
    try {
      const response = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.folder' and trashed=false and 'me' in owners",
        fields: 'files(id, name)',
        spaces: 'drive',
      });
      return response.data.files || [];
    } catch (error: any) {
      console.error('Error listing folders:', error);
      throw new Error(`Gagal mengambil daftar folder: ${error.message}`);
    }
  }

  static async listFilesFromFolder(userId: string, folderId: string = 'root') {
    const drive = await getOAuthDriveService(userId);
    try {
      const q = `'${folderId}' in parents and mimeType != 'application/vnd.google-apps.folder' and trashed=false`;
      const response = await drive.files.list({
        q,
        fields: 'files(id, name, mimeType, size, thumbnailLink, webViewLink)',
        spaces: 'drive',
      });
      return response.data.files || [];
    } catch (error: any) {
      console.error('Error listing files from drive:', error);
      throw new Error(`Gagal mengambil daftar file: ${error.message}`);
    }
  }

  static async createFolder(name: string, userId: string) {
    const drive = await getOAuthDriveService(userId);
    const fileMetadata = {
      name: name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    try {
      const response = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name',
      });
      return response.data;
    } catch (error: any) {
      console.error('Error creating folder:', error);
      throw new Error(`Gagal membuat folder: ${error.message}`);
    }
  }


}
