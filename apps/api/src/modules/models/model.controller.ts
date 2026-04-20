import fs from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../core/errors/app-error.js';
import {
  annotationSchema,
  bootstrapOverlaysSchema,
  completeSnapshotSchema,
  customPropertySchema,
  failSnapshotSchema,
  startSnapshotSchema,
  uploadSnapshotChunkSchema,
} from './model.schemas.js';
import { modelService } from './model.service.js';

const paramsSchema = z.object({
  modelId: z.string().min(1),
});

const propertyParamsSchema = z.object({
  modelId: z.string().min(1),
  propertyId: z.string().min(1),
});

const annotationParamsSchema = z.object({
  modelId: z.string().min(1),
  annotationId: z.string().min(1),
});

export const modelController: FastifyPluginAsync = async (app) => {
  app.get('/models', async () => {
    const models = await modelService.listRecentModels();
    return { items: models };
  });

  app.get('/sync-queue', async () => {
    const items = await modelService.listSyncQueue();
    return { items };
  });

  app.post('/models/upload', async (request, reply) => {
    const file = await request.file();

    if (!file) {
      throw new AppError('缺少上传文件', 400, 'FILE_REQUIRED');
    }

    const buffer = await file.toBuffer();
    const model = await modelService.uploadModel({
      fileName: file.filename,
      mimeType: file.mimetype,
      buffer,
    });

    return reply.status(201).send({ item: model });
  });

  app.get('/models/:modelId', async (request) => {
    const { modelId } = paramsSchema.parse(request.params);
    const item = await modelService.getModel(modelId);
    return { item };
  });

  app.post('/models/:modelId/requeue-sync', async (request, reply) => {
    const { modelId } = paramsSchema.parse(request.params);
    const item = await modelService.requeueModelSync(modelId);
    return reply.status(202).send({ item });
  });

  app.get('/models/:modelId/file', async (request, reply) => {
    const { modelId } = paramsSchema.parse(request.params);
    const descriptor = await modelService.getModelFileDescriptor(modelId);
    const stream = fs.createReadStream(descriptor.absolutePath);

    reply.header('content-type', descriptor.mimeType);
    reply.header(
      'content-disposition',
      `attachment; filename="${encodeURIComponent(descriptor.downloadFileName)}"`,
    );

    return reply.send(stream);
  });

  app.post('/models/:modelId/snapshot/start', async (request, reply) => {
    const { modelId } = paramsSchema.parse(request.params);
    const payload = startSnapshotSchema.parse(request.body);
    const item = await modelService.startSnapshot(modelId, payload);
    return reply.status(202).send({ item });
  });

  app.post('/models/:modelId/snapshot/chunk', async (request, reply) => {
    const { modelId } = paramsSchema.parse(request.params);
    const payload = uploadSnapshotChunkSchema.parse(request.body);
    const item = await modelService.saveSnapshotChunk(modelId, payload.elements);
    return reply.status(202).send({
      item: {
        chunkIndex: payload.chunkIndex,
        ...item,
      },
    });
  });

  app.post('/models/:modelId/snapshot/complete', async (request, reply) => {
    const { modelId } = paramsSchema.parse(request.params);
    const payload = completeSnapshotSchema.parse(request.body);
    const item = await modelService.completeSnapshot(modelId, payload);
    return reply.status(200).send({ item });
  });

  app.post('/models/:modelId/snapshot/fail', async (request, reply) => {
    const { modelId } = paramsSchema.parse(request.params);
    const payload = failSnapshotSchema.parse(request.body);
    const item = await modelService.failSnapshot(modelId, payload.reason);
    return reply.status(200).send({ item });
  });

  app.get('/models/:modelId/overlays', async (request) => {
    const { modelId } = paramsSchema.parse(request.params);
    const item = await modelService.getOverlayState(modelId);
    return { item };
  });

  app.post('/models/:modelId/overlays/bootstrap', async (request, reply) => {
    const { modelId } = paramsSchema.parse(request.params);
    const payload = bootstrapOverlaysSchema.parse(request.body);
    const item = await modelService.bootstrapOverlays(modelId, payload);
    return reply.status(202).send({ item });
  });

  app.put('/models/:modelId/custom-properties', async (request, reply) => {
    const { modelId } = paramsSchema.parse(request.params);
    const payload = customPropertySchema.parse(request.body);
    const item = await modelService.upsertCustomProperty(modelId, payload);
    return reply.status(200).send({ item });
  });

  app.delete('/models/:modelId/custom-properties/:propertyId', async (request, reply) => {
    const { modelId, propertyId } = propertyParamsSchema.parse(request.params);
    await modelService.deleteCustomProperty(modelId, propertyId);
    return reply.status(204).send();
  });

  app.put('/models/:modelId/annotations', async (request, reply) => {
    const { modelId } = paramsSchema.parse(request.params);
    const payload = annotationSchema.parse(request.body);
    const item = await modelService.upsertAnnotation(modelId, payload);
    return reply.status(200).send({ item });
  });

  app.delete('/models/:modelId/annotations/:annotationId', async (request, reply) => {
    const { modelId, annotationId } = annotationParamsSchema.parse(request.params);
    await modelService.deleteAnnotation(modelId, annotationId);
    return reply.status(204).send();
  });
};
