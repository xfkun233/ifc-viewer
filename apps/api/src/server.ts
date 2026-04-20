import { createApp } from './app.js';
import { env } from './config/env.js';
import { modelSyncWorker } from './modules/models/model-sync.worker.js';

async function bootstrap() {
  const app = createApp();

  app.addHook('onClose', async () => {
    await modelSyncWorker.stop();
  });

  try {
    await modelSyncWorker.start(app.log);
    await app.listen({
      host: env.HOST,
      port: env.PORT,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void bootstrap();
