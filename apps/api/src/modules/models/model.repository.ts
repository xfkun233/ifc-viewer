import { Prisma, PropertySource, type PropertyValueType } from '@prisma/client';
import { AppError } from '../../core/errors/app-error.js';
import { prisma } from '../../infrastructure/database/prisma.js';
import type {
  AnnotationInput,
  CustomPropertyInput,
  SnapshotElementInput,
} from './model.schemas.js';

const ELEMENT_MAX_BATCH_ROWS = 50;
const PROPERTY_MAX_BATCH_ROWS = 200;
const MAX_BATCH_BYTES = 1024 * 1024;
const MAX_RAW_DATA_BYTES_PER_ELEMENT = 512 * 1024;

type CreateManyBatchExecutor<T> = (rows: T[]) => Promise<void>;

function estimateUtf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function toSafeRawDataJson(
  rawData: SnapshotElementInput['rawData'],
  modelId: string,
  expressId: number,
): Prisma.InputJsonValue | Prisma.NullTypes.DbNull {
  if (rawData === null || rawData === undefined) {
    return Prisma.DbNull;
  }

  const rawDataBytes = estimateUtf8Bytes(rawData);
  if (rawDataBytes > MAX_RAW_DATA_BYTES_PER_ELEMENT) {
    console.warn(
      `[snapshot] drop oversized rawDataJson modelId=${modelId} expressId=${expressId} size=${rawDataBytes}B limit=${MAX_RAW_DATA_BYTES_PER_ELEMENT}B`,
    );
    return Prisma.DbNull;
  }

  return rawData as Prisma.InputJsonValue;
}

async function executeCreateManyInSafeBatches<T>(params: {
  rows: T[];
  maxRowsPerBatch: number;
  maxBytesPerBatch: number;
  entityLabel: string;
  executeBatch: CreateManyBatchExecutor<T>;
}) {
  const { rows, maxRowsPerBatch, maxBytesPerBatch, entityLabel, executeBatch } = params;

  let pendingRows: T[] = [];
  let pendingBytes = 0;

  for (const row of rows) {
    const rowBytes = estimateUtf8Bytes(row);

    if (rowBytes > maxBytesPerBatch) {
      throw new AppError(
        `${entityLabel} 单条记录过大（${rowBytes} bytes），请增大 MySQL max_allowed_packet 或减少单条 JSON 负载`,
        413,
        'SNAPSHOT_ROW_TOO_LARGE',
      );
    }

    const shouldFlush =
      pendingRows.length > 0 &&
      (pendingRows.length >= maxRowsPerBatch || pendingBytes + rowBytes > maxBytesPerBatch);

    if (shouldFlush) {
      await executeBatch(pendingRows);
      pendingRows = [];
      pendingBytes = 0;
    }

    pendingRows.push(row);
    pendingBytes += rowBytes;
  }

  if (pendingRows.length > 0) {
    await executeBatch(pendingRows);
  }
}

function toPropertyPersistenceInput(
  modelId: string,
  expressId: number,
  source: PropertySource,
  property: CustomPropertyInput,
): Prisma.IfcElementPropertyCreateManyInput {
  const numericValue =
    property.valueType === 'REAL' || property.valueType === 'INTEGER'
      ? new Prisma.Decimal(Number(property.value))
      : null;

  const booleanValue = property.valueType === 'BOOLEAN' ? Boolean(property.value) : null;

  return {
    modelId,
    expressId,
    source,
    psetName: property.psetName,
    propertyName: property.propertyName,
    valueType: property.valueType as PropertyValueType,
    valueText: String(property.value),
    numericValue,
    booleanValue,
    rawValueJson: property.value,
  };
}

export class ModelRepository {
  public async createModel(input: {
    originalFileName: string;
    storedFileName: string;
    mimeType: string;
    fileSize: number;
    fileHash: string;
    sourceFingerprint: string;
  }) {
    return prisma.ifcModel.create({
      data: {
        originalFileName: input.originalFileName,
        storedFileName: input.storedFileName,
        mimeType: input.mimeType,
        fileSize: input.fileSize,
        fileHash: input.fileHash,
        sourceFingerprint: input.sourceFingerprint,
      },
    });
  }

  public async findRecentModels(limit = 10) {
    return prisma.ifcModel.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  public async findModelsByFileHash(fileHash: string, limit = 20) {
    return prisma.ifcModel.findMany({
      where: { fileHash },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  public async findModelOrThrow(modelId: string) {
    const model = await prisma.ifcModel.findUnique({
      where: { id: modelId },
    });

    if (!model) {
      throw new AppError('模型不存在', 404, 'MODEL_NOT_FOUND');
    }

    return model;
  }

  public async touchModel(modelId: string) {
    await prisma.ifcModel.update({
      where: { id: modelId },
      data: { lastAccessedAt: new Date() },
    });
  }

  public async queueModelForSync(modelId: string) {
    return prisma.ifcModel.update({
      where: { id: modelId },
      data: {
        syncStatus: 'PENDING',
        syncQueuedAt: new Date(),
        syncError: null,
        syncProcessedElements: 0,
        totalElements: 0,
        totalProperties: 0,
        syncStartedAt: null,
        syncCompletedAt: null,
      },
    });
  }

  public async requeueInterruptedSnapshots() {
    return prisma.ifcModel.updateMany({
      where: { syncStatus: 'PROCESSING' },
      data: {
        syncStatus: 'PENDING',
        syncQueuedAt: new Date(),
        syncError: 'Server restarted before snapshot sync completed.',
        syncProcessedElements: 0,
        syncStartedAt: null,
        syncCompletedAt: null,
      },
    });
  }

  public async claimNextQueuedModel() {
    const candidate = await prisma.ifcModel.findFirst({
      where: { syncStatus: 'PENDING' },
      orderBy: [{ syncQueuedAt: 'asc' }, { createdAt: 'asc' }],
    });

    if (!candidate) {
      return null;
    }

    const claimed = await prisma.ifcModel.updateMany({
      where: {
        id: candidate.id,
        syncStatus: 'PENDING',
      },
      data: {
        syncStatus: 'PROCESSING',
        syncError: null,
        syncQueuedAt: null,
        syncStartedAt: new Date(),
        syncCompletedAt: null,
        syncProcessedElements: 0,
      },
    });

    if (claimed.count === 0) {
      return null;
    }

    return prisma.ifcModel.findUnique({
      where: { id: candidate.id },
    });
  }

  public async startSnapshot(modelId: string, totalElements: number) {
    await prisma.$transaction([
      prisma.ifcElementProperty.deleteMany({
        where: {
          modelId,
          source: PropertySource.NATIVE,
        },
      }),
      prisma.ifcElement.deleteMany({
        where: { modelId },
      }),
      prisma.ifcModel.update({
        where: { id: modelId },
        data: {
          syncStatus: 'PROCESSING',
          syncQueuedAt: null,
          syncError: null,
          syncProcessedElements: 0,
          totalElements,
          totalProperties: 0,
          syncStartedAt: new Date(),
          syncCompletedAt: null,
        },
      }),
    ]);
  }

  public async saveSnapshotChunk(modelId: string, elements: SnapshotElementInput[]) {
    const expressIds = elements.map((element) => element.expressId);

    const elementRows: Prisma.IfcElementCreateManyInput[] = elements.map((element) => ({
      modelId,
      expressId: element.expressId,
      globalId: element.globalId ?? null,
      entityType: element.entityType ?? null,
      name: element.name ?? null,
      objectType: element.objectType ?? null,
      predefinedType: element.predefinedType ?? null,
      attributesJson: element.attributes,
      rawDataJson: toSafeRawDataJson(element.rawData, modelId, element.expressId),
    }));

    const propertyRows: Prisma.IfcElementPropertyCreateManyInput[] = elements.flatMap((element) =>
      element.properties.map((property) =>
        toPropertyPersistenceInput(modelId, element.expressId, PropertySource.NATIVE, {
          expressId: element.expressId,
          psetName: property.psetName,
          propertyName: property.propertyName,
          valueType: property.valueType,
          value: property.value,
        }),
      ),
    );

    await prisma.$transaction(
      async (tx) => {
        // 分批删除，防止 IN 子句过长
        const CHUNK_SIZE = 100;
        for (let i = 0; i < expressIds.length; i += CHUNK_SIZE) {
          const chunkIds = expressIds.slice(i, i + CHUNK_SIZE);
          await tx.ifcElementProperty.deleteMany({
            where: {
              modelId,
              source: PropertySource.NATIVE,
              expressId: { in: chunkIds },
            },
          });

          await tx.ifcElement.deleteMany({
            where: {
              modelId,
              expressId: { in: chunkIds },
            },
          });
        }

        // 按条数和估算字节双阈值分批，避免 createMany SQL 包体超过 max_allowed_packet。
        await executeCreateManyInSafeBatches({
          rows: elementRows,
          maxRowsPerBatch: ELEMENT_MAX_BATCH_ROWS,
          maxBytesPerBatch: MAX_BATCH_BYTES,
          entityLabel: 'IfcElement',
          executeBatch: async (rows) => {
            await tx.ifcElement.createMany({
              data: rows,
              skipDuplicates: true,
            });
          },
        });

        await executeCreateManyInSafeBatches({
          rows: propertyRows,
          maxRowsPerBatch: PROPERTY_MAX_BATCH_ROWS,
          maxBytesPerBatch: MAX_BATCH_BYTES,
          entityLabel: 'IfcElementProperty',
          executeBatch: async (rows) => {
            await tx.ifcElementProperty.createMany({
              data: rows,
              skipDuplicates: true,
            });
          },
        });
      },
      {
        // 增加事务超时时间（默认 5000ms），防止解析大模型写入数据库过久导致事务终止
        maxWait: 10000, // 增加等待连接池的最大时间
        timeout: 60000, // 将事务超时时间改为 60 秒
      },
    );

    return {
      elementCount: elementRows.length,
      propertyCount: propertyRows.length,
    };
  }

  public async updateSnapshotProgress(modelId: string, processedElements: number) {
    await prisma.ifcModel.update({
      where: { id: modelId },
      data: {
        syncProcessedElements: processedElements,
      },
    });
  }

  public async completeSnapshot(modelId: string, totals: { totalElements: number; totalProperties: number }) {
    await prisma.ifcModel.update({
      where: { id: modelId },
      data: {
        syncStatus: 'READY',
        syncQueuedAt: null,
        syncError: null,
        syncProcessedElements: totals.totalElements,
        totalElements: totals.totalElements,
        totalProperties: totals.totalProperties,
        syncCompletedAt: new Date(),
      },
    });
  }

  public async failSnapshot(modelId: string, reason: string | null) {
    await prisma.ifcModel.update({
      where: { id: modelId },
      data: {
        syncStatus: 'FAILED',
        syncQueuedAt: null,
        syncError: reason,
        syncCompletedAt: new Date(),
      },
    });
  }

  public async findSyncQueueModels(limit = 100) {
    return prisma.ifcModel.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  public async bootstrapCustomOverlays(
    modelId: string,
    customProperties: CustomPropertyInput[],
    annotations: AnnotationInput[],
  ) {
    await prisma.$transaction(async (tx) => {
      if (customProperties.length > 0) {
        for (const property of customProperties) {
          await tx.ifcElementProperty.upsert({
            where: {
              modelId_expressId_source_psetName_propertyName: {
                modelId,
                expressId: property.expressId,
                source: PropertySource.CUSTOM,
                psetName: property.psetName,
                propertyName: property.propertyName,
              },
            },
            update: {
              valueType: property.valueType,
              valueText: String(property.value),
              numericValue:
                property.valueType === 'REAL' || property.valueType === 'INTEGER'
                  ? new Prisma.Decimal(Number(property.value))
                  : null,
              booleanValue: property.valueType === 'BOOLEAN' ? Boolean(property.value) : null,
              rawValueJson: property.value,
            },
            create: toPropertyPersistenceInput(modelId, property.expressId, PropertySource.CUSTOM, property),
          });
        }
      }

      if (annotations.length > 0) {
        for (const annotation of annotations) {
          await tx.ifcAnnotation.upsert({
            where: {
              modelId_clientId: {
                modelId,
                clientId: annotation.clientId,
              },
            },
            update: {
              x: new Prisma.Decimal(annotation.x),
              y: new Prisma.Decimal(annotation.y),
              z: new Prisma.Decimal(annotation.z),
              text: annotation.text,
            },
            create: {
              modelId,
              clientId: annotation.clientId,
              x: new Prisma.Decimal(annotation.x),
              y: new Prisma.Decimal(annotation.y),
              z: new Prisma.Decimal(annotation.z),
              text: annotation.text,
            },
          });
        }
      }
    });
  }

  public async listOverlayState(modelId: string) {
    const [customProperties, annotations] = await Promise.all([
      prisma.ifcElementProperty.findMany({
        where: {
          modelId,
          source: PropertySource.CUSTOM,
        },
        orderBy: [{ expressId: 'asc' }, { psetName: 'asc' }, { propertyName: 'asc' }],
      }),
      prisma.ifcAnnotation.findMany({
        where: { modelId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return { customProperties, annotations };
  }

  public async upsertCustomProperty(modelId: string, property: CustomPropertyInput) {
    return prisma.ifcElementProperty.upsert({
      where: {
        modelId_expressId_source_psetName_propertyName: {
          modelId,
          expressId: property.expressId,
          source: PropertySource.CUSTOM,
          psetName: property.psetName,
          propertyName: property.propertyName,
        },
      },
      update: {
        valueType: property.valueType,
        valueText: String(property.value),
        numericValue:
          property.valueType === 'REAL' || property.valueType === 'INTEGER'
            ? new Prisma.Decimal(Number(property.value))
            : null,
        booleanValue: property.valueType === 'BOOLEAN' ? Boolean(property.value) : null,
        rawValueJson: property.value,
      },
      create: toPropertyPersistenceInput(modelId, property.expressId, PropertySource.CUSTOM, property),
    });
  }

  public async deleteCustomProperty(modelId: string, propertyId: string) {
    const existing = await prisma.ifcElementProperty.findFirst({
      where: {
        id: propertyId,
        modelId,
        source: PropertySource.CUSTOM,
      },
    });

    if (!existing) {
      throw new AppError('自定义属性不存在', 404, 'CUSTOM_PROPERTY_NOT_FOUND');
    }

    await prisma.ifcElementProperty.delete({
      where: { id: propertyId },
    });
  }

  public async upsertAnnotation(modelId: string, annotation: AnnotationInput) {
    return prisma.ifcAnnotation.upsert({
      where: {
        modelId_clientId: {
          modelId,
          clientId: annotation.clientId,
        },
      },
      update: {
        x: new Prisma.Decimal(annotation.x),
        y: new Prisma.Decimal(annotation.y),
        z: new Prisma.Decimal(annotation.z),
        text: annotation.text,
      },
      create: {
        modelId,
        clientId: annotation.clientId,
        x: new Prisma.Decimal(annotation.x),
        y: new Prisma.Decimal(annotation.y),
        z: new Prisma.Decimal(annotation.z),
        text: annotation.text,
      },
    });
  }

  public async deleteAnnotation(modelId: string, annotationId: string) {
    const existing = await prisma.ifcAnnotation.findFirst({
      where: {
        modelId,
        clientId: annotationId,
      },
    });

    if (!existing) {
      throw new AppError('标注不存在', 404, 'ANNOTATION_NOT_FOUND');
    }

    await prisma.ifcAnnotation.delete({
      where: { id: existing.id },
    });
  }
}

export const modelRepository = new ModelRepository();
