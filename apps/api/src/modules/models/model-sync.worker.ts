import fs from 'node:fs/promises';
import type { FastifyBaseLogger } from 'fastify';
import { fileStorageService } from '../../infrastructure/storage/file-storage.service.js';
import { backendIfcSnapshotExtractor } from './model-sync.extractor.js';
import { modelRepository } from './model.repository.js';

const POLL_INTERVAL_MS = 2000;

export class ModelSyncWorker {
  private logger: FastifyBaseLogger | Console = console;

  private timer: NodeJS.Timeout | null = null;

  private running = false;

  private processing = false;

  public async start(logger: FastifyBaseLogger) {
    if (this.running) {
      return;
    }

    this.logger = logger;
    this.running = true;

    await modelRepository.requeueInterruptedSnapshots();

    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);

    void this.tick();
  }

  public async stop() {
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public notify() {
    if (!this.running) {
      return;
    }

    void this.tick();
  }

  private logInfo(payload: Record<string, unknown>, message: string) {
    if ('info' in this.logger && typeof this.logger.info === 'function') {
      (this.logger.info as (payload: Record<string, unknown>, message: string) => void)(payload, message);
      return;
    }

    console.info(message, payload);
  }

  private logError(error: unknown, modelId: string) {
    if ('error' in this.logger && typeof this.logger.error === 'function') {
      (this.logger.error as (payload: Record<string, unknown>, message: string) => void)(
        { err: error, modelId },
        'IFC snapshot sync failed',
      );
      return;
    }

    console.error('IFC snapshot sync failed', { modelId, error });
  }

  private async tick() {
    if (!this.running || this.processing) {
      return;
    }

    this.processing = true;

    try {
      let model = await modelRepository.claimNextQueuedModel();

      while (model) {
        await this.processModel(model.id, model.storedFileName, model.originalFileName);
        model = await modelRepository.claimNextQueuedModel();
      }
    } finally {
      this.processing = false;
    }
  }

  private async processModel(modelId: string, storedFileName: string, originalFileName: string) {
    let processedElements = 0;
    let totalProperties = 0;

    try {
      this.logInfo({ modelId, originalFileName }, 'Starting IFC snapshot sync');

      const absolutePath = fileStorageService.resolveAbsolutePath(storedFileName);
      const fileBuffer = await fs.readFile(absolutePath);

      const extraction = await backendIfcSnapshotExtractor.extractFromBuffer(new Uint8Array(fileBuffer), async (chunk) => {
        if (processedElements === 0) {
          await modelRepository.startSnapshot(modelId, chunk.totalElements);
        }

        const persisted = await modelRepository.saveSnapshotChunk(modelId, chunk.elements);
        processedElements = chunk.processedElements;
        totalProperties += persisted.propertyCount;

        await modelRepository.updateSnapshotProgress(modelId, processedElements);
      });

      if (processedElements === 0) {
        await modelRepository.startSnapshot(modelId, extraction.totalElements);
      }

      await modelRepository.completeSnapshot(modelId, {
        totalElements: extraction.totalElements,
        totalProperties,
      });

      this.logInfo(
        { modelId, totalElements: extraction.totalElements, totalProperties },
        'Completed IFC snapshot sync',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown snapshot sync failure';
      await modelRepository.failSnapshot(modelId, message);
      this.logError(error, modelId);
    }
  }
}

export const modelSyncWorker = new ModelSyncWorker();
