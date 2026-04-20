import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';

export interface StoredFileDescriptor {
  storedFileName: string;
  absolutePath: string;
}

export class FileStorageService {
  public async ensureUploadDirectory(): Promise<void> {
    await fs.mkdir(env.UPLOAD_DIR, { recursive: true });
  }

  public async saveIfcFile(originalFileName: string, buffer: Buffer): Promise<StoredFileDescriptor> {
    await this.ensureUploadDirectory();

    const safeExtension = path.extname(originalFileName) || '.ifc';
    const storedFileName = `${randomUUID()}${safeExtension}`;
    const absolutePath = path.join(env.UPLOAD_DIR, storedFileName);

    await fs.writeFile(absolutePath, buffer);

    return {
      storedFileName,
      absolutePath,
    };
  }

  public resolveAbsolutePath(storedFileName: string): string {
    return path.join(env.UPLOAD_DIR, storedFileName);
  }
}

export const fileStorageService = new FileStorageService();
