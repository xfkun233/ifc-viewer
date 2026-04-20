import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { setErrorHandler } from './core/http/set-error-handler.js';
import { prisma } from './infrastructure/database/prisma.js';
import { healthController } from './modules/health/health.controller.js';
import { modelController } from './modules/models/model.controller.js';

export function createApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
    },
    bodyLimit: 100 * 1024 * 1024,
  });

  void app.register(cors, {
    origin: env.CLIENT_ORIGIN,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  void app.register(multipart, {
    limits: {
      fileSize: 1024 * 1024 * 1024,
      files: 1,
    },
  });

  setErrorHandler(app);

  void app.register(healthController, { prefix: '/api' });
  void app.register(modelController, { prefix: '/api' });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return app;
}
