import type { IfcAnnotation, IfcElementProperty, IfcModel } from '@prisma/client';
import { AppError } from '../../core/errors/app-error.js';
import { fileStorageService } from '../../infrastructure/storage/file-storage.service.js';
import { deriveIfcLineage } from '../../shared/utils/ifc-lineage.js';
import { modelSyncWorker } from './model-sync.worker.js';
import type {
  AnnotationInput,
  BootstrapOverlaysInput,
  CompleteSnapshotInput,
  CustomPropertyInput,
  SnapshotElementInput,
  StartSnapshotInput,
} from './model.schemas.js';
import { modelRepository } from './model.repository.js';

function serializeModel(model: IfcModel) {
  return {
    id: model.id,
    originalFileName: model.originalFileName,
    storedFileName: model.storedFileName,
    mimeType: model.mimeType,
    fileSize: model.fileSize,
    fileHash: model.fileHash,
    sourceFingerprint: model.sourceFingerprint,
    syncStatus: model.syncStatus,
    syncQueuedAt: model.syncQueuedAt,
    syncError: model.syncError,
    syncProcessedElements: model.syncProcessedElements,
    totalElements: model.totalElements,
    totalProperties: model.totalProperties,
    syncStartedAt: model.syncStartedAt,
    syncCompletedAt: model.syncCompletedAt,
    lastAccessedAt: model.lastAccessedAt,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

function serializeProperty(property: IfcElementProperty) {
  return {
    id: property.id,
    expressId: property.expressId,
    psetName: property.psetName,
    propertyName: property.propertyName,
    valueType: property.valueType,
    value:
      property.booleanValue ?? property.numericValue?.toNumber() ?? (property.rawValueJson as string | number | boolean),
    createdAt: property.createdAt,
    updatedAt: property.updatedAt,
  };
}

function serializeAnnotation(annotation: IfcAnnotation) {
  return {
    id: annotation.clientId,
    databaseId: annotation.id,
    x: annotation.x.toNumber(),
    y: annotation.y.toNumber(),
    z: annotation.z.toNumber(),
    text: annotation.text,
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
  };
}

export class ModelService {
  public async uploadModel(file: {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
  }) {
    if (!file.fileName.toLowerCase().endsWith('.ifc')) {
      throw new AppError('仅支持上传 .ifc 文件', 400, 'INVALID_FILE_TYPE');
    }

    const lineage = deriveIfcLineage(file.buffer);
    if (lineage.embeddedMetadata && lineage.embeddedMetadata.sourceFingerprint !== lineage.baseContentHash) {
      throw new AppError(
        'IFC 鏂囦欢鍝堝笇鏍￠獙澶辫触锛岃妫€鏌ユ簮鏂囦欢鏄惁琚牬鍧?',
        400,
        'IFC_HASH_VALIDATION_FAILED',
      );
    }

    const reusableModels = await modelRepository.findModelsByFileHash(lineage.fileHash);
    const reusableModel =
      reusableModels.find((model) => model.syncStatus === 'READY') ??
      reusableModels.find((model) => model.syncStatus === 'PROCESSING') ??
      reusableModels.find((model) => model.syncStatus === 'PENDING') ??
      reusableModels[0];
    if (reusableModel) {
      if (reusableModel.syncStatus === 'FAILED') {
        const queuedModel = await modelRepository.queueModelForSync(reusableModel.id);
        modelSyncWorker.notify();
        return serializeModel(queuedModel);
      }

      return serializeModel(reusableModel);
    }

    const descriptor = await fileStorageService.saveIfcFile(file.fileName, file.buffer);
    const model = await modelRepository.createModel({
      originalFileName: file.fileName,
      storedFileName: descriptor.storedFileName,
      mimeType: file.mimeType || 'application/octet-stream',
      fileSize: file.buffer.byteLength,
      fileHash: lineage.fileHash,
      sourceFingerprint: lineage.sourceFingerprint,
    });

    const queuedModel = await modelRepository.queueModelForSync(model.id);
    modelSyncWorker.notify();
    return serializeModel(queuedModel);
  }

  public async listRecentModels() {
    const models = await modelRepository.findRecentModels();
    return models.map(serializeModel);
  }

  public async getModel(modelId: string) {
    const model = await modelRepository.findModelOrThrow(modelId);
    return serializeModel(model);
  }

  public async listSyncQueue() {
    const models = await modelRepository.findSyncQueueModels();
    const statusPriority = new Map([
      ['PROCESSING', 0],
      ['PENDING', 1],
      ['FAILED', 2],
      ['READY', 3],
    ]);

    return models
      .slice()
      .sort((left, right) => {
        const leftPriority = statusPriority.get(left.syncStatus) ?? 99;
        const rightPriority = statusPriority.get(right.syncStatus) ?? 99;

        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        const leftTime = left.syncQueuedAt?.getTime() ?? left.updatedAt.getTime();
        const rightTime = right.syncQueuedAt?.getTime() ?? right.updatedAt.getTime();
        return rightTime - leftTime;
      })
      .map(serializeModel);
  }

  public async requeueModelSync(modelId: string) {
    await modelRepository.findModelOrThrow(modelId);
    const model = await modelRepository.queueModelForSync(modelId);
    modelSyncWorker.notify();
    return serializeModel(model);
  }

  public async getModelFileDescriptor(modelId: string) {
    const model = await modelRepository.findModelOrThrow(modelId);
    await modelRepository.touchModel(modelId);

    return {
      model: serializeModel(model),
      absolutePath: fileStorageService.resolveAbsolutePath(model.storedFileName),
      mimeType: model.mimeType,
      downloadFileName: model.originalFileName,
    };
  }

  public async startSnapshot(modelId: string, input: StartSnapshotInput) {
    await modelRepository.findModelOrThrow(modelId);
    await modelRepository.startSnapshot(modelId, input.totalElements);

    return {
      modelId,
      totalElements: input.totalElements,
      totalChunks: input.totalChunks,
      status: 'PROCESSING',
    };
  }

  public async saveSnapshotChunk(modelId: string, elements: SnapshotElementInput[]) {
    await modelRepository.findModelOrThrow(modelId);
    return modelRepository.saveSnapshotChunk(modelId, elements);
  }

  public async completeSnapshot(modelId: string, input: CompleteSnapshotInput) {
    await modelRepository.findModelOrThrow(modelId);
    await modelRepository.completeSnapshot(modelId, {
      totalElements: input.totalElements,
      totalProperties: input.totalProperties,
    });

    return {
      modelId,
      status: 'READY',
      totalElements: input.totalElements,
      totalProperties: input.totalProperties,
    };
  }

  public async failSnapshot(modelId: string, reason: string | null) {
    await modelRepository.findModelOrThrow(modelId);
    await modelRepository.failSnapshot(modelId, reason);

    return {
      modelId,
      status: 'FAILED',
      reason,
    };
  }

  public async bootstrapOverlays(modelId: string, input: BootstrapOverlaysInput) {
    await modelRepository.findModelOrThrow(modelId);
    await modelRepository.bootstrapCustomOverlays(modelId, input.customProperties, input.annotations);

    return this.getOverlayState(modelId);
  }

  public async getOverlayState(modelId: string) {
    await modelRepository.findModelOrThrow(modelId);
    const state = await modelRepository.listOverlayState(modelId);

    return {
      customProperties: state.customProperties.map(serializeProperty),
      annotations: state.annotations.map(serializeAnnotation),
    };
  }

  public async upsertCustomProperty(modelId: string, property: CustomPropertyInput) {
    const persisted = await modelRepository.upsertCustomProperty(modelId, property);
    return serializeProperty(persisted);
  }

  public async deleteCustomProperty(modelId: string, propertyId: string) {
    await modelRepository.deleteCustomProperty(modelId, propertyId);
  }

  public async upsertAnnotation(modelId: string, annotation: AnnotationInput) {
    const persisted = await modelRepository.upsertAnnotation(modelId, annotation);
    return serializeAnnotation(persisted);
  }

  public async deleteAnnotation(modelId: string, annotationId: string) {
    await modelRepository.deleteAnnotation(modelId, annotationId);
  }
}

export const modelService = new ModelService();
