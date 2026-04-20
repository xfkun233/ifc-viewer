import type { FastifyPluginAsync } from 'fastify';

export const healthController: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));
};
