import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error.js';

export function setErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    // 增加详细的后端报错日志输出，便于本地和线上排查问题
    console.error(`[后端报错] ${request.method} ${request.url} 发生异常:`, error);
    request.log.error({ err: error }, error.message);

    if (error instanceof AppError) {
      void reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
      });
      return;
    }

    if (error instanceof ZodError) {
      void reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        issues: error.issues,
      });
      return;
    }

    void reply.status(500).send({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
    });
  });
}
