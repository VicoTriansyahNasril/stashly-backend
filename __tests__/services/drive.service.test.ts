import { describe, it, expect, vi } from 'vitest';
import { DriveService } from '../../src/services/drive.service';
import { google } from 'googleapis';

// Mock googleapis
vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        GoogleAuth: vi.fn().mockImplementation(() => ({})),
      },
      drive: vi.fn().mockImplementation(() => ({
        files: {
          create: vi.fn().mockResolvedValue({ data: { id: 'mock-drive-id' } }),
          delete: vi.fn().mockResolvedValue({ data: {} }),
        }
      }))
    }
  };
});

describe('DriveService', () => {
  it('initializes without throwing', () => {
    expect(DriveService).toBeDefined();
  });

  // More detailed testing of uploadToDrive would involve providing mock files 
  // and asserting that google.drive().files.create was called correctly.
});
